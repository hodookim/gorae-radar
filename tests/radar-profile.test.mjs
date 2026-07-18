import assert from "node:assert/strict";
import test from "node:test";

import { profileWallet } from "../api/_lib/radar.js";
import { normalizeFearGreed } from "../api/market/fear-greed.js";
import { normalizeMarketSummary } from "../api/market/summary.js";

const thresholdRow = {
  displayName: "Public Whale",
  windowPerformances: [
    ["month", { pnl: 10_000_000, roi: 0.5 }],
    ["week", { pnl: 3_000_000 }],
  ],
};

const balancedPositions = [
  {
    coin: "BTC",
    side: "LONG",
    position_value: 60_000_000,
    leverage: 1,
    unrealized_pnl: 0,
  },
  {
    coin: "ETH",
    side: "SHORT",
    position_value: 40_000_000,
    leverage: 1,
    unrealized_pnl: 0,
  },
];

test("내부자 의심 후보 라벨은 공개 가점 합계 65점부터 붙는다", () => {
  const profile = profileWallet(thresholdRow, 0, balancedPositions, 0);
  assert.equal(profile.insider_suspicion_score, 65);
  assert.match(profile.radar_label, /내부자 의심 후보/);
  assert.equal(profile.insider_suspicion_factors.reduce((sum, item) => sum + item.points, 0), 65);
  assert.equal(profile.insider_suspicion_factors.some((item) => item.code === "RADAR_SCORE"), false);
  assert.match(profile.radar_summary, /판정한 결과가 아닙니다/);
});

test("65점 미만 지갑에는 내부자 의심 후보 라벨이 붙지 않는다", () => {
  const row = {
    ...thresholdRow,
    windowPerformances: [
      ["month", { pnl: 3_000_000, roi: 0.5 }],
      ["week", { pnl: 3_000_000 }],
    ],
  };
  const profile = profileWallet(row, 0, balancedPositions, 1);
  assert.ok(profile.insider_suspicion_score < 65);
  assert.doesNotMatch(profile.radar_label, /내부자 의심 후보/);
});

test("시장 요약은 Hyperliquid 컨텍스트를 표시 단위로 정규화한다", () => {
  const summary = normalizeMarketSummary(
    "HYPE",
    { name: "HYPE" },
    {
      markPx: "50",
      oraclePx: "49.8",
      midPx: "50.1",
      prevDayPx: "40",
      dayNtlVlm: "123456789",
      openInterest: "2000",
      funding: "0.0001",
    },
    1_700_000_000_000,
  );
  assert.equal(summary.change_24h_pct, 25);
  assert.equal(summary.open_interest_usd, 100_000);
  assert.equal(summary.funding_annualized_pct, 87.60000000000001);
  assert.equal(summary.source, "Hyperliquid public Info API (metaAndAssetCtxs)");
});

test("공포탐욕 지수는 값, 한국어 분류와 출처를 함께 제공한다", () => {
  const result = normalizeFearGreed(
    { value: "22", timestamp: "1700000000", time_until_update: "3600" },
    1_700_000_000_000,
  );
  assert.equal(result.value, 22);
  assert.equal(result.classification, "극단적 공포");
  assert.equal(result.observed_at_ms, 1_700_000_000_000);
  assert.equal(result.source.name, "Alternative.me Crypto Fear & Greed Index");
});

test("공포탐욕 지수의 결측 시각은 0이 아니라 null로 유지한다", () => {
  const result = normalizeFearGreed({ value: "50", timestamp: null, time_until_update: "" });
  assert.equal(result.observed_at_ms, null);
  assert.equal(result.next_update_seconds, null);
});
