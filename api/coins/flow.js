import { buildRadarPayload, coinsFlowFromRadar } from "../_lib/radar.js";

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const lookbackHours = Number(url.searchParams.get("lookback_hours") || 6);
    const radar = await buildRadarPayload({
      top: 12,
      pool: 36,
      scan_limit: 18,
      min_score: 45,
      lookback_hours: lookbackHours,
    });
    response.setHeader("cache-control", "s-maxage=30, stale-while-revalidate=60");
    response.status(200).json({
      generated_at_ms: radar.generated_at_ms || Date.now(),
      lookback_hours: lookbackHours,
      coins: coinsFlowFromRadar(radar),
    });
  } catch (error) {
    response.status(500).json({ error: "coins_flow_failed", message: String(error?.message || error) });
  }
}
