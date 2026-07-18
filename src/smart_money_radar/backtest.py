from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from .smart_money import HyperliquidInfoClient, SmartMoneyCandle
from .storage import StoredFill, load_recent_fills_for_backtest


@dataclass(frozen=True)
class FollowBacktestResult:
    fill_key: str
    address: str
    wallet_label: str
    coin: str
    source_time_ms: int
    direction: str
    delay_minutes: int
    horizon_minutes: int
    take_profit_bps: int
    entry_price: Decimal | None
    exit_price: Decimal | None
    take_profit_hit: bool
    return_bps: Decimal | None
    notional_usd: Decimal
    skipped_reason: str | None = None


def run_follow_backtest(
    *,
    client: HyperliquidInfoClient,
    fills: tuple[StoredFill, ...] | None = None,
    delay_minutes: int = 1,
    horizon_minutes: int = 5,
    take_profit_bps: int = 50,
    limit: int = 200,
) -> tuple[FollowBacktestResult, ...]:
    fills = fills if fills is not None else load_recent_fills_for_backtest(limit=limit)
    results: list[FollowBacktestResult] = []
    for fill in fills[: max(1, limit)]:
        direction = _follow_direction(fill)
        if direction is None:
            results.append(_skipped(fill, delay_minutes, horizon_minutes, take_profit_bps, "unknown_direction"))
            continue
        start_ms = fill.time_ms + delay_minutes * 60_000
        end_ms = start_ms + max(1, horizon_minutes) * 60_000
        try:
            candles = tuple(
                _parse_candle(item)
                for item in client.candle_snapshot(
                    coin=fill.coin,
                    interval="1m",
                    start_time_ms=start_ms,
                    end_time_ms=end_ms + 60_000,
                )
            )
            candles = tuple(item for item in candles if item is not None)
        except Exception as exc:
            results.append(
                _skipped(
                    fill,
                    delay_minutes,
                    horizon_minutes,
                    take_profit_bps,
                    f"{type(exc).__name__}: {exc}",
                )
            )
            continue
        if not candles:
            results.append(_skipped(fill, delay_minutes, horizon_minutes, take_profit_bps, "no_candles"))
            continue
        results.append(
            _evaluate_fill(
                fill=fill,
                direction=direction,
                candles=candles,
                delay_minutes=delay_minutes,
                horizon_minutes=horizon_minutes,
                take_profit_bps=take_profit_bps,
            )
        )
    return tuple(results)


def summarize_follow_backtest(results: tuple[FollowBacktestResult, ...]) -> dict[str, Any]:
    completed = [item for item in results if item.return_bps is not None]
    skipped = [item for item in results if item.return_bps is None]
    wins = [item for item in completed if item.return_bps is not None and item.return_bps > 0]
    avg_return = (
        sum((item.return_bps for item in completed if item.return_bps is not None), Decimal("0"))
        / Decimal(len(completed))
        if completed
        else None
    )
    return {
        "total": len(results),
        "completed": len(completed),
        "skipped": len(skipped),
        "wins": len(wins),
        "win_rate": (len(wins) / len(completed)) if completed else None,
        "avg_return_bps": avg_return,
        "take_profit_hits": sum(1 for item in completed if item.take_profit_hit),
    }


