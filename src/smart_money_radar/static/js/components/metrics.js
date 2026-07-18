// components/metrics.js — summary metrics, candidate pool list, and recent flow list.
import { $, cleanName, esc, money, signedUsd, tone } from "../format.js?v=20";
import { state } from "../state.js?v=20";
import { positionCard } from "./position-card.js?v=20";

export function renderSummary() {
  const positions = state.rows.flatMap((row) => row.snapshot.open_positions || []);
  let longValue = 0;
  let shortValue = 0;
  for (const position of positions) {
    const value = Math.abs(Number(position.position_value || 0));
    if (position.side === "LONG") longValue += value;
    else shortValue += value;
  }
  $("kTop").textContent = state.rows.length;
  $("kPositions").textContent = positions.length;
  $("kFills").textContent = state.scannedCandidates;
  $("kLong").textContent = longValue > 0 ? `$${money(longValue)}` : "-";
  $("kShort").textContent = shortValue > 0 ? `$${money(shortValue)}` : "-";
}

export function renderCandidatePool() {
  if (!state.rows.length) {
    $("candidatePool").innerHTML = '<div class="empty">현재 포지션이 열린 후보가 없습니다.</div>';
    return;
  }
  $("candidatePool").innerHTML = state.rows.map((row) => {
    const c = row.candidate;
    return `
      <div class="row candidate-row" data-address="${esc(c.address)}" tabindex="0" role="button" aria-label="${esc(c.radar_label || cleanName(c))} 지갑 상세 보기">
        <div class="mono">${row.rank}</div>
        <div>
          <div class="name">${esc(c.radar_label || cleanName(c))}</div>
          <div class="address">${esc(c.short_address || c.address)}</div>
        </div>
        <div class="mono ${tone(c.month_pnl)}">${signedUsd(c.month_pnl)}</div>
      </div>
    `;
  }).join("");
}

export function renderFlow() {
  const positions = state.rows
    .flatMap((row) => (row.snapshot.open_positions || []).map((position) => ({...position, label: row.candidate.radar_label, fills: row.snapshot.recent_fills || []})))
    .slice(0, 10);

  const positionHtml = positions.map((position) => positionCard(position, position.fills || [], true)).join("");
  $("flowList").innerHTML = `
    ${positionHtml || '<div class="empty">열린 포지션이 없습니다.</div>'}
  `;
}
