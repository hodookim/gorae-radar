// format.js — leaf utilities: number/price/time formatters, DOM helpers, UI output.
// Most-imported module; no internal state, no imports.
const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const $ = (id) => document.getElementById(id);

export const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
})[ch]);

export function money(value) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${fmt.format(abs)}`;
}

export function signedMoney(value) {
  const n = Number(value || 0);
  return `${n > 0 ? "+" : ""}${money(n)}`;
}

export function signedUsd(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${money(Math.abs(n))}`;
}

export function roi(value) {
  const n = Number(value || 0) * 100;
  return `${n > 0 ? "+" : ""}${pctFmt.format(n)}%`;
}

export function tone(value) {
  const n = Number(value || 0);
  if (n > 0) return "good";
  if (n < 0) return "bad";
  return "";
}

export function price(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  const abs = Math.abs(n);
  if (abs >= 1000) return fmt.format(n);
  if (abs >= 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export function timeLabel(ms) {
  if (!ms) return "-";
  return new Date(Number(ms)).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function cleanName(candidate) {
  const label = String(candidate.label || "").trim();
  if (label && !label.startsWith("0x")) return label;
  return candidate.short_address || candidate.address;
}

export function log(message) {
  $("log").textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
}

export function setStatus(status) {
  $("kStatus").textContent = status;
}
