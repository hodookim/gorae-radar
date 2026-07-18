"""Unit tests for ``web._compute_whale_picks`` (Phase 7 backend whale picks).

These tests construct minimal ``SmartMoneyCandidate`` / ``SmartMoneyWalletSnapshot``
fixtures and assert that the Python port of the JS ``buildWhalePicks`` function
(``app.js``) reproduces the same grouping, conviction formula, filtering and
sorting behaviour.
"""

from __future__ import annotations
from decimal import Decimal

from smart_money_radar.smart_money import (
    SmartMoneyCandidate,
    SmartMoneyCandidateScoreBreakdown,
    SmartMoneyFill,
    SmartMoneyPosition,
    SmartMoneyWallet,
    SmartMoneyWalletSnapshot,
)
from smart_money_radar.web import _compute_whale_picks


def _candidate(address: str, score: float) -> SmartMoneyCandidate:
    return SmartMoneyCandidate(
        address=address,
        label=address,
        score=score,
        source="test",
        account_value=Decimal("1000"),
        day_pnl=Decimal("0"),
        week_pnl=Decimal("0"),
        month_pnl=Decimal("0"),
        all_time_pnl=Decimal("0"),
        day_roi=Decimal("0"),
        week_roi=Decimal("0"),
        month_roi=Decimal("0"),
        all_time_roi=Decimal("0"),
        day_volume=Decimal("0"),
        week_volume=Decimal("0"),
        month_volume=Decimal("0"),
        all_time_volume=Decimal("0"),
        score_breakdown=SmartMoneyCandidateScoreBreakdown(
            size=0.0, skill=0.0, consistency=0.0, activity=0.0, risk_penalty=0.0
        ),
    )


def _wallet(address: str) -> SmartMoneyWallet:
    return SmartMoneyWallet(label=address, address=address)


def _position(
    coin: str,
    side: str,
    position_value: Decimal | float,
    *,
    unrealized_pnl: Decimal | float = 0,
    roe_pct: Decimal | float | None = None,
    address: str = "0xabc",
) -> SmartMoneyPosition:
    return SmartMoneyPosition(
        wallet_label=address,
        address=address,
        coin=coin,
        side=side,
        size=Decimal("1"),
        entry_price=Decimal("1"),
        current_price=Decimal("1"),
        position_value=Decimal(str(position_value)),
        unrealized_pnl=Decimal(str(unrealized_pnl)),
        roe_pct=None if roe_pct is None else Decimal(str(roe_pct)),
    )


def _fill(
    coin: str,
    direction: str,
    notional_usd: Decimal | float,
    *,
    side: str = "B",
    address: str = "0xabc",
) -> SmartMoneyFill:
    return SmartMoneyFill(
        wallet_label=address,
        address=address,
        coin=coin,
        side=side,
        direction=direction,
        price=Decimal("1"),
        size=Decimal("1"),
        notional_usd=Decimal(str(notional_usd)),
        time_ms=1,
        closed_pnl=Decimal("0"),
        fee=Decimal("0"),
    )


def _snapshot(
    address: str,
    score: float,
    positions: tuple[SmartMoneyPosition, ...] = (),
    fills: tuple[SmartMoneyFill, ...] = (),
) -> tuple[int, SmartMoneyCandidate, SmartMoneyWalletSnapshot]:
    candidate = _candidate(address, score)
    snapshot = SmartMoneyWalletSnapshot(
        wallet=_wallet(address),
        score=score,
        verdict="OK",
        recent_fills=fills,
        open_positions=positions,
        closed_pnl_usd=Decimal("0"),
        fees_usd=Decimal("0"),
        volume_usd=Decimal("0"),
        newest_fill_ms=None,
    )
    return (1, candidate, snapshot)


