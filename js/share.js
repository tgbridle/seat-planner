"use strict";
// Sharing a view-only copy of a plan as a link.
//
// There's no server yet, so the plan itself travels inside the link: it's
// packed small, compressed, and put after the "#" in the address (that part
// is never sent to any server). Opening the link shows the plan view only,
// with an option to save a copy. The link is a snapshot: later changes need
// a new link. Inviting editors needs accounts, so it's shown as coming soon.

const PUBLIC_APP_URL = "https://tgbridle.github.io/seat-planner/app.html";
const SHARE_PREFIX = "#share=1.";
const MAX_SHARE_BYTES = 2_000_000; // refuse links that unpack to something huge

// ----- Packing: short keys and arrays instead of objects, no ids -----

function packPlan(p) {
  return {
    n: p.eventName,
    t: p.tables.map(t => [t.name, SHAPES.indexOf(t.shape), Math.round(t.x), Math.round(t.y), t.seats.map(g => (g ? g.name : 0))]),
    u: p.unseated.map(g => g.name),
    c: p.venueCapacity,
  };
}

// Back to a plan; normalizePlan() then checks every part of it.
function unpackPlan(data) {
  const list = v => (Array.isArray(v) ? v : []);
  const guest = name => (typeof name === "string" ? { name } : null);
  return normalizePlan({
    eventName: data.n,
    tables: list(data.t).map(t => {
      const [name, shape, x, y, seats] = list(t);
      return { name, shape: SHAPES[shape], x, y, seats: list(seats).map(guest) };
    }),
    unseated: list(data.u).map(guest).filter(Boolean),
    venueCapacity: data.c,
  });
}

// ----- Compression and text encoding -----

async function compress(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_SHARE_BYTES) { reader.cancel(); throw new Error("Shared plan is too large"); }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

// Base64 that's safe in a web address.
function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function createShareLink(p) {
  const base = location.protocol.startsWith("http") ? location.origin + location.pathname : PUBLIC_APP_URL;
  return base + SHARE_PREFIX + toBase64Url(await compress(JSON.stringify(packPlan(p))));
}

// The shared plan in the current address, or null if there isn't one.
// Throws if there is one but it's damaged.
async function readShareLink() {
  if (!location.hash.startsWith(SHARE_PREFIX)) return null;
  const json = await decompress(fromBase64Url(location.hash.slice(SHARE_PREFIX.length)));
  const shared = unpackPlan(JSON.parse(json));
  if (!shared) throw new Error("Shared plan is incomplete");
  return shared;
}

// ----- The share dialog -----

async function openShareDialog() {
  const body = el("div", "dialog-body");
  body.append(
    el("h2", "serif", "Share this plan"),
    el("p", null, "Anyone with this link can see your seating plan. They can't change it."),
  );

  const linkSection = el("div", "dialog-section");
  const row = el("div", "copy-row");
  const input = el("input", "input");
  Object.assign(input, { readOnly: true, value: "Creating link…" });
  input.setAttribute("aria-label", "Share link");
  input.addEventListener("focus", () => input.select());
  const copy = labelButton("btn primary", ICONS.copy, "Copy link", () => copyLink(input, copy));
  copy.disabled = true;
  row.append(input, copy);
  linkSection.append(
    el("h3", null, "View-only link"),
    row,
    el("p", "hint", "The link is a snapshot of the plan as it is now. If you make changes, share a new link."),
  );

  const editors = el("div", "dialog-section");
  const editorRow = el("div", "copy-row");
  const email = el("input", "input");
  Object.assign(email, { type: "email", placeholder: "Email address", disabled: true });
  email.setAttribute("aria-label", "Editor's email address");
  const invite = textButton("btn", "Invite", () => {});
  invite.disabled = true;
  editorRow.append(email, invite);
  const heading = el("h3", null, "People who can edit ");
  heading.append(el("span", "soon", "Coming soon"));
  editors.append(heading, editorRow, el("p", "hint", "Invite someone to plan with you. This needs online accounts, which are on the way."));

  body.append(linkSection, editors);
  openDialog(body, dialogFoot(textButton("btn", "Done", closeDialog)));

  try {
    input.value = await createShareLink(store.plan);
    copy.disabled = false;
    copy.focus();
  } catch (err) {
    console.error(err);
    input.value = "Sorry, this browser can't create share links.";
  }
}

async function copyLink(input, button) {
  try {
    await navigator.clipboard.writeText(input.value);
    button.innerHTML = ICONS.check;
    button.append("Copied");
    setTimeout(() => {
      button.innerHTML = ICONS.copy;
      button.append("Copy link");
    }, 2000);
  } catch {
    input.focus();
    input.select();
    toast("Press Ctrl+C to copy the link");
  }
}
