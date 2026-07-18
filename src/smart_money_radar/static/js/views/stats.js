// views/stats.js - aggregate exposure and storage statistics.
import { esc, money, timeLabel } from "../format.js?v=20";
import { coinLogo } from "../coin-icons.js?v=20";

let mountGeneration = 0;

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function escNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function summarizeRadar(radar) {
  let longUsd = 0;
  let shortUsd = 0;
  const coinTotals = new Map();
  const groups = new Map();
  for (const row of radar?.wallets || []) {
    for (const position of row?.snapshot?.open_positions || []) {
      const coin = String(position.coin || "").toUpperCase();
      const side = String(position.side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
      const value = Math.abs(Number(position.position_value || 0));
      if (!coin || !value) continue;
      if (side === "LONG") longUsd += value;
      else shortUsd += value;
      coinTotals.set(coin, (coinTotals.get(coin) || 0) + value);
      const key = `${coin}:${side}`;
      const group = groups.get(key) || {
        coin,
        side,
        wallets: new Set(),
        positionUsd: 0,
        roeWeighted: 0,
        roeWeight: 0,
      };
      group.wallets.add(row?.candidate?.address || "unknown");
      group.positionUsd += value;
      if (position.roe_pct != null) {
        group.roeWeighted += Number(position.roe_pct || 0) * value;
        group.roeWeight += value;
      }
      groups.set(key, group);
    }
  }
  const topCoins = [...coinTotals.entries()]
    .map(([coin, position_usd]) => ({ coin, position_usd }))
    .sort((a, b) => b.position_usd - a.position_usd)
    .slice(0, 10);
  const coins = [...groups.values()]
    .map((group) => ({
      coin: group.coin,
      side: group.side,
      wallet_count: group.wallets.size,
      position_usd: group.positionUsd,
      avg_roe: group.roeWeight ? group.roeWeighted / group.roeWeight : 0,
    }))
    .sort((a, b) => b.position_usd - a.position_usd);
  return {
    generated_at_ms: radar?.generated_at_ms,
    exposure: { long_usd: longUsd, short_usd: shortUsd },
    top_coins: topCoins,
    coins,
  };
}

function coinsChart(coins) {
  if (!coins?.length) {
    return `<div class="empty empty-state"><img class="empty-state__mascot" src="/static/assets/mascot/mascot-whale-sleeping.svg" alt="" width="72" height="72" loading="lazy" decoding="async"><p class="empty-state__text">현재 코인 노출 데이터가 없습니다.</p></div>`;
  }
  const top = [...coins]
    .sort((a, b) => Math.abs(Number(b.position_usd || 0)) - Math.abs(Number(a.position_usd || 0)))
    .slice(0, 8);
  const maxUsd = Math.max(1, ...top.map((coin) => Math.abs(Number(coin.position_usd || 0))));
  return `<div class="stats-bar-list">${top.map((coin) => {
    const usd = Math.abs(Number(coin.position_usd || 0));
    const pct = Math.max(2, (usd / maxUsd) * 100);
    const isLong = String(coin.side || "").toUpperCase() === "LONG";
    return `
      <div class="stats-bar-row">
        <div class="stats-bar-row__coin">${coinLogo(coin.coin, "coin-logo--chip")}<strong>${esc(coin.coin)}</strong><span class="${isLong ? "good" : "bad"}">${isLong ? "롱" : "숏"}</span></div>
        <div class="stats-bar-track" aria-hidden="true"><span class="${isLong ? "long" : "short"}" style="--bar:${pct.toFixed(1)}%"></span></div>
        <div class="stats-bar-row__value"><strong class="mono">$${money(usd)}</strong><span>${escNum(coin.wallet_count)}개 지갑</span></div>
      </div>
    `;
  }).join("")}</div>`;
}

function topCoinsRows(topCoins) {
  if (!topCoins?.length) {
    return `<div class="empty empty-state"><img class="empty-state__mascot" src="/static/assets/mascot/mascot-whale-sleeping.svg" alt="" width="72" height="72" loading="lazy" decoding="async"><p class="empty-state__text">상위 보유 종목이 없습니다.</p></div>`;
  }
  return topCoins.slice(0, 10).map((coin, index) => `
    <div class="row flow-row top-coin-row">
      <span class="wallet-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="name coin-name">${coinLogo(coin.coin, "coin-logo--chip")}<span>${esc(coin.coin)}</span></div>
      <strong class="mono">$${money(coin.position_usd)}</strong>
    </div>
  `).join("");
}

function coinsFlowTable(coins) {
  if (!coins?.length) {
    return `<div class="empty empty-state"><img class="empty-state__mascot" src="/static/assets/mascot/mascot-whale-sleeping.svg" alt="" width="72" height="72" loading="lazy" decoding="async"><p class="empty-state__text">코인별 포지션 데이터가 없습니다.</p></div>`;
  }
  return `
    <div class="list coin-flow-list">
      ${coins.slice(0, 30).map((coin) => {
        const isLong = String(coin.side || "").toUpperCase() === "LONG";
        return `
          <div class="row flow-row coin-flow-row">
            <div class="coin-name">${coinLogo(coin.coin, "coin-logo--chip")}<strong>${esc(coin.coin)}</strong></div>
            <span class="direction-badge ${isLong ? "good" : "bad"}">${isLong ? "롱" : "숏"}</span>
            <div><span>참여 지갑</span><strong class="mono">${escNum(coin.wallet_count)}</strong></div>
            <div><span>가중 평균 ROE</span><strong class="mono ${Number(coin.avg_roe || 0) >= 0 ? "good" : "bad"}">${Number(coin.avg_roe || 0) > 0 ? "+" : ""}${Number(coin.avg_roe || 0).toFixed(2)}%</strong></div>
            <strong class="mono coin-flow-row__value">$${money(coin.position_usd)}</strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

export async function mount(container) {
  const generation = ++mountGeneration;
  container.innerHTML = `<section id="stats" class="dashboard stats-page"><div class="card"><div class="empty">노출 데이터를 불러오고 있습니다.</div></div></section>`;

  let radar;
  try {
    radar = await fetchJson("/api/radar/top?top=12&pool=48&scan_limit=24&min_score=45");
  } catch (err) {
    if (generation !== mountGeneration) return;
    container.innerHTML = `<section class="card empty">노출 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.<div class="small">${esc(err.message)}</div></section>`;
    return;
  }
  if (generation !== mountGeneration) return;
  const overview = summarizeRadar(radar);

  const longUsd = Number(overview?.exposure?.long_usd || 0);
  const shortUsd = Number(overview?.exposure?.short_usd || 0);
  const netUsd = longUsd - shortUsd;
  const generated = overview?.generated_at_ms ? timeLabel(overview.generated_at_ms) : "-";

  container.innerHTML = `
    <section id="stats" class="dashboard stats-page">
      <header class="product-header">
        <div><h1>고래 노출 분석</h1><p>관측 지갑의 롱·숏 방향, 종목별 집중과 평균 ROE를 비교합니다.</p></div>
        <div class="product-header__status"><span>데이터 기준 시각</span><strong>${esc(generated)}</strong></div>
      </header>

      <aside class="view-disclosure" aria-label="노출 분석 안내">
        <strong>관측 표본의 명목 가치 합계</strong>
        <p>최대 24개 후보를 확인해 포지션이 있는 지갑을 최대 12개 표시합니다. 순노출은 롱에서 숏을 뺀 값이며 시장 전체 방향이나 가격 예측이 아닙니다.</p>
        <a href="/guides/concentration">집중도 해석법</a>
      </aside>

      <section class="metrics kpi-strip stats-kpis" aria-label="노출 요약">
        <div class="metric"><div class="metric-label">롱 노출</div><div class="metric-value mono good">$${money(longUsd)}</div><div class="metric-sub">현재 포지션 가치</div></div>
        <div class="metric"><div class="metric-label">숏 노출</div><div class="metric-value mono bad">$${money(shortUsd)}</div><div class="metric-sub">현재 포지션 가치</div></div>
        <div class="metric"><div class="metric-label">순노출</div><div class="metric-value mono ${netUsd >= 0 ? "good" : "bad"}">${netUsd > 0 ? "+" : ""}$${money(netUsd)}</div><div class="metric-sub">롱-숏</div></div>
        <div class="metric"><div class="metric-label">총노출</div><div class="metric-value mono">$${money(longUsd + shortUsd)}</div><div class="metric-sub">롱+숏</div></div>
      </section>

      <section class="analytics-grid">
        <section class="card data-panel chart-panel">
          <div class="board-head"><div><div class="board-title">종목별 방향 노출</div><div class="subtitle">현재 포지션 가치가 큰 종목과 방향 순서입니다.</div></div></div>
          <div id="stats-chart">${coinsChart(overview.coins)}</div>
        </section>
        <section class="card data-panel top-coins-panel">
          <div class="board-head"><div><div class="board-title">집중 종목 순위</div><div class="subtitle">롱과 숏을 합친 노출 금액 기준 상위 종목</div></div></div>
          <div class="list">${topCoinsRows(overview?.top_coins)}</div>
        </section>
      </section>

      <section class="card data-panel">
        <div class="board-head"><div><div class="board-title">포지션 구성</div><div class="subtitle">방향, 참여 지갑, 가중 평균 ROE와 노출을 비교합니다.</div></div></div>
        ${coinsFlowTable(overview.coins)}
      </section>
    </section>
  `;
}

export function unmount() {
  mountGeneration += 1;
}
