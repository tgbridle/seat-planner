"use strict";
// Table sizes, where each seat goes around a table, and finding free space
// in the room for new tables. All measurements are in room pixels (before
// zooming).

const GAP = 28;      // table edge to seat centre
const SPACING = 100; // room per seat along a table edge
const GRID = 22;     // dot spacing; tables snap to it
const MARGIN = 16;   // minimum space between tables

const snap = v => Math.round(v / GRID) * GRID;

// The table top's size, and each seat's position relative to the table's
// centre. (nx, ny) points away from the table, so names can be placed on
// the outside of each seat.
function seatLayout(shape, n) {
  const seats = [];
  let W, H;

  if (shape === "rect") {
    const top = Math.ceil(n / 2), bottom = n - top;
    W = Math.max(2, top) * SPACING;
    H = 100;
    const row = (count, y, ny) => {
      for (let i = 0; i < count; i++) seats.push({ x: -W / 2 + (i + 0.5) * W / count, y, nx: 0, ny });
    };
    row(top, -H / 2 - GAP, -1);
    row(bottom, H / 2 + GAP, 1);
  } else if (shape === "square") {
    const perSide = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) perSide[i % 4]++;
    W = H = Math.max(150, Math.max(...perSide) * SPACING);
    const edge = W / 2 + GAP;
    const side = (count, place) => {
      for (let i = 0; i < count; i++) seats.push(place(-W / 2 + (i + 0.5) * W / count));
    };
    side(perSide[0], t => ({ x: t, y: -edge, nx: 0, ny: -1 }));
    side(perSide[1], t => ({ x: edge, y: t, nx: 1, ny: 0 }));
    side(perSide[2], t => ({ x: -t, y: edge, nx: 0, ny: 1 }));
    side(perSide[3], t => ({ x: -edge, y: -t, nx: -1, ny: 0 }));
  } else if (shape === "round") {
    const r = Math.max(70, (n * 90) / (2 * Math.PI));
    W = H = 2 * r;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const c = Math.cos(a), s = Math.sin(a);
      seats.push({ x: c * (r + GAP), y: s * (r + GAP), nx: c, ny: s });
    }
  } else { // oval
    const rx = Math.max(120, (n * 95) / (Math.PI * 1.55)), ry = rx * 0.55;
    W = 2 * rx;
    H = 2 * ry;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n;
      const c = Math.cos(a), s = Math.sin(a);
      let nx = c / rx, ny = s / ry;
      const len = Math.hypot(nx, ny);
      nx /= len; ny /= len;
      seats.push({ x: c * rx + nx * GAP, y: s * ry + ny * GAP, nx, ny });
    }
  }
  return { W, H, seats };
}

// LABEL_W must match .label's max-width in app.css, and stay below SPACING
// so names on neighbouring seats don't overlap.
const LABEL_W = 96, LABEL_H = 26, SEAT_R = 16, LABEL_OFFSET = 22, MENU_H = 56, PAD = 12;

// The box a table needs for its top, seats, name labels and menu.
// (cx, cy) is the table's centre inside that box. Depends only on the shape
// and number of seats, so results are remembered.
const geometryCache = new Map();

function geometry(table) {
  const key = table.shape + ":" + table.seats.length;
  if (!geometryCache.has(key)) geometryCache.set(key, computeGeometry(table.shape, table.seats.length));
  return geometryCache.get(key);
}

function computeGeometry(shape, n) {
  const { W, H, seats } = seatLayout(shape, n);
  let minX = -W / 2, maxX = W / 2, minY = -H / 2, maxY = H / 2;
  const placed = seats.map(s => {
    const lx = s.x + s.nx * LABEL_OFFSET, ly = s.y + s.ny * LABEL_OFFSET;
    minX = Math.min(minX, s.x - SEAT_R, lx + (-0.5 + 0.5 * s.nx) * LABEL_W);
    maxX = Math.max(maxX, s.x + SEAT_R, lx + (0.5 + 0.5 * s.nx) * LABEL_W);
    minY = Math.min(minY, s.y - SEAT_R, ly + (-0.5 + 0.5 * s.ny) * LABEL_H);
    maxY = Math.max(maxY, s.y + SEAT_R, ly + (0.5 + 0.5 * s.ny) * LABEL_H);
    return { ...s, lx, ly };
  });
  return {
    W, H, placed,
    cx: -minX + PAD,
    cy: -minY + PAD,
    width: maxX - minX + 2 * PAD,
    height: maxY - minY + 2 * PAD + MENU_H,
  };
}

// The rectangle a table takes up in the room.
function box(table, g = geometry(table)) {
  const left = table.x - g.cx, top = table.y - g.cy;
  return { left, top, right: left + g.width, bottom: top + g.height };
}

// The rectangle around every placed table, or null if there are none.
function contentBounds(plan) {
  const boxes = plan.tables.filter(t => t.x != null).map(t => box(t));
  if (!boxes.length) return null;
  return {
    left: Math.min(...boxes.map(b => b.left)),
    top: Math.min(...boxes.map(b => b.top)),
    right: Math.max(...boxes.map(b => b.right)),
    bottom: Math.max(...boxes.map(b => b.bottom)),
  };
}

// A free grid spot for a table.
// With `near`: the free spot closest to that point.
// Without: the next spot in reading order (rows left to right, top to
// bottom), keeping rows about as wide as the plan already is.
function findFreeSpot(plan, table, near) {
  const g = geometry(table);
  const boxes = plan.tables.filter(t => t !== table && t.x != null).map(t => box(t));
  const fits = (x, y) => {
    const left = x - g.cx, top = y - g.cy, right = left + g.width, bottom = top + g.height;
    return !boxes.some(o =>
      left < o.right + MARGIN && o.left < right + MARGIN && top < o.bottom + MARGIN && o.top < bottom + MARGIN);
  };

  if (near) {
    // Check rings of grid points around `near`, nearest ring first.
    const x0 = snap(near.x), y0 = snap(near.y);
    for (let ring = 0; ring < 150; ring++) {
      let best = null, bestDist = Infinity;
      for (let i = -ring; i <= ring; i++) {
        for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
          const x = x0 + dx * GRID, y = y0 + dy * GRID;
          const dist = Math.hypot(dx, dy);
          if (dist < bestDist && fits(x, y)) { best = { x, y }; bestDist = dist; }
        }
      }
      if (best) return best;
    }
  }

  const bounds = contentBounds(plan) || { left: 0, top: 0, right: 0, bottom: 0 };
  const rowWidth = Math.max(1400, bounds.right - bounds.left);
  for (let y = snap(bounds.top + g.cy); ; y += GRID) {
    for (let x = snap(bounds.left + g.cx); x - g.cx + g.width <= bounds.left + rowWidth; x += GRID) {
      if (fits(x, y)) return { x, y };
    }
    if (y - g.cy > bounds.bottom + MARGIN) return { x: snap(bounds.left + g.cx), y }; // always free below everything
  }
}

// Gives tables without a position (new plans, imports) a spot in the room.
function placeUnplaced(plan) {
  let placed = false;
  for (const table of plan.tables) {
    if (table.x == null || table.y == null) { Object.assign(table, findFreeSpot(plan, table)); placed = true; }
  }
  return placed;
}