# ---------------------------------------------------------------------------
# Reference JS conviction formula, kept here as the expected-value oracle so a
# future refactor cannot silently drift from app.js `buildWhalePicks`.
# ---------------------------------------------------------------------------
def _js_conviction(
    *,
    avg_score: float,
    wallet_count: int,
    position_value: float,
    fill_value: float,
    dominance: float,
    fill_count: int,
) -> float:
    pos_cap = 1_500_000.0
    fill_cap = 150_000.0
    wallet_cap = 4.0
    score_floor = 50.0
    score_ceil = 95.0
    dom_floor = 0.5
    dom_ceil = 1.0

    def clamp01(value: float) -> float:
        return 0.0 if value < 0 else (1.0 if value > 1 else value)

    s_pos = position_value / (position_value + pos_cap)
    s_fill = fill_value / (fill_value + fill_cap)
    s_wallet = min(wallet_count, wallet_cap) / wallet_cap
    s_score = (avg_score - score_floor) / (score_ceil - score_floor)
    s_dom = (dominance - dom_floor) / (dom_ceil - dom_floor)
    s_fb = min(fill_count, 3) / 3.0
    value = (
        12.0
        + 28.0 * clamp01(s_score)
        + 34.0 * clamp01(s_pos)
        + 14.0 * clamp01(s_wallet)
        + 10.0 * clamp01(s_fill)
        + 8.0 * clamp01(s_dom)
        + 6.0 * clamp01(s_fb)
    )
    return max(0.0, min(99.0, value))


def test_empty_selected_returns_empty_picks() -> None:
    assert _compute_whale_picks([]) == []


def test_position_only_below_threshold_is_filtered() -> None:
    # Zero exposure is always dropped even if the structural sub-signals exist.
    selected = [
        _snapshot("0x1", 0.0, positions=(_position("ETH", "LONG", 0),)),
    ]
    assert _compute_whale_picks(selected) == []


def test_single_long_pick_matches_js_formula() -> None:
    # Values chosen so conviction stays below the 99 clamp and the formula is
    # actually exercised end-to-end.
    selected = [
        _snapshot(
            "0x1",
            65.0,
            positions=(_position("ETH", "LONG", 100_000, roe_pct=5.0, unrealized_pnl=10),),
            fills=(_fill("ETH", "Open Long", 50_000),),
        ),
    ]

    picks = _compute_whale_picks(selected)

    assert len(picks) == 1
    pick = picks[0]
    assert pick["coin"] == "ETH"
    assert pick["side"] == "LONG"
    assert pick["walletCount"] == 1
    assert pick["positionValue"] == 100_000.0
    assert pick["fillValue"] == 50_000.0
    assert pick["fillCount"] == 1
    # Score 65 from the position + 65 from the fill -> avg 65.
    assert pick["avgScore"] == 65.0
    # Only one position contributes to the ROE weighted average.
    assert pick["avgRoe"] == 5.0
    # No SHORT side -> dominance defaults to 1.0.
    assert pick["dominance"] == 1.0
    expected = _js_conviction(
        avg_score=65.0,
        wallet_count=1,
        position_value=100_000.0,
        fill_value=50_000.0,
        dominance=1.0,
        fill_count=1,
    )
    assert pick["conviction"] == expected
    # Sanity: the conviction really is below the clamp so the oracle is real.
    assert pick["conviction"] < 99.0


def test_opposite_side_dominance_splits_correctly() -> None:
    selected = [
        _snapshot(
            "0x1",
            85.0,
            positions=(
                _position("BTC", "LONG", 100_000, roe_pct=0.0),
                _position("BTC", "SHORT", 1_000, roe_pct=0.0),
            ),
        ),
    ]
    picks = _compute_whale_picks(selected)
    by_side = {p["side"]: p for p in picks if p["coin"] == "BTC"}
    assert "LONG" in by_side and "SHORT" in by_side
    long_pick = by_side["LONG"]
    short_pick = by_side["SHORT"]
    # LONG exposure (100000) dominates SHORT (1000) -> ~0.99 vs ~0.01.
    assert long_pick["dominance"] > 0.98
    assert short_pick["dominance"] < 0.02
    assert abs(long_pick["dominance"] + short_pick["dominance"] - 1.0) < 1e-9
    assert long_pick["conviction"] > short_pick["conviction"]


def test_fills_count_triggers_bonus() -> None:
    # Three fills on the same coin/side saturates the 0..6 fill-burst subscore.
    selected = [
        _snapshot(
            "0x1",
            40.0,
            positions=(_position("SOL", "LONG", 500, roe_pct=4.0),),
            fills=(
                _fill("SOL", "Open Long", 50),
                _fill("SOL", "Open Long", 50),
                _fill("SOL", "Open Long", 50),
            ),
        ),
    ]
    picks = _compute_whale_picks(selected)
    assert len(picks) == 1
    expected = _js_conviction(
        avg_score=40.0,
        wallet_count=1,
        position_value=500.0,
        fill_value=150.0,
        dominance=1.0,
        fill_count=3,
    )
    assert picks[0]["conviction"] == expected
    # Fill-burst scales linearly up to three fills, so 3 fills vs 2 fills is +2.
    expected_without_bonus = _js_conviction(
        avg_score=40.0,
        wallet_count=1,
        position_value=500.0,
        fill_value=150.0,
        dominance=1.0,
        fill_count=2,
    )
    assert picks[0]["conviction"] - expected_without_bonus == 2.0
    assert picks[0]["conviction"] > 26.0


