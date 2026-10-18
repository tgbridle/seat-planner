"use strict";
// The "Add guest" picker. Opens from "Add guest" (on a table or in the
// list) or from an empty seat, and offers:
//   - a new guest (type their name first, or leave it blank and name them after)
//   - anyone already in the plan who isn't here yet, to move them here
// Typing filters the list. Up/Down arrows move, Enter chooses, Escape closes.

const pickerEl = document.getElementById("picker");
let pickerAnchor = null;

// target: { tableId (null = "Guest list (unseated)"), seatIndex (optional) }
// source: "floor" or "panel", for where the new guest's card opens.
function openPicker(anchor, target, source) {
  if (store.readOnly) return;
  closeCard();
  pickerAnchor = anchor;
  const table = target.tableId && findTable(store.plan, target.tableId);
  const where = table ? table.name : "the unseated guest list";

  const head = el("div", "card-head");
  head.append(el("span", "card-title", target.seatIndex != null ? `Seat at ${where}` : `Add to ${where}`),
    iconButton("icon-btn small", "×", "Close", closePicker));

  const input = el("input", "input");
  Object.assign(input, { type: "search", placeholder: "New name, or search your guests", maxLength: 120, autocomplete: "off" });
  input.setAttribute("aria-label", "Guest name");
  const list = el("ul", "picker-list");
  list.setAttribute("role", "listbox");

  let options = [];
  let active = 0;

  const choose = option => {
    closePicker();
    option.run();
  };

  const setActive = i => {
    active = clamp(i, 0, options.length - 1);
    options.forEach((o, j) => o.node.classList.toggle("active", j === active));
    options[active].node.scrollIntoView({ block: "nearest" });
  };

  const fill = () => {
    const typed = cleanText(input.value);
    const query = typed.toLowerCase();
    options = [];
    list.replaceChildren();

    const addOption = (node, run) => {
      const index = options.length;
      node.setAttribute("role", "option");
      node.addEventListener("pointerenter", () => setActive(index));
      node.addEventListener("click", () => choose(options[index]));
      options.push({ node, run });
      list.append(node);
    };

    // New guest
    const fresh = el("li", "picker-option new");
    fresh.innerHTML = ICONS.plus;
    fresh.append(el("span", "picker-name", typed ? `Add "${typed}" as a new guest` : "Add a new guest"));
    addOption(fresh, () => {
      const id = addGuest(target.tableId, target.seatIndex, typed);
      if (!typed) openCard(id, source); // no name yet: straight into naming them
    });

    // Everyone else, unseated guests first
    const others = guestsElsewhere(target.tableId).filter(c => c.guest.name.toLowerCase().includes(query));
    if (others.length) list.append(el("li", "picker-section", "Move someone here"));
    else if (query) list.append(el("li", "picker-empty", "No one in your plan matches."));
    for (const { guest, table: from } of others.slice(0, 100)) {
      const item = el("li", "picker-option");
      item.append(highlighted(guest.name, query), el("span", "picker-where" + (from ? "" : " unseated"), from ? from.name : "Unseated"));
      addOption(item, () => moveGuest(guest.id, target));
    }
    // With a search, jump to the first match; otherwise to "new guest".
    setActive(query && others.length ? 1 : 0);
  };

  input.addEventListener("input", fill);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Escape") { e.preventDefault(); closePicker(); }
  });

  pickerEl.replaceChildren(head, input, list);
  pickerEl.hidden = false;
  fill();
  placeNear(pickerEl, anchor);
  input.focus({ preventScroll: true });
}

function closePicker() {
  if (pickerEl.hidden) return;
  pickerEl.hidden = true;
  pickerEl.replaceChildren();
  pickerAnchor = null;
}

// Guests not at this table: "Guest list (unseated)" first, then table by table.
function guestsElsewhere(tableId) {
  const p = store.plan;
  const found = tableId ? p.unseated.map(guest => ({ guest, table: null })) : [];
  for (const table of p.tables) {
    if (table.id !== tableId) found.push(...guestsOf(table).map(guest => ({ guest, table })));
  }
  return found;
}

// The name with the searched-for part in bold (built from text nodes, so
// names are never treated as HTML).
function highlighted(name, query) {
  const span = el("span", "picker-name");
  const at = query ? name.toLowerCase().indexOf(query) : -1;
  if (at === -1) { span.textContent = name; return span; }
  span.append(name.slice(0, at), el("mark", null, name.slice(at, at + query.length)), name.slice(at + query.length));
  return span;
}

// Follows its button when the floor pans or zooms; closes if the button's gone.
function positionPicker() {
  if (pickerEl.hidden) return;
  if (pickerAnchor && pickerAnchor.isConnected) placeNear(pickerEl, pickerAnchor);
  else closePicker();
}

// Pressing anywhere else closes it.
document.addEventListener("pointerdown", e => {
  if (!pickerEl.hidden && !pickerEl.contains(e.target) && !(pickerAnchor && pickerAnchor.contains(e.target))) closePicker();
});
