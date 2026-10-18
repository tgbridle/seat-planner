"use strict";
// The event name in the top bar, the menu for switching between events,
// the "Saved" indicator, and the account menu.

const editEventName = () => startEdit(eventNameEl, () => store.plan.eventName, renameEvent);
eventNameEl.addEventListener("click", editEventName);

const eventMenu = bindPopover(document.getElementById("eventSwitch"), document.getElementById("eventMenu"), fillEventMenu);
bindPopover(document.getElementById("accountBtn"), document.getElementById("accountMenu"), fillAccountMenu);

function fillEventMenu(menu) {
  const list = el("ul", "event-list");
  for (const event of store.events) {
    const row = el("li", "event-row");
    row.classList.toggle("current", event.id === store.eventId);

    const open = el("button", "event-open");
    open.type = "button";
    open.append(el("span", "event-title", event.name), el("span", "event-meta", "Edited " + timeAgo(event.updatedAt)));
    open.addEventListener("click", () => { eventMenu.close(); store.openEvent(event.id); });

    row.append(
      open,
      iconButton("icon-btn small", ICONS.copy, "Duplicate", () => { eventMenu.close(); store.duplicateEvent(event.id); toast("Event duplicated"); }),
      iconButton("icon-btn small", ICONS.trash, "Delete", () => { eventMenu.close(); deleteEvent(event); }),
    );
    list.append(row);
  }

  const create = labelButton("menu-item", ICONS.plus, "New event", () => {
    eventMenu.close();
    store.createEvent();
    editEventName(); // straight into naming it
  });
  menu.replaceChildren(el("div", "menu-label", "Your events"), list, el("div", "menu-divider"), create);
}

async function deleteEvent(event) {
  const ok = await confirmDialog({
    title: "Delete this event?",
    message: `"${event.name}" and its seating plan will be deleted. This can't be undone.`,
    confirmText: "Delete event",
    danger: true,
  });
  if (ok) {
    store.deleteEvent(event.id);
    toast("Event deleted");
  }
}

function fillAccountMenu(menu) {
  const signOut = labelButton("menu-item", ICONS.logout, "Sign out");
  signOut.disabled = true;
  signOut.append(el("span", "soon", "Coming soon"));
  menu.replaceChildren(
    el("div", "menu-label", store.user.name),
    el("p", "menu-note", "This is a test account. Your events are saved in this browser on this device."),
    el("div", "menu-divider"),
    signOut,
  );
}

function renderAccount() {
  document.getElementById("accountBtn").textContent = initials(store.user.name);
  document.getElementById("accountBtn").title = store.user.name;
}

// "Saved" with a tick, or a warning if the browser wouldn't store it.
function renderSaveStatus() {
  const status = document.getElementById("saveStatus");
  status.classList.toggle("error", store.saveFailed);
  if (store.saveFailed) {
    status.innerHTML = ICONS.alert;
    status.append(el("span", "text", "Not saved"));
    status.title = "Your browser wouldn't save this plan. Its storage may be full or switched off.";
  } else {
    status.innerHTML = ICONS.check;
    status.append(el("span", "text", "Saved"));
    status.title = store.lastSaved ? "All changes saved " + timeAgo(store.lastSaved) : "All changes saved";
  }
}
