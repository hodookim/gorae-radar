// Investor-first landing view backed by Hyperliquid public data.
import { esc, money, price, signedUsd, timeLabel, tone } from "../format.js?v=20";
import { coinLogo } from "../coin-icons.js?v=20";

const RADAR_PATH = "/api/radar/top?top=12&pool=48&scan_limit=24&min_score=45";
const FEAR_PATH = "/api/market/fear-greed";

let mountGeneration = 0;

const SIGNAL_SKELETON = Array.from({ length: 4 }, (_, index) => `
  <div class="radar-row-skeleton ${index === 0 ? "radar-row-skeleton--lead" : ""}" aria-hidden="true">
    <span></span><span></span><span></span><span></span>
  </div>
`).join("");

const WALLET_SKELETON = Array.from({ length: 5 }, () => `
  <div class="wallet-row-skeleton" aria-hidden="true">
    <span></span><span></span><span></span>
  </div>
`).join("");

async function fetchJson(path) {
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validCoin(value) {
  const coin = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}$/.test(coin) ? coin : "";
}

function marketHref(coin) {
  const normalized = validCoin(coin) || "BTC";
  return normalized === "BTC" ? "/markets/BTC" : `/#/market/${normalized}`;
}

function latestReport() {
  try {
    const value = JSON.parse(document.getElementById("latest-report-data")?.textContent || "null");
    if (value?.href?.startsWith("/reports/") && value.title && value.description) return value;
  } catch {
    // The generic report link remains usable when build metadata is unavailable.
  }
  return {
    date: "최근",
    label: "데이터 리포트",
    title: "관측 지갑의 시점별 포지션을 기록합니다",
    description: "롱·숏 명목 가치, 상위 포지션과 지갑 집중도를 원본 데이터에서 다시 계산합니다.",
    href: "/reports",
  };
}

