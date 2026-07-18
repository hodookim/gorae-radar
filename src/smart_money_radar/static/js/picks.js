// picks.js — whale picks rendering with backend-first aggregation (Phase 6).
//
// renderWhalePicks prefers backend picks (`data.picks` from /api/radar/top,
// already camelCase and pickCard-compatible) and falls back to the JS-side
// buildWhalePicks() when the backend fetch is cold / fails / returns empty.
// buildWhalePicks is intentionally kept as the fallback (slated for removal in
// a later phase once api.js can stash data.picks into shared state).
import { $, esc, money, tone } from "./format.js?v=20";
import { state } from "./state.js?v=20";
import { coinLogo } from "./coin-icons.js?v=20";

// Whale-pick conviction sub-signal constants (redesigned formula). Must remain
// byte-equivalent with Python ``_compute_whale_picks`` in web.py — same
// constants, same clamp order, same operation order — so the frontend fallback
// (buildWhalePicks) and the backend /api/radar/top payload agree exactly.
const POS_CAP = 1_500_000.0;
const FILL_CAP = 150_000.0;
const WALLET_CAP = 4.0;
const SCORE_FLOOR = 50.0;
const SCORE_CEIL = 95.0;
const DOM_FLOOR = 0.5;
const DOM_CEIL = 1.0;
const CONVICTION_FLOOR = 26.0;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function buildWhalePicks() {
  const grouped = new Map();
  const ensure = (coin, side) => {
    const key = `${coin}:${side}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        coin,
        side,
        wallets: new Set(),
        positionValue: 0,
        fillValue: 0,
        fillCount: 0,
        pnl: 0,
        scoreSum: 0,
        scoreCount: 0,
        roeWeighted: 0,
        roeWeight: 0,
      });
    }
    return grouped.get(key);
  };

  for (const row of state.rows) {
    const address = row.candidate.address;
    const candidateScore = Number(row.candidate.score || 0);
    const snapshot = row.snapshot || {};
    for (const position of snapshot.open_positions || []) {
      const coin = String(position.coin || "").toUpperCase();
      const side = String(position.side || "").toUpperCase();
      if (!coin || !["LONG", "SHORT"].includes(side)) continue;
      const value = Math.abs(Number(position.position_value || 0));
      const group = ensure(coin, side);
      group.wallets.add(address);
      group.positionValue += value;
      group.pnl += Number(position.unrealized_pnl || 0);
      group.scoreSum += candidateScore;
      group.scoreCount += 1;
      const roe = Number(position.roe_pct || 0);
      if (value > 0 && Number.isFinite(roe)) {
        group.roeWeighted += roe * value;
        group.roeWeight += value;
      }
    }

    for (const fill of snapshot.recent_fills || []) {
      const coin = String(fill.coin || "").toUpperCase();
      const direction = String(fill.direction || "").toLowerCase();
      if (!coin || direction.includes("close")) continue;
      const side = direction.includes("short") ? "SHORT" : direction.includes("long") ? "LONG" : fill.side === "A" ? "SHORT" : "LONG";
      const group = ensure(coin, side);
      group.wallets.add(address);
      group.fillValue += Math.abs(Number(fill.notional_usd || 0));
      group.fillCount += 1;
      group.scoreSum += candidateScore;
      group.scoreCount += 1;
    }
  }

  const picks = [];
  for (const group of grouped.values()) {
    const opposite = grouped.get(`${group.coin}:${group.side === "LONG" ? "SHORT" : "LONG"}`);
    const exposure = group.positionValue + group.fillValue * 0.35;
    const oppositeExposure = (opposite?.positionValue || 0) + (opposite?.fillValue || 0) * 0.35;
    const dominance = exposure + oppositeExposure > 0 ? exposure / (exposure + oppositeExposure) : 1;
    const avgScore = group.scoreCount ? group.scoreSum / group.scoreCount : 0;
    const avgRoe = group.roeWeight ? group.roeWeighted / group.roeWeight : 0;
    const sPos = group.positionValue / (group.positionValue + POS_CAP);
    const sFill = group.fillValue / (group.fillValue + FILL_CAP);
    const sWallet = Math.min(group.wallets.size, WALLET_CAP) / WALLET_CAP;
    const sScore = (avgScore - SCORE_FLOOR) / (SCORE_CEIL - SCORE_FLOOR);
    const sDom = (dominance - DOM_FLOOR) / (DOM_CEIL - DOM_FLOOR);
    const sFB = Math.min(group.fillCount, 3) / 3.0;
    const raw =
      12.0
      + 28.0 * clamp01(sScore)
      + 34.0 * clamp01(sPos)
      + 14.0 * clamp01(sWallet)
      + 10.0 * clamp01(sFill)
      + 8.0 * clamp01(sDom)
      + 6.0 * clamp01(sFB);
    const conviction = Math.max(0.0, Math.min(99.0, raw));
    if (conviction < CONVICTION_FLOOR || exposure <= 0) continue;
    picks.push({
      ...group,
      walletCount: group.wallets.size,
      dominance,
      avgScore,
      avgRoe,
      conviction,
    });
  }
  return picks.sort((a, b) => b.conviction - a.conviction);
}

export function pickCard(pick, index) {
  const sideClass = pick.side === "LONG" ? "good" : "bad";
  const sideKind = pick.side === "LONG" ? "long" : "short";
  const sideLabel = pick.side === "LONG" ? "롱" : "숏";
  const pct = Math.max(0, Math.min(99, Math.round(pick.conviction)));
  const tier = pct >= 80 ? "elite" : pct >= 55 ? "strong" : "moderate";
  const selected = state.selectedPick
    && state.selectedPick.coin === pick.coin
    && state.selectedPick.side === pick.side;
  const walletCount = Number(pick.walletCount ?? pick.wallet_count ?? 0);
  const dominance = Number(pick.dominance || 0) * 100;
  const headline = `${pick.coin} 고래 지갑 ${walletCount}개, ${sideLabel} ${Number.isFinite(dominance) ? dominance.toFixed(0) : "0"}%`;
  return `
    <article class="pick-card ${sideKind} ${selected ? "selected" : ""}" data-pick-coin="${esc(pick.coin)}" data-pick-side="${esc(pick.side)}" tabindex="0" role="button" aria-label="${esc(pick.coin)} ${esc(pick.side)} 집중 포지션 상세 보기">
      <div class="pick-identity">
        <span class="wallet-rank">${String(index + 1).padStart(2, "0")}</span>
        ${coinLogo(pick.coin)}
        <span class="pick-identity__copy">
          <strong class="pick-symbol">${esc(pick.coin)}</strong>
          <span class="pick-headline">${esc(headline)}</span>
        </span>
        <span class="direction-badge ${sideClass}">${sideLabel}</span>
      </div>
      <div class="conviction conviction--${tier}" title="집중 점수 ${pct}/99">
        <span>집중 점수</span>
        <strong class="mono">${pick.conviction.toFixed(0)}<small>/99</small></strong>
      </div>
      <dl class="pick-stats">
        <div><dt>방향 비중</dt><dd class="mono">${(pick.dominance * 100).toFixed(0)}%</dd></div>
        <div><dt>포지션</dt><dd class="mono">$${money(pick.positionValue)}</dd></div>
        <div><dt>참여 지갑</dt><dd class="mono">${walletCount}</dd></div>
        <div><dt>가중 평균 ROE</dt><dd class="mono ${tone(pick.avgRoe)}">${pick.avgRoe > 0 ? "+" : ""}${pick.avgRoe.toFixed(2)}%</dd></div>
      </dl>
      <div class="pick-open"><span>상세 보기</span><b aria-hidden="true">→</b></div>
    </article>
  `;
}

export function renderWhalePicks() {
  const board = $("whalePickBoard");
  if (!board) return;
  const useBackend = Array.isArray(state.picks) && state.picks.length > 0;
  const picks = useBackend
    ? state.picks.slice(0, 8)
    : buildWhalePicks().slice(0, 8);
  if (!picks.length) {
    board.innerHTML = `<div class="empty empty-state"><img class="empty-state__mascot" src="/static/assets/mascot/mascot-whale-sleeping.svg" alt="" width="96" height="96" loading="lazy" decoding="async"><p class="empty-state__text">같은 방향에 모인 포지션이 없습니다.</p></div>`;
  } else {
    board.innerHTML = picks.map((pick, index) => pickCard(pick, index)).join("");
  }
}
