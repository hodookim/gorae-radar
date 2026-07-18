const liveDescription = "Hyperliquid 상위 지갑의 열린 포지션, 롱·숏 노출, 손익, 레버리지와 집중 종목을 공개 데이터로 비교합니다.";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUsd(value) {
  const amount = Math.abs(Number(value) || 0);
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

function snapshotAside(page, report) {
  if (!report?.summary || !report?.slug) return "";
  const summary = report.summary;
  const reportHref = `/${report.slug}`;
  if (page.view === "market") {
    const btcGroups = summary.coin_sides.filter((group) => group.coin === "BTC");
    const btcExposure = btcGroups.reduce((sum, group) => sum + group.position_usd, 0);
    const lead = btcGroups[0];
    return `
      <aside class="view-disclosure" aria-label="저장된 BTC 관측 요약">
        <strong>${escapeHtml(report.observedAt)} 저장 스냅샷</strong>
        <p>BTC 명목 노출 ${formatUsd(btcExposure)} 중 가장 큰 방향은 ${lead ? `${lead.side === "LONG" ? "롱" : "숏"} ${formatUsd(lead.position_usd)}` : "기록 없음"}이었습니다. 현재값과 다를 수 있으며 이후 가격 방향을 뜻하지 않습니다.</p>
        <a href="${reportHref}">원본 기반 리포트 확인</a>
      </aside>`;
  }
  const groups = summary.coin_sides.slice(0, 3)
    .map((group) => `${group.coin} ${group.side === "LONG" ? "롱" : "숏"} ${formatUsd(group.position_usd)}`)
    .join(", ");
  return `
    <aside class="view-disclosure" aria-label="저장된 라이브 관측 요약">
      <strong>${escapeHtml(report.observedAt)} 저장 스냅샷</strong>
      <p>${summary.wallet_count}개 지갑의 ${summary.position_count}개 포지션을 저장했습니다. 롱 ${formatUsd(summary.long_usd)}, 숏 ${formatUsd(summary.short_usd)}이며 상위 노출은 ${escapeHtml(groups)}였습니다.</p>
      <a href="${reportHref}">원본 데이터와 집계 결과 확인</a>
    </aside>`;
}

function withSnapshotPrerender(prerender, page, latestSnapshotReport) {
  const aside = snapshotAside(page, latestSnapshotReport);
  if (!aside) return prerender;
  const closingTag = page.view === "live" ? "div" : "section";
  return prerender.replace(new RegExp(`\\s*</${closingTag}>\\s*$`), `${aside}\n      </${closingTag}>`);
}

export const appPages = [
  {
    slug: "live",
    view: "live",
    title: "고래 포지션 라이브 | 고래지갑추적기",
    description: liveDescription,
    useLiveTemplate: true,
  },
  {
    slug: "markets/BTC",
    view: "market",
    title: "BTC 고래 포지션 차트 | 고래지갑추적기",
    description: "BTC 무기한 선물 가격과 펀딩, 미결제약정, 관측 지갑의 롱·숏 포지션을 TradingView 차트와 함께 비교합니다.",
    prerender: `
      <section id="market" class="dashboard market-page" aria-busy="true">
        <header class="product-header market-header">
          <div>
            <a class="product-back" href="/">브리핑으로 돌아가기</a>
            <h1>BTC 고래 포지션 차트</h1>
            <p class="market-header__summary">비트코인 무기한 선물의 가격 흐름과 관측 지갑의 롱·숏 노출을 같은 화면에서 비교합니다.</p>
          </div>
          <div class="product-header__status market-header__status"><span>관측 상태</span><strong>최신 데이터 확인 중</strong></div>
        </header>
        <aside class="view-disclosure" aria-label="BTC 시장 페이지 안내">
          <strong>공개 포지션과 시장 지표를 함께 봅니다.</strong>
          <p>방향 비중만으로 가격을 예측하지 않습니다. 참여 지갑 수, 포지션 가치, 펀딩, 미결제약정과 진입가를 함께 확인합니다.</p>
          <a href="/methodology">집계 기준 확인</a>
        </aside>
        <section class="market-layout">
          <section class="card market-chart-panel" aria-labelledby="market-chart-title">
            <div class="market-panel-head"><div><h2 id="market-chart-title">BTC/USDC 실시간 차트</h2><p>TradingView에서 제공하는 Hyperliquid 시장 차트입니다.</p></div></div>
            <div class="market-chart-host"><div class="market-chart-placeholder" role="status"><strong>차트 준비 중</strong><span>브라우저에서 최신 차트를 불러옵니다.</span></div></div>
          </section>
          <article class="card market-pick-panel"><span class="market-pick-eyebrow">관측 지갑 요약</span><h2 class="market-pick-headline">BTC 포지션을 계산하고 있습니다.</h2><p class="market-pick-copy">현재 공개 포지션을 지갑과 방향별로 합산합니다.</p></article>
        </section>
        <section class="card market-wallets-panel">
          <div class="board-head"><div><div class="board-title">확인할 데이터</div><div class="subtitle">방향, 참여 지갑, 포지션 가치, 진입가, 레버리지와 청산가</div></div></div>
          <div class="empty">최신 공개 데이터를 불러오는 중입니다.</div>
        </section>
      </section>
    `,
  },
];

function replaceMeta(html, selector, value) {
  return html.replace(selector, value);
}

export function renderAppPage(indexTemplate, page, siteOrigin, latestSnapshotReport = null) {
  const canonical = `${siteOrigin}/${page.slug}`;
  const liveTemplate = indexTemplate.match(/<template id="live-template">([\s\S]*?)<\/template>/)?.[1] || "";
  const initialPrerender = page.useLiveTemplate ? liveTemplate : page.prerender;
  const prerender = withSnapshotPrerender(initialPrerender, page, latestSnapshotReport);
  let html = indexTemplate;
  html = replaceMeta(html, /<title>[\s\S]*?<\/title>/, `<title>${page.title}</title>`);
  html = replaceMeta(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${page.description}">`);
  html = replaceMeta(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonical}">`);
  html = replaceMeta(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${page.title}">`);
  html = replaceMeta(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${page.description}">`);
  html = replaceMeta(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonical}">`);
  html = replaceMeta(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${page.title}">`);
  html = replaceMeta(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${page.description}">`);
  html = html.replace(/\s*<script async fetchpriority="low" src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=[^"]+" crossorigin="anonymous"><\/script>/, "");
  html = html.replace("<body>", `<body data-initial-view="${page.view}">`);
  html = html.replace(/(<main id="app" class="app-loading">)[\s\S]*?(<\/main>)/, `$1\n${prerender}\n    $2`);
  html = html.replace('"url": "{{SITE_ORIGIN}}/",', `"url": "${canonical}",`);
  return html.replaceAll("{{SITE_ORIGIN}}", siteOrigin);
}
