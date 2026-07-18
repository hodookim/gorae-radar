import { readFile, readdir } from "node:fs/promises";
import { join, parse } from "node:path";

import { defaultSnapshotsDir } from "./snapshot-pages.mjs";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rawWallets(snapshot) {
  if (Array.isArray(snapshot?.wallets)) return snapshot.wallets;
  if (Array.isArray(snapshot?.raw?.wallets)) return snapshot.raw.wallets;
  return [];
}

function rawPositions(row) {
  if (Array.isArray(row?.snapshot?.open_positions)) return row.snapshot.open_positions;
  if (Array.isArray(row?.open_positions)) return row.open_positions;
  if (Array.isArray(row?.positions)) return row.positions;
  return [];
}

function walletAddress(row) {
  return String(
    row?.candidate?.address
      || row?.snapshot?.wallet?.address
      || row?.wallet?.address
      || "",
  ).trim().toLowerCase();
}

function walletLabel(row, address) {
  return String(
    row?.candidate?.label
      || row?.snapshot?.wallet?.label
      || row?.wallet?.label
      || shortAddress(address),
  );
}

function shortAddress(address) {
  if (/^0x[a-f0-9]{40}$/i.test(address)) return `${address.slice(0, 8)}...${address.slice(-6)}`;
  return address;
}

function positionMap(row) {
  const signedByCoin = new Map();
  for (const position of rawPositions(row)) {
    const coin = String(position?.coin || "").trim().toUpperCase();
    const side = String(position?.side || "").trim().toUpperCase();
    const value = Math.abs(number(position?.position_value));
    if (!coin || !["LONG", "SHORT"].includes(side) || value <= 0) continue;
    const signedValue = side === "LONG" ? value : -value;
    signedByCoin.set(coin, (signedByCoin.get(coin) || 0) + signedValue);
  }

  const positions = new Map();
  for (const [coin, signedValue] of signedByCoin) {
    if (signedValue === 0) continue;
    positions.set(coin, {
      coin,
      side: signedValue > 0 ? "LONG" : "SHORT",
      position_usd: Math.abs(signedValue),
      signed_usd: signedValue,
    });
  }
  return positions;
}

function indexedWallets(snapshot) {
  const wallets = new Map();
  for (const row of rawWallets(snapshot)) {
    const address = walletAddress(row);
    if (!address) continue;
    wallets.set(address, {
      address,
      label: walletLabel(row, address),
      positions: positionMap(row),
    });
  }
  return wallets;
}

function exposureSummary(wallets) {
  let longUsd = 0;
  let shortUsd = 0;
  let positionCount = 0;
  for (const wallet of wallets) {
    for (const position of wallet.positions.values()) {
      positionCount += 1;
      if (position.side === "LONG") longUsd += position.position_usd;
      else shortUsd += position.position_usd;
    }
  }
  return {
    long_usd: longUsd,
    short_usd: shortUsd,
    gross_usd: longUsd + shortUsd,
    net_usd: longUsd - shortUsd,
    position_count: positionCount,
  };
}

function eventImpact(event) {
  return Math.abs(event.signed_change_usd);
}

