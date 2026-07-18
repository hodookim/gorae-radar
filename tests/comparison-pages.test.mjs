import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compareSnapshots,
  comparisonToReportPage,
  loadComparisonReportPage,
  loadComparisonReportPages,
} from "../scripts/comparison-pages.mjs";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";

function wallet(address, label, positions) {
  return {
    candidate: { address, label },
    snapshot: { open_positions: positions },
  };
}

function fixtures() {
  const before = {
    captured_at_ms: Date.parse("2026-07-18T11:00:00.000Z"),
    wallets: [
      wallet(A, "Wallet A", [
        { coin: "BTC", side: "LONG", position_value: 100 },
        { coin: "ETH", side: "SHORT", position_value: 50 },
      ]),
      wallet(B, "Wallet B", [
        { coin: "SOL", side: "LONG", position_value: 30 },
        { coin: "HYPE", side: "SHORT", position_value: 40 },
      ]),
      wallet(C, "Before only", [
        { coin: "DOGE", side: "LONG", position_value: 999 },
      ]),
    ],
  };
  const after = {
    captured_at_ms: Date.parse("2026-07-18T12:00:00.000Z"),
    wallets: [
      wallet(A, "Wallet A", [
        { coin: "BTC", side: "LONG", position_value: 130 },
        { coin: "ETH", side: "LONG", position_value: 20 },
        { coin: "SOL", side: "SHORT", position_value: 15 },
      ]),
      wallet(B, "Wallet B", [
        { coin: "HYPE", side: "SHORT", position_value: 25 },
      ]),
      wallet(D, "After only", [
        { coin: "DOGE", side: "SHORT", position_value: 777 },
      ]),
    ],
  };
  return { before, after };
}

test("두 표본에 모두 존재하는 지갑만 비교한다", () => {
  const { before, after } = fixtures();
  const result = compareSnapshots(before, after);

  assert.deepEqual(result.common_wallet_addresses, [A, B]);
  assert.equal(result.common_wallet_count, 2);
  assert.equal(result.before_only_wallet_count, 1);
  assert.equal(result.after_only_wallet_count, 1);
  assert.equal(result.events.some((event) => event.coin === "DOGE"), false);
});

test("방향 유지, 방향 전환, 신규 관측과 관측 종료를 구분한다", () => {
  const { before, after } = fixtures();
  const result = compareSnapshots(before, after);
  const byWalletCoin = new Map(result.events.map((event) => [`${event.wallet_address}:${event.coin}`, event]));

  assert.equal(byWalletCoin.get(`${A}:BTC`).type, "DIRECTION_MAINTAINED");
  assert.equal(byWalletCoin.get(`${A}:BTC`).notional_change_usd, 30);
  assert.equal(byWalletCoin.get(`${B}:HYPE`).type, "DIRECTION_MAINTAINED");
  assert.equal(byWalletCoin.get(`${B}:HYPE`).notional_change_usd, -15);
  assert.equal(byWalletCoin.get(`${A}:ETH`).type, "DIRECTION_FLIPPED");
  assert.equal(byWalletCoin.get(`${A}:ETH`).signed_change_usd, 70);
  assert.equal(byWalletCoin.get(`${A}:SOL`).type, "NEWLY_OBSERVED");
  assert.equal(byWalletCoin.get(`${B}:SOL`).type, "OBSERVATION_ENDED");
  assert.deepEqual(result.counts, {
    maintained: 2,
    maintained_changed: 2,
    maintained_increased: 1,
    maintained_decreased: 1,
    maintained_unchanged: 0,
    direction_flipped: 1,
    newly_observed: 1,
    observation_ended: 1,
    observed_difference_total: 5,
  });
});

test("공통 지갑 노출 합계는 한쪽 표본 전용 지갑을 제외한다", () => {
  const { before, after } = fixtures();
  const result = compareSnapshots(before, after);

  assert.deepEqual(result.before_exposure, {
    long_usd: 130,
    short_usd: 90,
    gross_usd: 220,
    net_usd: 40,
    position_count: 4,
  });
  assert.deepEqual(result.after_exposure, {
    long_usd: 150,
    short_usd: 40,
    gross_usd: 190,
    net_usd: 110,
    position_count: 4,
  });
});

test("페이지 객체에 두 원본 링크, 교집합과 비단정 문구가 포함된다", () => {
  const { before, after } = fixtures();
  const page = comparisonToReportPage(
    before,
    after,
    "2026-07-18-2000.json",
    "2026-07-18-2100.json",
  );

  assert.equal(page.slug, "reports/2026-07-18-2000-to-2026-07-18-2100-wallet-change");
  assert.equal(page.schemaType, "Report");
  assert.equal(page.article, true);
  assert.match(page.body, /지갑 교집합<\/strong><span>2개/);
  assert.match(page.body, /\/data\/snapshots\/2026-07-18-2000\.json/);
  assert.match(page.body, /\/data\/snapshots\/2026-07-18-2100\.json/);
  assert.match(page.body, /실제 신규 진입이나 청산 체결을 확정하지 않습니다/);
  assert.doesNotMatch(page.body, /—/);
});

test("누적 스냅샷은 모든 연속 비교와 전체 기간 비교를 최신순으로 유지한다", async (context) => {
  const snapshotDir = await mkdtemp(join(tmpdir(), "gorae-comparison-"));
  context.after(() => rm(snapshotDir, { recursive: true, force: true }));
  const { before, after } = fixtures();
  const latest = structuredClone(after);
  latest.captured_at_ms = Date.parse("2026-07-18T13:00:00.000Z");

  await Promise.all([
    writeFile(join(snapshotDir, "2026-07-18-2000.json"), JSON.stringify(before), "utf8"),
    writeFile(join(snapshotDir, "2026-07-18-2100.json"), JSON.stringify(after), "utf8"),
    writeFile(join(snapshotDir, "2026-07-18-2200.json"), JSON.stringify(latest), "utf8"),
  ]);

  const pages = await loadComparisonReportPages(snapshotDir);
  assert.deepEqual(pages.map((page) => page.slug), [
    "reports/2026-07-18-2100-to-2026-07-18-2200-wallet-change",
    "reports/2026-07-18-2000-to-2026-07-18-2200-wallet-change",
    "reports/2026-07-18-2000-to-2026-07-18-2100-wallet-change",
  ]);
  assert.equal(new Set(pages.map((page) => page.slug)).size, pages.length);

  const compatiblePage = await loadComparisonReportPage(snapshotDir);
  assert.equal(
    compatiblePage.slug,
    "reports/2026-07-18-2000-to-2026-07-18-2200-wallet-change",
  );
});
