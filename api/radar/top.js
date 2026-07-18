import { buildRadarPayload } from "../_lib/radar.js";

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const query = Object.fromEntries(url.searchParams.entries());
    const payload = await buildRadarPayload(query);
    response.setHeader("cache-control", "s-maxage=15, stale-while-revalidate=45");
    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({ error: "radar_top_failed", message: String(error?.message || error) });
  }
}
