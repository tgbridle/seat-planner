"use strict";
// Drawing the plan: the tables on the floor, the guest list and the totals.
// The page is redrawn from the plan after every change.

// What's highlighted on screen. Not part of the plan, so not undoable.
const ui = {
  selectedTableId: null, // its menu stays showing
  hoverTableId: null,    // the table the mouse is over (or just left)
  cardGuestId: null,     // guest whose details card is open
  cardSource: "floor",   // where the card opened: "floor" or "panel"
};

const roomEl = document.getElementById("room");
const panelEl = document.getElementById("panel");
const listEl = document.getElementById("list");
const eventNameEl = document.getElementById("eventName");

function render() {
  const p = store.plan;
  if (ui.selectedTableId && !findTable(p, ui.selectedTableId)) ui.selectedTableId = null;
  document.body.classList.toggle("read-only", store.readOnly);
  eventNameEl.textContent = p.eventName;
  document.title = p.eventName + " · Seat Planner";
  renderStats(p);
  roomEl.replaceChildren(...p.tables.map(renderTable));
  listEl.replaceChildren(
    renderUnseated(p),
    ...p.tables.map(renderGroup),
    ...(store.readOnly ? [] : [renderAddTableRow()]),
  );
  selectTable(ui.selectedTableId);
  updateHistoryButtons();
  viewport.refresh(); // the plan's size may have changed
  if (ui.cardGuestId) drawCard();
}

// "20 total guests / 19 seated (1 unseated)", plus a progress bar.
function renderStats(p) {
  const total = allGuests(p).length, unseated = p.unseated.length, seated = total - unseated;
  document.getElementById("total").textContent = total;
  document.getElementById("totalLabel").textContent = total === 1 ? "total guest" : "total guests";
  document.getElementById("seated").textContent = seated;
  const note = document.getElementById("unseatedNote");
  note.textContent = `(${unseated} unseated)`;
  note.classList.toggle("some", unseated > 0);
  document.getElementById("meterFill").style.width = (total ? (seated / total) * 100 : 0) + "%";
  renderCapacity(p, total);
}

// Venue capacity, with places left (or how many over) for the guest total.
function renderCapacity(p, total) {
  const cap = p.venueCapacity;
  const box = document.getElementById("capacity");
  box.hidden = store.readOnly && cap == null;
  const button = document.getElementById("capacityBtn");
  button.disabled = store.readOnly;
  button.classList.toggle("unset", cap == null);
  button.textContent = cap == null ? "Set capacity" : cap;
  const note = document.getElementById("capacityNote");
  note.textContent = cap == null ? "" : total > cap ? `${total - cap} over capacity` : `${plural(cap - total, "place")} left`;
  note.classList.toggle("over", cap != null && total > cap);
}

// Click the capacity to type a new one. Enter or click away saves;
// Escape cancels; clearing it removes the capacity.
function editCapacity() {
  const button = document.getElementById("capacityBtn");
  const input = el("input", "capacity-input");
  Object.assign(input, { type: "number", min: 1, max: MAX_CAPACITY, step: 1, inputMode: "numeric", value: store.plan.venueCapacity ?? "" });
  input.setAttribute("aria-label", "Venue capacity");
  let cancelled = false;
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { cancelled = true; input.blur(); }
  });
  input.addEventListener("blur", () => {
    input.replaceWith(button);
    const value = input.value.trim();
    const n = Math.round(Number(value));
    if (cancelled) return;
    if (value === "") setVenueCapacity(null);
    else if (n >= 1 && n <= MAX_CAPACITY) setVenueCapacity(n);
    else toast(`Venue capacity must be between 1 and ${MAX_CAPACITY.toLocaleString()}`);
  });
  button.replaceWith(input);
  input.focus();
  input.select();
}

function updateHistoryButtons() {
  document.getElementById("undo").disabled = !store.canUndo;
  document.getElementById("redo").disabled = !store.canRedo;
}

