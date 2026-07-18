import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildRadarPayload } from "../api/_lib/radar.js";
import { summarizeSnapshot } from "./snapshot-pages.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const captureParameters = Object.freeze({
  top: 12,
  pool: 36,
  scan_limit: 24,
  min_score: 45,
  lookback_hours: 6,
});

function clonePublicData(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(clamp(parsed, min, max));
}

function normalizedParameters(parameters) {
  const top = boundedInteger(parameters?.top, captureParameters.top, 1, 12);
  return {
    top,
    pool: boundedInteger(parameters?.pool, captureParameters.pool, top, 48),
    scan_limit: boundedInteger(parameters?.scan_limit, captureParameters.scan_limit, top, 30),
    min_score: boundedInteger(parameters?.min_score, captureParameters.min_score, 0, 100),
    lookback_hours: boundedInteger(parameters?.lookback_hours, captureParameters.lookback_hours, 1, 24),
  };
}

function kstFileStem(timestamp) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`;
}

export async function captureSnapshot({
  outputDir = join(root, "data", "snapshots"),
  parameters = captureParameters,
} = {}) {
  const actualParameters = normalizedParameters(parameters);
  const radar = await buildRadarPayload(actualParameters);
  if (radar?.stale) throw new Error("refusing_to_save_stale_radar_payload");

  const capturedAtMs = Number(radar?.generated_at_ms);
  if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) {
    throw new Error("radar_payload_missing_generated_at_ms");
  }

  const snapshot = {
    schema_version: "1.0",
    captured_at: new Date(capturedAtMs).toISOString(),
    captured_at_ms: capturedAtMs,
    data_source: {
      name: "Hyperliquid public leaderboard and Info API",
      provider: "Hyperliquid",
      leaderboard_url: "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard",
      info_api_url: "https://api.hyperliquid.xyz/info",
      radar_source: radar.source || null,
    },
    capture_parameters: clonePublicData(actualParameters),
    observation: {
      scanned_candidates: radar.scanned_candidates ?? null,
      position_wallets: radar.position_wallets ?? null,
      candidate_cache_refreshed: radar.candidate_cache_refreshed ?? null,
      cached: Boolean(radar.cached),
      stale: Boolean(radar.stale),
    },
    wallets: clonePublicData(radar.wallets || []),
    picks: clonePublicData(radar.picks || []),
  };
  snapshot.summary = summarizeSnapshot(snapshot);

  await mkdir(outputDir, { recursive: true });
  const fileName = `${kstFileStem(capturedAtMs)}.json`;
  const outputPath = join(outputDir, fileName);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  return { outputPath, snapshot };
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    const result = await captureSnapshot();
    console.log(result.outputPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
