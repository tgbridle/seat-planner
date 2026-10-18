"use strict";
// Things you do with the mouse or finger on the plan: renaming in place,
// moving tables, dragging guests between tables, and the guest card.

// ================= Editing text in place =================
// Click a name, type, then Enter (or click away) to save; Escape cancels.

function startEdit(node, getCurrent, onSave) {
  if (store.readOnly || node.isContentEditable) return;
  const original = getCurrent();
  let cancelled = false;
  node.contentEditable = "true";
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const onKey = e => {
    if (e.key === "Enter") { e.preventDefault(); node.blur(); }
    if (e.key === "Escape") { cancelled = true; node.blur(); }
  };
  const onBlur = () => {
    node.removeEventListener("keydown", onKey);
    node.removeEventListener("blur", onBlur);
    node.contentEditable = "false";
    const value = cleanText(node.textContent);
    node.textContent = original;
    if (!cancelled && value && value !== original) onSave(value);
  };
  node.addEventListener("keydown", onKey);
  node.addEventListener("blur", onBlur);
}

function editTableName(node, tableId) {
  startEdit(node, () => findTable(store.plan, tableId).name, name => renameTable(tableId, name));
}

// ================= Moving tables =================
// Press on a table top and drag. A press without movement is just a click.

let suppressClick = false;

function tableDrag(surface, wrap, table, g) {
  surface.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("button, [contenteditable='true']")) return;
    const startX = e.clientX, startY = e.clientY;
    const left0 = parseFloat(wrap.style.left), top0 = parseFloat(wrap.style.top);
    let moved = false;

    // Listen on the window rather than capturing the pointer: capturing
    // would send the click to the table top instead of the name inside it.
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      wrap.classList.remove("moving");
    };
    const onMove = ev => {
      if (ev.pointerId !== e.pointerId) return;
      if (viewport.isPinching()) { // a second finger landed: zoom instead
        stop();
        Object.assign(wrap.style, { left: left0 + "px", top: top0 + "px" });
        return;
      }
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      if (!moved) { moved = true; wrap.classList.add("moving"); closeCard(); }
      const z = viewport.zoom;
      wrap.style.left = left0 + (ev.clientX - startX) / z + "px";
      wrap.style.top = top0 + (ev.clientY - startY) / z + "px";
    };
    const onUp = ev => {
      if (ev.pointerId !== e.pointerId) return;
      stop();
      if (!moved) return;
      suppressClick = true; // the click that ends a drag shouldn't also rename the table
      setTimeout(() => { suppressClick = false; });
      const x = snap(parseFloat(wrap.style.left) + g.cx);
      const y = snap(parseFloat(wrap.style.top) + g.cy);
      if (x === table.x && y === table.y) render(); // back where it was: tidy up
      else moveTable(table.id, x, y);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

document.addEventListener("click", e => {
  if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); }
}, true);

// ================= Moving guests (drag and drop) =================
// Drop a guest on:
//   an empty seat           -> they sit there
//   a table, or anyone at it -> they join that table
//   a row in the list        -> they go just above/below that person
//   "Guest list (unseated)"               -> they're unseated

let draggingId = null;

function draggable(node, guestId) {
  node.draggable = true;
  node.addEventListener("dragstart", e => {
    e.stopPropagation();
    draggingId = guestId;
    closeCard();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", guestId);
    requestAnimationFrame(() => node.classList.add("dragging")); // after the browser snapshots the drag image
  });
  node.addEventListener("dragend", () => {
    draggingId = null;
    node.classList.remove("dragging");
    clearDropHighlights();
  });
}

function acceptDrop(e) {
  if (!draggingId) return false;
  e.preventDefault();
  e.stopPropagation(); // the innermost target (a seat or row) wins over its table
  e.dataTransfer.dropEffect = "move";
  return true;
}

function takeDrop(e) {
  if (!acceptDrop(e)) return null;
  const id = draggingId;
  draggingId = null;
  clearDropHighlights();
  return id;
}

function dropTarget(node, target) {
  node.addEventListener("dragover", e => {
    if (!acceptDrop(e) || node.classList.contains("drop-over")) return;
    clearDropHighlights();
    node.classList.add("drop-over");
  });
  node.addEventListener("dragleave", e => {
    if (!node.contains(e.relatedTarget)) node.classList.remove("drop-over");
  });
  node.addEventListener("drop", e => {
    const id = takeDrop(e);
    if (id) moveGuest(id, target);
  });
}

