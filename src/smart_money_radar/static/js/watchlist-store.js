const KEY = "gorae-radar-watchlist-v1";

function canUseStorage() {
  try {
    const probe = "__gorae_probe__";
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function normalizeAddress(address) {
  return String(address || "").trim().toLowerCase();
}

export function isValidAddress(address) {
  return /^0x[a-f0-9]{40}$/i.test(String(address || ""));
}

export function loadLocalWatchlist() {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        address: normalizeAddress(item.address),
        label: String(item.label || item.address || "").trim(),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        added_at_ms: Number(item.added_at_ms || Date.now()),
      }))
      .filter((item) => isValidAddress(item.address));
  } catch {
    return [];
  }
}

export function saveLocalWatchlist(wallets) {
  if (!canUseStorage()) return false;
  localStorage.setItem(KEY, JSON.stringify(wallets));
  window.dispatchEvent(new CustomEvent("gorae-watchlist-change"));
  return true;
}

export function upsertLocalWallet(address, label = "", tags = ["manual"]) {
  const normalized = normalizeAddress(address);
  if (!isValidAddress(normalized)) {
    throw new Error("올바른 지갑 주소가 아닙니다.");
  }
  const wallets = loadLocalWatchlist();
  const existing = wallets.find((wallet) => wallet.address === normalized);
  if (existing) {
    existing.label = String(label || existing.label || normalized.slice(0, 10)).trim();
    existing.tags = tags;
  } else {
    wallets.unshift({
      address: normalized,
      label: String(label || normalized.slice(0, 10)).trim(),
      tags,
      added_at_ms: Date.now(),
    });
  }
  saveLocalWatchlist(wallets);
  return wallets;
}

export function removeLocalWallet(address) {
  const normalized = normalizeAddress(address);
  const wallets = loadLocalWatchlist().filter((wallet) => wallet.address !== normalized);
  saveLocalWatchlist(wallets);
  return wallets;
}

export function isLocalWatched(address) {
  const normalized = normalizeAddress(address);
  return loadLocalWatchlist().some((wallet) => wallet.address === normalized);
}

export function markLocalWatchedRows(rows) {
  const watched = new Set(loadLocalWatchlist().map((wallet) => wallet.address));
  return (rows || []).map((row) => {
    const candidate = row.candidate || {};
    if (!watched.has(normalizeAddress(candidate.address))) return row;
    return {...row, candidate: {...candidate, watched: true}};
  });
}
