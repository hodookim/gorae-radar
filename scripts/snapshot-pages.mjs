import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const defaultSnapshotsDir = join(root, "data", "snapshots");

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(part, total) {
  return total > 0 ? (part / total) * 100 : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function snapshotWallets(snapshot) {
  if (Array.isArray(snapshot?.wallets)) return snapshot.wallets;
  if (Array.isArray(snapshot?.raw?.wallets)) return snapshot.raw.wallets;
  return [];
}

function walletIdentity(row, index) {
  const address = String(
    row?.candidate?.address
      || row?.snapshot?.wallet?.address
      || row?.wallet?.address
      || `unknown-${index + 1}`,
  ).toLowerCase();
  const label = String(
    row?.candidate?.label
      || row?.snapshot?.wallet?.label
      || row?.wallet?.label
      || shortAddress(address),
  );
  return { address, label };
}

function walletPositions(row) {
  if (Array.isArray(row?.snapshot?.open_positions)) return row.snapshot.open_positions;
  if (Array.isArray(row?.open_positions)) return row.open_positions;
  if (Array.isArray(row?.positions)) return row.positions;
  return [];
}

function normalizePosition(position, wallet) {
  const coin = String(position?.coin || "").trim().toUpperCase();
  const side = String(position?.side || "").trim().toUpperCase();
  const positionUsd = Math.abs(number(position?.position_value));
  if (!coin || !["LONG", "SHORT"].includes(side) || positionUsd <= 0) return null;
  return {
    wallet_address: wallet.address,
    wallet_label: wallet.label,
    coin,
    side,
    position_usd: positionUsd,
    unrealized_pnl_usd: number(position?.unrealized_pnl),
    leverage: position?.leverage == null ? null : number(position.leverage),
  };
}

function shortAddress(address) {
  if (/^0x[a-f0-9]{40}$/i.test(address)) return `${address.slice(0, 8)}...${address.slice(-6)}`;
  return address;
}

function observationValue(snapshot, key) {
  return snapshot?.observation?.[key] ?? snapshot?.[key] ?? null;
}

function parameterValue(snapshot, key) {
  return snapshot?.capture_parameters?.[key] ?? snapshot?.query?.[key] ?? null;
}

export function summarizeSnapshot(snapshot) {
  const positions = [];
  const wallets = new Map();

  for (const [index, row] of snapshotWallets(snapshot).entries()) {
    const identity = walletIdentity(row, index);
    for (const rawPosition of walletPositions(row)) {
      const position = normalizePosition(rawPosition, identity);
      if (!position) continue;
      positions.push(position);
      const wallet = wallets.get(identity.address) || {
        address: identity.address,
        label: identity.label,
        exposure_usd: 0,
        position_count: 0,
      };
      wallet.exposure_usd += position.position_usd;
      wallet.position_count += 1;
      wallets.set(identity.address, wallet);
    }
  }

  const longUsd = positions
    .filter((position) => position.side === "LONG")
    .reduce((sum, position) => sum + position.position_usd, 0);
  const shortUsd = positions
    .filter((position) => position.side === "SHORT")
    .reduce((sum, position) => sum + position.position_usd, 0);
  const grossUsd = longUsd + shortUsd;
  const netUsd = longUsd - shortUsd;

  const coinTotals = new Map();
  const groups = new Map();
  for (const position of positions) {
    coinTotals.set(position.coin, (coinTotals.get(position.coin) || 0) + position.position_usd);
    const key = `${position.coin}:${position.side}`;
    const group = groups.get(key) || {
      coin: position.coin,
      side: position.side,
      position_usd: 0,
      position_count: 0,
      wallet_addresses: new Set(),
    };
    group.position_usd += position.position_usd;
    group.position_count += 1;
    group.wallet_addresses.add(position.wallet_address);
    groups.set(key, group);
  }

  const coinSides = [...groups.values()]
    .map((group) => ({
      coin: group.coin,
      side: group.side,
      position_usd: group.position_usd,
      position_count: group.position_count,
      wallet_count: group.wallet_addresses.size,
      dominance_pct: percent(group.position_usd, coinTotals.get(group.coin) || 0),
      gross_share_pct: percent(group.position_usd, grossUsd),
    }))
    .sort((a, b) => b.position_usd - a.position_usd || a.coin.localeCompare(b.coin));

  const sortedPositions = [...positions].sort((a, b) => b.position_usd - a.position_usd);
  const walletRows = [...wallets.values()]
    .map((wallet) => ({
      ...wallet,
      share_pct: percent(wallet.exposure_usd, grossUsd),
      position_count_share_pct: percent(wallet.position_count, positions.length),
    }))
    .sort((a, b) => b.exposure_usd - a.exposure_usd || a.address.localeCompare(b.address));
  const topFivePositionsUsd = sortedPositions
    .slice(0, 5)
    .reduce((sum, position) => sum + position.position_usd, 0);
  const topFourWalletsUsd = walletRows
    .slice(0, 4)
    .reduce((sum, wallet) => sum + wallet.exposure_usd, 0);

  return {
    observed_at_ms: number(snapshot?.captured_at_ms || snapshot?.generated_at_ms) || null,
    scanned_candidates: observationValue(snapshot, "scanned_candidates"),
    source: snapshot?.data_source || snapshot?.source || null,
    capture_parameters: {
      top: parameterValue(snapshot, "top"),
      pool: parameterValue(snapshot, "pool"),
      scan_limit: parameterValue(snapshot, "scan_limit"),
      min_score: parameterValue(snapshot, "min_score"),
      lookback_hours: parameterValue(snapshot, "lookback_hours"),
    },
    wallet_count: walletRows.length,
    position_count: positions.length,
    long_usd: longUsd,
    short_usd: shortUsd,
    gross_usd: grossUsd,
    net_usd: netUsd,
    largest_position: sortedPositions[0] || null,
    largest_position_share_pct: percent(sortedPositions[0]?.position_usd || 0, grossUsd),
    top_five_position_count: Math.min(5, sortedPositions.length),
    top_five_positions_share_pct: percent(topFivePositionsUsd, grossUsd),
    top_wallet_share_pct: walletRows[0]?.share_pct || 0,
    top_four_wallet_count: Math.min(4, walletRows.length),
    top_four_wallets_share_pct: percent(topFourWalletsUsd, grossUsd),
    positions: sortedPositions,
    coin_sides: coinSides,
    wallets: walletRows,
  };
}

function formatUsd(value) {
  const amount = Math.abs(number(value));
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

function formatSignedUsd(value) {
  const amount = number(value);
  if (amount === 0) return formatUsd(0);
  return `${amount > 0 ? "+" : "−"}${formatUsd(amount)}`;
}

function formatPercent(value) {
  return `${number(value).toFixed(1)}%`;
}

function formatCount(value, suffix) {
  if (value == null || value === "") return "기록 없음";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.round(parsed).toLocaleString("ko-KR")}${suffix}` : "기록 없음";
}

function kstDateTime(timestamp) {
  if (!timestamp) return "관측 시각 기록 없음";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function dateFromStem(stem, observedAtMs) {
  const match = /^(\d{4}-\d{2}-\d{2})-\d{4}$/.exec(stem);
  if (match) return match[1];
  if (observedAtMs) return new Date(observedAtMs).toISOString().slice(0, 10);
  throw new Error(`snapshot_date_missing:${stem}`);
}

function sourceName(source) {
  if (typeof source === "string" && source) return source;
  if (source && typeof source === "object") return source.name || source.provider || "공개 데이터";
  return "공개 데이터";
}

function exposureHeadline(summary) {
  if (summary.gross_usd === 0) return "유효한 열린 포지션이 기록되지 않았습니다";
  if (summary.net_usd === 0) return "관측 지갑의 롱과 숏 명목 노출이 같았습니다";
  const side = summary.net_usd > 0 ? "롱" : "숏";
  return `관측 지갑의 순노출은 ${side} ${formatUsd(summary.net_usd)}였습니다`;
}

function exposureObservation(summary) {
  if (summary.gross_usd === 0) return "저장된 원본에서 유효한 명목 포지션 가치를 확인할 수 없었습니다.";
  if (summary.net_usd === 0) return "저장 시점의 롱과 숏 명목 포지션 가치 합계가 같았습니다.";
  const larger = summary.net_usd > 0 ? "롱" : "숏";
  const smaller = summary.net_usd > 0 ? "숏" : "롱";
  return `${larger} 명목 노출이 ${smaller}보다 ${formatUsd(summary.net_usd)} 컸습니다. 이 차이는 표본의 현재 상태이며 이후 가격 방향을 뜻하지 않습니다.`;
}

function groupRows(summary) {
  if (!summary.coin_sides.length) return '<tr><td colspan="5">유효한 포지션이 기록되지 않았습니다.</td></tr>';
  return summary.coin_sides.slice(0, 5).map((group) => `
              <tr>
                <td>${escapeHtml(group.coin)} ${group.side === "LONG" ? "롱" : "숏"}</td>
                <td>${formatUsd(group.position_usd)}</td>
                <td>${formatCount(group.wallet_count, "개")}</td>
                <td>${formatPercent(group.dominance_pct)}</td>
                <td>${formatPercent(group.gross_share_pct)}</td>
              </tr>`).join("");
}

function walletRows(summary) {
  if (!summary.wallets.length) return '<tr><td colspan="4">유효한 포지션 지갑이 기록되지 않았습니다.</td></tr>';
  return summary.wallets.slice(0, 5).map((wallet) => `
              <tr>
                <td>${escapeHtml(wallet.label)} <small>${escapeHtml(shortAddress(wallet.address))}</small></td>
                <td>${formatUsd(wallet.exposure_usd)}</td>
                <td>${formatCount(wallet.position_count, "개")}</td>
                <td>${formatPercent(wallet.share_pct)}</td>
              </tr>`).join("");
}

function largestPositionObservation(summary) {
  const position = summary.largest_position;
  if (!position) return "유효한 개별 포지션이 없어 집중도를 계산하지 않았습니다.";
  return `가장 큰 개별 포지션은 ${escapeHtml(position.wallet_label)}의 ${escapeHtml(position.coin)} ${position.side === "LONG" ? "롱" : "숏"} ${formatUsd(position.position_usd)}로, 전체 명목 노출의 ${formatPercent(summary.largest_position_share_pct)}였습니다. 상위 ${summary.top_five_position_count}개 개별 포지션의 합계 비중은 ${formatPercent(summary.top_five_positions_share_pct)}였습니다.`;
}

function walletConcentrationObservation(summary) {
  const wallet = summary.wallets[0];
  if (!wallet) return "유효한 포지션 지갑이 없어 지갑 편중을 계산하지 않았습니다.";
  return `명목 노출이 가장 큰 지갑은 ${escapeHtml(wallet.label)}으로 전체의 ${formatPercent(summary.top_wallet_share_pct)}를 차지했습니다. 상위 ${summary.top_four_wallet_count}개 지갑의 합계 비중은 ${formatPercent(summary.top_four_wallets_share_pct)}였습니다. 지갑 수와 노출 금액을 함께 봐야 한 지갑의 영향력을 구분할 수 있습니다.`;
}

export function snapshotToReportPage(snapshot, fileName) {
  const baseName = parse(String(fileName)).base;
  if (extname(baseName).toLowerCase() !== ".json") throw new Error(`snapshot_file_must_be_json:${baseName}`);
  const stem = parse(baseName).name;
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(stem)) throw new Error(`invalid_snapshot_file_name:${baseName}`);

  const summary = summarizeSnapshot(snapshot);
  const observedDate = dateFromStem(stem, summary.observed_at_ms);
  const publishedAt = String(snapshot?.report_published_at || observedDate);
  const updatedAt = String(snapshot?.report_updated_at || publishedAt);
  const observedAt = kstDateTime(summary.observed_at_ms);
  const rawHref = `/data/snapshots/${encodeURIComponent(baseName)}`;
  const minimumScore = summary.capture_parameters.min_score;
  const source = sourceName(summary.source);
  const title = `${observedDate} ${stem.slice(-4, -2)}:${stem.slice(-2)} 관측 지갑 스냅샷`;
  const description = `${observedAt}에 관측한 ${summary.wallet_count}개 공개 지갑의 ${summary.position_count}개 열린 포지션을 원본 데이터에서 집계합니다.`;

  return {
    slug: `reports/${stem}-market-snapshot`,
    title,
    description,
    article: true,
    schemaType: "Report",
    publishedAt,
    updatedAt,
    observedAt,
    observedDate,
    snapshotFile: baseName,
    summary,
    body: `
      <header class="content-hero">
        <span class="content-kicker">MARKET SNAPSHOT · ${escapeHtml(observedAt)}</span>
        <h1>${exposureHeadline(summary)}</h1>
        <p class="content-lede">저장된 공개 지갑과 포지션 원본을 다시 계산해 전체 노출, 상위 포지션 집중과 지갑 편중을 함께 확인합니다.</p>
      </header>
      <section>
        <h2>관측 조건</h2>
        <div class="definition-grid">
          <div><strong>후보 확인</strong><span>${formatCount(summary.scanned_candidates, "개")}</span></div>
          <div><strong>포지션 보유</strong><span>${formatCount(summary.wallet_count, "개 지갑")}</span></div>
          <div><strong>열린 포지션</strong><span>${formatCount(summary.position_count, "개")}</span></div>
          <div><strong>최소 후보 점수</strong><span>${formatCount(minimumScore, "점")}</span></div>
        </div>
        <p>관측 시각은 ${escapeHtml(observedAt)}이며 데이터 출처는 ${escapeHtml(source)}입니다. 후보 범위 안에서 열린 포지션이 확인된 공개 지갑만 포함했습니다.</p>
      </section>
      <section>
        <h2>전체 롱·숏 노출</h2>
        <div class="content-table-wrap">
          <table class="content-table">
            <thead><tr><th>항목</th><th>명목 포지션 가치</th><th>계산 기준</th></tr></thead>
            <tbody>
              <tr><td>롱 노출</td><td>${formatUsd(summary.long_usd)}</td><td>롱 포지션 가치의 절댓값 합계</td></tr>
              <tr><td>숏 노출</td><td>${formatUsd(summary.short_usd)}</td><td>숏 포지션 가치의 절댓값 합계</td></tr>
              <tr><td>순노출</td><td>${formatSignedUsd(summary.net_usd)}</td><td>롱 노출에서 숏 노출을 뺀 값</td></tr>
              <tr><td>총 명목 노출</td><td>${formatUsd(summary.gross_usd)}</td><td>롱과 숏 노출의 합계</td></tr>
            </tbody>
          </table>
        </div>
        <p>${exposureObservation(summary)}</p>
      </section>
      <section>
        <h2>상위 포지션 집중</h2>
        <div class="content-table-wrap">
          <table class="content-table">
            <thead><tr><th>코인·방향</th><th>포지션 가치</th><th>지갑 수</th><th>해당 코인 방향 비중</th><th>전체 노출 비중</th></tr></thead>
            <tbody>${groupRows(summary)}
            </tbody>
          </table>
        </div>
        <p>${largestPositionObservation(summary)}</p>
      </section>
      <section>
        <h2>지갑 편중</h2>
        <div class="content-table-wrap">
          <table class="content-table">
            <thead><tr><th>지갑</th><th>명목 노출</th><th>포지션 수</th><th>전체 노출 비중</th></tr></thead>
            <tbody>${walletRows(summary)}
            </tbody>
          </table>
        </div>
        <p>${walletConcentrationObservation(summary)}</p>
      </section>
      <section>
        <h2>이 관측의 한계</h2>
        <ul>
          <li>leaderboard 후보 중 제한된 범위만 조회한 표본이며 시장 전체 지갑을 대표하지 않습니다.</li>
          <li>지갑을 순차 조회하므로 모든 포지션이 완전히 같은 시각에 측정된 값은 아닙니다.</li>
          <li>다른 거래소, 현물, 옵션과 장외 포지션은 포함하지 않아 실제 헤지 여부를 알 수 없습니다.</li>
          <li>한 번의 스냅샷만으로 포지션 증가, 감소 또는 이후 가격 방향을 판단할 수 없습니다.</li>
          <li>공개 주소만으로 지갑 소유자의 신원, 거래 의도 또는 미공개 정보 이용 여부를 확인할 수 없습니다.</li>
        </ul>
      </section>
      <section class="content-callout">
        <h2>원본과 재현 정보</h2>
        <p>관측 시각 ${escapeHtml(observedAt)} · 후보 상한 ${formatCount(summary.capture_parameters.scan_limit, "개")} · 결과 지갑 상한 ${formatCount(summary.capture_parameters.top, "개")} · 최소 후보 점수 ${formatCount(minimumScore, "점")}.</p>
        <p><a href="${rawHref}">이 리포트의 원본 JSON 보기</a> · <a href="/methodology">집계 방법론 확인</a></p>
      </section>
    `,
  };
}

export async function loadSnapshotReportPages(snapshotDir = defaultSnapshotsDir) {
  let entries;
  try {
    entries = await readdir(snapshotDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-\d{4}\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  return await Promise.all(fileNames.map(async (fileName) => {
    const contents = await readFile(join(snapshotDir, fileName), "utf8");
    return snapshotToReportPage(JSON.parse(contents), fileName);
  }));
}
