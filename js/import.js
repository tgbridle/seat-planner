"use strict";
// Importing a guest list from a spreadsheet (Excel, CSV, Numbers, ODS).
//
// It looks for the columns it understands by their headings:
//   Name / Guest / Full name     or   First name + Last name
//   Table                        (optional) which table they sit at
//   Party / Group / Household    (optional) people to keep together
//   RSVP / Attending / Status    (optional) to leave out people who declined
// With no headings, it uses the column that looks most like names.
//
// Then it asks where to seat everyone: at the tables from the Table
// column, filling tables automatically, or under "Guest list (unseated)".

const SHEET_LIBRARY = {
  // SheetJS, loaded only when someone imports. The integrity hash makes the
  // browser refuse the file if it's ever different from the one we checked.
  src: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  integrity: "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT",
};

let sheetLibrary = null;

function loadSheetLibrary() {
  sheetLibrary ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEET_LIBRARY.src;
    script.integrity = SHEET_LIBRARY.integrity;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => { sheetLibrary = null; reject(new Error("Couldn't load the spreadsheet reader")); };
    document.head.append(script);
  });
  return sheetLibrary;
}

// The first sheet, as rows of cell text.
async function readSpreadsheet(file) {
  const XLSX = await loadSheetLibrary();
  const workbook = XLSX.read(await file.arrayBuffer());
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false })
    .slice(0, MAX_GUESTS + 20)
    .map(row => row.map(cell => cleanText(cell)));
}

// ================= Understanding the sheet =================

