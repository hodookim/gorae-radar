const INFO_URL = "https://api.hyperliquid.xyz/info";
const COIN_PATTERN = /^[A-Za-z0-9]{1,24}$/;

let marketCache = {
  expiresAt: 0,
  fetchedAt: 0,
  payload: null,
};

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchMarketContexts() {
  const now = Date.now();
  if (marketCache.payload && marketCache.expiresAt > now) {
    return { payload: marketCache.payload, fetchedAt: marketCache.fetchedAt, stale: false };
  }
  try {
    const upstream = await fetch(INFO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "gorae-radar-vercel/0.2",
      },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error(`hyperliquid_info_${upstream.status}`);
    const payload = await upstream.json();
    if (!Array.isArray(payload) || !Array.isArray(payload[0]?.universe) || !Array.isArray(payload[1])) {
      throw new Error("hyperliquid_invalid_market_payload");
    }
    const fetchedAt = Date.now();
    marketCache = { payload, fetchedAt, expiresAt: fetchedAt + 25000 };
    return { payload, fetchedAt, stale: false };
  } catch (error) {
    if (marketCache.payload) {
      return { payload: marketCache.payload, fetchedAt: marketCache.fetchedAt, stale: true };
    }
    throw error;
  }
}

export function normalizeMarketSummary(coin, asset, context, generatedAt = Date.now()) {
  const markPrice = finiteNumber(context?.markPx);
  const oraclePrice = finiteNumber(context?.oraclePx);
  const midPrice = finiteNumber(context?.midPx);
  const prevDayPrice = finiteNumber(context?.prevDayPx);
  const openInterestUnits = finiteNumber(context?.openInterest);
  const fundingRate = finiteNumber(context?.funding);
  const change24hPct = markPrice != null && prevDayPrice
    ? ((markPrice - prevDayPrice) / prevDayPrice) * 100
    : null;
  return {
    coin: String(asset?.name || coin),
    mark_price: markPrice,
    oracle_price: oraclePrice,
    mid_price: midPrice,
    prev_day_price: prevDayPrice,
    change_24h_pct: change24hPct,
    day_volume_usd: finiteNumber(context?.dayNtlVlm),
    open_interest_units: openInterestUnits,
    open_interest_usd: openInterestUnits != null && markPrice != null
      ? openInterestUnits * markPrice
      : null,
    funding_rate: fundingRate,
    funding_annualized_pct: fundingRate != null ? fundingRate * 24 * 365 * 100 : null,
    generated_at_ms: generatedAt,
    source: "Hyperliquid public Info API (metaAndAssetCtxs)",
    source_url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals",
  };
}

export default async function handler(request, response) {
  if (String(request.method || "GET").toUpperCase() !== "GET") {
    response.setHeader("allow", "GET");
    return response.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const coinInput = String(url.searchParams.get("coin") || "").trim();
    if (!COIN_PATTERN.test(coinInput)) {
      return response.status(400).json({
        error: "invalid_coin",
        message: "coin은 영문과 숫자 1~24자로 입력해야 합니다.",
      });
    }
    const marketResult = await fetchMarketContexts();
    const [meta, contexts] = marketResult.payload;
    const index = meta.universe.findIndex(
      (asset) => String(asset?.name || "").toUpperCase() === coinInput.toUpperCase(),
    );
    if (index < 0 || !contexts[index]) {
      return response.status(404).json({ error: "coin_not_found", coin: coinInput.toUpperCase() });
    }
    response.setHeader("cache-control", "public, s-maxage=30, stale-while-revalidate=60");
    const payload = normalizeMarketSummary(
      coinInput,
      meta.universe[index],
      contexts[index],
      marketResult.fetchedAt,
    );
    if (marketResult.stale) payload.stale = true;
    return response.status(200).json(payload);
  } catch (error) {
    return response.status(502).json({
      error: "market_summary_failed",
      message: String(error?.message || error),
    });
  }
}
