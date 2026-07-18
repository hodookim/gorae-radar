// views/whale.js - current public wallet state from the production API.
import { esc, money, signedUsd, timeLabel, tone } from "../format.js?v=20";
import { positionCard } from "../components/position-card.js?v=20";
import { loadLocalWatchlist } from "../watchlist-store.js?v=20";

let mountGeneration = 0;
let activeController = null;

async function fetchJson(path, signal) {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function isValidAddress(address) {
  return /^0x[a-f0-9]{40}$/i.test(String(address || ""));
}

function savedLabel(address) {
  const match = loadLocalWatchlist().find(
    (wallet) => String(wallet.address || "").toLowerCase() === address,
  );
  return match?.label || `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export async function mount(container, params) {
  const rawAddress = params?.address || "";
  if (!isValidAddress(rawAddress)) {
    container.innerHTML = `<section class="card empty">올바른 지갑 주소가 아닙니다.</section>`;
    return;
  }

  const address = rawAddress.toLowerCase();
  const generation = ++mountGeneration;
  activeController?.abort();
  activeController = new AbortController();
  const { signal } = activeController;

  container.innerHTML = `
    <section id="whale" class="dashboard wallet-page">
      <div class="card"><div class="empty">현재 지갑 상태를 확인하고 있습니다.</div></div>
    </section>
  `;

  let detail;
  try {
    detail = await fetchJson(`/api/wallet/detail?address=${encodeURIComponent(address)}`, signal);
  } catch (error) {
    if (error?.name === "AbortError" || generation !== mountGeneration) return;
    container.innerHTML = `
      <section class="card empty">
        지갑 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        <div class="small">${esc(error.message)}</div>
      </section>
    `;
    return;
  }
  if (generation !== mountGeneration) return;

  const positions = detail.positions || [];
  const longUsd = Number(detail.exposure?.long_usd || 0);
  const shortUsd = Number(detail.exposure?.short_usd || 0);
  const netUsd = longUsd - shortUsd;
  const label = savedLabel(address);

  container.innerHTML = `
    <section id="whale" class="dashboard wallet-page">
      <header class="product-header wallet-header">
        <div>
          <a class="product-back" href="/#/watchlist">관심 지갑으로 돌아가기</a>
          <h1>${esc(label)}</h1>
          <p class="mono wallet-address">${esc(address)}</p>
        </div>
        <div class="product-header__status">
          <span>현재 조회</span>
          <strong>${esc(timeLabel(detail.generated_at_ms))}</strong>
        </div>
      </header>

      <aside class="view-disclosure" aria-label="지갑 데이터 안내">
        <strong>현재 공개 상태만 표시</strong>
        <p>이 주소의 소유자와 거래 목적은 확인하지 않습니다. 다른 거래소·현물·옵션 헤지가 빠져 있을 수 있으며 표시 값은 투자 추천이나 수익 예측이 아닙니다.</p>
        <a href="/guides/leaderboard-bias">표본 편향 안내</a>
      </aside>

      <section class="metrics kpi-strip wallet-kpis" aria-label="지갑 요약">
        <div class="metric"><div class="metric-label">계정 가치</div><div class="metric-value mono">$${money(detail.account_value)}</div><div class="metric-sub">공개 계정 상태</div></div>
        <div class="metric"><div class="metric-label">롱 노출</div><div class="metric-value mono good">$${money(longUsd)}</div><div class="metric-sub">현재 포지션 가치</div></div>
        <div class="metric"><div class="metric-label">숏 노출</div><div class="metric-value mono bad">$${money(shortUsd)}</div><div class="metric-sub">현재 포지션 가치</div></div>
        <div class="metric"><div class="metric-label">순노출</div><div class="metric-value mono ${tone(netUsd)}">${signedUsd(netUsd)}</div><div class="metric-sub">롱-숏</div></div>
      </section>

      <section class="wallet-detail-layout">
        <section class="card data-panel wallet-positions-panel">
          <div class="board-head"><div><div class="board-title">현재 포지션</div><div class="subtitle">Hyperliquid 공개 계정 상태 기준</div></div><span class="pill">${positions.length}개</span></div>
          <div class="whale-grid">
            ${positions.length
              ? positions.map((position) => positionCard(position, [])).join("")
              : '<div class="empty empty-state"><img class="empty-state__mascot" src="/static/assets/mascot/mascot-whale-sleeping.svg" alt="" width="80" height="80" loading="lazy" decoding="async"><p class="empty-state__text">현재 열린 포지션이 없습니다.</p></div>'}
          </div>
        </section>

        <aside class="card snapshot-panel">
          <div class="board-head"><div><div class="board-title">계정 요약</div><div class="subtitle">조회 시점의 공개 데이터</div></div></div>
          <dl class="snapshot-list">
            <div><dt>출금 가능액</dt><dd class="mono">$${money(detail.withdrawable)}</dd></div>
            <div><dt>순노출</dt><dd class="mono ${tone(netUsd)}">${signedUsd(netUsd)}</dd></div>
            <div><dt>열린 포지션</dt><dd class="mono">${positions.length}개</dd></div>
          </dl>
          <div class="wallet-data-note">
            <strong>데이터 범위</strong>
            <p>이 화면은 공개 Info API의 현재 상태를 보여줍니다. 다른 거래소나 현물 지갑의 포지션은 포함하지 않으며 응답 필드가 없으면 값을 추정하지 않습니다.</p>
            <a class="text-link" href="/methodology">산정 방식 보기</a>
          </div>
        </aside>
      </section>
    </section>
  `;
}

export function unmount() {
  mountGeneration += 1;
  activeController?.abort();
  activeController = null;
}
