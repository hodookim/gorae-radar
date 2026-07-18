// render.js — top-level render orchestrator.
// Centralizes the render call order so api.js can invoke it without importing the
// entry point (avoids an api <-> main cycle).
import { state } from "./state.js?v=20";
import { renderCandidatePool, renderFlow, renderSummary } from "./components/metrics.js?v=20";
import { renderTopWhales } from "./components/whale-card.js?v=22";
import { renderDetail, renderPickDetail } from "./components/detail-panel.js?v=22";
import { renderWhalePicks } from "./picks.js?v=23";

export function renderAll() {
  renderSummary();
  renderWhalePicks();
  renderTopWhales();
  renderCandidatePool();
  renderFlow();
  if (state.selectedPick) {
    renderPickDetail(state.selectedPick);
    return;
  }
  const selected = state.rows.find((row) => row.candidate.address === state.selectedAddress) || state.rows[0];
  if (selected) renderDetail(selected);
}
