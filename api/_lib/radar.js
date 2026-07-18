const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const INFO_URL = "https://api.hyperliquid.xyz/info";

let cache = {
  key: "",
  expiresAt: 0,
  payload: null,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(clamp(parsed, min, max));
}

function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function perfMap(row) {
  const result = {};
  for (const item of row.windowPerformances || []) {
    if (Array.isArray(item) && item.length === 2) result[item[0]] = item[1] || {};
  }
  return result;
}

function scoreCandidate(row) {
  const perf = perfMap(row);
  const day = perf.day || {};
  const week = perf.week || {};
  const month = perf.month || {};
  const allTime = perf.allTime || {};
  const account = num(row.accountValue);
  const monthPnl = num(month.pnl);
  const weekPnl = num(week.pnl);
  const dayPnl = num(day.pnl);
  const monthVolume = num(month.vlm);
  let score = 0;
  if (account >= 10000) score += 8;
  if (account >= 100000) score += 8;
  if (account >= 1000000) score += 8;
  if (dayPnl > 0) score += clamp(dayPnl / 10000, 0, 8);
  if (weekPnl > 0) score += clamp(weekPnl / 50000, 0, 14);
  if (monthPnl > 0) score += clamp(monthPnl / 100000, 0, 18);
  if (num(allTime.pnl) > 0) score += 8;
  if (monthVolume >= 10000000) score += 8;
  if (monthPnl < 0 && weekPnl < 0) score -= 18;
  return clamp(score, 0, 100);
}

async function hyperInfo(payload) {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "gorae-radar-vercel/0.1",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`hyperliquid_info_${res.status}`);
  return await res.json();
}

function parsePositions(address, state) {
  const positions = [];
  for (const item of state.assetPositions || []) {
    const position = item.position || item;
    const size = num(position.szi);
    const value = Math.abs(num(position.positionValue));
    if (!position.coin || !size || !value) continue;
    positions.push({
      wallet_label: address.slice(0, 10),
      address,
      coin: String(position.coin).toUpperCase(),
      side: size > 0 ? "LONG" : "SHORT",
      size,
      entry_price: num(position.entryPx),
      current_price: Math.abs(size) > 0 ? value / Math.abs(size) : 0,
      position_value: value,
      unrealized_pnl: num(position.unrealizedPnl),
      roe_pct: position.returnOnEquity == null ? null : num(position.returnOnEquity) * 100,
      liquidation_price: position.liquidationPx == null ? null : num(position.liquidationPx),
      margin_used: position.marginUsed == null ? null : num(position.marginUsed),
      leverage: position.leverage?.value == null ? null : num(position.leverage.value),
    });
  }
  return positions;
}

function compactUsd(value) {
  const amount = Math.abs(num(value));
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(1)}B`;
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

function signedUsd(value) {
  const amount = num(value);
  return `${amount >= 0 ? "+" : "-"}${compactUsd(amount)}`;
}

function signedPercent(value, digits = 1) {
  const amount = num(value);
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(digits)}%`;
}

function safeWalletIdentity(displayName, index) {
  const fallback = `#${index + 1}`;
  const raw = String(displayName || fallback).trim().slice(0, 48) || fallback;
  return raw.replace(/내부자\s*의심\s*후보/giu, "관찰 지갑");
}

/**
 * 공개 리더보드 수익과 현재 열린 포지션만으로 관찰 점수를 계산한다.
 * 이 점수는 내부자일 확률이 아니며, 각 가점은 factors에 그대로 공개된다.
 */
