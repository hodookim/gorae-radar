// components/detail-panel.js — detail pane renderer plus private score-breakdown & metric helpers.
import { $, cleanName, esc, money, signedUsd, tone } from "../format.js?v=20";
import { state } from "../state.js?v=20";
import { coinLogo } from "../coin-icons.js?v=20";
import { markSelected } from "./whale-card.js?v=22";
import { positionCard } from "./position-card.js?v=20";

const PICK_MODAL_ID = "pick-detail-modal";

function metric(label, value, cls = "") {
  return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value ${cls}">${value}</div></div>`;
}

export function closePickDetailModal({ clearSelection = true } = {}) {
  const modal = document.getElementById(PICK_MODAL_ID);
  if (modal) modal.remove();
  document.body.classList.remove("modal-open");
  if (clearSelection) {
    state.selectedPick = null;
    document.querySelectorAll(".pick-card.selected").forEach((el) => el.classList.remove("selected"));
  }
}

function openPickDetailModal(content) {
  closePickDetailModal({ clearSelection: false });
  const modal = document.createElement("div");
  modal.id = PICK_MODAL_ID;
  modal.className = "pick-detail-modal";
  modal.innerHTML = `
    <div class="pick-detail-modal__backdrop" data-pick-modal-close></div>
    <div class="pick-detail-modal__panel" role="dialog" aria-modal="true" aria-label="집중 포지션 상세">
      <button class="pick-detail-modal__close" type="button" data-pick-modal-close aria-label="닫기">×</button>
      ${content}
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-pick-modal-close]")) closePickDetailModal();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePickDetailModal();
  });
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  modal.querySelector(".pick-detail-modal__close")?.focus();
}

function scoreBreakdown(parts) {
  const rows = [
    ["규모", parts.size || 0, 20, ""],
    ["실력", parts.skill || 0, 40, ""],
    ["일관성", parts.consistency || 0, 20, ""],
    ["활동성", parts.activity || 0, 15, ""],
    ["리스크", parts.risk_penalty || 0, 30, "risk"],
  ];
  return rows.map(([name, value, max, cls]) => {
    const pct = Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100));
    return `
      <div class="score-line">
        <div>${esc(name)}</div>
        <div class="bar"><div class="fill ${cls}" style="--pct:${pct}%"></div></div>
        <div class="mono">${Number(value).toFixed(1)}</div>
      </div>
    `;
  }).join("");
}

export function renderDetail(row) {
  closePickDetailModal({ clearSelection: false });
  state.selectedAddress = row.candidate.address;
  state.selectedPick = null;
  markSelected(state.selectedAddress);
  const candidate = row.candidate;
  const snapshot = row.snapshot || {};
  const positions = snapshot.open_positions || [];
  const fills = snapshot.recent_fills || [];
  const score = Number(candidate.score || 0);
  const rawSuspicion = candidate.insider_suspicion_score;
  const suspicion = rawSuspicion == null || !Number.isFinite(Number(rawSuspicion))
    ? null
    : Math.max(0, Math.min(100, Number(rawSuspicion)));
  const radarSummary = String(candidate.radar_summary || "").trim();
  const breakdown = candidate.score_breakdown || null;
  const hasBreakdown = breakdown && Object.values(breakdown).some((value) => Number(value) !== 0);
  $("detailPane").innerHTML = `
    <div class="detail-inner">
      <div class="detail-title">지갑 상세</div>
      <div class="detail-name">${esc(candidate.radar_label || cleanName(candidate))}</div>
      <div class="detail-address mono">${esc(candidate.address)}</div>
      ${radarSummary ? `<p class="detail-summary">${esc(radarSummary)}</p>` : ""}
      <div class="status-strip">
        ${suspicion != null ? `<span class="pill">의심 ${Math.round(suspicion)}/100</span>` : ""}
        ${(candidate.radar_tags || []).map((tag) => `<span class="pill">${esc(tag)}</span>`).join("")}
        ${candidate.watched ? '<span class="pill good">관심 등록됨</span>' : ""}
      </div>
      <div class="detail-grid">
        ${metric("점수", score.toFixed(1), score >= 70 ? "good" : score >= 50 ? "warn" : "")}
        ${metric("계정", "$" + money(candidate.account_value))}
        ${metric("월 PnL", signedUsd(candidate.month_pnl), tone(candidate.month_pnl))}
        ${metric("주 PnL", signedUsd(candidate.week_pnl), tone(candidate.week_pnl))}
        ${metric("일 PnL", signedUsd(candidate.day_pnl), tone(candidate.day_pnl))}
        ${metric("포지션", String(positions.length))}
        ${suspicion != null ? metric("의심 점수", `${Math.round(suspicion)}/100`, suspicion >= 65 ? "warn" : "") : ""}
      </div>
      <div class="section-title">점수 산정</div>
      ${hasBreakdown
        ? scoreBreakdown(breakdown)
        : '<div class="small">계정 규모, 기간별 손익과 활동성을 조합한 관찰 점수입니다. <a class="text-link" href="/methodology">산정 방식 보기</a></div>'}
      <div class="section-title">현재 포지션</div>
      ${positions.map((position) => positionCard(position, fills)).join("") || '<div class="empty">현재 열린 포지션이 없습니다.</div>'}
      <div class="section-title">액션</div>
      ${candidate.watched
        ? '<span class="pill good">이미 관심 지갑입니다.</span>'
        : `<button class="primary add-wallet" data-address="${esc(candidate.address)}" data-label="${esc(candidate.radar_label || cleanName(candidate))}">관심 지갑으로 등록</button>`
      }
      <div class="section-title">데이터 안내</div>
      <div class="small">공개 데이터만 사용하며, 의심 점수는 정량 조건을 비교하는 관찰 지표입니다. 실제 내부자 지위나 불법행위를 의미하지 않습니다.</div>
    </div>
  `;
}

function pickSideFromFill(fill) {
  const direction = String(fill.direction || "").toLowerCase();
  if (direction.includes("short")) return "SHORT";
  if (direction.includes("long")) return "LONG";
  return fill.side === "A" ? "SHORT" : "LONG";
}

function matchingPickRows(coin, side) {
  const symbol = String(coin || "").toUpperCase();
  const targetSide = String(side || "").toUpperCase();
  return state.rows.map((row) => {
    const snapshot = row.snapshot || {};
    const positions = (snapshot.open_positions || []).filter((position) => (
      String(position.coin || "").toUpperCase() === symbol
      && String(position.side || "").toUpperCase() === targetSide
    ));
    const fills = (snapshot.recent_fills || []).filter((fill) => (
      String(fill.coin || "").toUpperCase() === symbol
      && pickSideFromFill(fill) === targetSide
      && !String(fill.direction || "").toLowerCase().includes("close")
    ));
    const positionValue = positions.reduce((sum, position) => (
      sum + Math.abs(Number(position.position_value || 0))
    ), 0);
    const fillValue = fills.reduce((sum, fill) => (
      sum + Math.abs(Number(fill.notional_usd || 0))
    ), 0);
    return { row, positions, fills, positionValue, fillValue };
  }).filter((item) => item.positions.length)
    .sort((a, b) => (
      (b.positionValue + b.fillValue * 0.35) - (a.positionValue + a.fillValue * 0.35)
    ));
}

export function renderPickDetail(pick) {
  const coin = String(pick?.coin || "").toUpperCase();
  const side = String(pick?.side || "").toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(coin) || !["LONG", "SHORT"].includes(side)) return;

  state.selectedPick = { coin, side };
  state.selectedAddress = null;
  document.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
  document.querySelectorAll(
    `.pick-card[data-pick-coin="${CSS.escape(coin)}"][data-pick-side="${CSS.escape(side)}"]`,
  ).forEach((el) => el.classList.add("selected"));

  const matches = matchingPickRows(coin, side);
  const positionValue = matches.reduce((sum, item) => sum + item.positionValue, 0);
  const unrealizedPnl = matches.reduce((sum, item) => sum + item.positions.reduce(
    (positionSum, position) => positionSum + Number(position.unrealized_pnl || 0),
    0,
  ), 0);
  const sideLabel = side === "LONG" ? "롱" : "숏";
  const sideClass = side === "LONG" ? "good" : "bad";
  openPickDetailModal(`
    <div class="detail-inner pick-detail">
      <div class="detail-title">집중 포지션 상세</div>
      <div class="detail-name coin-name">${coinLogo(coin, "coin-logo--position")}<span>${esc(coin)} ${sideLabel}</span></div>
      <div class="detail-address">같은 종목과 방향의 상위 지갑을 모아 보여줍니다.</div>
      <div class="status-strip">
        <span class="pill ${sideClass}">${sideLabel}</span>
        <span class="pill">지갑 ${matches.length}개</span>
      </div>
      <div class="detail-grid">
        ${metric("포지션", "$" + money(positionValue))}
        ${metric("미실현 PnL", signedUsd(unrealizedPnl), tone(unrealizedPnl))}
        ${metric("참여 지갑", String(matches.length))}
        ${metric("방향", sideLabel, sideClass)}
      </div>
      <a class="primary pick-chart-link" href="${coin === "BTC" ? "/markets/BTC" : `/#/market/${esc(coin)}`}">실시간 차트 보기</a>

      <div class="section-title">참여 지갑</div>
      ${matches.slice(0, 8).map((item, index) => {
        const candidate = item.row.candidate;
        const label = candidate.radar_label || cleanName(candidate);
        const score = Number(candidate.score || 0);
        return `
          <div class="pick-wallet-row" data-address="${esc(candidate.address)}">
            <div class="wallet-rank">#${index + 1}</div>
            <div>
              <div class="name">${esc(label)}</div>
              <div class="address mono">${esc(candidate.short_address || candidate.address)}</div>
            </div>
            <div class="pick-wallet-row__stats">
              <span>$${money(item.positionValue)}</span>
              <span class="${score >= 70 ? "good" : score >= 50 ? "warn" : ""}">${score.toFixed(0)}</span>
            </div>
          </div>
        `;
      }).join("") || '<div class="empty">해당 신호의 참여 지갑을 찾지 못했습니다.</div>'}

      <div class="section-title">관련 포지션</div>
      ${matches.flatMap((item) => (
        item.positions.map((position) => positionCard(position, item.fills))
      )).slice(0, 10).join("") || '<div class="empty">현재 열린 관련 포지션이 없습니다.</div>'}
    </div>
  `);
}
