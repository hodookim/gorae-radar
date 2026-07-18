const FEAR_GREED_API = "https://api.alternative.me/fng/?limit=1&format=json";
const SOURCE_URL = "https://alternative.me/crypto/fear-and-greed-index/";

let fearGreedCache = {
  expiresAt: 0,
  payload: null,
};

function boundedInteger(value, min, max) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function classificationFor(value, upstreamLabel) {
  const approvedLabels = {
    "EXTREME FEAR": { classification: "극단적 공포", label_code: "EXTREME_FEAR" },
    FEAR: { classification: "공포", label_code: "FEAR" },
    NEUTRAL: { classification: "중립", label_code: "NEUTRAL" },
    GREED: { classification: "탐욕", label_code: "GREED" },
    "EXTREME GREED": { classification: "극단적 탐욕", label_code: "EXTREME_GREED" },
  };
  const approved = approvedLabels[String(upstreamLabel || "").trim().toUpperCase()];
  if (approved) return approved;
  if (value <= 24) return { classification: "극단적 공포", label_code: "EXTREME_FEAR" };
  if (value <= 44) return { classification: "공포", label_code: "FEAR" };
  if (value <= 55) return { classification: "중립", label_code: "NEUTRAL" };
  if (value <= 75) return { classification: "탐욕", label_code: "GREED" };
  return { classification: "극단적 탐욕", label_code: "EXTREME_GREED" };
}

export function normalizeFearGreed(item, generatedAt = Date.now()) {
  const value = boundedInteger(item?.value, 0, 100);
  if (value == null) throw new Error("alternative_me_invalid_value");
  const timestampSeconds = boundedInteger(item?.timestamp, 0, 9999999999);
  const nextUpdateSeconds = boundedInteger(item?.time_until_update, 0, 604800);
  return {
    value,
    ...classificationFor(value, item?.value_classification),
    observed_at_ms: timestampSeconds == null ? null : timestampSeconds * 1000,
    next_update_seconds: nextUpdateSeconds,
    generated_at_ms: generatedAt,
    source: {
      name: "Alternative.me Crypto Fear & Greed Index",
      url: SOURCE_URL,
      attribution: "Data provided by Alternative.me",
    },
  };
}

async function loadFearGreed() {
  const now = Date.now();
  if (fearGreedCache.payload && fearGreedCache.expiresAt > now) return fearGreedCache.payload;
  try {
    const upstream = await fetch(FEAR_GREED_API, {
      headers: { "user-agent": "gorae-radar-vercel/0.2" },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error(`alternative_me_${upstream.status}`);
    const body = await upstream.json();
    if (!Array.isArray(body?.data) || !body.data[0]) throw new Error("alternative_me_invalid_payload");
    const payload = normalizeFearGreed(body.data[0], now);
    fearGreedCache = { payload, expiresAt: now + 21600000 };
    return payload;
  } catch (error) {
    if (fearGreedCache.payload) return { ...fearGreedCache.payload, stale: true };
    throw error;
  }
}

export default async function handler(request, response) {
  if (String(request.method || "GET").toUpperCase() !== "GET") {
    response.setHeader("allow", "GET");
    return response.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const payload = await loadFearGreed();
    response.setHeader(
      "cache-control",
      payload.stale
        ? "public, s-maxage=30, stale-while-revalidate=60"
        : "public, s-maxage=21600, stale-while-revalidate=3600",
    );
    return response.status(200).json(payload);
  } catch (error) {
    return response.status(502).json({
      error: "fear_greed_failed",
      message: String(error?.message || error),
    });
  }
}