def _evaluate_fill(
    *,
    fill: StoredFill,
    direction: str,
    candles: tuple[SmartMoneyCandle, ...],
    delay_minutes: int,
    horizon_minutes: int,
    take_profit_bps: int,
) -> FollowBacktestResult:
    entry_candle = candles[0]
    entry_price = entry_candle.open
    tp_multiplier = Decimal(take_profit_bps) / Decimal("10000")
    take_profit_price = (
        entry_price * (Decimal("1") + tp_multiplier)
        if direction == "LONG"
        else entry_price * (Decimal("1") - tp_multiplier)
    )
    take_profit_hit = False
    exit_price = candles[-1].close

    for candle in candles:
        if direction == "LONG" and candle.high >= take_profit_price:
            take_profit_hit = True
            exit_price = _breakeven_or_horizon_exit(
                direction=direction,
                entry_price=entry_price,
                candles=candles,
                start_after_ms=candle.close_time_ms,
            )
            break
        if direction == "SHORT" and candle.low <= take_profit_price:
            take_profit_hit = True
            exit_price = _breakeven_or_horizon_exit(
                direction=direction,
                entry_price=entry_price,
                candles=candles,
                start_after_ms=candle.close_time_ms,
            )
            break

    full_position_return = _return_bps(direction, entry_price, exit_price)
    if take_profit_hit:
        half_tp_return = Decimal(take_profit_bps) / Decimal("2")
        half_runner_return = full_position_return / Decimal("2")
        return_bps = half_tp_return + half_runner_return
    else:
        return_bps = full_position_return

    return FollowBacktestResult(
        fill_key=fill.fill_key,
        address=fill.address,
        wallet_label=fill.wallet_label,
        coin=fill.coin,
        source_time_ms=fill.time_ms,
        direction=direction,
        delay_minutes=delay_minutes,
        horizon_minutes=horizon_minutes,
        take_profit_bps=take_profit_bps,
        entry_price=entry_price,
        exit_price=exit_price,
        take_profit_hit=take_profit_hit,
        return_bps=return_bps,
        notional_usd=fill.notional_usd,
    )


def _breakeven_or_horizon_exit(
    *,
    direction: str,
    entry_price: Decimal,
    candles: tuple[SmartMoneyCandle, ...],
    start_after_ms: int,
) -> Decimal:
    later = tuple(item for item in candles if item.open_time_ms > start_after_ms)
    for candle in later:
        if direction == "LONG" and candle.low <= entry_price:
            return entry_price
        if direction == "SHORT" and candle.high >= entry_price:
            return entry_price
    return candles[-1].close


def _return_bps(direction: str, entry_price: Decimal, exit_price: Decimal) -> Decimal:
    if entry_price <= 0:
        return Decimal("0")
    raw = ((exit_price - entry_price) / entry_price) * Decimal("10000")
    return raw if direction == "LONG" else -raw


def _follow_direction(fill: StoredFill) -> str | None:
    direction = fill.direction.lower()
    if "long" in direction:
        return "LONG"
    if "short" in direction:
        return "SHORT"
    if fill.side.upper() == "B":
        return "LONG"
    if fill.side.upper() == "A":
        return "SHORT"
    return None


def _parse_candle(payload: dict[str, Any]) -> SmartMoneyCandle | None:
    try:
        return SmartMoneyCandle(
            coin=str(payload.get("s") or "").upper(),
            interval=str(payload.get("i") or "1m"),
            open_time_ms=int(payload.get("t") or 0),
            close_time_ms=int(payload.get("T") or 0),
            open=_decimal(payload.get("o")),
            high=_decimal(payload.get("h")),
            low=_decimal(payload.get("l")),
            close=_decimal(payload.get("c")),
            volume=_decimal(payload.get("v")),
            trade_count=int(payload.get("n") or 0),
        )
    except (TypeError, ValueError, InvalidOperation):
        return None


def _skipped(
    fill: StoredFill,
    delay_minutes: int,
    horizon_minutes: int,
    take_profit_bps: int,
    reason: str,
) -> FollowBacktestResult:
    return FollowBacktestResult(
        fill_key=fill.fill_key,
        address=fill.address,
        wallet_label=fill.wallet_label,
        coin=fill.coin,
        source_time_ms=fill.time_ms,
        direction="UNKNOWN",
        delay_minutes=delay_minutes,
        horizon_minutes=horizon_minutes,
        take_profit_bps=take_profit_bps,
        entry_price=None,
        exit_price=None,
        take_profit_hit=False,
        return_bps=None,
        notional_usd=fill.notional_usd,
        skipped_reason=reason,
    )


def _decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))