function normalizePick(raw) {
  const coin = validCoin(raw?.coin);
  const side = String(raw?.side || "").toUpperCase();
  if (!coin || !["LONG", "SHORT"].includes(side)) return null;
  const dominanceRaw = finiteNumber(raw?.dominance, 0);
  const dominance = Math.max(0, Math.min(1, dominanceRaw > 1 ? dominanceRaw / 100 : dominanceRaw));
  return {
    coin,
    side,
    dominance,
    walletCount: Math.max(0, Math.round(finiteNumber(raw?.walletCount ?? raw?.wallet_count, 0))),
    positionValue: Math.abs(finiteNumber(raw?.positionValue ?? raw?.position_value, 0)),
    avgRoe: finiteNumber(raw?.avgRoe ?? raw?.avg_roe, 0),
    pnl: finiteNumber(raw?.pnl, 0),
    conviction: Math.max(0, Math.min(99, finiteNumber(raw?.conviction, 0))),
    label: String(raw?.label || "").trim(),
    reasons: Array.isArray(raw?.reasons)
      ? raw.reasons.map((reason) => String(reason || "").trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

function normalizedPicks(radar) {
  return (Array.isArray(radar?.picks) ? radar.picks : [])
    .map(normalizePick)
    .filter(Boolean)
    .slice(0, 4);
}

function summarizeRadar(radar) {
  let longUsd = 0;
  let shortUsd = 0;
  let positionCount = 0;
  const byCoin = new Map();
  for (const row of radar?.wallets || []) {
    for (const position of row?.snapshot?.open_positions || []) {
      const coin = validCoin(position?.coin);
      const value = Math.abs(finiteNumber(position?.position_value, 0));
      if (!coin || !value) continue;
      positionCount += 1;
      if (String(position.side).toUpperCase() === "LONG") longUsd += value;
      else shortUsd += value;
      byCoin.set(coin, (byCoin.get(coin) || 0) + value);
    }
  }
  const totalUsd = longUsd + shortUsd;
  const longShare = totalUsd > 0 ? (longUsd / totalUsd) * 100 : 50;
  const shortShare = totalUsd > 0 ? (shortUsd / totalUsd) * 100 : 50;
  const topCoins = [...byCoin.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([coin, positionUsd]) => ({ coin, positionUsd }));
  return {
    longUsd,
    shortUsd,
    totalUsd,
    netUsd: longUsd - shortUsd,
    longShare,
    shortShare,
    positionCount,
    topCoins,
  };
}

function freshness(radar) {
  if (!radar) return { label: "데이터 연결 실패", className: "is-error" };
  if (radar.stale) return { label: "이전 스냅샷 유지", className: "is-stale" };
  if (radar.generated_at_ms) return { label: timeLabel(radar.generated_at_ms), className: "is-live" };
  return { label: "최근 스냅샷", className: "is-live" };
}

function sideMeta(side) {
  return side === "LONG"
    ? { label: "롱", className: "good", kind: "long" }
    : { label: "숏", className: "bad", kind: "short" };
}

function fearTone(value) {
  const number = finiteNumber(value, 50);
  if (number <= 44) return "bad";
  if (number >= 56) return "good";
  return "warn";
}

function renderHeroPulse(radar, market, fear) {
  if (!radar) {
    return `
      <div class="pulse-error" role="status">
        <strong>시장 스냅샷을 불러오지 못했습니다.</strong>
        <p>라이브 레이더에서 다시 시도하거나 잠시 후 새로고침해 주세요.</p>
        <a class="text-link" href="/live">라이브 레이더</a>
      </div>
    `;
  }
  const summary = summarizeRadar(radar);
  const picks = normalizedPicks(radar);
  const lead = picks[0] || null;
  const bias = summary.netUsd >= 0 ? sideMeta("LONG") : sideMeta("SHORT");
  const marketChange = market?.change_24h_pct == null ? null : finiteNumber(market.change_24h_pct);
  return `
    <div class="pulse-headline">
      <span>관측 지갑 방향</span>
      <strong>${bias.label} 우위</strong>
      <p class="mono ${bias.className}">${signedUsd(summary.netUsd)} 순노출</p>
    </div>
    <div class="exposure-balance" aria-label="롱 ${summary.longShare.toFixed(0)}%, 숏 ${summary.shortShare.toFixed(0)}%">
      <div class="exposure-balance__labels">
        <span class="good">롱 ${summary.longShare.toFixed(0)}%</span>
        <span class="bad">숏 ${summary.shortShare.toFixed(0)}%</span>
      </div>
      <div class="exposure-balance__track" aria-hidden="true">
        <span class="is-long" style="width:${summary.longShare.toFixed(2)}%"></span>
        <span class="is-short" style="width:${summary.shortShare.toFixed(2)}%"></span>
      </div>
    </div>
    <dl class="pulse-metrics">
      <div><dt>관측 지갑</dt><dd class="mono">${Number(radar.position_wallets || 0)}</dd></div>
      <div><dt>열린 포지션</dt><dd class="mono">${summary.positionCount}</dd></div>
      <div><dt>총 노출</dt><dd class="mono">$${money(summary.totalUsd)}</dd></div>
      <div><dt>시장 심리</dt><dd class="mono ${fear ? fearTone(fear.value) : ""}">${fear ? `${Math.round(finiteNumber(fear.value))} ${esc(fear.classification || "")}` : "-"}</dd></div>
    </dl>
    ${lead ? `
      <a class="lead-signal" href="${marketHref(lead.coin)}">
        <span class="lead-signal__label">가장 강한 포지션 신호</span>
        <span class="lead-signal__coin">${coinLogo(lead.coin, "coin-logo--position")}<strong>${esc(lead.coin)}</strong></span>
        <span class="direction-badge ${sideMeta(lead.side).className}">${sideMeta(lead.side).label} ${(lead.dominance * 100).toFixed(0)}%</span>
        <span class="lead-signal__quote mono">${market ? `$${price(market.mark_price ?? market.mid_price)}` : `$${money(lead.positionValue)} 노출`}${marketChange == null ? "" : ` <em class="${marketChange >= 0 ? "good" : "bad"}">${marketChange > 0 ? "+" : ""}${marketChange.toFixed(2)}%</em>`}</span>
        <b aria-hidden="true">차트 보기 →</b>
      </a>
    ` : ""}
  `;
}

function renderMarketTape(radar, market, fear) {
  const lead = normalizedPicks(radar)[0] || null;
  const coin = lead?.coin || market?.coin || "시장";
  const funding = market?.funding_rate == null ? null : finiteNumber(market.funding_rate) * 100;
  const change = market?.change_24h_pct == null ? null : finiteNumber(market.change_24h_pct);
  const items = [
    {
      label: `${coin} 현재가`,
      value: market ? `$${price(market.mark_price ?? market.mid_price)}` : "-",
      sub: change == null ? "24시간 변화 확인 중" : `${change > 0 ? "+" : ""}${change.toFixed(2)}% / 24시간`,
      className: change == null ? "" : change >= 0 ? "good" : "bad",
    },
    {
      label: "미결제약정",
      value: market?.open_interest_usd == null ? "-" : `$${money(market.open_interest_usd)}`,
      sub: "Hyperliquid 공개 시장",
      className: "",
    },
    {
      label: "현재 펀딩",
      value: funding == null ? "-" : `${funding > 0 ? "+" : ""}${funding.toFixed(4)}%`,
      sub: funding == null ? "데이터 확인 중" : funding > 0 ? "롱 보유 비용 우세" : "숏 보유 비용 우세",
      className: funding == null ? "" : funding >= 0 ? "good" : "bad",
    },
    {
      label: "공포 탐욕 지수",
      value: fear ? `${Math.round(finiteNumber(fear.value))}` : "-",
      sub: fear?.classification || "시장 심리 확인 중",
      className: fear ? fearTone(fear.value) : "",
    },
  ];
  return items.map((item) => `
    <div class="market-tape__item">
      <span>${esc(item.label)}</span>
      <strong class="mono ${item.className}">${esc(item.value)}</strong>
      <small>${esc(item.sub)}</small>
    </div>
  `).join("");
}

function signalSummary(pick) {
  if (pick.pnl > 0 && pick.avgRoe > 0) return "수익 동반 노출";
  if (pick.pnl < 0 && pick.avgRoe < 0) return "손실 구간 노출";
  return "동일 방향 집중";
}

function renderSignalRows(radar) {
  const picks = normalizedPicks(radar);
  if (!picks.length) {
    return `
      <div class="terminal-empty">
        <strong>현재 같은 방향으로 모인 포지션이 없습니다.</strong>
        <span>표본을 다시 확인하고 있습니다.</span>
      </div>
    `;
  }
  return picks.map((pick, index) => {
    const side = sideMeta(pick.side);
    return `
      <a class="radar-signal-row ${index === 0 ? "is-lead" : ""} is-${side.kind}" href="${marketHref(pick.coin)}">
        <div class="radar-signal-row__identity">
          <span class="row-rank mono">${String(index + 1).padStart(2, "0")}</span>
          ${coinLogo(pick.coin)}
          <div><strong>${esc(pick.coin)}</strong><small>${esc(signalSummary(pick))}</small></div>
        </div>
        <div class="radar-signal-row__direction">
          <span class="direction-badge ${side.className}">${side.label}</span>
          <strong class="mono ${side.className}">${(pick.dominance * 100).toFixed(0)}%</strong>
          <small>방향 비중</small>
        </div>
        <div class="radar-signal-row__exposure">
          <span>포지션 합계</span>
          <strong class="mono">$${money(pick.positionValue)}</strong>
        </div>
        <dl class="radar-signal-row__facts">
          <div><dt>지갑</dt><dd class="mono">${pick.walletCount}</dd></div>
          <div><dt>평균 ROE</dt><dd class="mono ${tone(pick.avgRoe)}">${pick.avgRoe > 0 ? "+" : ""}${pick.avgRoe.toFixed(2)}%</dd></div>
          <div><dt>미실현 PnL</dt><dd class="mono ${tone(pick.pnl)}">${signedUsd(pick.pnl)}</dd></div>
          <div><dt>집중 점수</dt><dd class="mono">${pick.conviction.toFixed(0)}/99</dd></div>
        </dl>
        <span class="radar-signal-row__open">차트 <b aria-hidden="true">→</b></span>
      </a>
    `;
  }).join("");
}

function walletPositions(positions) {
  return (positions || [])
    .filter((position) => validCoin(position?.coin) && ["LONG", "SHORT"].includes(String(position?.side || "").toUpperCase()))
    .sort((a, b) => Math.abs(finiteNumber(b.position_value)) - Math.abs(finiteNumber(a.position_value)));
}

function renderWalletPosition(position) {
  const coin = validCoin(position.coin);
  const side = sideMeta(String(position.side).toUpperCase());
  return `
    <span class="wallet-position-chip">
      ${coinLogo(coin, "coin-logo--chip")}
      <strong>${esc(coin)}</strong>
      <em class="${side.className}">${side.label}</em>
      <small class="mono">$${money(Math.abs(finiteNumber(position.position_value)))}</small>
    </span>
  `;
}

function renderWalletRows(radar) {
  const wallets = (radar?.wallets || [])
    .filter((row) => /^0x[a-f0-9]{40}$/i.test(String(row?.candidate?.address || "")))
    .slice(0, 6);
  if (!wallets.length) {
    return `
      <div class="terminal-empty">
        <strong>표시할 지갑을 찾지 못했습니다.</strong>
        <a href="/live">라이브 레이더에서 다시 확인</a>
      </div>
    `;
  }
  return wallets.map((row, index) => {
    const candidate = row.candidate || {};
    const positions = walletPositions(row.snapshot?.open_positions || []);
    const suspicion = Math.max(0, Math.min(100, finiteNumber(candidate.insider_suspicion_score, 0)));
    const reasons = Array.isArray(candidate.insider_reasons)
      ? candidate.insider_reasons.map(String).filter(Boolean).slice(0, 2)
      : [];
    const label = String(candidate.radar_label || candidate.label || `관찰 지갑 ${index + 1}`);
    return `
      <a class="investor-wallet-row ${suspicion >= 65 ? "is-watch" : ""}" href="/#/whale/${esc(candidate.address)}">
        <div class="investor-wallet-row__identity">
          <span class="row-rank mono">${String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>${esc(label)}</strong>
            <code>${esc(candidate.short_address || candidate.address)}</code>
          </div>
        </div>
        <div class="investor-wallet-row__reasons">
          ${reasons.length
            ? reasons.map((reason) => `<span>${esc(reason)}</span>`).join("")
            : '<span>복합 관찰 기준 확인</span>'}
        </div>
        <div class="investor-wallet-row__positions">
          ${positions.slice(0, 2).map(renderWalletPosition).join("") || '<span class="wallet-position-empty">포지션 확인 중</span>'}
          ${positions.length > 2 ? `<small class="mono">+${positions.length - 2}</small>` : ""}
        </div>
        <dl class="investor-wallet-row__facts">
          <div><dt>계정</dt><dd class="mono">$${money(candidate.account_value)}</dd></div>
          <div><dt>월 PnL</dt><dd class="mono ${tone(candidate.month_pnl)}">${signedUsd(candidate.month_pnl)}</dd></div>
          <div><dt>관찰 점수</dt><dd class="mono ${suspicion >= 65 ? "warn" : ""}">${Math.round(suspicion)}/100</dd></div>
        </dl>
        <span class="investor-wallet-row__open">분석 <b aria-hidden="true">→</b></span>
      </a>
    `;
  }).join("");
}

function renderStaticShell() {
  const report = latestReport();
  return `
    <section id="landing" class="terminal-home">
      <section class="investor-hero" aria-labelledby="investor-hero-title">
        <div class="investor-hero__intro">
          <span class="hero-kicker">Hyperliquid Wallet Intelligence</span>
          <h1 id="investor-hero-title">상위 지갑의 움직임을<br><span>포지션으로 추적합니다</span></h1>
          <p>내부자 의심 후보를 포함한 공개 지갑의 방향, 손익과 레버리지를 비교합니다.</p>
          <div class="investor-hero__actions">
            <a class="primary" href="/live">라이브 레이더</a>
            <a class="text-link" id="landing-chart-cta" href="/markets/BTC">BTC 시장 차트</a>
          </div>
          <div class="hero-source-line">
            <span>Source: Hyperliquid public data</span>
            <span>약 30초 캐시</span>
          </div>
        </div>
        <aside class="investor-pulse" aria-label="현재 시장 펄스">
          <div class="investor-pulse__head">
            <div><span class="status-indicator" aria-hidden="true"></span><strong>시장 펄스</strong></div>
            <span id="landing-generated">연결 중</span>
          </div>
          <div class="investor-pulse__body" id="landing-pulse-body">
            <div class="pulse-loading" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          </div>
        </aside>
      </section>

      <section class="market-tape" id="landing-market-tape" aria-label="시장 보조 지표">
        <div class="market-tape__item is-loading" aria-hidden="true"></div>
        <div class="market-tape__item is-loading" aria-hidden="true"></div>
        <div class="market-tape__item is-loading" aria-hidden="true"></div>
        <div class="market-tape__item is-loading" aria-hidden="true"></div>
      </section>

      <section class="terminal-section signal-terminal" aria-labelledby="signals-title">
        <header class="terminal-section__head">
          <div><h2 id="signals-title">고래 포지션 레이더</h2><p>같은 종목과 방향에 모인 공개 포지션을 노출 규모와 손익으로 비교합니다.</p></div>
          <a href="/live">전체 라이브 보기</a>
        </header>
        <div class="radar-signal-board" id="landing-signal-board">${SIGNAL_SKELETON}</div>
      </section>

      <section class="terminal-section wallet-terminal" aria-labelledby="wallets-title">
        <header class="terminal-section__head">
          <div><h2 id="wallets-title">주목 지갑</h2><p>수익 규모, 포지션 집중, 레버리지와 방향 편중이 함께 포착된 지갑입니다.</p></div>
          <a href="/#/watchlist">관심 지갑 관리</a>
        </header>
        <div class="investor-wallet-board" id="landing-wallet-board">${WALLET_SKELETON}</div>
      </section>

      <section class="terminal-section report-terminal" aria-labelledby="report-title">
        <header class="terminal-section__head">
          <div><h2 id="report-title">관측 데이터 리포트</h2><p>관측 시각, 표본 조건과 해석 한계를 날짜별 분석으로 남깁니다.</p></div>
          <a href="/reports">전체 리포트</a>
        </header>
        <article class="landing-report-feature">
          <div><span>${esc(report.date)} ${esc(report.label || "저장 스냅샷")}</span><h3>${esc(report.title)}</h3><p>${esc(report.description)}</p></div>
          <a class="primary" href="${esc(report.href)}">분석 읽기</a>
        </article>
      </section>

      <section class="investor-guide" aria-labelledby="guide-title">
        <div class="investor-guide__intro">
          <h2 id="guide-title">신호보다 근거를 먼저 보세요</h2>
          <p>방향 편중만으로 매수나 매도를 결정하지 않습니다. 가격, 펀딩, 미결제약정과 지갑별 진입가를 함께 확인하세요.</p>
          <a class="text-link" href="/methodology">산정 방식 확인</a>
        </div>
        <div class="investor-guide__checks">
          <article><strong>포지션 집중</strong><span>같은 코인과 방향에 실제 노출이 얼마나 모였는지 봅니다.</span></article>
          <article><strong>시장 비용</strong><span>펀딩과 미결제약정으로 포지션 쏠림의 부담을 확인합니다.</span></article>
          <article><strong>청산 위험</strong><span>개별 지갑의 레버리지와 청산가를 상세 화면에서 비교합니다.</span></article>
        </div>
      </section>

      <aside class="landing-data-disclosure" aria-label="데이터 및 투자 안내">
        <strong>내부자 의심은 공개 데이터 기반 관찰 라벨입니다.</strong>
        <p>지갑 소유자의 신원, 내부자 지위, 미공개 정보 이용 또는 불법행위를 확인하거나 단정하지 않습니다. 표시값은 투자 권유가 아닙니다.</p>
        <div><a href="/guides/data-quality">데이터 품질</a><a href="/disclaimer">투자 면책</a><a href="/editorial-policy">편집 정책</a></div>
      </aside>
    </section>
  `;
}

export async function mount(container) {
  const generation = ++mountGeneration;
  container.innerHTML = renderStaticShell();

  const fearPromise = fetchJson(FEAR_PATH);
  const radar = await fetchJson(RADAR_PATH);
  if (generation !== mountGeneration) return;

  const picks = normalizedPicks(radar);
  const chartCoin = picks[0]?.coin || "BTC";
  const marketPromise = fetchJson(`/api/market/summary?coin=${encodeURIComponent(chartCoin)}`);
  const [market, fear] = await Promise.all([marketPromise, fearPromise]);
  if (generation !== mountGeneration) return;

  const pulse = container.querySelector("#landing-pulse-body");
  const tape = container.querySelector("#landing-market-tape");
  const signals = container.querySelector("#landing-signal-board");
  const wallets = container.querySelector("#landing-wallet-board");
  const generated = container.querySelector("#landing-generated");
  const chartCta = container.querySelector("#landing-chart-cta");
  const fresh = freshness(radar);

  if (pulse) pulse.innerHTML = renderHeroPulse(radar, market, fear);
  if (tape) tape.innerHTML = renderMarketTape(radar, market, fear);
  if (signals) signals.innerHTML = renderSignalRows(radar);
  if (wallets) wallets.innerHTML = renderWalletRows(radar);
  if (generated) {
    generated.textContent = fresh.label;
    generated.className = fresh.className;
  }
  if (chartCta) {
    chartCta.href = marketHref(chartCoin);
    chartCta.setAttribute("aria-label", `${chartCoin} 시장 차트 보기`);
  }
}

export function unmount() {
  mountGeneration += 1;
}
