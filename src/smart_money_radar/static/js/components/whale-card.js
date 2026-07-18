// components/whale-card.js — whale card (upgraded body), mascot SVG, board renderer,
// and the shared selection marker.
import { $, cleanName, esc, money, signedUsd, tone } from "../format.js?v=20";
import { state } from "../state.js?v=20";

export function whaleMascot(score = 0, index = 0) {
  // Mascot asset swap: was an inline SVG, now a fixed <img> asset. Signature
  // (score, index) is preserved for backward-compat with any caller, but the
  // variant is fixed to "neutral" — high-confidence status is already signaled
  // by the parent card's border + glow (components.css). Elite whales get a
  // brighter drop-shadow on the img via the `--elite` modifier.
  // `index` is kept in the signature but no longer drives a gradient id.
  void index;
  const elite = Number(score || 0) >= 88;
  const variantClass = elite ? " whale-mascot--elite" : "";
  return `<img class="whale-mascot${variantClass}" src="/static/assets/mascot/mascot-whale-neutral.svg" alt="" width="48" height="48" loading="lazy" decoding="async">`;
}

export function whaleCard(row, index) {
  const candidate = row.candidate;
  const snapshot = row.snapshot || {};
  const score = Math.max(0, Math.min(100, Number(candidate.score || 0)));
  const positions = snapshot.open_positions || [];
  const label = candidate.radar_label || cleanName(candidate);
  const rawTags = candidate.radar_tags || [];
  const rawSuspicion = candidate.insider_suspicion_score;
  const suspicion = rawSuspicion == null || !Number.isFinite(Number(rawSuspicion))
    ? null
    : Math.max(0, Math.min(100, Number(rawSuspicion)));
  const summary = String(candidate.radar_summary || "").trim();
  const cardClass = [
    "whale-card",
    score >= 88 ? "elite" : "",
    suspicion != null && suspicion >= 65 ? "insider" : "",
  ].filter(Boolean).join(" ");
  const displayTags = [
    ...(suspicion != null ? [`의심 ${Math.round(suspicion)}/100`] : []),
    ...rawTags.filter((tag) => !/^의심(?:\s|점수)/.test(String(tag))),
  ].filter((tag, tagIndex, tags) => tags.indexOf(tag) === tagIndex).slice(0, 2);
  const tags = displayTags.map((tag) => `<span class="pill">${esc(tag)}</span>`).join("");
  return `
    <article class="${cardClass}" data-address="${esc(candidate.address)}">
      <div class="whale-card__identity">
        <span class="wallet-rank">${String(index + 1).padStart(2, "0")}</span>
        ${whaleMascot(score, index)}
        <div class="whale-card__name">
          <div class="name ${score >= 88 ? "hot" : ""}">${esc(label)}</div>
          <div class="address">${esc(candidate.short_address || candidate.address)}</div>
          <div class="label-row">${tags || '<span class="pill">열린 포지션</span>'}</div>
          ${summary ? `<p class="whale-card__summary">${esc(summary)}</p>` : ""}
        </div>
      </div>
      <dl class="whale-card__metrics">
        <div><dt>점수</dt><dd class="mono">${score.toFixed(0)}</dd></div>
        <div><dt>계정</dt><dd class="mono">$${money(candidate.account_value)}</dd></div>
        <div><dt>월 PnL</dt><dd class="mono ${tone(candidate.month_pnl)}">${signedUsd(candidate.month_pnl)}</dd></div>
        <div><dt>주 PnL</dt><dd class="mono ${tone(candidate.week_pnl)}">${signedUsd(candidate.week_pnl)}</dd></div>
        <div><dt>포지션</dt><dd class="mono">${positions.length}</dd></div>
      </dl>
      <div class="whale-card__activity">
        <span>현재 열린 포지션</span>
        <strong class="mono">${positions.length}개</strong>
      </div>
      <div class="whale-card__actions">
        <button class="wallet-detail-button ghost" data-address="${esc(candidate.address)}" type="button">상세</button>
        ${candidate.watched ? '<span class="pill good">관심 등록됨</span>' : `<button class="add-wallet" data-address="${esc(candidate.address)}" data-label="${esc(label)}">관심 등록</button>`}
      </div>
    </article>
  `;
}

export function markSelected(address) {
  document.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
  if (!address) return;
  document.querySelectorAll(`[data-address="${CSS.escape(address)}"]`).forEach((el) => {
    if (el.classList.contains("whale-card") || el.classList.contains("candidate-row")) {
      el.classList.add("selected");
    }
  });
}

export function renderTopWhales() {
  if (!state.rows.length) {
    $("topWhaleBoard").innerHTML = `<div class="empty empty-state"><img class="empty-state__mascot" src="/static/assets/mascot/mascot-whale-sleeping.svg" alt="" width="96" height="96" loading="lazy" decoding="async"><p class="empty-state__text">현재 열린 포지션이 있는 지갑을 찾지 못했습니다.<br>최소 점수를 낮추거나 다음 갱신을 기다려 주세요.</p></div>`;
    return;
  }
  $("topWhaleBoard").innerHTML = state.rows.map((row, index) => whaleCard(row, index)).join("");
  markSelected(state.selectedAddress || state.rows[0].candidate.address);
}