export function profileWallet(row, _candidateScore, positions, index = 0) {
  const perf = perfMap(row || {});
  const monthPnl = num(perf.month?.pnl);
  const weekPnl = num(perf.week?.pnl);
  const monthRoiPct = num(perf.month?.roi) * 100;
  const totalExposure = positions.reduce((sum, position) => sum + Math.abs(num(position.position_value)), 0);
  const longExposure = positions
    .filter((position) => position.side === "LONG")
    .reduce((sum, position) => sum + Math.abs(num(position.position_value)), 0);
  const shortExposure = Math.max(0, totalExposure - longExposure);
  const dominantSide = longExposure >= shortExposure ? "롱" : "숏";
  const directionShare = totalExposure > 0 ? Math.max(longExposure, shortExposure) / totalExposure : 0;
  const largestPosition = positions.reduce(
    (largest, position) => Math.max(largest, Math.abs(num(position.position_value))),
    0,
  );
  const topPositionShare = totalExposure > 0 ? largestPosition / totalExposure : 0;
  const maxLeverage = positions.reduce((largest, position) => Math.max(largest, num(position.leverage)), 0);
  const unrealizedPnl = positions.reduce((sum, position) => sum + num(position.unrealized_pnl), 0);
  const factors = [];

  const addFactor = (code, points, evidence) => {
    if (points > 0) factors.push({ code, points, evidence });
  };

  if (monthPnl >= 10000000) addFactor("MONTH_PROFIT", 18, `월간 수익 ${compactUsd(monthPnl)}`);
  else if (monthPnl >= 3000000) addFactor("MONTH_PROFIT", 12, `월간 수익 ${compactUsd(monthPnl)}`);
  else if (monthPnl >= 1000000) addFactor("MONTH_PROFIT", 8, `월간 수익 ${compactUsd(monthPnl)}`);

  if (weekPnl >= 3000000) addFactor("WEEK_PROFIT", 12, `주간 수익 ${compactUsd(weekPnl)}`);
  else if (weekPnl >= 1000000) addFactor("WEEK_PROFIT", 8, `주간 수익 ${compactUsd(weekPnl)}`);
  else if (weekPnl >= 250000) addFactor("WEEK_PROFIT", 5, `주간 수익 ${compactUsd(weekPnl)}`);

  if (monthRoiPct >= 50) addFactor("MONTH_ROI", 10, `월간 ROI ${signedPercent(monthRoiPct)}`);
  else if (monthRoiPct >= 20) addFactor("MONTH_ROI", 7, `월간 ROI ${signedPercent(monthRoiPct)}`);
  else if (monthRoiPct >= 8) addFactor("MONTH_ROI", 4, `월간 ROI ${signedPercent(monthRoiPct)}`);

  if (totalExposure >= 50000000) addFactor("TOTAL_EXPOSURE", 16, `총 포지션 ${compactUsd(totalExposure)}`);
  else if (totalExposure >= 20000000) addFactor("TOTAL_EXPOSURE", 10, `총 포지션 ${compactUsd(totalExposure)}`);
  else if (totalExposure >= 5000000) addFactor("TOTAL_EXPOSURE", 5, `총 포지션 ${compactUsd(totalExposure)}`);

  if (topPositionShare >= 0.8) addFactor("POSITION_CONCENTRATION", 15, `단일 종목 비중 ${(topPositionShare * 100).toFixed(0)}%`);
  else if (topPositionShare >= 0.6) addFactor("POSITION_CONCENTRATION", 9, `단일 종목 비중 ${(topPositionShare * 100).toFixed(0)}%`);

  if (maxLeverage >= 25) addFactor("MAX_LEVERAGE", 14, `최대 레버리지 ${maxLeverage.toFixed(0)}x`);
  else if (maxLeverage >= 15) addFactor("MAX_LEVERAGE", 8, `최대 레버리지 ${maxLeverage.toFixed(0)}x`);

  if (directionShare >= 0.9) addFactor("DIRECTION_BIAS", 13, `${dominantSide} 방향 비중 ${(directionShare * 100).toFixed(0)}%`);
  else if (directionShare >= 0.75) addFactor("DIRECTION_BIAS", 7, `${dominantSide} 방향 비중 ${(directionShare * 100).toFixed(0)}%`);

  if (unrealizedPnl >= 3000000) addFactor("OPEN_POSITION_PROFIT", 10, `현재 미실현 수익 ${compactUsd(unrealizedPnl)}`);
  else if (unrealizedPnl >= 500000) addFactor("OPEN_POSITION_PROFIT", 6, `현재 미실현 수익 ${compactUsd(unrealizedPnl)}`);

  const suspicionScore = Math.round(clamp(
    factors.reduce((sum, factor) => sum + factor.points, 0),
    0,
    100,
  ));
  let persona = "레이더 포착 고래";
  if (suspicionScore >= 65) persona = "내부자 의심 후보";
  else if (suspicionScore >= 50) persona = "심상치 않은 고래";
  else if (unrealizedPnl <= -100000) persona = "물린 고래";
  else if (maxLeverage >= 25) persona = "고레버리지 승부사";
  else if (topPositionShare >= 0.8) persona = "한 종목 몰빵형";
  else if (directionShare >= 0.9) persona = `${dominantSide} 집중 고래`;
  else if (totalExposure >= 50000000) persona = "메가 포지션 고래";
  else if (positions.length >= 12) persona = "포지션 수집가";
  else if (monthPnl >= 10000000) persona = "월간 수익 괴물";

  const reasons = factors.map((factor) => factor.evidence);
  const identity = safeWalletIdentity(row?.displayName, index);
  const evidenceSummary = reasons.length ? reasons.slice(0, 3).join(", ") : "복합 의심 기준 미충족";
  return {
    insider_suspicion_score: suspicionScore,
    insider_reasons: reasons,
    insider_suspicion_factors: factors,
    radar_label: `${persona} · ${identity}`,
    radar_tags: [`의심 점수 ${suspicionScore}`, ...reasons].slice(0, 6),
    radar_summary: `공개 데이터 기반 의심 점수 ${suspicionScore}/100. ${evidenceSummary}. 실제 내부자 또는 불법행위 여부를 판정한 결과가 아닙니다.`,
  };
}

