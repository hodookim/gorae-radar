import assert from "node:assert/strict";
import test from "node:test";

import { snapshotToReportPage, summarizeSnapshot } from "../scripts/snapshot-pages.mjs";

function fixtureSnapshot() {
  return {
    captured_at_ms: Date.parse("2026-07-18T12:30:00.000Z"),
    data_source: { name: "Hyperliquid public leaderboard and Info API" },
    capture_parameters: {
      top: 12,
      pool: 36,
      scan_limit: 24,
      min_score: 45,
      lookback_hours: 6,
    },
    observation: { scanned_candidates: 24 },
    wallets: [
      {
        candidate: { address: "0x1111111111111111111111111111111111111111", label: "Wallet A" },
        snapshot: {
          open_positions: [
            { coin: "BTC", side: "LONG", position_value: 100, unrealized_pnl: 5 },
            { coin: "ETH", side: "SHORT", position_value: 50, unrealized_pnl: -2 },
          ],
        },
      },
      {
        candidate: { address: "0x2222222222222222222222222222222222222222", label: "Wallet B" },
        snapshot: {
          open_positions: [
            { coin: "BTC", side: "SHORT", position_value: 40, unrealized_pnl: 1 },
            { coin: "SOL", side: "LONG", position_value: 10, unrealized_pnl: 0 },
          ],
        },
      },
    ],
  };
}

test("원본 포지션에서 롱, 숏, 순노출을 계산한다", () => {
  const summary = summarizeSnapshot(fixtureSnapshot());

  assert.equal(summary.long_usd, 110);
  assert.equal(summary.short_usd, 90);
  assert.equal(summary.gross_usd, 200);
  assert.equal(summary.net_usd, 20);
  assert.equal(summary.wallet_count, 2);
  assert.equal(summary.position_count, 4);
});

test("상위 포지션과 지갑 편중을 입력 데이터에서 계산한다", () => {
  const summary = summarizeSnapshot(fixtureSnapshot());
  const btcLong = summary.coin_sides.find((group) => group.coin === "BTC" && group.side === "LONG");

  assert.equal(summary.largest_position.position_usd, 100);
  assert.equal(summary.largest_position_share_pct, 50);
  assert.equal(summary.top_five_positions_share_pct, 100);
  assert.equal(summary.wallets[0].label, "Wallet A");
  assert.equal(summary.wallets[0].exposure_usd, 150);
  assert.equal(summary.top_wallet_share_pct, 75);
  assert.equal(summary.top_four_wallets_share_pct, 100);
  assert.equal(btcLong.position_usd, 100);
  assert.equal(btcLong.wallet_count, 1);
  assert.ok(Math.abs(btcLong.dominance_pct - (100 / 140) * 100) < 1e-10);
});

test("리포트 객체는 파일명 기반 주소와 원본 링크를 만든다", () => {
  const page = snapshotToReportPage(fixtureSnapshot(), "2026-07-18-2130.json");

  assert.equal(page.slug, "reports/2026-07-18-2130-market-snapshot");
  assert.equal(page.schemaType, "Report");
  assert.equal(page.publishedAt, "2026-07-18");
  assert.match(page.body, /2026-07-18 21:30 KST/);
  assert.match(page.body, /전체 롱·숏 노출/);
  assert.match(page.body, /상위 포지션 집중/);
  assert.match(page.body, /지갑 편중/);
  assert.match(page.body, /\/data\/snapshots\/2026-07-18-2130\.json/);
  assert.doesNotMatch(page.body, /—/);
});

test("과거 관측을 나중에 발행해도 관측일과 발행일을 구분한다", () => {
  const snapshot = fixtureSnapshot();
  snapshot.report_published_at = "2026-07-20";
  const page = snapshotToReportPage(snapshot, "2026-07-18-2130.json");

  assert.equal(page.observedDate, "2026-07-18");
  assert.equal(page.publishedAt, "2026-07-20");
  assert.match(page.title, /^2026-07-18/);
});

test("유효하지 않거나 가치가 0인 포지션은 집계하지 않는다", () => {
  const snapshot = fixtureSnapshot();
  snapshot.wallets = [{
    candidate: { address: "0x3333333333333333333333333333333333333333", label: "Empty" },
    snapshot: {
      open_positions: [
        { coin: "BTC", side: "LONG", position_value: 0 },
        { coin: "", side: "SHORT", position_value: 100 },
        { coin: "ETH", side: "UNKNOWN", position_value: 100 },
      ],
    },
  }];

  const summary = summarizeSnapshot(snapshot);
  assert.equal(summary.position_count, 0);
  assert.equal(summary.wallet_count, 0);
  assert.equal(summary.gross_usd, 0);
  assert.equal(summary.top_wallet_share_pct, 0);
});
