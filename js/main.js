"use strict";
// Starts the app: connects the buttons, keyboard shortcuts and screen
// updates, then opens the last event (or a shared plan from a link).

const viewBanner = document.getElementById("viewBanner");

store.subscribe(kind => {
  if (kind === "text") syncText();
  else if (kind === "saved") renderSaveStatus();
  else if (kind === "plan") render();
  else if (kind === "event") showEvent();
});

// A different event (or a shared plan) was opened: reset the screen.
function showEvent() {
  closeCard(false);
  closePicker();
  ui.selectedTableId = null;
  ui.hoverTableId = null;
  viewBanner.hidden = !store.readOnly;
  render();
  renderSaveStatus();
  viewport.fit();
}

viewport.init({
  getBounds: () => store.plan && contentBounds(store.plan),
  onBackgroundClick: () => selectTable(null),
  onChange: () => { positionCard(); positionPicker(); },
});

// ----- Buttons -----

document.getElementById("undo").addEventListener("click", () => store.undo());
document.getElementById("redo").addEventListener("click", () => store.redo());
document.getElementById("shareBtn").addEventListener("click", openShareDialog);
document.getElementById("importBtn").addEventListener("click", startImport);
document.getElementById("capacityBtn").addEventListener("click", editCapacity);
document.getElementById("addTable").addEventListener("click", () => focusTable(addTable(null, viewport.visibleCentre())));

// The arrow next to "Add table" opens the shapes; picking one adds that table.
const shapeMenu = bindPopover(document.getElementById("chooseShape"), document.getElementById("shapeMenu"));
for (const shape of SHAPES) {
  const option = iconButton("shape-opt", ICONS[shape], "Add a " + SHAPE_NAMES[shape].toLowerCase() + " table", () => {
    shapeMenu.close();
    focusTable(addTable(shape, viewport.visibleCentre()));
  });
  option.append(SHAPE_NAMES[shape]);
  document.getElementById("shapePicker").append(option);
}

document.getElementById("saveCopy").addEventListener("click", () => {
  store.saveSharedCopy();
  history.replaceState(null, "", location.pathname); // drop the shared plan from the address
  toast("Saved to your events. You can edit it now.");
});

// ----- Keyboard -----
// Ctrl+Z / Ctrl+Y undo and redo, except while typing (where the browser's
// own undo applies). Escape closes the top-most thing. With a table
// selected, + and - add and remove a seat.

document.addEventListener("keydown", e => {
  const t = e.target;
  if (e.defaultPrevented || isDialogOpen() || t.isContentEditable || t.tagName === "INPUT" || t.tagName === "SELECT") return;
  if (e.key === "Escape") {
    if (ui.cardGuestId) closeCard();
    else { selectTable(null); setHoverTable(null); }
    return;
  }
  if (ui.selectedTableId && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === "+" || e.key === "=") { e.preventDefault(); changeSeats(ui.selectedTableId, 1); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); changeSeats(ui.selectedTableId, -1); return; }
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
  else if (key === "y") { e.preventDefault(); store.redo(); }
});

// ----- Start -----

async function start() {
  let shared = null;
  try {
    shared = await readShareLink();
  } catch (err) {
    console.error(err);
    toast("Sorry, that share link is damaged or incomplete.");
  }
  store.init(); // opens the last event
  renderAccount();
  if (shared) store.viewShared(shared);
}

// Pasting a different share link into the address bar.
window.addEventListener("hashchange", () => location.reload());

start();
