"use strict";
// The seating plan and the basic operations on it. Nothing here touches
// the page; these functions only read and change plan objects.
//
// A plan looks like:
//   {
//     eventName: "Our Wedding",
//     tables: [{ id, name, shape, x, y, seats: [guest | null, ...] }],
//     unseated: [guest, ...],   // guests without a table ("Guest list (unseated)")
//     venueCapacity: 120,       // how many people the venue holds, or null if not set
//     nextGuest: 7,             // number for the next "Guest N"
//     nextTable: 2,             // number for the next "Table N"
//   }
//   guest = { id, name }
//
// A table's seats list is its chairs, so its length is the table's capacity
// and null means an empty chair. x/y is the centre of the table top.

const SHAPES = ["rect", "square", "round", "oval"];
const SHAPE_NAMES = { rect: "Rectangle", square: "Square", round: "Round", oval: "Oval" };
const DEFAULT_SEATS = 6;
const MAX_SEATS = 100;
const MAX_GUESTS = 2000;
const MAX_CAPACITY = 100000;
const UNSEATED_LABEL = "Guest list (unseated)";

const newGuest = name => ({ id: uid(), name });

function createPlan(eventName, { sampleGuests = false } = {}) {
  const seats = Array(DEFAULT_SEATS).fill(null);
  if (sampleGuests) seats.forEach((_, i) => { seats[i] = newGuest("Guest " + (i + 1)); });
  return {
    eventName,
    tables: [{ id: uid(), name: "Table 1", shape: "rect", x: null, y: null, seats }],
    unseated: [],
    venueCapacity: null,
    nextGuest: sampleGuests ? DEFAULT_SEATS + 1 : 1,
    nextTable: 2,
  };
}

// Turns anything that claims to be a plan (an old save, a share link) into
// a valid plan, or returns null. Fixes up missing or broken parts, so the
// rest of the app can trust what it gets.
function normalizePlan(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tables)) return null;
  const ids = new Set();
  const id = value => {
    const ok = typeof value === "string" && /^[\w-]{1,40}$/.test(value) && !ids.has(value);
    const result = ok ? value : uid();
    ids.add(result);
    return result;
  };
  const number = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let guestCount = 0;
  const guest = g => {
    if (!g || typeof g !== "object" || guestCount >= MAX_GUESTS) return null;
    guestCount++;
    return { id: id(g.id), name: cleanText(g.name) || "Guest" };
  };

  const tables = raw.tables.filter(t => t && typeof t === "object").slice(0, 500).map((t, i) => {
    // Plans saved by the first version had "guests" instead of "seats".
    let seats = Array.isArray(t.seats) ? t.seats : Array.isArray(t.guests) ? t.guests : [];
    seats = seats.slice(0, MAX_SEATS).map(guest);
    if (!seats.length) seats = Array(DEFAULT_SEATS).fill(null);
    return {
      id: id(t.id),
      name: cleanText(t.name, 80) || "Table " + (i + 1),
      shape: SHAPES.includes(t.shape) ? t.shape : "rect",
      x: number(t.x),
      y: number(t.y),
      seats,
    };
  });
  if (!tables.length) return null;

  const unseated = (Array.isArray(raw.unseated) ? raw.unseated : []).map(guest).filter(Boolean);
  const plan = {
    eventName: cleanText(raw.eventName, 120) || "My Upcoming Event",
    tables,
    unseated,
    venueCapacity: Number.isInteger(raw.venueCapacity) && raw.venueCapacity > 0 && raw.venueCapacity <= MAX_CAPACITY
      ? raw.venueCapacity : null,
  };
  const count = allGuests(plan).length;
  plan.nextGuest = Number.isInteger(raw.nextGuest) && raw.nextGuest > count ? raw.nextGuest : count + 1;
  plan.nextTable = Number.isInteger(raw.nextTable) && raw.nextTable > tables.length ? raw.nextTable : tables.length + 1;
  return plan;
}

const findTable = (plan, id) => plan.tables.find(t => t.id === id);
const guestsOf = table => table.seats.filter(Boolean);
const freeSeats = table => table.seats.filter(g => !g).length;
const allGuests = plan => plan.tables.flatMap(guestsOf).concat(plan.unseated);
const lastTable = plan => plan.tables[plan.tables.length - 1];
const padSeats = (guests, count) => guests.concat(Array(Math.max(0, count - guests.length)).fill(null));

// Where a guest is. `list` is the table's seats, or the unseated list
// (then `table` is null).
function locateGuest(plan, guestId) {
  for (const table of plan.tables) {
    const index = table.seats.findIndex(g => g && g.id === guestId);
    if (index !== -1) return { table, list: table.seats, index, guest: table.seats[index] };
  }
  const index = plan.unseated.findIndex(g => g.id === guestId);
  return index === -1 ? null : { table: null, list: plan.unseated, index, guest: plan.unseated[index] };
}

// A seated guest leaves an empty chair behind; an unseated one just goes.
function takeOut(found) {
  if (found.table) found.list[found.index] = null;
  else found.list.splice(found.index, 1);
}

// Puts a guest in the given empty seat, else the first empty seat.
// A full table gets an extra chair.
function seatGuest(table, guest, seatIndex) {
  if (seatIndex != null && !table.seats[seatIndex]) { table.seats[seatIndex] = guest; return; }
  const free = table.seats.indexOf(null);
  if (free === -1) table.seats.push(guest); else table.seats[free] = guest;
}

// Puts a guest into a table's seats (or the unseated list) just before or
// after another guest, so they show up in that spot in the guest list.
// A table keeps its number of chairs if it has an empty one to give up.
function insertGuest(plan, guest, tableId, anchorId, after) {
  const list = tableId ? findTable(plan, tableId).seats : plan.unseated;
  const anchor = list.findIndex(g => g && g.id === anchorId);
  const at = anchor === -1 ? list.length : anchor + (after ? 1 : 0);
  list.splice(at, 0, guest);
  if (tableId) {
    const empty = list.lastIndexOf(null);
    if (empty !== -1) list.splice(empty, 1);
  }
}

function newTable(plan, shape, seatCount) {
  return { id: uid(), name: "Table " + plan.nextTable++, shape, x: null, y: null, seats: Array(seatCount).fill(null) };
}
