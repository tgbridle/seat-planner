"use strict";
// The open event, its undo history, and the user's list of events.
//
// Every change to a plan goes through store.commit(), which records an
// undo step, saves, and tells the screen to redraw. Parts of the page
// listen with store.subscribe(fn); fn gets one of:
//   "plan"  - the plan changed; redraw
//   "text"  - only a name changed; update text in place
//   "event" - a different event (or a shared plan) was opened
//   "saved" - the save status changed

const store = (() => {
  const HISTORY_LIMIT = 200;
  let account = null;
  let eventId = null;
  let plan = null;
  let readOnly = false;
  let saveFailed = false;
  let lastSaved = null;
  let undoStack = [];
  let redoStack = [];
  const listeners = new Set();

  const emit = kind => listeners.forEach(fn => fn(kind));

  function persist() {
    if (readOnly || !eventId) return;
    const entry = account.events.find(e => e.id === eventId);
    entry.name = plan.eventName;
    entry.updatedAt = Date.now();
    saveFailed = !(storage.savePlan(eventId, plan) && storage.saveAccount(account));
    if (!saveFailed) lastSaved = Date.now();
    emit("saved");
  }

  // Applies a change to the plan, with an undo step. Changes that don't
  // actually change anything are ignored. soft = only text changed, so the
  // page updates text in place instead of redrawing (redrawing mid-click
  // would swallow the click the user is making).
  function commit(change, { soft = false } = {}) {
    if (readOnly) return;
    const before = JSON.stringify(plan);
    change(plan);
    if (placeUnplaced(plan)) soft = false;
    if (JSON.stringify(plan) === before) return;
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    persist();
    emit(soft ? "text" : "plan");
  }

  function stepHistory(from, to) {
    if (readOnly || !from.length) return;
    to.push(JSON.stringify(plan));
    plan = JSON.parse(from.pop());
    persist();
    emit("plan");
  }

  function load(id, newPlan) {
    eventId = id;
    plan = newPlan;
    readOnly = false;
    undoStack = [];
    redoStack = [];
    placeUnplaced(plan);
    account.currentEventId = id;
    storage.saveAccount(account);
    emit("event");
  }

  // Saves a plan as a brand new event and opens it.
  function addEvent(newPlan) {
    const id = uid();
    account.events.push({ id, name: newPlan.eventName, updatedAt: Date.now() });
    load(id, newPlan);
    persist();
  }

  function openEvent(id) {
    if (id === eventId && !readOnly) return true;
    const saved = storage.loadPlan(id);
    if (!saved) { toast("Sorry, that event couldn't be opened."); return false; }
    load(id, saved);
    return true;
  }

  // Most recently edited first.
  const sortedEvents = () => [...account.events].sort((a, b) => b.updatedAt - a.updatedAt);

  // The planner open in another tab saved something. Pick it up, so the two
  // tabs don't quietly overwrite each other's changes.
  window.addEventListener("storage", e => {
    if (!account || e.newValue == null) return;
    if (e.key === storage.ACCOUNT_KEY) {
      account.events = storage.loadAccount().events;
      emit("saved");
    } else if (!readOnly && e.key === storage.eventKey(eventId)) {
      const fresh = storage.loadPlan(eventId);
      if (!fresh) return;
      plan = fresh;
      undoStack = [];
      redoStack = [];
      emit("plan");
      toast("Updated with changes made in another tab");
    }
  });

  return {
    get plan() { return plan; },
    get eventId() { return eventId; },
    get user() { return account.user; },
    get readOnly() { return readOnly; },
    get saveFailed() { return saveFailed; },
    get lastSaved() { return lastSaved; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get events() { return sortedEvents(); },

    subscribe: fn => listeners.add(fn),
    commit,
    undo: () => stepHistory(undoStack, redoStack),
    redo: () => stepHistory(redoStack, undoStack),

    // Opens the last event used, or starts the first one.
    init() {
      account = storage.loadAccount();
      const ids = account.events.map(e => e.id);
      for (const id of [account.currentEventId, ...ids]) {
        const saved = id && ids.includes(id) && storage.loadPlan(id);
        if (saved) { load(id, saved); return; }
      }
      addEvent(createPlan("My Upcoming Event", { sampleGuests: true }));
    },

    openEvent,

    createEvent: () => addEvent(createPlan("Untitled event")),

    duplicateEvent(id) {
      const saved = id === eventId ? structuredClone(plan) : storage.loadPlan(id);
      if (!saved) return;
      saved.eventName = cleanText("Copy of " + saved.eventName, 120);
      addEvent(saved);
    },

    deleteEvent(id) {
      storage.deletePlan(id);
      account.events = account.events.filter(e => e.id !== id);
      storage.saveAccount(account);
      if (id !== eventId) { emit("saved"); return; }
      const next = sortedEvents()[0];
      if (!next || !openEvent(next.id)) addEvent(createPlan("Untitled event"));
    },

    // Shows a plan from a share link, without saving it anywhere.
    viewShared(sharedPlan) {
      eventId = null;
      plan = sharedPlan;
      readOnly = true;
      undoStack = [];
      redoStack = [];
      placeUnplaced(plan);
      emit("event");
    },

    // Keeps the shared plan being viewed as one of the user's own events.
    saveSharedCopy() {
      if (readOnly) addEvent(structuredClone(plan));
    },
  };
})();

// ================= Actions =================
// Everything the user can do to a plan. Each is one undo step.

// No tableId: the guest goes on the unseated guest list. No name: "Guest N".
// Returns the new guest's id so their card can be opened.
function addGuest(tableId, seatIndex, name) {
  let id;
  store.commit(p => {
    const guest = newGuest(name || "Guest " + p.nextGuest++);
    id = guest.id;
    if (tableId) seatGuest(findTable(p, tableId), guest, seatIndex);
    else p.unseated.push(guest);
  });
  return id;
}

function removeGuest(guestId) {
  store.commit(p => {
    const found = locateGuest(p, guestId);
    if (found) takeOut(found);
  });
}

function renameGuest(guestId, name) {
  store.commit(p => {
    const found = locateGuest(p, guestId);
    if (found) found.guest.name = name;
  }, { soft: true });
}

// Moves a guest to:
//   { tableId, seatIndex }      a particular empty seat
//   { tableId }                 that table (first empty seat, or a new chair)
//   { tableId: null }           "Guest list (unseated)"
//   { tableId, anchorId, after } just before/after another guest in the list
function moveGuest(guestId, { tableId = null, seatIndex = null, anchorId = null, after = false }) {
  if (anchorId === guestId) return;
  store.commit(p => {
    const found = locateGuest(p, guestId);
    if (!found) return;
    const fromTableId = found.table ? found.table.id : null;
    if (fromTableId === tableId && seatIndex == null && anchorId == null) return; // dropped where it was
    takeOut(found);
    if (anchorId) insertGuest(p, found.guest, tableId, anchorId, after);
    else if (tableId) seatGuest(findTable(p, tableId), found.guest, seatIndex);
    else p.unseated.push(found.guest);
  });
}

// A table like the last one (or in the given shape), at `near` if given.
// Returns the new table's id.
function addTable(shape, near) {
  let id;
  store.commit(p => {
    const last = lastTable(p);
    const table = newTable(p, shape || (last ? last.shape : "rect"), last ? last.seats.length : DEFAULT_SEATS);
    id = table.id;
    if (near) Object.assign(table, findFreeSpot(p, table, near));
    p.tables.push(table);
  });
  return id;
}

// Spot to the right of a table, for splitting.
const beside = table => ({ x: table.x + geometry(table).width, y: table.y });

// Two tables, with the guests and the seats shared between them.
// Returns the new table's id.
function splitTableAndGuests(tableId) {
  let id;
  store.commit(p => {
    const index = p.tables.findIndex(t => t.id === tableId);
    const table = p.tables[index];
    const guests = guestsOf(table);
    const keep = Math.ceil(guests.length / 2);
    const seatsA = Math.ceil(table.seats.length / 2);
    const seatsB = Math.max(1, table.seats.length - seatsA);
    table.seats = padSeats(guests.slice(0, keep), seatsA);
    const created = newTable(p, table.shape, seatsB);
    created.seats = padSeats(guests.slice(keep), seatsB);
    Object.assign(created, findFreeSpot(p, created, beside(table)));
    p.tables.splice(index + 1, 0, created);
    id = created.id;
  });
  return id;
}

// A second, empty table of the same size next to this one; guests stay put.
function splitTable(tableId) {
  let id;
  store.commit(p => {
    const index = p.tables.findIndex(t => t.id === tableId);
    const table = p.tables[index];
    const created = newTable(p, table.shape, table.seats.length);
    Object.assign(created, findFreeSpot(p, created, beside(table)));
    p.tables.splice(index + 1, 0, created);
    id = created.id;
  });
  return id;
}

// Sets how many chairs a table has, adding empty ones or taking empty ones
// away. It can't go below the number of people sat there, or above
// MAX_SEATS. Returns the number it ended up with.
function setSeats(tableId, count) {
  const table = findTable(store.plan, tableId);
  const target = clamp(Math.round(count), Math.max(1, guestsOf(table).length), MAX_SEATS);
  store.commit(p => {
    const seats = findTable(p, tableId).seats;
    while (seats.length < target) seats.push(null);
    while (seats.length > target) seats.splice(seats.lastIndexOf(null), 1);
  });
  return target;
}

const changeSeats = (tableId, delta) => setSeats(tableId, findTable(store.plan, tableId).seats.length + delta);

// null clears it.
function setVenueCapacity(capacity) {
  store.commit(p => { p.venueCapacity = capacity; });
}

function setShape(tableId, shape) {
  store.commit(p => { findTable(p, tableId).shape = shape; });
}

// Anyone sitting there moves to "Guest list (unseated)".
function removeTable(tableId) {
  store.commit(p => {
    p.unseated.push(...guestsOf(findTable(p, tableId)));
    p.tables = p.tables.filter(t => t.id !== tableId);
  });
}

// Changes where a table comes in the guest list (it doesn't move on the floor).
function reorderTable(tableId, anchorId, after) {
  if (tableId === anchorId) return;
  store.commit(p => {
    const [table] = p.tables.splice(p.tables.findIndex(t => t.id === tableId), 1);
    p.tables.splice(p.tables.findIndex(t => t.id === anchorId) + (after ? 1 : 0), 0, table);
  });
}

function renameTable(tableId, name) {
  store.commit(p => { findTable(p, tableId).name = name; }, { soft: true });
}

function renameEvent(name) {
  store.commit(p => { p.eventName = name; }, { soft: true });
}

function moveTable(tableId, x, y) {
  store.commit(p => { Object.assign(findTable(p, tableId), { x, y }); });
}
