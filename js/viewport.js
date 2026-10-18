"use strict";
// Panning and zooming the floor.
//
//   Trackpad pinch / Ctrl + mouse wheel   zoom around the pointer
//   Two-finger scroll / mouse wheel        pan
//   Drag on empty floor (or middle mouse)  pan
//   Two-finger pinch on a touch screen     zoom and pan
//
// The room is moved with a CSS transform: screen = room * z + (x, y).
// Zooming out stops once everything fits on screen (but never stops above
// 50%), and panning always keeps part of the plan in view, so you can't
// lose your tables.

const viewport = (() => {
  const MAX_ZOOM = 2;
  const LOWEST_ZOOM = 0.2;   // even for very large plans
  const MIN_ZOOM_CAP = 0.5;  // you can always zoom out at least this far
  const KEEP_VISIBLE = 220;  // screen pixels of the plan that stay in view
  const FIT_PAD = 48;        // space around the plan when fitting it
  const TOP_PAD = 72;        // room for the "Add table" button

  const floor = document.getElementById("floor");
  const room = document.getElementById("room");
  const zoomLabel = document.getElementById("zoomReset");
  const view = { x: 0, y: 0, z: 1 };
  let getBounds = () => null;
  let onBackgroundClick = () => {};
  let onChange = () => {};

  const size = () => ({ w: floor.clientWidth, h: floor.clientHeight });

  // The zoom that fits these bounds on screen.
  function fitZoom(b) {
    const { w, h } = size();
    return Math.min((w - 2 * FIT_PAD) / (b.right - b.left), (h - TOP_PAD - FIT_PAD) / (b.bottom - b.top));
  }

  function minZoom() {
    const b = getBounds();
    return b ? clamp(fitZoom(b), LOWEST_ZOOM, MIN_ZOOM_CAP) : MIN_ZOOM_CAP;
  }

  // Keep at least KEEP_VISIBLE pixels of the plan on screen in each direction.
  function clampPan() {
    const b = getBounds();
    if (!b) return;
    const { w, h } = size();
    const keepX = Math.min(KEEP_VISIBLE, w / 2), keepY = Math.min(KEEP_VISIBLE, h / 2);
    view.x = clamp(view.x, keepX - b.right * view.z, w - keepX - b.left * view.z);
    view.y = clamp(view.y, keepY - b.bottom * view.z, h - keepY - b.top * view.z);
  }

  function apply() {
    view.z = clamp(view.z, minZoom(), MAX_ZOOM);
    clampPan();
    room.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    // Zoomed far out, show every 2nd (or 4th...) dot so they don't blur together.
    let dots = GRID * view.z;
    while (dots < 12) dots *= 2;
    floor.style.backgroundSize = `${dots}px ${dots}px`;
    floor.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomLabel.textContent = Math.round(view.z * 100) + "%";
    onChange();
  }

  // Zoom to `z`, keeping the room point under (sx, sy) where it is on screen.
  // (sx, sy) are relative to the floor; the default is its centre.
  function zoomTo(z, sx = size().w / 2, sy = size().h / 2) {
    const wx = (sx - view.x) / view.z, wy = (sy - view.y) / view.z;
    view.z = clamp(z, minZoom(), MAX_ZOOM);
    view.x = sx - wx * view.z;
    view.y = sy - wy * view.z;
    apply();
  }

  function panBy(dx, dy) {
    view.x += dx;
    view.y += dy;
    apply();
  }

  // Show the whole plan, no bigger than 100%.
  function fit() {
    const b = getBounds();
    if (!b) return;
    const { w, h } = size();
    view.z = clamp(fitZoom(b), LOWEST_ZOOM, 1);
    view.x = (w - (b.right - b.left) * view.z) / 2 - b.left * view.z;
    view.y = TOP_PAD + (h - TOP_PAD - FIT_PAD - (b.bottom - b.top) * view.z) / 2 - b.top * view.z;
    apply();
  }

  // Pan just enough to bring a room rectangle fully into view (if it fits).
  function reveal(r) {
    const { w, h } = size();
    const left = r.left * view.z + view.x, right = r.right * view.z + view.x;
    const top = r.top * view.z + view.y, bottom = r.bottom * view.z + view.y;
    let dx = 0, dy = 0;
    if (left < FIT_PAD) dx = FIT_PAD - left; else if (right > w - FIT_PAD) dx = Math.max(w - FIT_PAD - right, FIT_PAD - left);
    if (top < TOP_PAD) dy = TOP_PAD - top; else if (bottom > h - FIT_PAD) dy = Math.max(h - FIT_PAD - bottom, TOP_PAD - top);
    if (dx || dy) panBy(dx, dy);
  }

  // The room point in the middle of what's on screen.
  function visibleCentre() {
    const { w, h } = size();
    return { x: (w / 2 - view.x) / view.z, y: ((h + TOP_PAD) / 2 - view.y) / view.z };
  }

  // ----- Mouse wheel and trackpad -----
  // Browsers report a trackpad pinch as a wheel event with Ctrl held.
  floor.addEventListener("wheel", e => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size().h : 1; // lines or pages to pixels
    const r = floor.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomTo(view.z * Math.exp(-e.deltaY * unit * 0.01), e.clientX - r.left, e.clientY - r.top);
    else panBy(-e.deltaX * unit, -e.deltaY * unit);
  }, { passive: false });

  // Safari on a Mac reports trackpad pinches as "gesture" events instead.
  let gestureStartZoom = 1;
  floor.addEventListener("gesturestart", e => { e.preventDefault(); gestureStartZoom = view.z; });
  floor.addEventListener("gesturechange", e => {
    e.preventDefault();
    const r = floor.getBoundingClientRect();
    zoomTo(gestureStartZoom * e.scale, e.clientX - r.left, e.clientY - r.top);
  });

  // ----- Dragging the floor, and pinching on touch screens -----
  const touches = new Map(); // pointerId -> { x, y } for fingers on the floor
  let pinch = null;
  let pan = null;

  const floorPoint = e => {
    const r = floor.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function pinchState() {
    const [a, b] = [...touches.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  // Capture phase: count every finger, even ones that land on a table.
  floor.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, floorPoint(e));
    if (touches.size === 2) {
      pan = null;
      pinch = { ...pinchState(), view: { ...view } };
    }
  }, true);

  floor.addEventListener("pointerdown", e => {
    if (pinch) return;
    const onBackground = !e.target.closest(".table-wrap");
    if (e.button === 1) e.preventDefault(); // middle button: no auto-scroll
    else if (e.button !== 0 || !onBackground) return;
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  });

  window.addEventListener("pointermove", e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, floorPoint(e));
    if (pinch && touches.size >= 2) {
      const now = pinchState(), start = pinch.view;
      const wx = (pinch.mid.x - start.x) / start.z, wy = (pinch.mid.y - start.y) / start.z;
      view.z = clamp(start.z * (now.dist / pinch.dist), minZoom(), MAX_ZOOM);
      view.x = now.mid.x - wx * view.z;
      view.y = now.mid.y - wy * view.z;
      apply();
      return;
    }
    if (!pan || e.pointerId !== pan.id) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    floor.classList.add("panning");
    pan.x = e.clientX;
    pan.y = e.clientY;
    panBy(dx, dy);
  });

  function endPointer(e) {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (pan && e.pointerId === pan.id) {
      // A press on the floor without dragging is a click on empty space.
      if (!pan.moved && e.type === "pointerup") onBackgroundClick();
      pan = null;
      floor.classList.remove("panning");
    }
  }
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  window.addEventListener("resize", () => apply());

  // ----- Zoom buttons -----
  const STEP = 1.25;
  document.getElementById("zoomIn").addEventListener("click", () => zoomTo(view.z * STEP));
  document.getElementById("zoomOut").addEventListener("click", () => zoomTo(view.z / STEP));
  document.getElementById("zoomReset").addEventListener("click", () => zoomTo(1));
  document.getElementById("zoomFit").addEventListener("click", fit);

  return {
    // options.getBounds: () => the room rectangle holding every table, or null
    // options.onBackgroundClick: a click on empty floor
    // options.onChange: called after every pan or zoom
    init(options) {
      ({ getBounds, onBackgroundClick, onChange } = options);
      apply();
    },
    get zoom() { return view.z; },
    isPinching: () => pinch !== null,
    refresh: apply,
    fit,
    reveal,
    visibleCentre,
    zoomTo,
  };
})();
