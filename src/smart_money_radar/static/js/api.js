// api.js — fetch wrappers + per-call state/render orchestration & error logging.
// Note: loadRadar no longer reschedules polling itself; refresh.js owns the cycle.
import { $, log, setStatus, timeLabel } from "./format.js?v=20";
import { state } from "./state.js?v=20";
import { renderAll } from "./render.js?v=23";
import { markLocalWatchedRows, upsertLocalWallet } from "./watchlist-store.js?v=20";

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return await res.json();
}

export async function loadRadar() {
  try {
    setStatus("갱신중");
    $("refreshBtn").disabled = true;
    const minScore = encodeURIComponent($("minScore").value || 45);
    const data = await api(`/api/radar/top?top=12&pool=48&scan_limit=24&min_score=${minScore}`);
    const fresh = markLocalWatchedRows(data.wallets || []);
    const generatedLabel = data.generated_at_ms
      ? timeLabel(data.generated_at_ms)
      : new Date().toLocaleTimeString("ko-KR");
    state.picks = Array.isArray(data.picks) ? data.picks : [];
    state.scannedCandidates = Number(data.scanned_candidates || 0);
    if (fresh.length > 0) {
      // 새 데이터가 잡히면 덮어쓴다.
      state.rows = fresh;
      setStatus(data.stale ? "이전값" : data.cached ? "캐시" : "정상");
      $("lastUpdated").textContent = data.stale
        ? `이전 데이터 ${generatedLabel}`
        : `기준 ${generatedLabel}${data.cached ? " (캐시)" : ""}`;
      log(`포지션 열린 고래 ${state.rows.length}개 자동 갱신 완료`);
    } else if (state.rows.length > 0) {
      // 이번 스캔에 열린 포지션이 없어도 기존 고래를 그대로 유지한다.
      // (보드가 순간적으로 싹 비워지는 현상 방지 — 새 데이터가 오면 그때 덮어쓴다.)
      setStatus("관측 대기");
      $("lastUpdated").textContent = `기준 ${generatedLabel} (이전 데이터 유지)`;
      log(`이번 스캔에 새 포지션이 없어 이전 고래 ${state.rows.length}개를 유지합니다.`);
    } else {
      setStatus("정상");
    }
    renderAll();
  } catch (error) {
    // 네트워크/API 오류 시에도 기존 state.rows는 그대로 유지된다 (할당이 try 안에서만 일어남).
    setStatus("오류");
    log(`자동 갱신 실패: ${error.message}`);
  } finally {
    $("refreshBtn").disabled = false;
  }
}

export async function addWallet(address, label) {
  try {
    upsertLocalWallet(address, label || address.slice(0, 10), ["auto-radar"]);
    state.rows = state.rows.map((row) => (
      row.candidate.address === address
        ? {...row, candidate: {...row.candidate, watched: true}}
        : row
    ));
    renderAll();
    log(`관심 지갑 등록: ${address} (브라우저 저장)`);
  } catch (error) {
    log(`관심 지갑 등록 실패: ${error.message}`);
  }
}
