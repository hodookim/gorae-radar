// refresh.js — 10s polling scheduler, countdown, and the refresh cycle.
// Owns the loadRadar -> scheduleNext loop so api.js does not need to import back here
// (breaks what would otherwise be an api <-> refresh import cycle).
import { $ } from "./format.js?v=20";
import { state } from "./state.js?v=20";
import { loadRadar } from "./api.js?v=29";

export function renderCountdown() {
  if (!state.autoEnabled || !state.nextRefreshAt) {
    $("kCountdown").textContent = "정지";
    return;
  }
  const left = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
  $("kCountdown").textContent = `${left}s`;
}

export function scheduleNext() {
  clearTimeout(state.refreshTimer);
  clearInterval(state.countdownTimer);
  if (!state.autoEnabled) {
    $("kCountdown").textContent = "정지";
    return;
  }
  state.nextRefreshAt = Date.now() + state.refreshMs;
  state.refreshTimer = setTimeout(tick, state.refreshMs);
  state.countdownTimer = setInterval(renderCountdown, 1000);
  renderCountdown();
}

// One full refresh cycle: fetch+render, then reschedule. Drives the polling loop
// and is also the handler for manual refresh and filter changes.
export async function tick() {
  try {
    await loadRadar();
  } finally {
    scheduleNext();
  }
}
