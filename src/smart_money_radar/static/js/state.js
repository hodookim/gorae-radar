// state.js — singleton mutable state shared across modules.
// Other modules import `state` and read/mutate its fields directly.
export const state = {
  rows: [],
  picks: [],
  scannedCandidates: 0,
  autoEnabled: true,
  selectedAddress: null,
  selectedPick: null,
  refreshTimer: null,
  countdownTimer: null,
  nextRefreshAt: 0,
  refreshMs: 10_000,
};