// Update names everywhere after a rename, without redrawing.
function syncText() {
  const p = store.plan;
  eventNameEl.textContent = p.eventName;
  document.title = p.eventName + " · Seat Planner";
  for (const table of p.tables) {
    document.querySelectorAll(`[data-tname="${table.id}"]`).forEach(n => { n.textContent = table.name; });
  }
  for (const g of allGuests(p)) {
    document.querySelectorAll(`[data-gname="${g.id}"]`).forEach(n => { n.textContent = g.name; });
    document.querySelectorAll(`[data-seat="${g.id}"]`).forEach(n => { n.textContent = initials(g.name); });
    document.querySelectorAll(`[data-guest="${g.id}"]`).forEach(n => { n.title = g.name; });
  }
  updateHistoryButtons();
}

// "Guest 7" -> "G7", "Anna Smith" -> "AS"
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

function countText(table) {
  const n = guestsOf(table).length, c = table.seats.length;
  return `${n} / ${c}` + (n === c ? " · Full" : "");
}

// ================= Selection and table menus =================
// The selected table always shows its menu. The table under the mouse
// shows it too, and keeps it for 5 seconds after the mouse leaves, unless
// the mouse moves onto another table or you click somewhere else.

const MENU_LINGER = 5000;
let hoverTimer = null;

function selectTable(tableId) {
  ui.selectedTableId = tableId;
  document.querySelectorAll("[data-table]").forEach(n => n.classList.toggle("selected", n.dataset.table === tableId));
  showMenus();
}

function showMenus() {
  roomEl.querySelectorAll(".table-wrap").forEach(w =>
    w.classList.toggle("menu-open", w.dataset.table === ui.selectedTableId || w.dataset.table === ui.hoverTableId));
}

function setHoverTable(tableId) {
  clearTimeout(hoverTimer);
  ui.hoverTableId = tableId;
  showMenus();
}

function hoverMenu(wrap, tableId) {
  wrap.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") setHoverTable(tableId); });
  wrap.addEventListener("pointerleave", e => {
    if (e.pointerType !== "mouse" || ui.hoverTableId !== tableId) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => setHoverTable(null), MENU_LINGER);
  });
}

document.addEventListener("pointerdown", e => {
  if (ui.hoverTableId && !e.target.closest(`.table-wrap[data-table="${ui.hoverTableId}"]`)) setHoverTable(null);
});