def test_fill_direction_close_is_skipped() -> None:
    selected = [
        _snapshot(
            "0x1",
            50.0,
            positions=(_position("ETH", "LONG", 100_000, roe_pct=4.0),),
            fills=(
                _fill("ETH", "Close Long", 100_000),  # must be ignored
                _fill("ETH", "Open Long", 50),
            ),
        ),
    ]
    picks = _compute_whale_picks(selected)
    assert len(picks) == 1
    assert picks[0]["fillCount"] == 1
    assert picks[0]["fillValue"] == 50.0


def test_fill_side_inference_from_direction_and_side_code() -> None:
    # direction missing long/short cues falls back to fill.side code (A=SHORT).
    selected = [
        _snapshot(
            "0x1",
            70.0,
            positions=(),
            fills=(
                _fill("HYPE", "Buy", 50_000, side="A"),  # -> SHORT
                _fill("HYPE", "Sell", 50_000, side="B"),  # -> LONG
            ),
        ),
    ]
    picks = _compute_whale_picks(selected)
    coinsides = {(pick["coin"], pick["side"]) for pick in picks}
    assert ("HYPE", "LONG") in coinsides
    assert ("HYPE", "SHORT") in coinsides


def test_multiple_wallets_aggregate_into_wallet_count() -> None:
    selected = [
        _snapshot("0x1", 50.0, positions=(_position("ETH", "LONG", 200),)),
        _snapshot("0x2", 50.0, positions=(_position("ETH", "LONG", 200),)),
        _snapshot("0x3", 50.0, positions=(_position("ETH", "LONG", 200),)),
    ]
    picks = _compute_whale_picks(selected)
    eth_long = next(p for p in picks if p["coin"] == "ETH" and p["side"] == "LONG")
    assert eth_long["walletCount"] == 3
    assert eth_long["positionValue"] == 600.0


def test_picks_sorted_by_conviction_descending() -> None:
    # ETH collects two wallets (extra +13) while BTC only one, so ETH must rank
    # first. Values are kept small so neither conviction hits the 99 clamp.
    selected = [
        _snapshot("0x1", 50.0, positions=(_position("ETH", "LONG", 5_000, roe_pct=5.0),)),
        _snapshot("0x2", 50.0, positions=(_position("BTC", "LONG", 5_000, roe_pct=5.0),)),
        _snapshot("0x3", 50.0, positions=(_position("ETH", "LONG", 5_000, roe_pct=5.0),)),
    ]
    picks = _compute_whale_picks(selected)
    convictions = [pick["conviction"] for pick in picks]
    assert convictions == sorted(convictions, reverse=True)
    assert picks[0]["coin"] == "ETH"
    assert picks[0]["walletCount"] == 2
    # Sanity: neither side is clamped, so the ordering is a real formula result.
    assert all(c < 99.0 for c in convictions)


def test_conviction_clamped_to_99() -> None:
    # A huge position with a high score would mathematically exceed 99; the
    # clamp must match JS ``Math.max(0, Math.min(99, ...))``.
    selected = [
        _snapshot(
            "0x1",
            100.0,
            positions=(_position("ETH", "LONG", Decimal("1e12"), roe_pct=500.0),),
            fills=(
                _fill("ETH", "Open Long", Decimal("1e12")),
                _fill("ETH", "Open Long", Decimal("1e12")),
                _fill("ETH", "Open Long", Decimal("1e12")),
            ),
        ),
    ]
    picks = _compute_whale_picks(selected)
    assert picks[0]["conviction"] == 99.0


def test_invalid_position_side_is_ignored() -> None:
    selected = [
        _snapshot(
            "0x1",
            50.0,
            positions=(
                _position("ETH", "", 50_000),  # blank side -> dropped
                _position("", "LONG", 50_000),  # blank coin -> dropped
                _position("ETH", "FLAT", 50_000),  # neither LONG nor SHORT -> dropped
                    _position("ETH", "LONG", 150_000, roe_pct=10.0),  # valid
            ),
        ),
    ]
    picks = _compute_whale_picks(selected)
    assert len(picks) == 1
    assert picks[0]["positionValue"] == 150_000.0
