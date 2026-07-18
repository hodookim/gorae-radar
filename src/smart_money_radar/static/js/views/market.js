// views/market.js - one-coin whale PICK, public market data, and TradingView chart.
import { esc, money, price, timeLabel } from "../format.js?v=20";
import { coinLogo } from "../coin-icons.js?v=20";

const SAFE_COIN = /^[A-Z0-9]{1,20}$/;
const SAFE_CHART_SYMBOL = /^HYPERLIQUID:[A-Z0-9]{1,32}(?:\.P)?$/;
const RADAR_PATH = "/api/radar/top?top=12&pool=48&scan_limit=24&min_score=45";
const TRADINGVIEW_SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const HYPERLIQUID_SOURCE_URL = "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint";
const FEAR_GREED_SOURCE_URL = "https://alternative.me/crypto/fear-and-greed-index/";

let mountGeneration = 0;
let activeController = null;
let chartObserver = null;
let chartRoot = null;
let chartScript = null;
let chartHost = null;
let chartFailureTimer = null;

const cache = {
  radar: null,
  fear: null,
  summaries: new Map(),
};

function safeCoin(value) {
  const coin = String(value || "").trim().toUpperCase();
  return SAFE_COIN.test(coin) ? coin : "";
}

function marketHref(coin) {
  const normalized = safeCoin(coin) || "BTC";
  return normalized === "BTC" ? "/markets/BTC" : `/#/market/${normalized}`;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function epochMs(value) {
  const number = optionalNumber(value);
  if (number == null || number <= 0) return 0;
  return number < 1_000_000_000_000 ? number * 1000 : number;
}

function sourceName(source, fallback) {
  if (typeof source === "string" && source.trim()) return source.trim();
  if (source && typeof source.name === "string" && source.name.trim()) return source.name.trim();
  return fallback;
}

function sourceUrl(source, fallback) {
  const value = source && typeof source === "object" ? String(source.url || "") : "";
  return /^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(value) ? value : fallback;
}

function freshnessLabel(timestamp, stale, loading = false) {
  const ms = epochMs(timestamp);
  if (loading) return ms ? `저장값 ${timeLabel(ms)}, 최신값 확인 중` : "최신값 확인 중";
  if (stale) return ms ? `이전 데이터 유지, ${timeLabel(ms)}` : "이전 데이터 유지";
  return ms ? `갱신 ${timeLabel(ms)}` : "갱신 시각 미제공";
}

function safeChartSymbol(rawSymbol, coin) {
  const symbol = String(rawSymbol || "").trim().toUpperCase();
  if (SAFE_CHART_SYMBOL.test(symbol)) return symbol;
  return `HYPERLIQUID:${coin}USDC.P`;
}

function normalizeDominance(value) {
  const number = finiteNumber(value, 0);
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function normalizePick(raw) {
  const coin = safeCoin(raw?.coin);
  if (!coin) return null;
  const side = String(raw?.side || "").toUpperCase();
  if (side !== "LONG" && side !== "SHORT") return null;
  const dominance = normalizeDominance(raw?.dominance);
  const walletCount = Math.max(0, Math.round(finiteNumber(raw?.walletCount ?? raw?.wallet_count, 0)));
  const positionValue = Math.abs(finiteNumber(raw?.positionValue ?? raw?.position_value, 0));
  const avgRoe = finiteNumber(raw?.avgRoe ?? raw?.avg_roe, 0);
  const conviction = Math.max(0, Math.min(99, finiteNumber(raw?.conviction, 0)));
  const sideLabel = side === "LONG" ? "롱" : "숏";
  const headline = String(
    raw?.headline
      || `고래 ${walletCount}곳, ${coin} ${sideLabel} ${(dominance * 100).toFixed(0)}% 집결`,
  ).trim();
  const reasons = Array.isArray(raw?.reasons)
    ? raw.reasons.map((reason) => String(reason || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  if (!reasons.length && positionValue > 0) reasons.push(`포지션 $${money(positionValue)} 집중`);
  if (walletCount > 0) reasons.push(`${walletCount}개 공개 지갑이 같은 방향에 참여`);
  return {
    coin,
    side,
    dominance,
    walletCount,
    positionValue,
    avgRoe,
    conviction,
    pnl: finiteNumber(raw?.pnl, 0),
    headline,
    label: String(raw?.label || "").trim(),
    reasons: [...new Set(reasons)].slice(0, 4),
    labelCode: String(raw?.label_code ?? raw?.labelCode ?? "").trim(),
    chartSymbol: safeChartSymbol(raw?.chart_symbol ?? raw?.chartSymbol, coin),
    derived: false,
  };
}

function normalizedPicks(radar) {
  return (Array.isArray(radar?.picks) ? radar.picks : [])
    .map(normalizePick)
    .filter(Boolean);
}

function derivePickFromRadar(radar, coin) {
  const groups = {
    LONG: { wallets: new Set(), positionValue: 0, pnl: 0, roeWeighted: 0 },
    SHORT: { wallets: new Set(), positionValue: 0, pnl: 0, roeWeighted: 0 },
  };
  for (const row of radar?.wallets || []) {
    for (const position of row?.snapshot?.open_positions || []) {
      if (safeCoin(position?.coin) !== coin) continue;
      const side = String(position?.side || "").toUpperCase();
      if (side !== "LONG" && side !== "SHORT") continue;
      const value = Math.abs(finiteNumber(position?.position_value, 0));
      if (!value) continue;
      const group = groups[side];
      group.wallets.add(String(row?.candidate?.address || "unknown"));
      group.positionValue += value;
      group.pnl += finiteNumber(position?.unrealized_pnl, 0);
      group.roeWeighted += finiteNumber(position?.roe_pct, 0) * value;
    }
  }
  const total = groups.LONG.positionValue + groups.SHORT.positionValue;
  if (!total) return null;
  const side = groups.LONG.positionValue >= groups.SHORT.positionValue ? "LONG" : "SHORT";
  const group = groups[side];
  const sideLabel = side === "LONG" ? "롱" : "숏";
  const dominance = group.positionValue / total;
  return {
    coin,
    side,
    dominance,
    walletCount: group.wallets.size,
    positionValue: group.positionValue,
    avgRoe: group.positionValue ? group.roeWeighted / group.positionValue : 0,
    conviction: 0,
    pnl: group.pnl,
    headline: `고래 ${group.wallets.size}곳, ${coin} ${sideLabel} ${(dominance * 100).toFixed(0)}% 집결`,
    reasons: [
      `공개 포지션 $${money(group.positionValue)} 집계`,
      `반대 방향 대비 ${(dominance * 100).toFixed(0)}% 비중`,
    ],
    labelCode: "derived_radar_pick",
    chartSymbol: safeChartSymbol("", coin),
    derived: true,
  };
}

function selectMarketModel(radar, coin) {
  const picks = normalizedPicks(radar);
  const selected = picks.find((pick) => pick.coin === coin) || derivePickFromRadar(radar, coin);
  const selectors = [];
  const seen = new Set();
  for (const pick of [selected, ...picks]) {
    if (!pick || seen.has(pick.coin)) continue;
    seen.add(pick.coin);
    selectors.push(pick);
    if (selectors.length === 4) break;
  }
  if (!seen.has(coin)) {
    selectors.unshift({
      coin,
      side: "",
      conviction: 0,
      headline: `${coin} 시장 데이터`,
      chartSymbol: safeChartSymbol("", coin),
    });
  }
  return { selected, selectors: selectors.slice(0, 4) };
}

async function fetchJson(path, signal) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort("request_timeout"), 15000);
  const forwardAbort = () => timeoutController.abort(signal?.reason || "route_changed");
  signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const response = await fetch(path, {
      signal: timeoutController.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function cachedRecord(data) {
  return data ? { data, receivedAt: Date.now() } : null;
}

function renderShell(container, coin) {
  container.innerHTML = `
    <section id="market" class="dashboard market-page" aria-busy="true">
      <header class="product-header market-header">
        <div>
          <a class="product-back" href="/">지금 고래 PICK으로 돌아가기</a>
          <h1>${coinLogo(coin)}${esc(coin)} 고래 PICK</h1>
          <p class="market-header__summary" id="market-text-summary">공개 지갑 포지션과 시장 데이터를 함께 확인하고 있습니다.</p>
        </div>
        <div class="product-header__status market-header__status">
          <span>관측 상태</span>
          <strong id="market-header-freshness">확인 중</strong>
        </div>
      </header>

      <aside class="view-disclosure" aria-label="고래 PICK 해석 안내">
        <strong>고래 PICK은 공개 데이터 기반 관찰 신호입니다.</strong>
        <p>같은 종목과 방향에 모인 공개 포지션을 보여줍니다. 내부자 지위, 미공개 정보 이용 또는 불법행위를 확인하거나 단정하지 않습니다.</p>
        <a href="/methodology">선정 기준 확인</a>
      </aside>

      <nav class="market-pick-tabs" id="market-pick-tabs" aria-label="고래 PICK 종목 선택">
        <span class="market-pick-tab is-loading">PICK 종목을 불러오는 중입니다.</span>
      </nav>

      <section class="market-layout">
        <section class="card market-chart-panel" aria-labelledby="market-chart-title">
          <div class="market-panel-head">
            <div>
              <h2 id="market-chart-title">${esc(coin)}/USDC 실시간 차트</h2>
              <p>TradingView에서 제공하는 Hyperliquid 시장 차트입니다.</p>
            </div>
            <span class="market-chart-status" id="market-chart-status" role="status">차트 설정 대기</span>
          </div>
          <div id="market-chart-host" class="market-chart-host" aria-describedby="market-chart-fallback">
            <div class="market-chart-placeholder" role="status"><strong>TradingView 준비 중</strong><span>차트가 화면 가까이 오면 불러옵니다.</span></div>
          </div>
          <p class="market-chart-fallback" id="market-chart-fallback">차트를 사용하지 않아도 아래 시세 지표와 PICK 근거를 텍스트로 확인할 수 있습니다.</p>
        </section>

        <article class="card market-pick-panel" id="market-pick-panel">
          <span class="market-pick-eyebrow">고래 포지션 요약</span>
          <h2 class="market-pick-headline">포지션을 계산하고 있습니다.</h2>
          <p class="market-pick-copy">공개 포지션을 종목과 방향별로 합산합니다.</p>
        </article>
      </section>

      <section class="market-data-grid" aria-label="시장 보조 지표">
        <section class="card market-quote-panel" aria-labelledby="market-quote-title">
          <div class="market-panel-head"><div><h2 id="market-quote-title">Hyperliquid 시장</h2><p>가격, 거래대금, 펀딩과 미결제약정</p></div></div>
          <div id="market-quote-content"><p class="market-panel-empty">시세 API를 불러오는 중입니다.</p></div>
        </section>
        <section class="card market-fear-panel" aria-labelledby="market-fear-title">
          <div class="market-panel-head"><div><h2 id="market-fear-title">시장 심리</h2><p>Crypto Fear &amp; Greed Index</p></div></div>
          <div id="market-fear-content"><p class="market-panel-empty">시장 심리 지수를 불러오는 중입니다.</p></div>
        </section>
      </section>

      <section class="card market-wallets-panel" aria-labelledby="market-wallets-title">
        <div class="board-head">
          <div><div class="board-title" id="market-wallets-title">PICK 참여 지갑</div><div class="subtitle">포지션 규모, 진입가, 레버리지, 청산가와 현재 손익</div></div>
        </div>
        <div class="market-wallets-content" id="market-wallets-content">
          <div class="empty">참여 지갑을 확인하고 있습니다.</div>
        </div>
      </section>

      <div class="market-load-state is-loading" id="market-load-state" role="status" aria-live="polite">공개 데이터를 불러오는 중입니다.</div>
    </section>
  `;
}

function matchingWalletPositions(radar, pick, coin) {
  const targetSide = pick?.side || "";
  const matches = [];
  for (const row of radar?.wallets || []) {
    const candidate = row?.candidate || {};
    for (const position of row?.snapshot?.open_positions || []) {
      if (safeCoin(position?.coin) !== coin) continue;
      const side = String(position?.side || "").toUpperCase();
      if (targetSide && side !== targetSide) continue;
      matches.push({ candidate, position, side });
    }
  }
  return matches.sort((a, b) => (
    Math.abs(finiteNumber(b.position?.position_value, 0))
    - Math.abs(finiteNumber(a.position?.position_value, 0))
  ));
}

function renderParticipants(container, radarStatus, pick, coin) {
  const target = container.querySelector("#market-wallets-content");
  if (!target) return;
  if (!radarStatus.data) {
    target.innerHTML = `
      <div class="empty">
        참여 지갑 데이터를 불러오지 못했습니다. 차트와 시장 지표는 계속 확인할 수 있습니다.
      </div>
    `;
    return;
  }
  const matches = matchingWalletPositions(radarStatus.data, pick, coin);
  if (!matches.length) {
    target.innerHTML = `
      <div class="empty">현재 표본에서 ${esc(coin)} 참여 지갑을 찾지 못했습니다.</div>
    `;
    return;
  }
  target.innerHTML = `
    <div class="market-wallet-table" role="list">
      ${matches.slice(0, 10).map(({ candidate, position, side }, index) => {
    const sideLabel = side === "LONG" ? "롱" : "숏";
    const sideClass = side === "LONG" ? "good" : "bad";
    const address = String(candidate.address || "");
    const label = String(candidate.radar_label || candidate.label || candidate.short_address || `관찰 지갑 ${index + 1}`);
    const pnl = finiteNumber(position.unrealized_pnl, 0);
    const roe = optionalNumber(position.roe_pct);
    const leverage = optionalNumber(position.leverage);
    return `
          <a class="market-wallet-row" role="listitem" href="/#/whale/${esc(address)}">
            <div class="market-wallet-row__identity">
              <span class="row-rank mono">${String(index + 1).padStart(2, "0")}</span>
              <div><strong>${esc(label)}</strong><code>${esc(candidate.short_address || address)}</code></div>
            </div>
            <div class="market-wallet-row__side"><span class="direction-badge ${sideClass}">${sideLabel}</span><strong class="mono">$${money(Math.abs(finiteNumber(position.position_value, 0)))}</strong></div>
            <dl class="market-wallet-row__prices">
              <div><dt>진입가</dt><dd class="mono">$${price(position.entry_price)}</dd></div>
              <div><dt>현재가</dt><dd class="mono">$${price(position.current_price)}</dd></div>
              <div><dt>레버리지</dt><dd class="mono ${leverage != null && leverage >= 20 ? "warn" : ""}">${leverage == null ? "-" : `${leverage.toFixed(1)}x`}</dd></div>
              <div><dt>청산가</dt><dd class="mono">${position.liquidation_price == null ? "-" : `$${price(position.liquidation_price)}`}</dd></div>
            </dl>
            <div class="market-wallet-row__pnl"><span>미실현 PnL</span><strong class="mono ${pnl >= 0 ? "good" : "bad"}">${pnl > 0 ? "+" : ""}$${money(pnl)}</strong><small class="mono ${roe == null ? "" : roe >= 0 ? "good" : "bad"}">${roe == null ? "ROE -" : `${roe > 0 ? "+" : ""}${roe.toFixed(2)}%`}</small></div>
            <span class="market-wallet-row__open">지갑 분석 <b aria-hidden="true">→</b></span>
          </a>
        `;
  }).join("")}
    </div>
    <p class="market-wallets-note">청산가는 관측 시점의 공개값입니다. 교차마진에서는 계정 가치와 다른 포지션 변화에 따라 달라질 수 있습니다.</p>
  `;
}

function renderSelectors(container, selectors, selectedCoin) {
  const target = container.querySelector("#market-pick-tabs");
  if (!target) return;
  if (!selectors.length) {
    target.innerHTML = `<span class="market-pick-tab is-empty">현재 표시할 PICK 종목이 없습니다.</span>`;
    return;
  }
  target.innerHTML = selectors.map((pick) => {
    const active = pick.coin === selectedCoin;
    const side = pick.side === "LONG" ? "롱" : pick.side === "SHORT" ? "숏" : "시장";
    const score = pick.conviction > 0 ? `${Math.round(pick.conviction)}/99` : "관측";
    return `
      <a class="market-pick-tab ${active ? "is-active" : ""}" href="${marketHref(pick.coin)}" ${active ? 'aria-current="page"' : ""}>
        <span class="market-pick-tab__coin">${coinLogo(pick.coin, "coin-logo--chip")}<strong>${esc(pick.coin)}</strong></span>
        <span class="market-pick-tab__side ${pick.side === "LONG" ? "good" : pick.side === "SHORT" ? "bad" : ""}">${side}</span>
        <span class="market-pick-tab__score mono">${score}</span>
      </a>
    `;
  }).join("");
}

function renderPick(container, pick, coin, radarStatus) {
  const target = container.querySelector("#market-pick-panel");
  const summary = container.querySelector("#market-text-summary");
  const freshness = container.querySelector("#market-header-freshness");
  if (freshness) {
    freshness.textContent = freshnessLabel(
      radarStatus.data?.generated_at_ms,
      radarStatus.stale,
      radarStatus.loading,
    );
  }
  if (!target) return;
  if (!pick) {
    target.innerHTML = `
      <span class="market-pick-eyebrow">고래 포지션 요약</span>
      <h2 class="market-pick-headline">${esc(coin)}은 현재 추적 표본에 없습니다.</h2>
      <p class="market-pick-copy">시세와 차트는 계속 확인할 수 있지만, 근거 없는 방향 신호는 만들지 않습니다.</p>
      <div class="market-source-line">
        <a class="market-source-line__source" href="${HYPERLIQUID_SOURCE_URL}" target="_blank" rel="noopener noreferrer nofollow">Source: Hyperliquid</a>
        <span class="market-source-line__freshness">${esc(freshnessLabel(radarStatus.data?.generated_at_ms, radarStatus.stale, radarStatus.loading))}</span>
      </div>
    `;
    if (summary) summary.textContent = `${coin}은 현재 관측 표본에서 같은 방향으로 모인 포지션이 확인되지 않았습니다.`;
    return;
  }
  const sideLabel = pick.side === "LONG" ? "롱" : "숏";
  const sideClass = pick.side === "LONG" ? "good" : "bad";
  const score = pick.conviction > 0 ? `${Math.round(pick.conviction)}/99` : "표본 집계";
  const dominanceLabel = (pick.dominance * 100).toFixed(0);
  const cleanHeadline = `${coin} 고래 지갑 ${pick.walletCount}개`;
  target.innerHTML = `
    <span class="market-pick-eyebrow">관측 지갑 컨센서스</span>
    <h2 class="market-pick-headline">${esc(cleanHeadline)}</h2>
    <p class="market-pick-copy">현재 <strong class="${sideClass}">${sideLabel} 비중 ${dominanceLabel}%</strong>, 참여 지갑 ${pick.walletCount}개입니다.</p>
    <ul class="market-pick-reasons" aria-label="PICK 선정 근거">
      ${pick.reasons.map((reason) => `<li class="market-pick-reason">${esc(reason)}</li>`).join("")}
    </ul>
    <dl class="market-pick-stats">
      <div><dt>방향</dt><dd class="${sideClass}">${sideLabel}</dd></div>
      <div><dt>포지션 집중도</dt><dd class="mono">${score}</dd></div>
      <div><dt>참여 지갑</dt><dd class="mono">${pick.walletCount}개</dd></div>
      <div><dt>포지션 합계</dt><dd class="mono">$${money(pick.positionValue)}</dd></div>
      <div><dt>방향 비중</dt><dd class="mono">${dominanceLabel}%</dd></div>
      <div><dt>가중 평균 ROE</dt><dd class="mono ${pick.avgRoe >= 0 ? "good" : "bad"}">${pick.avgRoe > 0 ? "+" : ""}${pick.avgRoe.toFixed(2)}%</dd></div>
    </dl>
    <div class="market-source-line">
      <a class="market-source-line__source" href="${HYPERLIQUID_SOURCE_URL}" target="_blank" rel="noopener noreferrer nofollow">Source: Hyperliquid public positions</a>
      <span class="market-source-line__freshness">${esc(freshnessLabel(radarStatus.data?.generated_at_ms, radarStatus.stale, radarStatus.loading))}</span>
    </div>
  `;
  if (summary) {
    summary.textContent = `${coin} 공개 포지션은 ${pick.walletCount}개 지갑이 ${sideLabel} 방향 ${(pick.dominance * 100).toFixed(0)}%로 모여 있습니다.`;
  }
}

function renderQuote(container, status, coin) {
  const target = container.querySelector("#market-quote-content");
  if (!target) return;
  const data = status.data;
  if (!data) {
    target.innerHTML = `
      <p class="market-panel-empty">시세 API가 응답하지 않았습니다. 차트와 PICK 근거는 계속 볼 수 있습니다.</p>
      <div class="market-source-line">
        <a class="market-source-line__source" href="${HYPERLIQUID_SOURCE_URL}" target="_blank" rel="noopener noreferrer nofollow">Source: Hyperliquid Info API</a>
        <span class="market-source-line__freshness">데이터 없음</span>
      </div>
    `;
    return;
  }
  const change = optionalNumber(data.change_24h_pct);
  const funding = optionalNumber(data.funding_rate);
  const annualFunding = optionalNumber(data.funding_annualized_pct);
  const source = sourceName(data.source, "Hyperliquid Info API");
  target.innerHTML = `
    <dl class="market-quote-metrics">
      <div><dt>현재가</dt><dd class="mono">$${price(data.mark_price ?? data.mid_price)}</dd></div>
      <div><dt>24시간 변화</dt><dd class="mono ${change == null ? "" : change >= 0 ? "good" : "bad"}">${change == null ? "-" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}</dd></div>
      <div><dt>24시간 거래대금</dt><dd class="mono">${data.day_volume_usd == null ? "-" : `$${money(data.day_volume_usd)}`}</dd></div>
      <div><dt>미결제약정</dt><dd class="mono">${data.open_interest_usd == null ? "-" : `$${money(data.open_interest_usd)}`}</dd></div>
      <div><dt>현재 펀딩</dt><dd class="mono ${funding == null ? "" : funding >= 0 ? "good" : "bad"}">${funding == null ? "-" : `${funding > 0 ? "+" : ""}${(funding * 100).toFixed(4)}%`}</dd></div>
      <div><dt>연환산 펀딩</dt><dd class="mono ${annualFunding == null ? "" : annualFunding >= 0 ? "good" : "bad"}">${annualFunding == null ? "-" : `${annualFunding > 0 ? "+" : ""}${annualFunding.toFixed(2)}%`}</dd></div>
      <div><dt>오라클 가격</dt><dd class="mono">${data.oracle_price == null ? "-" : `$${price(data.oracle_price)}`}</dd></div>
      <div><dt>중간 가격</dt><dd class="mono">${data.mid_price == null ? "-" : `$${price(data.mid_price)}`}</dd></div>
    </dl>
    <div class="market-source-line">
      <a class="market-source-line__source" href="${HYPERLIQUID_SOURCE_URL}" target="_blank" rel="noopener noreferrer nofollow">Source: ${esc(source)}</a>
      <span class="market-source-line__freshness">${esc(freshnessLabel(data.generated_at_ms, status.stale, status.loading))}</span>
    </div>
    ${status.stale ? `<p class="market-stale-note">${esc(coin)} 최신 시세 요청에 실패해 이전 값을 유지했습니다.</p>` : ""}
  `;
}

function fearClassification(value) {
  const key = String(value || "").trim().toLowerCase();
  const labels = {
    "extreme fear": "극단적 공포",
    fear: "공포",
    neutral: "중립",
    greed: "탐욕",
    "extreme greed": "극단적 탐욕",
  };
  return labels[key] || String(value || "분류 없음");
}

function renderFear(container, status) {
  const target = container.querySelector("#market-fear-content");
  if (!target) return;
  const data = status.data;
  if (!data) {
    target.innerHTML = `
      <p class="market-panel-empty">시장 심리 API가 응답하지 않았습니다. 이 지표 없이도 PICK과 시세를 확인할 수 있습니다.</p>
      <div class="market-source-line">
        <a class="market-source-line__source" href="${FEAR_GREED_SOURCE_URL}" target="_blank" rel="noopener noreferrer nofollow">Source: Alternative.me</a>
        <span class="market-source-line__freshness">데이터 없음</span>
      </div>
    `;
    return;
  }
  const indexValue = Math.max(0, Math.min(100, finiteNumber(data.value, 0)));
  const nextSeconds = optionalNumber(data.next_update_seconds);
  const nextLabel = nextSeconds == null
    ? "다음 갱신 시각 미제공"
    : nextSeconds < 3600
      ? `약 ${Math.max(1, Math.ceil(nextSeconds / 60))}분 후 갱신 예정`
      : `약 ${Math.ceil(nextSeconds / 3600)}시간 후 갱신 예정`;
  const updatedAt = data.observed_at_ms ?? data.updated_at_ms ?? data.generated_at_ms;
  const url = sourceUrl(data.source, FEAR_GREED_SOURCE_URL);
  target.innerHTML = `
    <div class="market-fear-value">
      <strong class="mono">${Math.round(indexValue)}</strong><span>/100</span>
      <b>${esc(fearClassification(data.classification))}</b>
    </div>
    <dl class="market-fear-meta">
      <div><dt>지수 기준 시각</dt><dd>${esc(timeLabel(epochMs(updatedAt)))}</dd></div>
      <div><dt>다음 갱신</dt><dd>${esc(nextLabel)}</dd></div>
    </dl>
    <div class="market-source-line">
      <a class="market-source-line__source" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">Source: Alternative.me</a>
      <span class="market-source-line__freshness">${esc(freshnessLabel(data.generated_at_ms ?? updatedAt, status.stale, status.loading))}</span>
    </div>
    ${status.stale ? '<p class="market-stale-note">최신 지수 요청에 실패해 이전 값을 유지했습니다.</p>' : ""}
  `;
}

function updateLoadState(container, kind, message) {
  const target = container.querySelector("#market-load-state");
  const root = container.querySelector("#market");
  if (!target) return;
  target.className = `market-load-state is-${kind}`;
  target.textContent = message;
  if (root) root.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
}

function removeChart() {
  chartObserver?.disconnect();
  chartObserver = null;
  if (chartRoot) {
    chartRoot.querySelectorAll("iframe").forEach((frame) => {
      frame.src = "about:blank";
      frame.remove();
    });
  }
  chartScript?.remove();
  chartRoot?.remove();
  window.clearTimeout(chartFailureTimer);
  chartFailureTimer = null;
  chartScript = null;
  chartRoot = null;
  chartHost = null;
}

function showChartFailure(host, coin, generation) {
  if (generation !== mountGeneration || !host.isConnected) return;
  window.clearTimeout(chartFailureTimer);
  chartFailureTimer = null;
  host.classList.add("is-failed");
  host.closest(".market-chart-panel")?.classList.add("is-chart-failed");
  host.innerHTML = `
    <div class="market-chart-placeholder is-error" role="status">
      <strong>차트를 불러오지 못했습니다.</strong>
      <span>브라우저의 콘텐츠 차단 설정이나 네트워크를 확인해 주세요. 아래 시세와 PICK 근거는 계속 볼 수 있습니다.</span>
      <a href="https://www.tradingview.com/symbols/HYPERLIQUID-${esc(coin)}USDC.P/" target="_blank" rel="noopener nofollow">TradingView에서 열기</a>
    </div>
  `;
  const status = document.getElementById("market-chart-status");
  if (status) status.textContent = "차트 차단 또는 연결 실패";
}

function buildTradingViewWidget(host, coin, chartSymbol, generation) {
  if (generation !== mountGeneration || !host.isConnected || chartRoot || chartScript) return;
  const status = document.getElementById("market-chart-status");
  if (status) status.textContent = "TradingView 차트 불러오는 중";

  const root = document.createElement("div");
  root.className = "tradingview-widget-container";
  root.style.height = "100%";
  root.style.width = "100%";

  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  widget.style.height = "calc(100% - 32px)";
  widget.style.width = "100%";

  const copyright = document.createElement("div");
  copyright.className = "tradingview-widget-copyright";
  const attribution = document.createElement("a");
  attribution.href = `https://www.tradingview.com/symbols/${chartSymbol.replace(":", "-")}/`;
  attribution.target = "_blank";
  attribution.rel = "noopener nofollow";
  const chartName = document.createElement("span");
  chartName.className = "blue-text";
  chartName.textContent = `${coin} chart`;
  const trademark = document.createElement("span");
  trademark.className = "trademark";
  trademark.textContent = " by TradingView";
  attribution.append(chartName, trademark);
  copyright.appendChild(attribution);

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = TRADINGVIEW_SCRIPT;
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol: chartSymbol,
    interval: "15",
    timezone: "Asia/Seoul",
    theme: "dark",
    backgroundColor: "#071019",
    gridColor: "rgba(106, 130, 151, 0.12)",
    style: "1",
    locale: "kr",
    allow_symbol_change: false,
    calendar: false,
    details: false,
    hide_side_toolbar: false,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    save_image: false,
    support_host: "https://www.tradingview.com",
  });
  script.addEventListener("load", () => {
    if (generation !== mountGeneration) return;
    const chartStatus = document.getElementById("market-chart-status");
    if (chartStatus) chartStatus.textContent = "차트 표시 확인 중";
    window.setTimeout(() => {
      if (generation !== mountGeneration || !chartStatus || !root.querySelector("iframe")) return;
      window.clearTimeout(chartFailureTimer);
      chartFailureTimer = null;
      chartStatus.textContent = "TradingView 연결됨";
    }, 300);
  }, { once: true });
  script.addEventListener("error", () => {
    showChartFailure(host, coin, generation);
  }, { once: true });

  root.append(widget, copyright, script);
  host.replaceChildren(root);
  chartHost = host;
  chartRoot = root;
  chartScript = script;
  chartFailureTimer = window.setTimeout(() => {
    if (root.querySelector("iframe")) {
      const chartStatus = document.getElementById("market-chart-status");
      if (chartStatus) chartStatus.textContent = "TradingView 연결됨";
      chartFailureTimer = null;
      return;
    }
    showChartFailure(host, coin, generation);
  }, 8000);
}

function scheduleTradingView(container, coin, rawSymbol, generation) {
  const host = container.querySelector("#market-chart-host");
  if (!host) return;
  const symbol = safeChartSymbol(rawSymbol, coin);
  const start = () => buildTradingViewWidget(host, coin, symbol, generation);
  if (!("IntersectionObserver" in window)) {
    start();
    return;
  }
  chartObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    chartObserver?.disconnect();
    chartObserver = null;
    start();
  }, { rootMargin: "280px 0px" });
  chartObserver.observe(host);
}

function cacheStatus(record, loading = false) {
  return {
    data: record?.data || null,
    loading,
    stale: false,
    error: null,
  };
}

function settledStatus(result, previousRecord, cacheSetter) {
  if (result.status === "fulfilled") {
    const record = cachedRecord(result.value);
    cacheSetter(record);
    return { data: result.value, loading: false, stale: Boolean(result.value?.stale), error: null };
  }
  return {
    data: previousRecord?.data || null,
    loading: false,
    stale: Boolean(previousRecord?.data),
    error: result.reason,
  };
}

function renderAvailableData(container, coin, radarStatus, summaryStatus, fearStatus) {
  const model = selectMarketModel(radarStatus.data, coin);
  renderSelectors(container, model.selectors, coin);
  renderPick(container, model.selected, coin, radarStatus);
  renderParticipants(container, radarStatus, model.selected, coin);
  renderQuote(container, summaryStatus, coin);
  renderFear(container, fearStatus);
  return model;
}

export async function mount(container, params) {
  const coin = safeCoin(params?.coin);
  if (!coin) {
    container.innerHTML = '<section class="card empty">지원하지 않는 종목 코드입니다.</section>';
    return;
  }

  const generation = ++mountGeneration;
  activeController?.abort();
  activeController = new AbortController();
  const { signal } = activeController;
  removeChart();
  renderShell(container, coin);

  const previousRadar = cache.radar;
  const previousSummary = cache.summaries.get(coin) || null;
  const previousFear = cache.fear;
  const previousModel = previousRadar ? selectMarketModel(previousRadar.data, coin) : null;
  scheduleTradingView(
    container,
    coin,
    previousModel?.selected?.chartSymbol || safeChartSymbol("", coin),
    generation,
  );
  if (previousRadar || previousSummary || previousFear) {
    renderAvailableData(
      container,
      coin,
      cacheStatus(previousRadar, true),
      cacheStatus(previousSummary, true),
      cacheStatus(previousFear, true),
    );
    updateLoadState(container, "loading", "저장된 관측값을 먼저 표시하고 최신 공개 데이터를 확인 중입니다.");
  }

  let radarStatus = cacheStatus(previousRadar, true);
  let summaryStatus = cacheStatus(previousSummary, true);
  let fearStatus = cacheStatus(previousFear, true);
  const isActive = () => generation === mountGeneration && !signal.aborted;

  const radarTask = fetchJson(RADAR_PATH, signal).then((data) => {
    radarStatus = settledStatus({ status: "fulfilled", value: data }, previousRadar, (record) => { cache.radar = record; });
    if (isActive()) {
      const model = selectMarketModel(radarStatus.data, coin);
      renderSelectors(container, model.selectors, coin);
      renderPick(container, model.selected, coin, radarStatus);
      renderParticipants(container, radarStatus, model.selected, coin);
    }
    return data;
  }, (error) => {
    radarStatus = settledStatus({ status: "rejected", reason: error }, previousRadar, () => {});
    if (isActive()) {
      const model = selectMarketModel(radarStatus.data, coin);
      renderSelectors(container, model.selectors, coin);
      renderPick(container, model.selected, coin, radarStatus);
      renderParticipants(container, radarStatus, model.selected, coin);
    }
    throw error;
  });

  const summaryTask = fetchJson(`/api/market/summary?coin=${encodeURIComponent(coin)}`, signal).then((data) => {
    summaryStatus = settledStatus({ status: "fulfilled", value: data }, previousSummary, (record) => { cache.summaries.set(coin, record); });
    if (isActive()) renderQuote(container, summaryStatus, coin);
    return data;
  }, (error) => {
    summaryStatus = settledStatus({ status: "rejected", reason: error }, previousSummary, () => {});
    if (isActive()) renderQuote(container, summaryStatus, coin);
    throw error;
  });

  const fearTask = fetchJson("/api/market/fear-greed", signal).then((data) => {
    fearStatus = settledStatus({ status: "fulfilled", value: data }, previousFear, (record) => { cache.fear = record; });
    if (isActive()) renderFear(container, fearStatus);
    return data;
  }, (error) => {
    fearStatus = settledStatus({ status: "rejected", reason: error }, previousFear, () => {});
    if (isActive()) renderFear(container, fearStatus);
    throw error;
  });

  await Promise.allSettled([radarTask, summaryTask, fearTask]);
  if (generation !== mountGeneration || signal.aborted) return;

  const statuses = [radarStatus, summaryStatus, fearStatus];
  const failed = statuses.filter((status) => status.error);
  const stale = statuses.filter((status) => status.stale);
  if (stale.length) {
    updateLoadState(container, "stale", "일부 API가 응답하지 않아 이전 관측값을 화면에 유지했습니다.");
  } else if (failed.length) {
    updateLoadState(container, "error", "일부 데이터를 불러오지 못했습니다. 확인 가능한 PICK, 시세 또는 차트는 계속 표시합니다.");
  } else {
    updateLoadState(container, "ready", "최신 공개 데이터를 불러왔습니다.");
  }

}

export function unmount() {
  mountGeneration += 1;
  activeController?.abort();
  activeController = null;
  removeChart();
}