export function compareSnapshots(beforeSnapshot, afterSnapshot) {
  const beforeWallets = indexedWallets(beforeSnapshot);
  const afterWallets = indexedWallets(afterSnapshot);
  const commonAddresses = [...beforeWallets.keys()]
    .filter((address) => afterWallets.has(address))
    .sort();
  const commonBeforeWallets = commonAddresses.map((address) => beforeWallets.get(address));
  const commonAfterWallets = commonAddresses.map((address) => afterWallets.get(address));
  const events = [];

  for (const address of commonAddresses) {
    const beforeWallet = beforeWallets.get(address);
    const afterWallet = afterWallets.get(address);
    const coins = new Set([...beforeWallet.positions.keys(), ...afterWallet.positions.keys()]);
    for (const coin of [...coins].sort()) {
      const before = beforeWallet.positions.get(coin) || null;
      const after = afterWallet.positions.get(coin) || null;
      let type;
      if (!before) type = "NEWLY_OBSERVED";
      else if (!after) type = "OBSERVATION_ENDED";
      else if (before.side !== after.side) type = "DIRECTION_FLIPPED";
      else type = "DIRECTION_MAINTAINED";

      const beforeUsd = before?.position_usd || 0;
      const afterUsd = after?.position_usd || 0;
      const signedBeforeUsd = before?.signed_usd || 0;
      const signedAfterUsd = after?.signed_usd || 0;
      events.push({
        type,
        wallet_address: address,
        wallet_label: afterWallet.label || beforeWallet.label,
        coin,
        before_side: before?.side || null,
        after_side: after?.side || null,
        before_usd: beforeUsd,
        after_usd: afterUsd,
        notional_change_usd: afterUsd - beforeUsd,
        notional_change_pct: beforeUsd > 0 ? ((afterUsd - beforeUsd) / beforeUsd) * 100 : null,
        signed_change_usd: signedAfterUsd - signedBeforeUsd,
      });
    }
  }

  events.sort((a, b) => eventImpact(b) - eventImpact(a)
    || a.wallet_address.localeCompare(b.wallet_address)
    || a.coin.localeCompare(b.coin));
  const maintained = events.filter((event) => event.type === "DIRECTION_MAINTAINED");
  const flipped = events.filter((event) => event.type === "DIRECTION_FLIPPED");
  const newlyObserved = events.filter((event) => event.type === "NEWLY_OBSERVED");
  const observationEnded = events.filter((event) => event.type === "OBSERVATION_ENDED");
  const maintainedChanged = maintained.filter((event) => event.notional_change_usd !== 0);

  return {
    before_observed_at_ms: observationTimestamp(beforeSnapshot),
    after_observed_at_ms: observationTimestamp(afterSnapshot),
    before_wallet_count: beforeWallets.size,
    after_wallet_count: afterWallets.size,
    common_wallet_count: commonAddresses.length,
    before_only_wallet_count: [...beforeWallets.keys()].filter((address) => !afterWallets.has(address)).length,
    after_only_wallet_count: [...afterWallets.keys()].filter((address) => !beforeWallets.has(address)).length,
    common_wallet_addresses: commonAddresses,
    before_exposure: exposureSummary(commonBeforeWallets),
    after_exposure: exposureSummary(commonAfterWallets),
    counts: {
      maintained: maintained.length,
      maintained_changed: maintainedChanged.length,
      maintained_increased: maintained.filter((event) => event.notional_change_usd > 0).length,
      maintained_decreased: maintained.filter((event) => event.notional_change_usd < 0).length,
      maintained_unchanged: maintained.filter((event) => event.notional_change_usd === 0).length,
      direction_flipped: flipped.length,
      newly_observed: newlyObserved.length,
      observation_ended: observationEnded.length,
      observed_difference_total: maintainedChanged.length + flipped.length + newlyObserved.length + observationEnded.length,
    },
    events,
    maintained,
    direction_flipped: flipped,
    newly_observed: newlyObserved,
    observation_ended: observationEnded,
  };
}

