import { getWalletDetail } from "../_lib/radar.js";

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const address = String(url.searchParams.get("address") || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      response.status(400).json({ error: "invalid_wallet_address" });
      return;
    }
    const payload = await getWalletDetail(address);
    response.setHeader("cache-control", "s-maxage=10, stale-while-revalidate=30");
    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({
      error: "wallet_detail_failed",
      message: String(error?.message || error),
    });
  }
}
