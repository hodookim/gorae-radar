import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appPages, renderAppPage } from "./app-pages.mjs";
import {
  contentPages,
  featuredReport,
  latestSnapshotReport,
  renderContentPage,
} from "./content-pages.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staticDir = join(root, "src", "smart_money_radar", "static");
const outDir = join(root, "dist");
const siteOrigin = String(process.env.SITE_ORIGIN || "https://gorae-radar.vercel.app").replace(/\/$/, "");
const buildDate = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const defaultContentUpdatedAt = "2026-07-11";
const naverVerificationFile = "naver0e7986cc8358bf3048efb564b27a8c87.html";

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function withLatestReport(html) {
  if (!featuredReport) return html;
  const report = {
    date: featuredReport.observedDate || featuredReport.publishedAt,
    label: featuredReport.comparisonReport ? "원본 비교 리포트" : "저장 스냅샷",
    title: featuredReport.title,
    description: featuredReport.description,
    href: `/${featuredReport.slug}`,
  };
  const serialized = JSON.stringify(report).replaceAll("<", "\\u003c");
  return html
    .replace(/(<span id="prerender-report-kicker">)[\s\S]*?(<\/span>)/, `$1${escapeHtml(report.date)} ${escapeHtml(report.label)}$2`)
    .replace(/(<h3 id="prerender-report-headline">)[\s\S]*?(<\/h3>)/, `$1${escapeHtml(report.title)}$2`)
    .replace(/(<p id="prerender-report-summary">)[\s\S]*?(<\/p>)/, `$1${escapeHtml(report.description)}$2`)
    .replace(/(<a class="primary" id="prerender-report-link" href=")[^"]*(")/, `$1${report.href}$2`)
    .replace("</head>", `  <script id="latest-report-data" type="application/json">${serialized}</script>\n</head>`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, "static"), { recursive: true });
const indexTemplate = await readFile(join(staticDir, "index.html"), "utf8");
await writeFile(join(outDir, "index.html"), withLatestReport(indexTemplate).replaceAll("{{SITE_ORIGIN}}", siteOrigin), "utf8");
await cp(join(staticDir, "ads.txt"), join(outDir, "ads.txt"));
await mkdir(join(outDir, "static"), { recursive: true });
for (const directory of ["assets", "css", "js"]) {
  await cp(join(staticDir, directory), join(outDir, "static", directory), { recursive: true });
}
await cp(join(staticDir, "favicon.svg"), join(outDir, "static", "favicon.svg"));
try {
  await cp(join(root, "data", "snapshots"), join(outDir, "data", "snapshots"), { recursive: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

for (const page of contentPages) {
  const pageDir = join(outDir, ...page.slug.split("/"));
  await mkdir(pageDir, { recursive: true });
  await writeFile(join(pageDir, "index.html"), renderContentPage(page, siteOrigin), "utf8");
}

for (const page of appPages) {
  const pageDir = join(outDir, ...page.slug.split("/"));
  await mkdir(pageDir, { recursive: true });
  await writeFile(
    join(pageDir, "index.html"),
    renderAppPage(indexTemplate, page, siteOrigin, latestSnapshotReport),
    "utf8",
  );
}

await writeFile(
  join(outDir, "404.html"),
  `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, follow">
  <title>페이지를 찾을 수 없습니다 | 고래지갑추적기</title>
  <meta name="description" content="요청한 페이지를 찾을 수 없습니다.">
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <link rel="stylesheet" href="/static/css/system-v2.css?v=3">
  <link rel="stylesheet" href="/static/css/content-v2.css?v=5">
</head>
<body>
  <header class="content-topbar">
    <a class="content-brand" href="/" aria-label="고래지갑추적기 홈"><img src="/static/assets/logo/logo-symbol-dark.svg" alt="" width="36" height="36"><span>고래지갑추적기</span></a>
    <nav aria-label="주요 내비게이션"><a href="/">홈</a><a href="/live">라이브</a><a href="/reports">리포트</a><a href="/methodology">방법론</a></nav>
  </header>
  <main class="content-shell not-found-shell">
    <article class="content-article">
      <header class="content-hero"><span class="content-kicker">404 · NOT FOUND</span><h1>페이지를 찾을 수 없습니다</h1><p class="content-lede">주소가 잘못됐거나 이동된 페이지입니다. 홈에서 현재 데이터와 공개 문서를 다시 확인할 수 있습니다.</p></header>
      <section><h2>다음 경로를 확인해 보세요</h2><ul><li><a href="/">고래지갑추적기 홈</a></li><li><a href="/live">라이브 포지션</a></li><li><a href="/reports">관측 데이터 리포트</a></li><li><a href="/methodology">지갑 선정과 점수 산정 방식</a></li></ul></section>
    </article>
  </main>
</body>
</html>`,
  "utf8",
);

const sitemapUrls = [
  { slug: "", updatedAt: buildDate },
  ...appPages.map((page) => ({ slug: page.slug, updatedAt: buildDate })),
  ...contentPages.map((page) => ({ slug: page.slug, updatedAt: page.updatedAt || defaultContentUpdatedAt })),
]
  .map(({ slug, updatedAt }) => `  <url><loc>${siteOrigin}/${slug}</loc><lastmod>${updatedAt}</lastmod></url>`)
  .join("\n");
await writeFile(
  join(outDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`,
  "utf8",
);
await writeFile(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`, "utf8");

const rssItems = contentPages
  .filter((page) => page.article || page.slug.startsWith("reports/"))
  .sort((a, b) => String(b.updatedAt || defaultContentUpdatedAt).localeCompare(String(a.updatedAt || defaultContentUpdatedAt)))
  .map((page) => {
    const url = `${siteOrigin}/${page.slug}`;
    const updatedAt = page.updatedAt || defaultContentUpdatedAt;
    const publishedAt = page.publishedAt || updatedAt;
    const pubDate = new Date(`${publishedAt}T00:00:00+09:00`).toUTCString();
    return `    <item>\n      <title>${escapeXml(page.title)}</title>\n      <link>${escapeXml(url)}</link>\n      <guid isPermaLink="true">${escapeXml(url)}</guid>\n      <pubDate>${pubDate}</pubDate>\n      <description>${escapeXml(page.description)}</description>\n    </item>`;
  })
  .join("\n");
await writeFile(
  join(outDir, "rss.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>고래지갑추적기 데이터 리포트</title>\n    <link>${escapeXml(siteOrigin)}</link>\n    <description>Hyperliquid 공개 포지션, 고래 지갑 분석 방법과 데이터 리포트</description>\n    <language>ko-KR</language>\n    <lastBuildDate>${new Date(`${buildDate}T00:00:00Z`).toUTCString()}</lastBuildDate>\n${rssItems}\n  </channel>\n</rss>\n`,
  "utf8",
);
await writeFile(
  join(outDir, naverVerificationFile),
  `naver-site-verification: ${naverVerificationFile}\n`,
  "utf8",
);

console.log(`Built static site to dist/ for ${siteOrigin}`);
