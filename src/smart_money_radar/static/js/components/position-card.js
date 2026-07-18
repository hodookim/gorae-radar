// components/position-card.js - compact position record renderer.
import { esc, money, price, signedUsd, tone, timeLabel } from "../format.js?v=20";
import { coinLogo } from "../coin-icons.js?v=20";

function impliedCurrentPrice(position) {
  const value = Math.abs(Number(position.position_value || 0));
  const size = Math.abs(Number(position.size || 0));
  return size > 0 ? value / size : 0;
}

export function positionOpenTime(position, fills = []) {
  const sideNeedle = position.side === "LONG" ? "long" : "short";
  const sideFallback = position.side === "LONG" ? "B" : "A";
  const match = (fills || [])
    .filter((fill) => String(fill.coin || "").toUpperCase() === String(position.coin || "").toUpperCase())
    .find((fill) => {
      const direction = String(fill.direction || "").toLowerCase();
      if (direction.includes("open") && direction.includes(sideNeedle)) return true;
      return !direction.includes("close") && String(fill.side || "").toUpperCase() === sideFallback;
    });
  return match?.time_ms ? timeLabel(match.time_ms) : "진입 시각 미제공";
}

export function positionCard(position, fills = [], compact = false) {
  const sideClass = position.side === "LONG" ? "good" : "bad";
  const sideKind = position.side === "LONG" ? "long" : "short";
  const sideLabel = position.side === "LONG" ? "롱" : "숏";
  const currentPrice = Number(position.current_price || 0) || impliedCurrentPrice(position);
  const liquidation = Number(position.liquidation_price || 0);
  const openLabel = positionOpenTime(position, fills);
  const roe = position.roe_pct == null
    ? "-"
    : `${Number(position.roe_pct) > 0 ? "+" : ""}${Number(position.roe_pct).toFixed(2)}%`;
  const leverage = position.leverage == null ? "-" : `${Number(position.leverage).toFixed(0)}x`;
  return `
    <div class="position-card ${sideKind}">
      <div class="position-head">
        <div class="coin-block">
          ${coinLogo(position.coin, "coin-logo--position")}
          <div class="coin-block__text">
            <strong>${esc(position.coin)}</strong>
            <div class="sub">${esc(openLabel)}</div>
          </div>
        </div>
        <span class="side-badge ${sideClass}">${sideLabel}</span>
      </div>
      <div class="price-grid">
        <div class="price-box entry"><div class="k">진입가</div><div class="v mono">${price(position.entry_price)}</div></div>
        <div class="price-box current"><div class="k">현재가</div><div class="v mono ${sideClass}">${price(currentPrice)}</div></div>
        <div class="price-box liquidation"><div class="k">청산가</div><div class="v mono ${liquidation ? "bad" : ""}">${liquidation ? price(liquidation) : "-"}</div></div>
      </div>
      <div class="position-exposure">
        <span><small>노출</small><strong class="mono">$${money(position.position_value)}</strong></span>
        <span><small>마진</small><strong class="mono">${position.margin_used == null ? "-" : "$" + money(position.margin_used)}</strong></span>
        <span><small>레버리지</small><strong class="mono">${leverage}</strong></span>
      </div>
      <div class="roe-chip ${tone(position.unrealized_pnl)}">
        <span class="roe-chip__label">ROE</span>
        <strong class="mono">${roe}</strong>
        <span class="pnl mono">${signedUsd(position.unrealized_pnl)}</span>
      </div>
      ${compact && position.label ? `<div class="small position-owner">${esc(position.label)}</div>` : ""}
    </div>
  `;
}
