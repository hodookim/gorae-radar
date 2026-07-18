from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx


HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info"
HYPERLIQUID_STATS_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
DEFAULT_SMART_MONEY_WATCHLIST = Path("data/smart_money_watchlist.json")
DEFAULT_SMART_MONEY_WATCHLIST_EXAMPLE = Path("data/smart_money_watchlist.example.json")


@dataclass(frozen=True)
class SmartMoneyWallet:
    label: str
    address: str
    tags: tuple[str, ...] = ()
    weight: float = 1.0
    enabled: bool = True
    notes: str = ""

    @property
    def short_address(self) -> str:
        if len(self.address) <= 14:
            return self.address
        return f"{self.address[:8]}...{self.address[-6:]}"


@dataclass(frozen=True)
class SmartMoneyFill:
    wallet_label: str
    address: str
    coin: str
    side: str
    direction: str
    price: Decimal
    size: Decimal
    notional_usd: Decimal
    time_ms: int
    closed_pnl: Decimal
    fee: Decimal

    @property
    def age_minutes(self) -> float:
        return max(0.0, (time.time() * 1000 - self.time_ms) / 60_000)


@dataclass(frozen=True)
class SmartMoneyPosition:
    wallet_label: str
    address: str
    coin: str
    side: str
    size: Decimal
    entry_price: Decimal
    current_price: Decimal
    position_value: Decimal
    unrealized_pnl: Decimal
    roe_pct: Decimal | None = None
    liquidation_price: Decimal | None = None
    margin_used: Decimal | None = None
    leverage: Decimal | None = None


@dataclass(frozen=True)
class SmartMoneyCandle:
    coin: str
    interval: str
    open_time_ms: int
    close_time_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    trade_count: int


@dataclass(frozen=True)
class SmartMoneyWalletSnapshot:
    wallet: SmartMoneyWallet
    score: float
    verdict: str
    recent_fills: tuple[SmartMoneyFill, ...]
    open_positions: tuple[SmartMoneyPosition, ...]
    closed_pnl_usd: Decimal
    fees_usd: Decimal
    volume_usd: Decimal
    newest_fill_ms: int | None
    error: str | None = None

    @property
    def newest_fill_age_minutes(self) -> float | None:
        if self.newest_fill_ms is None:
            return None
        return max(0.0, (time.time() * 1000 - self.newest_fill_ms) / 60_000)


@dataclass(frozen=True)
class SmartMoneyCandidateScoreBreakdown:
    size: float
    skill: float
    consistency: float
    activity: float
    risk_penalty: float


@dataclass(frozen=True)
class SmartMoneyCandidate:
    address: str
    label: str
    score: float
    source: str
    account_value: Decimal
    day_pnl: Decimal
    week_pnl: Decimal
    month_pnl: Decimal
    all_time_pnl: Decimal
    day_roi: Decimal
    week_roi: Decimal
    month_roi: Decimal
    all_time_roi: Decimal
    day_volume: Decimal
    week_volume: Decimal
    month_volume: Decimal
    all_time_volume: Decimal
    score_breakdown: SmartMoneyCandidateScoreBreakdown
    labels: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()

    @property
    def short_address(self) -> str:
        if len(self.address) <= 14:
            return self.address
        return f"{self.address[:8]}...{self.address[-6:]}"


class HyperliquidInfoClient:
    """Read-only Hyperliquid public info client.

    Uses only the public `/info` endpoint. No signing, exchange action, or API key
    is involved.
    """

    def __init__(
        self,
        *,
        client: httpx.Client | None = None,
        timeout_seconds: float = 15.0,
    ) -> None:
        self._client = client or httpx.Client(
            timeout=timeout_seconds,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "ai-trading-smart-money/0.1",
            },
        )
        self._owns_client = client is None

    def __enter__(self) -> "HyperliquidInfoClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def info(self, payload: dict[str, Any]) -> Any:
        response = self._client.post(HYPERLIQUID_INFO_URL, json=payload)
        response.raise_for_status()
        return response.json()

    def user_fills_by_time(
        self,
        address: str,
        *,
        start_time_ms: int,
        end_time_ms: int | None = None,
        aggregate_by_time: bool = True,
    ) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "type": "userFillsByTime",
            "user": address,
            "startTime": start_time_ms,
            "aggregateByTime": aggregate_by_time,
        }
        if end_time_ms is not None:
            payload["endTime"] = end_time_ms
        result = self.info(payload)
        return result if isinstance(result, list) else []

    def clearinghouse_state(self, address: str) -> dict[str, Any]:
        result = self.info({"type": "clearinghouseState", "user": address})
        return result if isinstance(result, dict) else {}

    def candle_snapshot(
        self,
        *,
        coin: str,
        interval: str,
        start_time_ms: int,
        end_time_ms: int,
    ) -> list[dict[str, Any]]:
        result = self.info(
            {
                "type": "candleSnapshot",
                "req": {
                    "coin": coin,
                    "interval": interval,
                    "startTime": start_time_ms,
                    "endTime": end_time_ms,
                },
            }
        )
        return result if isinstance(result, list) else []