// Selects a table and brings it into view, on the floor and in the list.
function focusTable(tableId) {
  if (!tableId) return;
  selectTable(tableId);
  const table = findTable(store.plan, tableId);
  if (table) viewport.reveal(box(table));
  const group = listEl.querySelector(`.group[data-table="${tableId}"]`);
  if (group) group.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ================= Tables on the floor =================

function renderTable(table) {
  const editable = !store.readOnly;
  const g = geometry(table);
  const { W, H, cx, cy } = g;
  const b = box(table, g);

  const wrap = el("div", "table-wrap");
  wrap.dataset.table = table.id;
  Object.assign(wrap.style, { left: b.left + "px", top: b.top + "px", width: g.width + "px", height: g.height + "px" });

  // Table top: shows the name and count; drag it to move the table.
  const surface = el("div", "surface shape-" + table.shape);
  Object.assign(surface.style, { left: cx - W / 2 + "px", top: cy - H / 2 + "px", width: W + "px", height: H + "px" });
  const tname = el("span", "tname", table.name);
  tname.dataset.tname = table.id;
  const count = el("span", "tcount", countText(table));
  count.classList.toggle("full", guestsOf(table).length === table.seats.length);
  surface.append(tname, count);
  wrap.append(surface);

  if (editable) {
    // Any press on a table (its top, a seat, a name, its menu) selects it.
    wrap.addEventListener("pointerdown", () => selectTable(table.id));
    hoverMenu(wrap, table.id);
    tname.title = "Click to rename table";
    tname.addEventListener("click", e => { e.stopPropagation(); editTableName(tname, table.id); });
    const add = labelButton("add-pill", ICONS.plus, "Add guest", e => {
      e.stopPropagation();
      openPicker(add, { tableId: table.id }, "floor");
    });
    add.title = "Add a guest to " + table.name;
    surface.append(add);
    dropTarget(surface, { tableId: table.id });
    tableDrag(surface, wrap, table, g);
  }

  table.seats.forEach((guest, i) => {
    const p = g.placed[i];
    const at = { left: cx + p.x + "px", top: cy + p.y + "px" };

    if (!guest) {
      const empty = el("button", "seat open");
      empty.innerHTML = ICONS.plus;
      empty.title = "Add a guest here";
      empty.setAttribute("aria-label", "Add a guest here");
      Object.assign(empty.style, at);
      if (editable) {
        empty.addEventListener("click", e => { e.stopPropagation(); openPicker(empty, { tableId: table.id, seatIndex: i }, "floor"); });
        dropTarget(empty, { tableId: table.id, seatIndex: i });
      }
      wrap.append(empty);
      return;
    }

    const seat = el("div", "seat", initials(guest.name));
    seat.dataset.seat = guest.id;
    seat.dataset.guest = guest.id;
    seat.title = guest.name;
    Object.assign(seat.style, at);

    const label = el("div", "label");
    label.dataset.guest = guest.id;
    label.title = guest.name;
    Object.assign(label.style, {
      left: cx + p.lx + "px",
      top: cy + p.ly + "px",
      transform: `translate(${-50 + 50 * p.nx}%, ${-50 + 50 * p.ny}%)`,
    });
    const text = el("span", "gtext", guest.name);
    text.dataset.gname = guest.id;
    label.append(text);

    if (editable) {
      label.append(iconButton("x", "×", "Remove guest", () => removeGuest(guest.id)));
      for (const node of [seat, label]) {
        node.addEventListener("click", e => { e.stopPropagation(); openCard(guest.id, "floor"); });
        draggable(node, guest.id);
        dropTarget(node, { tableId: table.id });
      }
    }
    wrap.append(seat, label);
  });

  if (editable) wrap.append(renderMenu(table));
  return wrap;
}

// Options under a table.
function renderMenu(table) {
  const menu = el("div", "table-menu");
  const guestCount = guestsOf(table).length;

  const splitGuestsBtn = labelButton("menu-btn", ICONS.splitGuests, "Split table and guests", e => {
    e.stopPropagation();
    focusTable(splitTableAndGuests(table.id));
  });
  splitGuestsBtn.title = "Make two tables and share the guests between them";
  splitGuestsBtn.disabled = guestCount < 2;

  const splitBtn = labelButton("menu-btn", ICONS.split, "Split table", e => {
    e.stopPropagation();
    focusTable(splitTable(table.id));
  });
  splitBtn.title = "Add an empty table next to this one";

  menu.append(splitGuestsBtn, splitBtn, el("span", "menu-sep"));
  for (const shape of SHAPES) {
    const b = iconButton("menu-btn icon", ICONS[shape], SHAPE_NAMES[shape] + " table", () => setShape(table.id, shape));
    b.setAttribute("aria-pressed", String(table.shape === shape));
    menu.append(b);
  }

  // Seats stepper: can't go below the number of people sat down.
  const n = table.seats.length;
  const fewer = iconButton("menu-btn icon", ICONS.minus, "Remove an empty seat", () => changeSeats(table.id, -1));
  fewer.disabled = guestCount === n || n === 1;
  if (fewer.disabled) fewer.title = "No empty seats to remove";
  const more = iconButton("menu-btn icon", ICONS.plus, "Add a seat", () => changeSeats(table.id, 1));
  more.disabled = n >= MAX_SEATS;
  menu.append(el("span", "menu-sep"), fewer, seatCountInput(table), more);

  const del = iconButton("menu-btn icon danger", ICONS.trash,
    guestCount ? "Remove table (its guests move to the unseated guest list)" : "Remove table", () => removeTable(table.id));
  if (store.plan.tables.length === 1) {
    del.disabled = true;
    del.title = "You need at least one table";
  }
  menu.append(el("span", "menu-sep"), del);
  return menu;
}

// The number of seats, as a box you can type into (Enter or click away to
// apply). The arrow keys also step it up and down.
function seatCountInput(table) {
  const label = el("label", "seat-count");
  const input = el("input");
  const n = table.seats.length;
  Object.assign(input, { type: "number", min: Math.max(1, guestsOf(table).length), max: MAX_SEATS, step: 1, inputMode: "numeric", value: n });
  input.setAttribute("aria-label", "Number of seats at " + table.name);
  const apply = () => {
    const wanted = Math.round(Number(input.value));
    if (!input.value.trim() || !Number.isFinite(wanted) || wanted === n) { input.value = n; return; }
    const stillTyping = document.activeElement === input; // arrow keys, not clicking away
    const got = setSeats(table.id, wanted);
    if (stillTyping) { // the menu was redrawn: carry on in the new box
      const fresh = roomEl.querySelector(`.table-wrap[data-table="${table.id}"] .seat-count input`);
      if (fresh) { fresh.focus(); fresh.select(); }
    }
    if (got !== wanted) {
      toast(got > wanted
        ? `${table.name} has ${plural(got, "guest")}, so it needs at least ${plural(got, "seat")}`
        : `A table can have up to ${MAX_SEATS} seats`);
    }
  };
  input.addEventListener("change", apply);
  input.addEventListener("keydown", e => {
    e.stopPropagation(); // typing here mustn't trigger shortcuts
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = n; input.blur(); }
  });
  label.append(input, n === 1 ? " seat" : " seats");
  return label;
}

