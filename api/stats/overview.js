import { buildRadarPayload, overviewFromRadar } from "../_lib/radar.js";

export default async function handler(request, response) {
  try {
    const radar = await buildRadarPayload({ top: 12, pool: 36, scan_limit: 18, min_score: 45 });
    response.setHeader("cache-control", "s-maxage=30, stale-while-revalidate=60");
    response.status(200).json(overviewFromRadar(radar));
  } catch (error) {
    response.status(500).json({ error: "stats_overview_failed", message: String(error?.message || error) });
  }
}
