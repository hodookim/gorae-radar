import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { appPages, renderAppPage } from "../scripts/app-pages.mjs";

const template = await readFile(
  new URL("../src/smart_money_radar/static/index.html", import.meta.url),
  "utf8",
);
const origin = "https://gorae-radar.vercel.app";

test("라이브 페이지는 고유한 제목과 canonical을 갖는다", () => {
  const page = appPages.find((item) => item.slug === "live");
  const html = renderAppPage(template, page, origin);

  assert.match(html, /<title>고래 포지션 라이브 \| 고래지갑추적기<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/gorae-radar\.vercel\.app\/live">/);
  assert.match(html, /<body data-initial-view="live">/);
  assert.doesNotMatch(html, /pagead2\.googlesyndication\.com/);
});

test("BTC 페이지는 검색 가능한 초기 본문을 제공한다", () => {
  const page = appPages.find((item) => item.slug === "markets/BTC");
  const html = renderAppPage(template, page, origin);

  assert.match(html, /<h1>BTC 고래 포지션 차트<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/gorae-radar\.vercel\.app\/markets\/BTC">/);
  assert.match(html, /관측 지갑의 롱·숏 노출/);
  assert.doesNotMatch(html, /pagead2\.googlesyndication\.com/);
});

test("저장 스냅샷이 있으면 앱 초기 HTML에도 원본 리포트를 연결한다", () => {
  const page = appPages.find((item) => item.slug === "live");
  const latest = {
    slug: "reports/2026-07-18-2058-market-snapshot",
    observedAt: "2026-07-18 20:58 KST",
    summary: {
      wallet_count: 12,
      position_count: 78,
      long_usd: 96_000_000,
      short_usd: 372_000_000,
      coin_sides: [{ coin: "BTC", side: "SHORT", position_usd: 104_000_000 }],
    },
  };
  const html = renderAppPage(template, page, origin, latest);

  assert.match(html, /2026-07-18 20:58 KST 저장 스냅샷/);
  assert.match(html, /12개 지갑의 78개 포지션/);
  assert.match(html, /\/reports\/2026-07-18-2058-market-snapshot/);
});