// ================= Guest list =================

function renderGroup(table) {
  const editable = !store.readOnly;
  const group = el("section", "group");
  group.dataset.table = table.id;

  const head = el("div", "group-head");
  const tname = el("span", "tname", table.name);
  tname.dataset.tname = table.id;
  const guests = guestsOf(table);
  const count = el("span", "tcount", `(${guests.length}/${table.seats.length})`);
  count.classList.toggle("full", guests.length === table.seats.length);
  head.append(tname, count);
  group.append(head, renderRows(guests, table.id, "No guests yet. Drag someone here."));

  if (editable) {
    const handle = el("span", "handle", "⋮⋮");
    handle.title = "Drag to reorder the list";
    head.prepend(handle);
    tableListDrag(handle, group, table.id);
    group.addEventListener("pointerdown", () => selectTable(table.id));
    dropTarget(group, { tableId: table.id });
    tname.title = "Click to rename table";
    tname.addEventListener("click", () => editTableName(tname, table.id));
    head.append(iconButton("icon-btn small edit-name", ICONS.pencil, "Rename table", () => editTableName(tname, table.id)));
    group.append(addGuestRow(table.id));
  }
  return group;
}

// Guests who haven't been given a table yet. Always at the top of the list.
function renderUnseated(p) {
  const guests = p.unseated;
  const group = el("section", "group unseated");
  group.classList.toggle("has-guests", guests.length > 0);

  const head = el("div", "group-head");
  const title = el("span", "unseated-title");
  title.innerHTML = ICONS.person;
  title.append(UNSEATED_LABEL);
  head.append(title, el("span", "badge", guests.length));
  group.append(head, renderRows(guests, null, "Everyone has a seat."));

  if (!store.readOnly) {
    dropTarget(group, { tableId: null });
    group.append(addGuestRow(null));
  }
  return group;
}

function renderRows(guests, tableId, emptyText) {
  const editable = !store.readOnly;
  const rows = el("ul", "rows");
  for (const g of guests) {
    const row = el("li", "row");
    row.dataset.guest = g.id;
    const name = el("span", "gname", g.name);
    name.dataset.gname = g.id;

    if (editable) {
      const handle = el("span", "handle", "⋮⋮");
      handle.title = "Drag to move";
      row.append(handle, name, iconButton("x", "×", "Remove guest", () => removeGuest(g.id)));
      row.tabIndex = 0;
      row.addEventListener("click", () => openCard(g.id, "panel"));
      row.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === row) openCard(g.id, "panel"); });
      draggable(row, g.id);
      listDropTarget(row, tableId, g.id);
    } else {
      row.append(name);
    }
    rows.append(row);
  }
  if (!guests.length) rows.append(el("li", "empty", emptyText));
  return rows;
}

function addGuestRow(tableId) {
  const add = labelButton("add-guest-row", ICONS.plus, "Add guest", () => openPicker(add, { tableId }, "panel"));
  return add;
}

function renderAddTableRow() {
  return labelButton("add-table-row", ICONS.plus, "Add table", () => focusTable(addTable(null, viewport.visibleCentre())));
}