def load_smart_money_watchlist(
    path: Path = DEFAULT_SMART_MONEY_WATCHLIST,
) -> tuple[SmartMoneyWallet, ...]:
    source = path
    if not source.exists() and DEFAULT_SMART_MONEY_WATCHLIST_EXAMPLE.exists():
        source = DEFAULT_SMART_MONEY_WATCHLIST_EXAMPLE
    if not source.exists():
        return ()
    payload = json.loads(source.read_text(encoding="utf-8"))
    wallets = payload.get("wallets", payload if isinstance(payload, list) else [])
    parsed: list[SmartMoneyWallet] = []
    for item in wallets:
        if not isinstance(item, dict):
            continue
        address = str(item.get("address", "")).strip()
        if not _looks_like_eth_address(address):
            continue
        parsed.append(
            SmartMoneyWallet(
                label=str(item.get("label") or address[:10]),
                address=address.lower(),
                tags=tuple(str(tag) for tag in item.get("tags", []) if str(tag)),
                weight=float(item.get("weight", 1.0) or 1.0),
                enabled=bool(item.get("enabled", True)),
                notes=str(item.get("notes", "")),
            )
        )
    return tuple(parsed)


def save_smart_money_watchlist(
    wallets: tuple[SmartMoneyWallet, ...],
    path: Path = DEFAULT_SMART_MONEY_WATCHLIST,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "wallets": [
            {
                "label": wallet.label,
                "address": wallet.address,
                "enabled": wallet.enabled,
                "tags": list(wallet.tags),
                "weight": wallet.weight,
                "notes": wallet.notes,
            }
            for wallet in wallets
        ]
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def upsert_smart_money_wallet(
    wallet: SmartMoneyWallet,
    path: Path = DEFAULT_SMART_MONEY_WATCHLIST,
) -> tuple[SmartMoneyWallet, ...]:
    wallets = list(load_smart_money_watchlist(path))
    existing = {item.address.lower(): idx for idx, item in enumerate(wallets)}
    normalized = SmartMoneyWallet(
        label=wallet.label,
        address=wallet.address.lower(),
        tags=wallet.tags,
        weight=wallet.weight,
        enabled=wallet.enabled,
        notes=wallet.notes,
    )
    idx = existing.get(normalized.address)
    if idx is None:
        wallets.append(normalized)
    else:
        wallets[idx] = normalized
    result = tuple(wallets)
    save_smart_money_watchlist(result, path)
    return result


def write_default_smart_money_watchlist(
    path: Path = DEFAULT_SMART_MONEY_WATCHLIST,
) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "wallets": [
                    {
                        "label": "example-disabled",
                        "address": "0x0000000000000000000000000000000000000000",
                        "enabled": False,
                        "tags": ["example"],
                        "weight": 1.0,
                        "notes": "Replace with a public Hyperliquid wallet address.",
                    }
                ]
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def fetch_smart_money_snapshots(
    *,
    client: HyperliquidInfoClient,
    wallets: tuple[SmartMoneyWallet, ...],
    lookback_hours: float = 24.0,
) -> tuple[SmartMoneyWalletSnapshot, ...]:
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - int(max(1.0, lookback_hours) * 60 * 60 * 1000)
    snapshots: list[SmartMoneyWalletSnapshot] = []
    for wallet in wallets:
        if not wallet.enabled:
            snapshots.append(
                SmartMoneyWalletSnapshot(
                    wallet=wallet,
                    score=0.0,
                    verdict="DISABLED",
                    recent_fills=(),
                    open_positions=(),
                    closed_pnl_usd=Decimal("0"),
                    fees_usd=Decimal("0"),
                    volume_usd=Decimal("0"),
                    newest_fill_ms=None,
                )
            )
            continue
        try:
            raw_fills = client.user_fills_by_time(
                wallet.address,
                start_time_ms=start_ms,
                end_time_ms=now_ms,
            )
            raw_state = client.clearinghouse_state(wallet.address)
            fills = tuple(_parse_fill(wallet, item) for item in raw_fills)
            fills = tuple(fill for fill in fills if fill is not None)
            positions = tuple(_parse_positions(wallet, raw_state))
            snapshots.append(_score_wallet_snapshot(wallet, fills, positions))
        except Exception as exc:
            snapshots.append(
                SmartMoneyWalletSnapshot(
                    wallet=wallet,
                    score=0.0,
                    verdict="ERROR",
                    recent_fills=(),
                    open_positions=(),
                    closed_pnl_usd=Decimal("0"),
                    fees_usd=Decimal("0"),
                    volume_usd=Decimal("0"),
                    newest_fill_ms=None,
                    error=f"{type(exc).__name__}: {exc}",
                )
            )
    return tuple(sorted(snapshots, key=lambda item: item.score, reverse=True))


def fetch_leaderboard_candidates(
    *,
    client: httpx.Client | None = None,
    limit: int = 100,
    min_score: float = 45.0,
    min_account_value: Decimal = Decimal("10000"),
) -> tuple[SmartMoneyCandidate, ...]:
    owned_client = client is None
    http_client = client or httpx.Client(
        timeout=20.0,
        headers={"User-Agent": "ai-trading-smart-money/0.1"},
    )
    try:
        response = http_client.get(HYPERLIQUID_STATS_LEADERBOARD_URL)
        response.raise_for_status()
        payload = response.json()
    finally:
        if owned_client:
            http_client.close()
    rows = payload.get("leaderboardRows", []) if isinstance(payload, dict) else []
    candidates: list[SmartMoneyCandidate] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        candidate = _parse_leaderboard_row(row)
        if candidate is None:
            continue
        if candidate.account_value < min_account_value:
            continue
        if candidate.score < min_score:
            continue
        candidates.append(candidate)
    candidates.sort(key=lambda item: item.score, reverse=True)
    return tuple(candidates[: max(1, limit)])


def _parse_fill(
    wallet: SmartMoneyWallet,
    payload: dict[str, Any],
) -> SmartMoneyFill | None:
    try:
        coin = str(payload.get("coin") or "").upper()
        side = str(payload.get("side") or "")
        direction = str(payload.get("dir") or "")
        price = _decimal(payload.get("px"))
        size = _decimal(payload.get("sz"))
        closed_pnl = _decimal(payload.get("closedPnl"))
        fee = _decimal(payload.get("fee"))
        time_ms = int(payload.get("time") or 0)
    except (TypeError, ValueError, InvalidOperation):
        return None
    if not coin or price <= 0 or size <= 0 or time_ms <= 0:
        return None
    return SmartMoneyFill(
        wallet_label=wallet.label,
        address=wallet.address,
        coin=coin,
        side=side,
        direction=direction,
        price=price,
        size=size,
        notional_usd=(price * size).copy_abs(),
        time_ms=time_ms,
        closed_pnl=closed_pnl,
        fee=fee,
    )


def _parse_positions(
    wallet: SmartMoneyWallet,
    payload: dict[str, Any],
) -> list[SmartMoneyPosition]:
    positions: list[SmartMoneyPosition] = []
    for item in payload.get("assetPositions", []) or []:
        if not isinstance(item, dict):
            continue
        position = item.get("position") or item
        if not isinstance(position, dict):
            continue
        try:
            coin = str(position.get("coin") or "").upper()
            size = _decimal(position.get("szi"))
            entry = _decimal(position.get("entryPx"))
            value = _decimal(position.get("positionValue"))
            current = value.copy_abs() / size.copy_abs() if size != 0 else Decimal("0")
            unrealized = _decimal(position.get("unrealizedPnl"))
            roe = position.get("returnOnEquity")
            roe_pct = _decimal(roe) * Decimal("100") if roe is not None else None
            liquidation = _optional_decimal(position.get("liquidationPx"))
            margin_used = _optional_decimal(position.get("marginUsed"))
            leverage_payload = position.get("leverage")
            leverage = None
            if isinstance(leverage_payload, dict):
                leverage = _optional_decimal(leverage_payload.get("value"))
        except (TypeError, ValueError, InvalidOperation):
            continue
        if not coin or size == 0:
            continue
        positions.append(
            SmartMoneyPosition(
                wallet_label=wallet.label,
                address=wallet.address,
                coin=coin,
                side="LONG" if size > 0 else "SHORT",
                size=size,
                entry_price=entry,
                current_price=current,
                position_value=value.copy_abs(),
                unrealized_pnl=unrealized,
                roe_pct=roe_pct,
                liquidation_price=liquidation,
                margin_used=margin_used,
                leverage=leverage,
            )
        )
    return positions


def _parse_leaderboard_row(row: dict[str, Any]) -> SmartMoneyCandidate | None:
    address = str(row.get("ethAddress") or "").lower()
    if not _looks_like_eth_address(address):
        return None
    label = str(row.get("displayName") or address[:10])
    performances = _leaderboard_performances(row.get("windowPerformances"))
    day = performances.get("day", {})
    week = performances.get("week", {})
    month = performances.get("month", {})
    all_time = performances.get("allTime", {})
    account_value = _decimal(row.get("accountValue"))
    day_pnl = _decimal(day.get("pnl"))
    week_pnl = _decimal(week.get("pnl"))
    month_pnl = _decimal(month.get("pnl"))
    all_time_pnl = _decimal(all_time.get("pnl"))
    day_roi = _decimal(day.get("roi"))
    week_roi = _decimal(week.get("roi"))
    month_roi = _decimal(month.get("roi"))
    all_time_roi = _decimal(all_time.get("roi"))
    day_volume = _decimal(day.get("vlm"))
    week_volume = _decimal(week.get("vlm"))
    month_volume = _decimal(month.get("vlm"))
    all_time_volume = _decimal(all_time.get("vlm"))
    score, breakdown, labels, reasons = _score_leaderboard_candidate(
        account_value=account_value,
        day_pnl=day_pnl,
        week_pnl=week_pnl,
        month_pnl=month_pnl,
        all_time_pnl=all_time_pnl,
        day_roi=day_roi,
        week_roi=week_roi,
        month_roi=month_roi,
        all_time_roi=all_time_roi,
        day_volume=day_volume,
        week_volume=week_volume,
        month_volume=month_volume,
    )
    return SmartMoneyCandidate(
        address=address,
        label=label,
        score=score,
        source="hyperliquid_stats_leaderboard",
        account_value=account_value,
        day_pnl=day_pnl,
        week_pnl=week_pnl,
        month_pnl=month_pnl,
        all_time_pnl=all_time_pnl,
        day_roi=day_roi,
        week_roi=week_roi,
        month_roi=month_roi,
        all_time_roi=all_time_roi,
        day_volume=day_volume,
        week_volume=week_volume,
        month_volume=month_volume,
        all_time_volume=all_time_volume,
        score_breakdown=breakdown,
        labels=tuple(labels),
        reasons=tuple(reasons),
    )


def _leaderboard_performances(value: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(value, list):
        return result
    for item in value:
        if (
            isinstance(item, list)
            and len(item) == 2
            and isinstance(item[0], str)
            and isinstance(item[1], dict)
        ):
            result[item[0]] = item[1]
    return result


def _score_leaderboard_candidate(
    *,
    account_value: Decimal,
    day_pnl: Decimal,
    week_pnl: Decimal,
    month_pnl: Decimal,
    all_time_pnl: Decimal,
    day_roi: Decimal,
    week_roi: Decimal,
    month_roi: Decimal,
    all_time_roi: Decimal,
    day_volume: Decimal,
    week_volume: Decimal,
    month_volume: Decimal,
) -> tuple[float, SmartMoneyCandidateScoreBreakdown, list[str], list[str]]:
    reasons: list[str] = []
    labels: list[str] = []

    size_score = 0.0
    if account_value >= Decimal("100000"):
        size_score += 6
        reasons.append("account_value_100k")
    elif account_value >= Decimal("10000"):
        size_score += 3
        reasons.append("account_value_10k")
    if account_value >= Decimal("1000000"):
        size_score += 5
        labels.append("large_account")
    if account_value >= Decimal("10000000"):
        size_score += 4
        labels.append("mega_whale")

    skill_score = 0.0
    if day_pnl > 0:
        skill_score += min(5.0, float(day_pnl / Decimal("10000")))
        reasons.append("day_pnl_positive")
    if week_pnl > 0:
        skill_score += min(10.0, float(week_pnl / Decimal("50000")))
        reasons.append("week_pnl_positive")
    if month_pnl > 0:
        skill_score += min(12.0, float(month_pnl / Decimal("100000")))
        reasons.append("month_pnl_positive")
    if all_time_pnl > 0:
        skill_score += min(8.0, float(all_time_pnl / Decimal("500000")))
        reasons.append("all_time_pnl_positive")
    if day_roi > 0:
        skill_score += min(2.0, float(day_roi * Decimal("20")))
    if week_roi > 0:
        skill_score += min(3.0, float(week_roi * Decimal("15")))
    if month_roi > 0:
        skill_score += min(4.0, float(month_roi * Decimal("10")))
    if all_time_roi > 0:
        skill_score += min(3.0, float(all_time_roi * Decimal("3")))

    positive_windows = sum(1 for value in (day_pnl, week_pnl, month_pnl, all_time_pnl) if value > 0)
    consistency_score = min(12.0, positive_windows * 3.0)
    if day_pnl > 0 and week_pnl > 0 and month_pnl > 0:
        consistency_score += 4
        labels.append("recently_consistent")
        reasons.append("recent_pnl_consistent")
    if month_pnl > 0 and all_time_pnl > 0:
        consistency_score += 4
        labels.append("profitable_trader")

    activity_score = 0.0
    if day_volume >= Decimal("100000"):
        activity_score += 2
    if day_volume >= Decimal("1000000"):
        activity_score += 3
        reasons.append("day_volume_1m")
        labels.append("active_today")
    if week_volume >= Decimal("1000000"):
        activity_score += 3
    if week_volume >= Decimal("5000000"):
        activity_score += 3
        reasons.append("week_volume_5m")
    if month_volume >= Decimal("10000000"):
        activity_score += 4
        reasons.append("month_volume_10m")
        labels.append("high_volume")

    risk_penalty = 0.0
    if month_pnl < 0 and week_pnl < 0:
        risk_penalty += 18
        reasons.append("recent_pnl_negative")
    if day_pnl < 0 and week_pnl < 0 and month_pnl > 0:
        risk_penalty += 10
        reasons.append("short_term_cooling")
        labels.append("cooling")
    if month_roi < 0:
        risk_penalty += 6
    if positive_windows <= 1 and all_time_pnl > 0:
        risk_penalty += 8
        labels.append("unstable_recently")

    if activity_score >= 8 and skill_score < 8:
        labels.append("high_volume_low_edge")
    if not labels:
        labels.append("smart_money_candidate")

    breakdown = SmartMoneyCandidateScoreBreakdown(
        size=round(min(20.0, size_score), 2),
        skill=round(min(40.0, skill_score), 2),
        consistency=round(min(20.0, consistency_score), 2),
        activity=round(min(15.0, activity_score), 2),
        risk_penalty=round(min(30.0, risk_penalty), 2),
    )
    score = (
        breakdown.size
        + breakdown.skill
        + breakdown.consistency
        + breakdown.activity
        - breakdown.risk_penalty
    )
    return max(0.0, min(100.0, round(score, 2))), breakdown, labels, reasons


def _score_wallet_snapshot(
    wallet: SmartMoneyWallet,
    fills: tuple[SmartMoneyFill, ...],
    positions: tuple[SmartMoneyPosition, ...],
) -> SmartMoneyWalletSnapshot:
    closed_pnl = sum((fill.closed_pnl for fill in fills), Decimal("0"))
    fees = sum((fill.fee for fill in fills), Decimal("0"))
    volume = sum((fill.notional_usd for fill in fills), Decimal("0"))
    newest_ms = max((fill.time_ms for fill in fills), default=None)
    fill_count = len(fills)
    active_position_count = len(positions)

    score = 0.0
    score += min(25.0, fill_count * 2.5)
    score += min(25.0, float(volume / Decimal("10000")))
    score += min(30.0, max(-20.0, float(closed_pnl / Decimal("100"))))
    score += min(15.0, active_position_count * 5.0)
    if newest_ms is not None:
        age_min = max(0.0, (time.time() * 1000 - newest_ms) / 60_000)
        if age_min <= 15:
            score += 15
        elif age_min <= 60:
            score += 8
        elif age_min <= 240:
            score += 3
    score *= max(0.1, wallet.weight)
    score = max(0.0, min(100.0, score))

    if score >= 75:
        verdict = "HOT"
    elif score >= 50:
        verdict = "WATCH"
    elif score > 0:
        verdict = "COLD"
    else:
        verdict = "NO_DATA"

    return SmartMoneyWalletSnapshot(
        wallet=wallet,
        score=score,
        verdict=verdict,
        recent_fills=tuple(sorted(fills, key=lambda item: item.time_ms, reverse=True)),
        open_positions=positions,
        closed_pnl_usd=closed_pnl,
        fees_usd=fees,
        volume_usd=volume,
        newest_fill_ms=newest_ms,
    )


def _decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _optional_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    return Decimal(str(value))


def _looks_like_eth_address(value: str) -> bool:
    if len(value) != 42 or not value.startswith("0x"):
        return False
    try:
        int(value[2:], 16)
    except ValueError:
        return False
    return True


def format_utc_ms(ms: int | None) -> str:
    if ms is None:
        return "-"
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%m-%d %H:%M")