function chartSymbol(coin) {
  const normalized = String(coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `HYPERLIQUID:${normalized}USDC.P`;
}

function pickPresentation(group, dominance, avgRoe) {
  const sideLabel = group.side === "LONG" ? "롱" : "숏";
  const dominancePct = (dominance * 100).toFixed(0);
  const exposureLabel = compactUsd(group.positionValue);
  let tone = "watch";
  let labelCode = "EXPOSURE_CONCENTRATION";
  let label = "고래 노출 집중";
  let headline = `${group.coin} ${sideLabel} ${dominancePct}% 편중, ${exposureLabel} 노출`;
  if (group.pnl > 0 && avgRoe > 0) {
    tone = "profit";
    labelCode = "PROFITABLE_CONVERGENCE";
    label = "수익 동반 집결";
    headline = `고래 ${group.walletCount}곳, ${group.coin} ${sideLabel} ${dominancePct}% 집결`;
  } else if (group.pnl < 0 && avgRoe < 0) {
    tone = "trapped";
    labelCode = "TRAPPED_WHALES";
    label = "물린 고래 군단";
    headline = `고래 ${group.walletCount}곳, ${group.coin} ${sideLabel} ${dominancePct}% 몰렸다가 손실 중`;
  } else if ((group.pnl > 0 && avgRoe < 0) || (group.pnl < 0 && avgRoe > 0)) {
    tone = "mixed";
    labelCode = "MIXED_PNL";
    label = "손익 신호 엇갈림";
    headline = `${group.coin} ${sideLabel} ${dominancePct}% 편중, 고래 손익은 엇갈림`;
  }
  return {
    headline,
    tone,
    label_code: labelCode,
    label,
    reasons: [
      `동일 방향 지갑 ${group.walletCount}개`,
      `포지션 노출 ${exposureLabel}`,
      `${sideLabel} 방향 비중 ${dominancePct}%`,
      `미실현 손익 ${signedUsd(group.pnl)}`,
      `가중 평균 ROE ${signedPercent(avgRoe)}`,
    ],
    chart_symbol: chartSymbol(group.coin),
  };
}

function computePicks(wallets) {
  const groups = new Map();
  for (const row of wallets) {
    for (const position of row.snapshot.open_positions || []) {
      const key = `${position.coin}:${position.side}`;
      const group = groups.get(key) || {
        coin: position.coin,
        side: position.side,
        walletCount: 0,
        wallets: new Set(),
        positionValue: 0,
        fillValue: 0,
        fillCount: 0,
        pnl: 0,
        scoreSum: 0,
        avgRoeWeighted: 0,
        roeWeight: 0,
      };
      group.wallets.add(row.candidate.address);
      group.walletCount = group.wallets.size;
      group.positionValue += Math.abs(num(position.position_value));
      group.pnl += num(position.unrealized_pnl);
      group.scoreSum += num(row.candidate.score);
      if (num(position.position_value) > 0 && position.roe_pct != null) {
        group.avgRoeWeighted += num(position.roe_pct) * num(position.position_value);
        group.roeWeight += num(position.position_value);
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => {
    const opposite = groups.get(`${group.coin}:${group.side === "LONG" ? "SHORT" : "LONG"}`);
    const exposure = group.positionValue;
    const oppositeExposure = opposite?.positionValue || 0;
    const dominance = exposure + oppositeExposure > 0 ? exposure / (exposure + oppositeExposure) : 1;
    const avgScore = group.walletCount ? group.scoreSum / group.walletCount : 0;
    const sPos = group.positionValue / (group.positionValue + 1500000);
    const sWallet = Math.min(group.walletCount, 4) / 4;
    const sScore = clamp((avgScore - 50) / 45, 0, 1);
    const sDom = clamp((dominance - 0.5) / 0.5, 0, 1);
    const conviction = clamp(12 + 28 * sScore + 34 * sPos + 14 * sWallet + 8 * sDom, 0, 99);
    const avgRoe = group.roeWeight ? group.avgRoeWeighted / group.roeWeight : 0;
    return {
      coin: group.coin,
      side: group.side,
      walletCount: group.walletCount,
      positionValue: group.positionValue,
      fillValue: 0,
      fillCount: 0,
      pnl: group.pnl,
      avgScore,
      avgRoe,
      dominance,
      conviction,
      ...pickPresentation(group, dominance, avgRoe),
    };
  }).filter((pick) => pick.conviction >= 26)
    .sort((a, b) => b.conviction - a.conviction);
}

export async function buildRadarPayload(query = {}) {
  const startedAt = Date.now();
  const top = boundedInteger(query.top, 12, 1, 12);
  const pool = boundedInteger(query.pool, 36, top, 48);
  const scanLimit = boundedInteger(query.scan_limit, 18, top, 30);
  const requestedMinScore = Number(query.min_score ?? 45);
  const minScore = Number.isFinite(requestedMinScore) ? Math.round(clamp(requestedMinScore, 0, 100)) : 45;
  const cacheKey = `${top}:${pool}:${scanLimit}:${minScore}`;
  if (cache.payload && cache.key === cacheKey && cache.expiresAt > startedAt) {
    return { ...cache.payload, cached: true };
  }

  let leaderboardRes;
  try {
    leaderboardRes = await fetch(LEADERBOARD_URL, {
      headers: { "user-agent": "gorae-radar-vercel/0.1" },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    if (cache.payload && cache.key === cacheKey) {
      return { ...cache.payload, cached: true, stale: true };
    }
    throw error;
  }
  if (!leaderboardRes.ok) {
    if (cache.payload && cache.key === cacheKey) {
      return { ...cache.payload, cached: true, stale: true };
    }
    throw new Error(`leaderboard_${leaderboardRes.status}`);
  }
  const leaderboard = await leaderboardRes.json();
  const candidates = (leaderboard.leaderboardRows || [])
    .map((row) => ({ row, score: scoreCandidate(row) }))
    .filter(({ row, score }) => /^0x[a-fA-F0-9]{40}$/.test(String(row.ethAddress || "")) && score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, pool);

  const hydrateCandidate = async ({ row, score }, index) => {
    const address = String(row.ethAddress).toLowerCase();
    const state = await hyperInfo({ type: "clearinghouseState", user: address });
    const positions = parsePositions(address, state);
    if (!positions.length) return null;
    const profile = profileWallet(row, score, positions, index);
    return {
      rank: index + 1,
      candidate: {
        address,
        label: row.displayName || address.slice(0, 10),
        short_address: `${address.slice(0, 8)}...${address.slice(-6)}`,
        score,
        account_value: num(row.accountValue),
        day_pnl: num(perfMap(row).day?.pnl),
        week_pnl: num(perfMap(row).week?.pnl),
        month_pnl: num(perfMap(row).month?.pnl),
        month_roi: num(perfMap(row).month?.roi),
        ...profile,
        watched: false,
      },
      snapshot: {
        wallet: {
          label: row.displayName || address.slice(0, 10),
          address,
          short_address: `${address.slice(0, 8)}...${address.slice(-6)}`,
          tags: [],
          weight: 1,
          enabled: true,
          notes: "",
        },
        score,
        verdict: score >= 75 ? "HOT" : "WATCH",
        recent_fills: [],
        open_positions: positions,
        closed_pnl_usd: 0,
        fees_usd: 0,
        volume_usd: 0,
        newest_fill_ms: null,
        error: null,
      },
    };
  };

  const wallets = [];
  const candidateLimit = Math.min(candidates.length, scanLimit);
  const batchSize = 4;
  for (let start = 0; start < candidateLimit && wallets.length < top; start += batchSize) {
    const batch = candidates.slice(start, Math.min(start + batchSize, candidateLimit));
    const results = await Promise.allSettled(
      batch.map((candidate, offset) => hydrateCandidate(candidate, start + offset)),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) wallets.push(result.value);
      if (wallets.length >= top) break;
    }
  }

  if (!wallets.length && cache.payload && cache.key === cacheKey) {
    return { ...cache.payload, cached: true, stale: true };
  }

  const payload = {
    source: "vercel_lightweight_hyperliquid",
    lookback_hours: boundedInteger(query.lookback_hours, 6, 1, 24),
    scanned_candidates: Math.min(candidates.length, scanLimit),
    position_wallets: wallets.length,
    candidate_cache_refreshed: true,
    saved: {},
    wallets,
    picks: computePicks(wallets),
    generated_at_ms: Date.now(),
  };
  cache = { key: cacheKey, expiresAt: payload.generated_at_ms + 30000, payload };
  return payload;
}

export async function getWalletDetail(addressInput) {
  const address = String(addressInput || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("invalid_wallet_address");
  const state = await hyperInfo({ type: "clearinghouseState", user: address });
  const positions = parsePositions(address, state);
  let longUsd = 0;
  let shortUsd = 0;
  for (const position of positions) {
    const value = Math.abs(num(position.position_value));
    if (position.side === "LONG") longUsd += value;
    else shortUsd += value;
  }
  const summary = state.marginSummary || state.crossMarginSummary || {};
  return {
    generated_at_ms: Date.now(),
    address,
    account_value: num(summary.accountValue),
    withdrawable: num(state.withdrawable),
    exposure: { long_usd: longUsd, short_usd: shortUsd },
    positions,
  };
}

export function overviewFromRadar(radar) {
  let longUsd = 0;
  let shortUsd = 0;
  const byCoin = new Map();
  for (const row of radar.wallets || []) {
    for (const position of row.snapshot?.open_positions || []) {
      const value = Math.abs(num(position.position_value));
      if (position.side === "LONG") longUsd += value;
      else shortUsd += value;
      byCoin.set(position.coin, (byCoin.get(position.coin) || 0) + value);
    }
  }
  const topCoins = [...byCoin.entries()]
    .map(([coin, position_usd]) => ({ coin, position_usd }))
    .sort((a, b) => b.position_usd - a.position_usd)
    .slice(0, 10);
  return {
    generated_at_ms: radar.generated_at_ms || Date.now(),
    exposure: { long_usd: longUsd, short_usd: shortUsd },
    top_coins: topCoins,
    coins: coinsFlowFromRadar(radar),
    storage: {},
  };
}

export function coinsFlowFromRadar(radar) {
  const groups = new Map();
  for (const row of radar.wallets || []) {
    for (const position of row.snapshot?.open_positions || []) {
      const coin = String(position.coin || "").toUpperCase();
      const side = String(position.side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
      if (!coin) continue;
      const key = `${coin}:${side}`;
      const group = groups.get(key) || {
        coin,
        side,
        wallets: new Set(),
        positionUsd: 0,
        roeWeighted: 0,
        roeWeight: 0,
      };
      const value = Math.abs(num(position.position_value));
      group.wallets.add(row.candidate?.address || row.snapshot?.wallet?.address || "unknown");
      group.positionUsd += value;
      if (position.roe_pct != null && value > 0) {
        group.roeWeighted += num(position.roe_pct) * value;
        group.roeWeight += value;
      }
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      coin: group.coin,
      side: group.side,
      wallet_count: group.wallets.size,
      position_usd: group.positionUsd,
      avg_roe: group.roeWeight ? group.roeWeighted / group.roeWeight : 0,
    }))
    .sort((a, b) => b.position_usd - a.position_usd);
}
