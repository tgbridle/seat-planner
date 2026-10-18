"use strict";
// Saving and loading, using the browser's local storage.
//
// For now there is one built-in test user and everything is kept in this
// browser on this device. When real accounts arrive, this is the only file
// that needs to talk to a server instead; the rest of the app just calls
// these functions.
//
// Stored keys:
//   seat-planner:account     -> { user, currentEventId, events: [{ id, name, updatedAt }] }
//   seat-planner:event:<id>  -> the plan for that event

const storage = (() => {
  const ACCOUNT_KEY = "seat-planner:account";
  const LEGACY_KEY = "seat-planner-v1"; // the single plan saved by earlier versions
  const eventKey = id => "seat-planner:event:" + id;
  const TEST_USER = { id: "test-user", name: "Test User" };

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  // Returns false if the browser refused (storage full or switched off).
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch { /* nothing to do */ }
  }

  function loadAccount() {
    const saved = read(ACCOUNT_KEY);
    if (saved && Array.isArray(saved.events)) {
      const events = saved.events.filter(e => e && typeof e.id === "string");
      return { user: TEST_USER, events, currentEventId: saved.currentEventId };
    }
    // First visit, or a plan from the earlier one-plan version to bring across.
    const account = { user: TEST_USER, events: [], currentEventId: null };
    const legacy = normalizePlan(read(LEGACY_KEY));
    const id = uid();
    if (legacy && write(eventKey(id), legacy)) {
      account.events.push({ id, name: legacy.eventName, updatedAt: Date.now() });
      account.currentEventId = id;
      // Only forget the old save once the new one is safely stored.
      if (write(ACCOUNT_KEY, { events: account.events, currentEventId: id })) remove(LEGACY_KEY);
    }
    return account;
  }

  return {
    ACCOUNT_KEY,
    eventKey,
    loadAccount,
    saveAccount: account => write(ACCOUNT_KEY, { events: account.events, currentEventId: account.currentEventId }),
    loadPlan: id => normalizePlan(read(eventKey(id))),
    savePlan: (id, plan) => write(eventKey(id), plan),
    deletePlan: id => remove(eventKey(id)),
  };
})();
