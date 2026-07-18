// views/live.js — full live dashboard view.
//
// Mounts the existing dashboard (built from #live-template) into #app, runs the
// first refresh cycle, and starts the 10s polling loop. On unmount, polling is
// stopped and the live DOM is moved into a hidden stash (#live-stash) rather
// than destroyed, so any in-flight fetch's render/log calls still resolve
// their $() lookups safely (and re-mounting live is cheap).
//
// Event bindings that used to live in main.js (refreshBtn, pauseBtn, minScore)
// and the delegated click for [data-address]/.add-wallet are owned
// by this view now.
import { $, log } from "../format.js?v=20";
import { state } from "../state.js?v=20";
import { addWallet } from "../api.js?v=29";
import { scheduleNext, tick } from "../refresh.js?v=29";
import { closePickDetailModal, renderDetail, renderPickDetail } from "../components/detail-panel.js?v=22";

const STASH_ID = "live-stash";

let liveRoot = null;       // the live DOM root (rebuilt once, then reused)
let clickHandler = null;   // delegated document-click handler (bound on first mount)
let keyHandler = null;
let controlsBound = false;
// When non-null, live is unmounted and state.autoEnabled was temporarily flipped
// to false to stop the in-flight tick's finally→scheduleNext from rearming. The
// next mount restores the user's real preference.
let savedAutoEnabled = null;

function buildLiveDom() {
  const tpl = document.getElementById("live-template");
  const root = document.createElement("div");
  root.className = "live-root";
  root.appendChild(tpl.content.cloneNode(true));
  return root;
}

function bindEvents() {
  if (!controlsBound) {
    $("refreshBtn").addEventListener("click", () => tick());
    $("pauseBtn").addEventListener("click", () => {
      state.autoEnabled = !state.autoEnabled;
      $("pauseBtn").textContent = state.autoEnabled ? "자동 일시정지" : "자동 재개";
      log(state.autoEnabled ? "자동 갱신 재개" : "자동 갱신 일시정지");
      scheduleNext();
    });
    $("minScore").addEventListener("change", () => tick());
    controlsBound = true;
  }

  if (!clickHandler) clickHandler = (event) => {
    const addBtn = event.target.closest("button.add-wallet");
    if (addBtn) {
      event.stopPropagation();
      addWallet(addBtn.dataset.address, addBtn.dataset.label);
      return;
    }
    const pickCard = event.target.closest(".pick-card[data-pick-coin][data-pick-side]");
    if (pickCard) {
      event.stopPropagation();
      renderPickDetail({
        coin: pickCard.dataset.pickCoin,
        side: pickCard.dataset.pickSide,
      });
      return;
    }
    const item = event.target.closest("[data-address]");
    if (item) {
      const row = state.rows.find(
        (candidateRow) => candidateRow.candidate.address === item.dataset.address,
      );
      if (row) renderDetail(row);
    }
  };
  if (clickHandler) document.addEventListener("click", clickHandler);

  if (!keyHandler) keyHandler = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest?.("button, a, input, select")) return;
    const pickCard = event.target.closest?.(".pick-card[data-pick-coin][data-pick-side]");
    if (pickCard) {
      event.preventDefault();
      renderPickDetail({
        coin: pickCard.dataset.pickCoin,
        side: pickCard.dataset.pickSide,
      });
      return;
    }
    const item = event.target.closest?.("[data-address]");
    if (!item) return;
    const row = state.rows.find(
      (candidateRow) => candidateRow.candidate.address === item.dataset.address,
    );
    if (!row) return;
    event.preventDefault();
    renderDetail(row);
  };
  if (keyHandler) document.addEventListener("keydown", keyHandler);
}

function unbindEvents() {
  if (clickHandler) {
    document.removeEventListener("click", clickHandler);
    clickHandler = null;
  }
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
}

function stashEl() {
  return document.getElementById(STASH_ID);
}

export function mount(container) {
  const stash = stashEl();
  if (liveRoot && stash && liveRoot.parentElement === stash) {
    // Restore the previously stashed DOM (preserves any partial renders done
    // by an in-flight fetch that completed while the user was on another view).
    container.appendChild(liveRoot);
  } else {
    liveRoot = buildLiveDom();
    container.appendChild(liveRoot);
  }
  bindEvents();

  // Restore the user's pause preference if it was temporarily flipped on unmount.
  if (savedAutoEnabled !== null) {
    state.autoEnabled = savedAutoEnabled;
    savedAutoEnabled = null;
  }
  // Keep the pause button label in sync (template always ships with default text).
  const pauseBtn = $("pauseBtn");
  if (pauseBtn) pauseBtn.textContent = state.autoEnabled ? "자동 일시정지" : "자동 재개";

  // First refresh cycle (loadRadar → renderAll → scheduleNext).
  tick();
}

export function unmount() {
  unbindEvents();
  closePickDetailModal();

  // Stop the polling loop. Note: an in-flight tick()'s `finally` will still
  // call scheduleNext() after this returns; to prevent it from rearming the
  // timer, temporarily flip autoEnabled off (restored on next mount).
  clearTimeout(state.refreshTimer);
  clearInterval(state.countdownTimer);
  state.refreshTimer = null;
  state.countdownTimer = null;
  state.nextRefreshAt = 0;
  savedAutoEnabled = state.autoEnabled;
  state.autoEnabled = false;

  // Move the live DOM into the hidden stash (kept in document so $() lookups
  // from any in-flight render/log still resolve without crashing).
  const stash = stashEl();
  if (liveRoot && stash && liveRoot.parentElement !== stash) {
    stash.appendChild(liveRoot);
  }
}