// A row in the guest list: a line above or below it shows where the guest
// will go, depending on which half of the row the pointer is over.
function listDropTarget(row, tableId, guestId) {
  const below = e => {
    const r = row.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  row.addEventListener("dragover", e => {
    if (draggingId === guestId) return; // over itself: let the group handle it
    if (!acceptDrop(e)) return;
    const cls = below(e) ? "drop-after" : "drop-before";
    if (row.classList.contains(cls)) return;
    clearDropHighlights();
    row.classList.add(cls);
  });
  row.addEventListener("dragleave", e => {
    if (!row.contains(e.relatedTarget)) row.classList.remove("drop-before", "drop-after");
  });
  row.addEventListener("drop", e => {
    if (draggingId === guestId) return;
    const after = below(e);
    const id = takeDrop(e);
    if (id) moveGuest(id, { tableId, anchorId: guestId, after });
  });
}

// ================= Reordering tables in the list =================
// Drag a table's handle up or down the guest list. Only the list order
// changes; the table stays where it is on the floor.

let draggingTableId = null;

function tableListDrag(handle, group, tableId) {
  handle.draggable = true;
  handle.addEventListener("dragstart", e => {
    e.stopPropagation();
    draggingTableId = tableId;
    closeCard();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tableId);
    e.dataTransfer.setDragImage(group, 24, 16);
    requestAnimationFrame(() => group.classList.add("dragging"));
  });
  handle.addEventListener("dragend", () => {
    draggingTableId = null;
    group.classList.remove("dragging");
    clearDropHighlights();
  });

  const below = e => {
    const r = group.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  const isOtherTable = () => draggingTableId && draggingTableId !== tableId;
  group.addEventListener("dragover", e => {
    if (!isOtherTable()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const cls = below(e) ? "drop-after" : "drop-before";
    if (group.classList.contains(cls)) return;
    clearDropHighlights();
    group.classList.add(cls);
  });
  group.addEventListener("dragleave", e => {
    if (!group.contains(e.relatedTarget)) group.classList.remove("drop-before", "drop-after");
  });
  group.addEventListener("drop", e => {
    if (!isOtherTable()) return;
    e.preventDefault();
    const id = draggingTableId, after = below(e);
    draggingTableId = null;
    clearDropHighlights();
    reorderTable(id, tableId, after);
  });
}

function clearDropHighlights() {
  document.querySelectorAll(".drop-over, .drop-before, .drop-after")
    .forEach(n => n.classList.remove("drop-over", "drop-before", "drop-after"));
}

// ================= Guest card =================
// Opens next to the person you clicked, on the table or in the list.

const cardEl = document.getElementById("card");

function openCard(guestId, source) {
  if (!guestId || store.readOnly) return;
  if (ui.cardGuestId && ui.cardGuestId !== guestId) saveCardName();
  ui.cardGuestId = guestId;
  ui.cardSource = source;
  drawCard();
  const input = cardEl.querySelector("input");
  if (input) { input.focus({ preventScroll: true }); input.select(); }
}

function drawCard() {
  const p = store.plan;
  const found = locateGuest(p, ui.cardGuestId);
  if (!found) { closeCard(false); return; }

  const head = el("div", "card-head");
  head.append(el("span", "card-title", "Guest"), iconButton("icon-btn small", "×", "Close", () => closeCard()));

  const nameField = el("label", "field");
  const input = el("input", "card-name");
  input.value = found.guest.name;
  input.maxLength = 120;
  input.addEventListener("change", saveCardName);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); closeCard(); }
    if (e.key === "Escape") closeCard(false);
  });
  nameField.append(el("span", null, "Name"), input);

  const tableField = el("label", "field");
  const select = el("select");
  const none = el("option", null, UNSEATED_LABEL);
  none.value = "";
  select.append(none);
  for (const t of p.tables) {
    const option = el("option", null, `${t.name} (${guestsOf(t).length}/${t.seats.length})`);
    option.value = t.id;
    select.append(option);
  }
  select.value = found.table ? found.table.id : "";
  select.addEventListener("change", () => moveGuest(ui.cardGuestId, { tableId: select.value || null }));
  tableField.append(el("span", null, "Table"), select);

  const foot = el("div", "card-foot");
  foot.append(
    textButton("btn danger-text", "Remove guest", () => removeGuest(ui.cardGuestId)),
    textButton("btn primary", "Done", () => closeCard()),
  );

  cardEl.replaceChildren(head, nameField, tableField, foot);
  cardEl.hidden = false;
  highlightGuest();
  positionCard();
}

function saveCardName() {
  const input = cardEl.querySelector(".card-name");
  const found = ui.cardGuestId && locateGuest(store.plan, ui.cardGuestId);
  if (!input || !found) return;
  const value = cleanText(input.value);
  if (value && value !== found.guest.name) renameGuest(ui.cardGuestId, value);
  else input.value = found.guest.name;
}

function closeCard(keepTyping = true) {
  if (!ui.cardGuestId) return;
  if (keepTyping) saveCardName();
  ui.cardGuestId = null;
  cardEl.hidden = true;
  cardEl.replaceChildren();
  highlightGuest();
}

function highlightGuest() {
  document.querySelectorAll("[data-guest]").forEach(n => n.classList.toggle("selected", n.dataset.guest === ui.cardGuestId));
}

// Unseated guests are only in the list.
function positionCard() {
  if (!ui.cardGuestId) return;
  const anchor = (ui.cardSource === "floor" && document.querySelector(`.label[data-guest="${ui.cardGuestId}"]`))
    || document.querySelector(`.row[data-guest="${ui.cardGuestId}"]`);
  if (!anchor) { closeCard(false); return; }
  placeNear(cardEl, anchor);
}

// Puts a floating panel below an element if there's room on screen,
// otherwise above it.
function placeNear(panel, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth, h = panel.offsetHeight;
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 8 && r.top - h - 8 > 8) top = r.top - h - 8;
  const left = clamp(r.left + r.width / 2 - w / 2, 8, document.documentElement.clientWidth - w - 8);
  panel.style.left = left + window.scrollX + "px";
  panel.style.top = top + window.scrollY + "px";
}

// Pressing anywhere else closes the card (and keeps the name typed).
document.addEventListener("pointerdown", e => {
  if (ui.cardGuestId && !e.target.closest("#card, [data-guest]")) closeCard();
});
panelEl.addEventListener("scroll", positionCard);
window.addEventListener("resize", positionCard);
