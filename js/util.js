"use strict";
// Small helpers used throughout the app: building elements, icons,
// popover menus, dialogs and toast messages.
//
// Safety rule for the whole app: text that came from a person (guest and
// table names, imported files, share links) is only ever put on the page
// with textContent, never innerHTML. innerHTML is only used for the fixed
// icons below.

const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, "0")).join("");

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

// Collapse runs of spaces and trim; cap the length so nothing can flood the page.
const cleanText = (value, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function timeAgo(timestamp) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, "hour") + " ago";
  const days = Math.round(hours / 24);
  if (days < 30) return plural(days, "day") + " ago";
  return new Date(timestamp).toLocaleDateString();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function iconButton(className, icon, title, onClick) {
  const b = el("button", className);
  b.type = "button";
  b.innerHTML = icon;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", e => { e.stopPropagation(); onClick(e); });
  return b;
}

// A button with an icon and a text label.
function labelButton(className, icon, label, onClick) {
  const b = el("button", className);
  b.type = "button";
  b.innerHTML = icon;
  b.append(label);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  rect: svg('<rect x="2" y="7" width="20" height="10" rx="2"/>'),
  square: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  round: svg('<circle cx="12" cy="12" r="8"/>'),
  oval: svg('<ellipse cx="12" cy="12" rx="10" ry="6"/>'),
  splitGuests: svg('<rect x="2" y="8" width="8" height="8" rx="1.5"/><rect x="14" y="8" width="8" height="8" rx="1.5"/><circle cx="6" cy="4" r="1.2"/><circle cx="18" cy="4" r="1.2"/><circle cx="6" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/>'),
  split: svg('<rect x="2" y="8" width="8" height="8" rx="1.5"/><rect x="14" y="8" width="8" height="8" rx="1.5" stroke-dasharray="2.5 2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'),
};

// ----- Popover menus -----
// Opens below its button; closes on a click outside, on Escape, or via close().
// `fill` (optional) rebuilds the contents each time it opens.

function bindPopover(trigger, panel, fill) {
  const set = open => {
    if (open && fill) fill(panel);
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  };
  trigger.addEventListener("click", e => { e.stopPropagation(); set(panel.hidden); });
  document.addEventListener("pointerdown", e => {
    if (!panel.hidden && !panel.contains(e.target) && !trigger.contains(e.target)) set(false);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !panel.hidden) {
      e.preventDefault(); // tells other Escape handlers this one was used
      set(false);
      trigger.focus();
    }
  });
  return { close: () => set(false) };
}

// ----- Dialogs -----
// One shared <dialog>. Escape and clicking the dim background close it.

const dialogEl = document.getElementById("dialog");
dialogEl.addEventListener("click", e => { if (e.target === dialogEl) dialogEl.close(); });

function openDialog(...children) {
  dialogEl.replaceChildren(...children);
  if (!dialogEl.open) dialogEl.showModal();
}

const closeDialog = () => dialogEl.close();
const isDialogOpen = () => dialogEl.open;

function dialogFoot(...buttons) {
  const foot = el("div", "dialog-foot");
  foot.append(...buttons);
  return foot;
}

function textButton(className, text, onClick) {
  const b = el("button", className, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

// Resolves true if confirmed, false if cancelled or dismissed.
function confirmDialog({ title, message, confirmText, danger = false }) {
  return new Promise(resolve => {
    let result = false;
    const body = el("div", "dialog-body");
    body.append(el("h2", "serif", title), el("p", null, message));
    const ok = textButton("btn " + (danger ? "danger-text" : "primary"), confirmText, () => { result = true; closeDialog(); });
    openDialog(body, dialogFoot(textButton("btn", "Cancel", closeDialog), ok));
    ok.focus();
    dialogEl.addEventListener("close", () => resolve(result), { once: true });
  });
}

// ----- Toast -----
// A short message at the bottom of the screen, with an optional action button.

const toastEl = document.getElementById("toast");
let toastTimer = null;

function toast(message, action) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(el("span", null, message));
  if (action) {
    toastEl.append(textButton("", action.label, () => { hideToast(); action.run(); }));
  }
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}

function downloadFile(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = el("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