function observationTimestamp(snapshot, fileName = "") {
  const direct = Number(snapshot?.captured_at_ms || snapshot?.generated_at_ms);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const iso = Date.parse(snapshot?.captured_at || "");
  if (Number.isFinite(iso)) return iso;
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.json$/i.exec(fileName);
  if (!match) return null;
  return Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+09:00`);
}

function kstParts(timestamp) {
  if (!timestamp) return null;
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
}

function formatKst(timestamp) {
  const parts = kstParts(timestamp);
  if (!parts) return "관측 시각 기록 없음";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function dateKst(timestamp) {
  const parts = kstParts(timestamp);
  if (!parts) throw new Error("comparison_observation_time_missing");
  return `${parts.year}-${parts.month}-${parts.day}`;
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

function sideLabel(side) {
  if (side === "LONG") return "롱";
  if (side === "SHORT") return "숏";
  return "없음";
}

function typeLabel(type) {
  if (type === "DIRECTION_FLIPPED") return "방향 전환 관측";
  if (type === "NEWLY_OBSERVED") return "신규 관측";
  if (type === "OBSERVATION_ENDED") return "관측 종료";
  return "방향 유지";
}

function maintainedRows(comparison) {
  const changed = comparison.maintained.filter((event) => event.notional_change_usd !== 0).slice(0, 15);
  if (!changed.length) return '<tr><td colspan="6">방향을 유지하면서 명목 가치가 달라진 포지션이 없습니다.</td></tr>';
  return changed.map((event) => `
              <tr>
                <td>${escapeHtml(event.wallet_label)} <small>${escapeHtml(shortAddress(event.wallet_address))}</small></td>
                <td>${escapeHtml(event.coin)} ${sideLabel(event.after_side)}</td>
                <td>${formatUsd(event.before_usd)}</td>
                <td>${formatUsd(event.after_usd)}</td>
                <td>${formatSignedUsd(event.notional_change_usd)}</td>
                <td>${event.notional_change_pct == null ? "계산 없음" : `${number(event.notional_change_pct).toFixed(1)}%`}</td>
              </tr>`).join("");
}

function stateChangeRows(comparison) {
  const changes = comparison.events
    .filter((event) => event.type !== "DIRECTION_MAINTAINED")
    .slice(0, 20);
  if (!changes.length) return '<tr><td colspan="6">방향 전환, 신규 관측 또는 관측 종료 차이가 없습니다.</td></tr>';
  return changes.map((event) => `
              <tr>
                <td>${typeLabel(event.type)}</td>
                <td>${escapeHtml(event.wallet_label)} <small>${escapeHtml(shortAddress(event.wallet_address))}</small></td>
                <td>${escapeHtml(event.coin)}</td>
                <td>${sideLabel(event.before_side)} ${formatUsd(event.before_usd)}</td>
                <td>${sideLabel(event.after_side)} ${formatUsd(event.after_usd)}</td>
                <td>${formatSignedUsd(event.signed_change_usd)}</td>
              </tr>`).join("");
}

function headline(comparison) {
  if (!comparison.common_wallet_count) return "두 표본에 공통으로 남은 관측 지갑이 없었습니다";
  if (!comparison.counts.observed_difference_total) return "공통 지갑의 포지션 관측값 차이가 없었습니다";
  return `공통 ${comparison.common_wallet_count}개 지갑에서 ${comparison.counts.observed_difference_total}개 포지션 차이를 확인했습니다`;
}

export function comparisonToReportPage(beforeSnapshot, afterSnapshot, beforeFileName, afterFileName) {
  const beforeStem = parse(beforeFileName).name;
  const afterStem = parse(afterFileName).name;
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(beforeStem)) throw new Error(`invalid_snapshot_file_name:${beforeFileName}`);
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(afterStem)) throw new Error(`invalid_snapshot_file_name:${afterFileName}`);

  const comparison = compareSnapshots(beforeSnapshot, afterSnapshot);
  const beforeAt = comparison.before_observed_at_ms || observationTimestamp(beforeSnapshot, beforeFileName);
  const afterAt = comparison.after_observed_at_ms || observationTimestamp(afterSnapshot, afterFileName);
  if (!beforeAt || !afterAt) throw new Error("comparison_observation_time_missing");
  const beforeLabel = formatKst(beforeAt);
  const afterLabel = formatKst(afterAt);
  const publishedAt = dateKst(afterAt);
  const beforeRawHref = `/data/snapshots/${encodeURIComponent(beforeFileName)}`;
  const afterRawHref = `/data/snapshots/${encodeURIComponent(afterFileName)}`;
  const title = `${dateKst(beforeAt)}부터 ${publishedAt}까지 공통 지갑 변화`;
  const description = `${beforeLabel}와 ${afterLabel} 두 표본에 모두 포함된 ${comparison.common_wallet_count}개 지갑의 포지션 관측값 차이를 비교합니다.`;

  return {
    slug: `reports/${beforeStem}-to-${afterStem}-wallet-change`,
    title,
    description,
    article: true,
    schemaType: "Report",
    publishedAt,
    updatedAt: publishedAt,
    observedDate: publishedAt,
    comparisonReport: true,
    body: `
      <header class="content-hero">
        <span class="content-kicker">WALLET CHANGE REPORT · ${escapeHtml(beforeLabel)} · ${escapeHtml(afterLabel)}</span>
        <h1>${headline(comparison)}</h1>
        <p class="content-lede">서로 다른 두 시점에 모두 포함된 동일 지갑만 남기고 주소와 코인이 같은 포지션의 관측값을 비교했습니다.</p>
      </header>
      <section>
        <h2>비교 범위</h2>
        <div class="definition-grid">
          <div><strong>이전 표본</strong><span>${escapeHtml(beforeLabel)}</span></div>
          <div><strong>최신 표본</strong><span>${escapeHtml(afterLabel)}</span></div>
          <div><strong>지갑 교집합</strong><span>${comparison.common_wallet_count}개</span></div>
          <div><strong>포지션 차이</strong><span>${comparison.counts.observed_difference_total}개</span></div>
        </div>
        <p>이전 표본의 ${comparison.before_wallet_count}개 지갑과 최신 표본의 ${comparison.after_wallet_count}개 지갑 중 두 표본에 모두 존재하는 ${comparison.common_wallet_count}개만 비교했습니다. 이전에만 있던 ${comparison.before_only_wallet_count}개와 최신에만 있던 ${comparison.after_only_wallet_count}개 지갑은 표본 구성 차이로 보고 포지션 변화 계산에서 제외했습니다.</p>
      </section>
      <section>
        <h2>공통 지갑 노출 비교</h2>
        <div class="content-table-wrap">
          <table class="content-table">
            <thead><tr><th>항목</th><th>이전 표본</th><th>최신 표본</th><th>차이</th></tr></thead>
            <tbody>
              <tr><td>롱 명목 노출</td><td>${formatUsd(comparison.before_exposure.long_usd)}</td><td>${formatUsd(comparison.after_exposure.long_usd)}</td><td>${formatSignedUsd(comparison.after_exposure.long_usd - comparison.before_exposure.long_usd)}</td></tr>
              <tr><td>숏 명목 노출</td><td>${formatUsd(comparison.before_exposure.short_usd)}</td><td>${formatUsd(comparison.after_exposure.short_usd)}</td><td>${formatSignedUsd(comparison.after_exposure.short_usd - comparison.before_exposure.short_usd)}</td></tr>
              <tr><td>순노출</td><td>${formatSignedUsd(comparison.before_exposure.net_usd)}</td><td>${formatSignedUsd(comparison.after_exposure.net_usd)}</td><td>${formatSignedUsd(comparison.after_exposure.net_usd - comparison.before_exposure.net_usd)}</td></tr>
              <tr><td>총 명목 노출</td><td>${formatUsd(comparison.before_exposure.gross_usd)}</td><td>${formatUsd(comparison.after_exposure.gross_usd)}</td><td>${formatSignedUsd(comparison.after_exposure.gross_usd - comparison.before_exposure.gross_usd)}</td></tr>
            </tbody>
          </table>
        </div>
        <p>이 합계는 공통 지갑의 공개 포지션 관측값만 사용합니다. 표본 사이의 차이는 주문 체결, 자금 이동 또는 거래 의도를 직접 확인한 결과가 아닙니다.</p>
      </section>
      <section>
        <h2>방향 유지 포지션의 명목 가치 변화</h2>
        <p>방향 유지 ${comparison.counts.maintained}개 중 증가 ${comparison.counts.maintained_increased}개, 감소 ${comparison.counts.maintained_decreased}개, 동일 ${comparison.counts.maintained_unchanged}개가 관측됐습니다. 아래 표는 명목 변화 절댓값이 큰 순서로 최대 15개를 표시합니다.</p>
        <div class="content-table-wrap">
          <table class="content-table">
            <thead><tr><th>지갑</th><th>코인·방향</th><th>이전</th><th>최신</th><th>명목 차이</th><th>변화율</th></tr></thead>
            <tbody>${maintainedRows(comparison)}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>방향 전환과 관측 시작·종료</h2>
        <p>방향 전환 ${comparison.counts.direction_flipped}개, 신규 관측 ${comparison.counts.newly_observed}개, 관측 종료 ${comparison.counts.observation_ended}개가 확인됐습니다. 신규와 종료는 두 시점의 공개 응답 차이를 뜻하며 실제 신규 진입이나 청산 체결을 확정하지 않습니다.</p>
        <div class="content-table-wrap">
          <table class="content-table">
            <thead><tr><th>구분</th><th>지갑</th><th>코인</th><th>이전</th><th>최신</th><th>방향 포함 차이</th></tr></thead>
            <tbody>${stateChangeRows(comparison)}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>해석할 때의 한계</h2>
        <ul>
          <li>각 스냅샷은 여러 지갑을 순차 조회한 결과이므로 표본 내부도 완전히 동일한 시점은 아닙니다.</li>
          <li>두 관측 사이에 포지션이 여러 번 바뀌었더라도 중간 경로와 실제 체결 내역은 알 수 없습니다.</li>
          <li>관측 종료는 포지션 종료 외에 표본 누락, API 응답 차이 또는 후보 범위 변화의 영향을 받을 수 있습니다.</li>
          <li>다른 거래소, 현물, 옵션과 장외 노출을 포함하지 않으므로 전체 위험이나 헤지 의도를 판단할 수 없습니다.</li>
          <li>주소만으로 지갑 소유자의 신원, 거래 목적 또는 미공개 정보 이용 여부를 확인할 수 없습니다.</li>
        </ul>
      </section>
      <section class="content-callout">
        <h2>비교 원본</h2>
        <p><a href="${beforeRawHref}">이전 표본 JSON 보기</a> · <a href="${afterRawHref}">최신 표본 JSON 보기</a> · <a href="/methodology">집계 방법론 확인</a></p>
        <p>이 리포트의 모든 수치는 두 JSON의 공통 지갑과 공개 포지션 원본에서 다시 계산했습니다.</p>
      </section>
    `,
  };
}

async function loadOrderedSnapshots(snapshotDir) {
  let entries;
  try {
    entries = await readdir(snapshotDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const snapshots = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-\d{4}\.json$/i.test(entry.name))
    .map(async (entry) => {
      const snapshot = JSON.parse(await readFile(join(snapshotDir, entry.name), "utf8"));
      return {
        fileName: entry.name,
        snapshot,
        observedAtMs: observationTimestamp(snapshot, entry.name),
      };
    }));
  return snapshots
    .filter((item) => Number.isFinite(item.observedAtMs))
    .sort((a, b) => a.observedAtMs - b.observedAtMs || a.fileName.localeCompare(b.fileName));
}

function pageFromPair(before, after) {
  return comparisonToReportPage(before.snapshot, after.snapshot, before.fileName, after.fileName);
}

export async function loadComparisonReportPage(snapshotDir = defaultSnapshotsDir) {
  const ordered = await loadOrderedSnapshots(snapshotDir);
  if (ordered.length < 2) return null;
  return pageFromPair(ordered[0], ordered.at(-1));
}

export async function loadComparisonReportPages(snapshotDir = defaultSnapshotsDir) {
  const ordered = await loadOrderedSnapshots(snapshotDir);
  if (ordered.length < 2) return [];

  const pairs = [];
  for (let index = 1; index < ordered.length; index += 1) {
    pairs.push({ before: ordered[index - 1], after: ordered[index] });
  }
  if (ordered.length >= 3) pairs.push({ before: ordered[0], after: ordered.at(-1) });

  const uniquePairs = new Map();
  for (const pair of pairs) {
    const page = pageFromPair(pair.before, pair.after);
    if (!uniquePairs.has(page.slug)) uniquePairs.set(page.slug, { ...pair, page });
  }

  return [...uniquePairs.values()]
    .sort((a, b) => b.after.observedAtMs - a.after.observedAtMs
      || b.before.observedAtMs - a.before.observedAtMs)
    .map(({ page }) => page);
}