const HEADINGS = {
  first: /^(first|given|fore) ?names?$|^first$/,
  last: /^(last|sur|family) ?names?$|^surname$|^last$/,
  name: /^(full |guest |guests |attendee |invitee )?names?$|^guests?$|^name of guest$|^attendees?$|^invitees?$/,
  table: /^table( ?(name|no|number|#|assignment))?$|^seating$/,
  group: /^(party|group|household|family|invite|invitation)( ?(name|id|no|number))?$/,
  rsvp: /^rsvp( ?status)?$|^attending$|^response$|^status$/,
};
const DECLINED = /^(no|n|declined?|not attending|regrets?|can'?t come|cannot attend)$/i;

const headingKey = text => text.toLowerCase().replace(/[^a-z0-9# ]/g, "").replace(/\s+/g, " ").trim();

// Which column holds what, from a heading row.
function matchHeadings(row) {
  const columns = {};
  row.forEach((cell, i) => {
    const key = headingKey(cell);
    for (const [field, pattern] of Object.entries(HEADINGS)) {
      if (columns[field] == null && pattern.test(key)) { columns[field] = i; break; }
    }
  });
  const hasNames = columns.name != null || columns.first != null;
  return hasNames ? columns : null;
}

// With no headings: the column with the most text that isn't just numbers.
function guessNameColumn(rows) {
  const scores = [];
  for (const row of rows.slice(0, 50)) {
    row.forEach((cell, i) => { if (/[a-z]/i.test(cell)) scores[i] = (scores[i] || 0) + 1; });
  }
  let best = -1;
  scores.forEach((score, i) => { if (best === -1 || score > scores[best]) best = i; });
  return best;
}

// Returns { guests: [{ name, table, group, declined }], columns: { what: heading } }
function analyzeRows(rows) {
  let headerIndex = -1, columns = null;
  for (let i = 0; i < Math.min(rows.length, 10) && !columns; i++) {
    columns = matchHeadings(rows[i]);
    if (columns) headerIndex = i;
  }
  if (!columns) columns = { name: guessNameColumn(rows) };
  const header = rows[headerIndex] || [];
  const cell = (row, field) => (columns[field] == null ? "" : row[columns[field]] || "");

  const guests = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const name = cleanText(cell(row, "name") || [cell(row, "first"), cell(row, "last")].join(" "));
    if (!name) continue;
    guests.push({
      name,
      table: cleanText(cell(row, "table"), 80),
      group: cell(row, "group").toLowerCase(),
      declined: DECLINED.test(cell(row, "rsvp")),
    });
    if (guests.length >= MAX_GUESTS) break;
  }

  const described = {};
  const heading = field => header[columns[field]] || "";
  if (columns.name != null) described.names = heading("name") || "the first text column";
  else described.names = [heading("first"), heading("last")].filter(Boolean).join(" + ");
  for (const field of ["table", "group", "rsvp"]) {
    if (columns[field] != null) described[field] = heading(field);
  }
  return { guests, columns: described };
}

// ================= Seating the imported guests =================

// Natural order, so "Table 2" comes before "Table 10".
const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Matches "3" to a table called "Table 3", and names case-insensitively.
function findTableByLabel(p, label) {
  const key = label.toLowerCase();
  return p.tables.find(t => t.name.toLowerCase() === key || t.name.toLowerCase() === "table " + key);
}

function seatByTableColumn(p, guests) {
  const last = lastTable(p);
  const labels = [...new Set(guests.map(g => g.table).filter(Boolean))].sort(naturalSort);
  for (const label of labels) {
    if (findTableByLabel(p, label)) continue;
    const table = newTable(p, last.shape, last.seats.length);
    table.name = /^\d+$/.test(label) ? "Table " + label : label;
    p.tables.push(table);
  }
  for (const g of guests) {
    if (g.table) seatGuest(findTableByLabel(p, g.table), newGuest(g.name));
    else p.unseated.push(newGuest(g.name));
  }
}

// Fills empty seats in table order, adding tables like the last one as
// needed. With keepGroups, people in the same party sit together (a party
// bigger than a table is split across tables).
function seatAutomatically(p, guests, keepGroups) {
  const last = lastTable(p);
  const size = last.seats.length;
  const units = [];
  const byGroup = new Map();
  for (const g of guests) {
    if (keepGroups && g.group) {
      if (!byGroup.has(g.group)) { byGroup.set(g.group, []); units.push(byGroup.get(g.group)); }
      byGroup.get(g.group).push(g);
    } else {
      units.push([g]);
    }
  }
  for (const unit of units) {
    for (let i = 0; i < unit.length; i += size) {
      const chunk = unit.slice(i, i + size);
      let table = p.tables.find(t => freeSeats(t) >= chunk.length);
      if (!table) {
        table = newTable(p, last.shape, size);
        p.tables.push(table);
      }
      for (const g of chunk) seatGuest(table, newGuest(g.name));
    }
  }
}

// Works out which guests will actually be added, given the choices made.
function prepareImport(p, guests, { replace, skipDeclined }) {
  const existing = new Set(replace ? [] : allGuests(p).map(g => g.name.toLowerCase()));
  const declined = skipDeclined ? guests.filter(g => g.declined) : [];
  const fresh = guests.filter(g => !(skipDeclined && g.declined));
  const added = fresh.filter(g => !existing.has(g.name.toLowerCase()));
  return { added, duplicates: fresh.length - added.length, declined: declined.length };
}

function importGuests(guests, options) {
  const prepared = prepareImport(store.plan, guests, options);
  store.commit(p => {
    if (options.replace) {
      for (const t of p.tables) t.seats = t.seats.map(() => null);
      p.unseated = [];
    }
    if (options.mode === "table") seatByTableColumn(p, prepared.added);
    else if (options.mode === "auto") seatAutomatically(p, prepared.added, options.keepGroups);
    else p.unseated.push(...prepared.added.map(g => newGuest(g.name)));
  });
  viewport.fit();
  toast(`Imported ${plural(prepared.added.length, "guest")}`, { label: "Undo", run: () => store.undo() });
}

// ================= The import dialog =================

const fileInput = document.getElementById("importFile");

// Placeholder guests ("Guest 1", "Guest 2"...) are fine to replace.
const onlyPlaceholders = p => allGuests(p).every(g => /^Guest \d+$/.test(g.name));

// Step 1: what kind of file works, with a template to start from.
function startImport() {
  const body = el("div", "dialog-body");
  body.append(
    el("h2", "serif", "Import a guest list"),
    el("p", null, "Choose an Excel, CSV or Numbers file with one guest per row. "
      + "Put the names in a Name column (or First name and Last name)."),
    el("p", "hint", "Optional columns: Table (where they sit), Party (people to keep together) "
      + "and RSVP (so anyone who said no is left out). You'll see what was found before anything changes."),
  );
  const choose = textButton("btn primary", "Choose file", () => fileInput.click());
  openDialog(body, dialogFoot(templateButton(), textButton("btn", "Cancel", closeDialog), choose));
  choose.focus();
}

function templateButton() {
  const b = labelButton("btn push-left", ICONS.download, "Download a template", downloadTemplate);
  b.title = "A sample spreadsheet with the columns filled in";
  return b;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = ""; // so choosing the same file again still counts as a change
  if (!file) return;
  const reading = el("div", "dialog-body");
  reading.append(el("h2", "serif", "Reading " + file.name + "…"));
  openDialog(reading, dialogFoot());
  let rows;
  try {
    rows = await readSpreadsheet(file);
  } catch (err) {
    console.error(err);
    closeDialog();
    toast(navigator.onLine === false
      ? "You're offline. The spreadsheet reader needs an internet connection."
      : "Sorry, that file couldn't be read. Try saving it as .xlsx or .csv.");
    return;
  }
  const result = analyzeRows(rows);
  if (!result.guests.length) {
    closeDialog();
    toast("No guest names found in that file.");
    return;
  }
  showImportDialog(file.name, result);
});

function radio(name, value, title, detail, checked) {
  const label = el("label", "choice");
  const input = el("input");
  Object.assign(input, { type: "radio", name, value, checked });
  const text = el("div");
  text.append(el("strong", null, title), el("span", null, detail));
  label.append(input, text);
  return label;
}

function checkbox(text, checked) {
  const label = el("label", "check");
  const input = el("input");
  Object.assign(input, { type: "checkbox", checked });
  label.append(input, el("span", null, text));
  return { label, input };
}

function showImportDialog(fileName, { guests, columns }) {
  const p = store.plan;
  const tableLabels = new Set(guests.map(g => g.table).filter(Boolean));
  const groups = new Set(guests.map(g => g.group).filter(Boolean));
  const declinedCount = guests.filter(g => g.declined).length;

  const body = el("div", "dialog-body");
  body.append(el("h2", "serif", "Import guests"));

  // What we found
  const found = el("p", "found");
  found.append("Found ", el("strong", null, plural(guests.length, "guest")), " in " + fileName + ".");
  const preview = el("div", "preview");
  for (const g of guests.slice(0, 12)) preview.append(el("span", "chip", g.name));
  if (guests.length > 12) preview.append(el("span", "chip more", `and ${guests.length - 12} more`));
  const usedColumns = [`Names from "${columns.names}"`];
  if (columns.table) usedColumns.push(`tables from "${columns.table}"`);
  if (columns.group) usedColumns.push(`parties from "${columns.group}"`);
  if (columns.rsvp) usedColumns.push(`RSVPs from "${columns.rsvp}"`);
  body.append(found, el("p", "hint", usedColumns.join(", ") + "."), preview);

  // Where to seat them
  const seating = el("div", "dialog-section");
  seating.append(el("h3", null, "Where should they sit?"));
  const mode = tableLabels.size ? "table" : "auto";
  if (tableLabels.size) {
    seating.append(radio("mode", "table", "Use the table column",
      `Seats people at ${plural(tableLabels.size, "table")} from your file, adding any that don't exist yet.`, true));
  }
  const last = lastTable(p);
  seating.append(
    radio("mode", "auto", "Seat them automatically",
      `Fills empty seats, then adds tables of ${last.seats.length} as needed.`, mode === "auto"),
    radio("mode", "none", "Don't seat them yet", "Everyone goes on the unseated guest list for you to arrange.", false),
  );
  const keepGroups = checkbox(`Keep parties together (${plural(groups.size, "party", "parties")} found)`, true);
  if (groups.size) seating.append(keepGroups.label);
  body.append(seating);

  // Options
  const options = el("div", "dialog-section");
  options.append(el("h3", null, "Options"));
  const replace = checkbox("Replace the guests already in this plan", onlyPlaceholders(p));
  const skipDeclined = checkbox(`Leave out ${plural(declinedCount, "guest")} who declined`, true);
  options.append(replace.label);
  if (declinedCount) options.append(skipDeclined.label);
  const note = el("p", "hint");
  options.append(note);
  body.append(options);

  const chosen = () => ({
    mode: body.querySelector("input[name=mode]:checked").value,
    keepGroups: groups.size > 0 && keepGroups.input.checked,
    replace: replace.input.checked,
    skipDeclined: declinedCount > 0 && skipDeclined.input.checked,
  });

  const go = textButton("btn primary", "", () => {
    closeDialog();
    importGuests(guests, chosen());
  });

  // Keep the button and note in step with the choices.
  const update = () => {
    const opts = chosen();
    const { added, duplicates } = prepareImport(p, guests, opts);
    keepGroups.label.hidden = opts.mode !== "auto";
    go.textContent = `Import ${plural(added.length, "guest")}`;
    go.disabled = added.length === 0;
    note.textContent = duplicates ? `${plural(duplicates, "guest is", "guests are")} already in your plan and will be skipped.` : "";
  };
  body.addEventListener("change", update);
  update();

  openDialog(body, dialogFoot(textButton("btn", "Cancel", closeDialog), go));
  go.focus();
}

function downloadTemplate() {
  const csv = [
    "First name,Last name,Table,Party,RSVP",
    "Jane,Smith,1,Smith family,Yes",
    "John,Smith,1,Smith family,Yes",
    "Priya,Patel,2,,Yes",
    "Tom,Brown,,,No",
  ].join("\r\n");
  downloadFile("guest-list-template.csv", csv, "text/csv");
}
