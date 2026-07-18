// views/watchlist.js - browser-local wallet watchlist.
import { esc } from "../format.js?v=20";
import {
  isValidAddress,
  loadLocalWatchlist,
  removeLocalWallet,
  upsertLocalWallet,
} from "../watchlist-store.js?v=20";

function walletRows(wallets) {
  if (!wallets.length) {
    return `<div class="empty empty-state"><img class="empty-state__mascot" src="/static/assets/mascot/mascot-whale-sleeping.svg" alt="" width="96" height="96" loading="lazy" decoding="async"><p class="empty-state__text">아직 저장한 관심 지갑이 없습니다.</p></div>`;
  }
  return wallets.map((wallet, index) => `
    <article class="watchlist-row candidate-row" data-address="${esc(wallet.address)}">
      <span class="wallet-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="watchlist-row__identity">
        <div class="name">${esc(wallet.label || wallet.address)}</div>
        <div class="address mono">${esc(wallet.address)}</div>
        <div class="small">${(wallet.tags || []).map((tag) => esc(tag)).join(", ") || "태그 없음"}</div>
      </div>
      <div class="watchlist-actions">
        <a class="ghost-link" href="/#/whale/${esc(wallet.address)}">상세 보기</a>
        <button class="ghost remove-wallet" data-address="${esc(wallet.address)}">제거</button>
      </div>
    </article>
  `).join("");
}

export async function mount(container) {
  container.innerHTML = `
    <section id="watchlist" class="dashboard watchlist-page">
      <header class="product-header">
        <div><h1>관심 지갑</h1><p>지갑 주소와 라벨은 현재 브라우저에만 저장됩니다.</p></div>
        <div class="product-header__status"><span>저장된 지갑</span><strong id="watchlist-count">0개</strong></div>
      </header>

      <aside class="view-disclosure" aria-label="관심 지갑 개인정보 안내">
        <strong>서버 계정 없이 브라우저에 저장</strong>
        <p>입력한 공개 주소와 라벨은 이 브라우저의 localStorage에만 보관됩니다. 개인 키나 시드 문구를 입력하지 마세요. 주소를 저장해도 소유자 신원이나 거래 목적을 확인하는 것은 아닙니다.</p>
        <a href="/privacy">개인정보 안내</a>
      </aside>

      <section class="card watchlist-add-panel">
        <div class="board-head"><div><div class="board-title">지갑 추가</div><div class="subtitle">0x로 시작하는 공개 지갑 주소를 입력하세요.</div></div></div>
        <form class="watchlist-form" id="watchlist-form">
          <label><span>지갑 주소</span><input id="watchlist-address" type="text" placeholder="0x..." autocomplete="off" spellcheck="false" /></label>
          <label><span>라벨</span><input id="watchlist-label" type="text" placeholder="선택 입력" autocomplete="off" /></label>
          <button class="primary" id="watchlist-add" type="submit">추가</button>
        </form>
        <div class="watchlist-message small" id="watchlist-msg" role="status" aria-live="polite"></div>
      </section>

      <section class="card data-panel">
        <div class="board-head"><div><div class="board-title">저장 목록</div><div class="subtitle">상세 화면에서 현재 공개 포지션을 확인할 수 있습니다.</div></div></div>
        <div class="list watchlist-list" id="watchlist-list"><div class="empty">관심 지갑을 불러오고 있습니다.</div></div>
      </section>

      <section class="watchlist-explainer" aria-labelledby="watchlist-guide-title">
        <h2 id="watchlist-guide-title">관심 지갑을 확인할 때</h2>
        <p>저장 목록은 북마크 기능이며 추천 목록이 아닙니다. 상세 화면은 Hyperliquid 공개 Info API의 현재 상태만 보여주고 다른 거래소, 현물 지갑이나 비공개 헤지는 포함하지 않습니다. 중요한 판단 전에는 원문 데이터와 갱신 시각을 다시 확인하세요.</p>
        <div><a href="/guides/whale-wallets">지갑 관찰 가이드</a><a href="/guides/data-quality">데이터 품질</a><a href="/disclaimer">투자 면책</a></div>
      </section>
    </section>
  `;

  const listEl = container.querySelector("#watchlist-list");
  const countEl = container.querySelector("#watchlist-count");
  const msgEl = container.querySelector("#watchlist-msg");

  function refresh() {
    const wallets = loadLocalWatchlist();
    countEl.textContent = `${wallets.length}개`;
    listEl.innerHTML = walletRows(wallets);
  }

  container.querySelector("#watchlist-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const addrInput = container.querySelector("#watchlist-address");
    const labelInput = container.querySelector("#watchlist-label");
    const address = addrInput.value.trim();
    const label = labelInput.value.trim();
    msgEl.textContent = "";
    if (!isValidAddress(address)) {
      msgEl.textContent = "올바른 지갑 주소를 입력해 주세요. 0x 뒤에 40자리 16진수가 필요합니다.";
      addrInput.focus();
      return;
    }
    try {
      upsertLocalWallet(address, label || address.slice(0, 10), ["manual"]);
      addrInput.value = "";
      labelInput.value = "";
      msgEl.textContent = "관심 지갑에 추가했습니다.";
      refresh();
    } catch (err) {
      msgEl.textContent = `추가하지 못했습니다: ${err.message}`;
    }
  });

  listEl.addEventListener("click", (event) => {
    const button = event.target.closest("button.remove-wallet");
    if (!button) return;
    try {
      removeLocalWallet(button.dataset.address);
      msgEl.textContent = "관심 지갑에서 제거했습니다.";
      refresh();
    } catch (err) {
      msgEl.textContent = `제거하지 못했습니다: ${err.message}`;
    }
  });

  refresh();
}

export function unmount() {}
