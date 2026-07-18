import assert from "node:assert/strict";
import test from "node:test";

import { resolveRoute } from "../src/smart_money_radar/static/js/router.js";

test("실제 라이브 경로를 라이브 화면으로 해석한다", () => {
  assert.deepEqual(resolveRoute("/live", ""), { view: "live", params: {} });
});

test("실제 시장 경로에서 코인을 정규화한다", () => {
  assert.deepEqual(resolveRoute("/markets/btc", ""), {
    view: "market",
    params: { coin: "BTC" },
  });
});

test("기존 해시 경로는 실제 경로보다 우선한다", () => {
  assert.deepEqual(resolveRoute("/live", "#/market/eth"), {
    view: "market",
    params: { coin: "ETH" },
  });
});

test("기존 지갑 해시 경로를 계속 지원한다", () => {
  const address = `0x${"ab".repeat(20)}`;
  assert.deepEqual(resolveRoute("/", `#/whale/${address}`), {
    view: "whale",
    params: { address },
  });
});
