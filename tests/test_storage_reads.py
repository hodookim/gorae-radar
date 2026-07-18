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
from smart_money_radar.storage import (
    load_candidate_history,
    load_coin_flow,
    load_fills,
    load_position_history,
    load_snapshot_history,
    save_candidate_observations,
    save_wallet_snapshots,
)

ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OTHER_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"


def _candidate(address: str, *, score: float, account_value: Decimal) -> SmartMoneyCandidate:
    return SmartMoneyCandidate(
        address=address,
        label=f"label-{address[:6]}",
        score=score,
        source="test",
        account_value=account_value,
        day_pnl=Decimal("1"),
        week_pnl=Decimal("2"),
        month_pnl=Decimal("3"),
        all_time_pnl=Decimal("4"),
        day_roi=Decimal("0.01"),
        week_roi=Decimal("0.02"),
        month_roi=Decimal("0.03"),
        all_time_roi=Decimal("0.04"),
        day_volume=Decimal("10"),
        week_volume=Decimal("20"),
        month_volume=Decimal("30"),
        all_time_volume=Decimal("40"),
        score_breakdown=SmartMoneyCandidateScoreBreakdown(
            size=1.0,
            skill=2.0,
            consistency=3.0,
            activity=4.0,
            risk_penalty=0.5,
        ),
        labels=("mega_whale",),
        reasons=("reason one",),
    )


def _snapshot(
    address: str,
    *,
    score: float,
    fills: tuple[SmartMoneyFill, ...] = (),
    positions: tuple[SmartMoneyPosition, ...] = (),
    closed_pnl_usd: Decimal = Decimal("100"),
    volume_usd: Decimal = Decimal("500"),
    fees_usd: Decimal = Decimal("2"),
) -> SmartMoneyWalletSnapshot:
    return SmartMoneyWalletSnapshot(
        wallet=SmartMoneyWallet(label="alpha", address=address),
        score=score,
        verdict="OK",
        recent_fills=fills,
        open_positions=positions,
        closed_pnl_usd=closed_pnl_usd,
        fees_usd=fees_usd,
        volume_usd=volume_usd,
        newest_fill_ms=fills[0].time_ms if fills else None,
        error=None,
    )


def _fill(
    address: str,
    *,
    coin: str,
    direction: str,
    time_ms: int,
    notional_usd: Decimal = Decimal("1000"),
    side: str = "B",
) -> SmartMoneyFill:
    return SmartMoneyFill(
        wallet_label="alpha",
        address=address,
        coin=coin,
        side=side,
        direction=direction,
        price=Decimal("25"),
        size=Decimal("10"),
        notional_usd=notional_usd,
        time_ms=time_ms,
        closed_pnl=Decimal("0"),
        fee=Decimal("1"),
    )


def _position(
    address: str,
    *,
    coin: str,
    side: str,
    position_value: Decimal,
    roe_pct: Decimal | None = Decimal("0.5"),
) -> SmartMoneyPosition:
    return SmartMoneyPosition(
        wallet_label="alpha",
        address=address,
        coin=coin,
        side=side,
        size=Decimal("10"),
        entry_price=Decimal("25"),
        current_price=Decimal("26"),
        position_value=position_value,
        unrealized_pnl=Decimal("10"),
        roe_pct=roe_pct,
    )


def test_load_candidate_history_orders_oldest_first_and_maps_fields(tmp_path) -> None:
    db_path = tmp_path / "radar.sqlite3"
    save_candidate_observations(
        (_candidate(ADDRESS, score=70.0, account_value=Decimal("1000")),),
        path=db_path,
        observed_at_ms=300,
    )
    save_candidate_observations(
        (_candidate(ADDRESS, score=85.0, account_value=Decimal("2000")),),
        path=db_path,
        observed_at_ms=100,
    )

    rows = load_candidate_history(ADDRESS, path=db_path)
    assert [row["observed_at_ms"] for row in rows] == [100, 300]
    first = rows[0]
    assert first["address"] == ADDRESS
    assert first["score"] == 85.0
    assert first["account_value"] == 2000.0
    assert first["month_pnl"] == 3.0
    assert first["month_roi"] == 0.03
    assert first["label"].startswith("label-")
    assert first["score_breakdown"] == {
        "size": 1.0,
        "skill": 2.0,
        "consistency": 3.0,
        "activity": 4.0,
        "risk_penalty": 0.5,
    }
    assert first["labels"] == ["mega_whale"]
    assert first["reasons"] == ["reason one"]


def test_load_candidate_history_normalizes_address_and_empty(tmp_path) -> None:
    db_path = tmp_path / "radar.sqlite3"
    save_candidate_observations(
        (_candidate(ADDRESS, score=70.0, account_value=Decimal("1000")),),
        path=db_path,
        observed_at_ms=1,
    )
    upper = load_candidate_history(ADDRESS.upper(), path=db_path)
    assert len(upper) == 1
    missing = load_candidate_history(OTHER_ADDRESS, path=db_path)
    assert missing == []


def test_load_snapshot_history_orders_and_maps_fields(tmp_path) -> None:
    db_path = tmp_path / "radar.sqlite3"
    save_wallet_snapshots(
        (_snapshot(ADDRESS, score=50.0),),
        path=db_path,
        observed_at_ms=200,
    )
    save_wallet_snapshots(
        (_snapshot(ADDRESS, score=80.0, closed_pnl_usd=Decimal("333")),),
        path=db_path,
        observed_at_ms=400,
    )

    rows = load_snapshot_history(ADDRESS, path=db_path)
    assert [row["observed_at_ms"] for row in rows] == [200, 400]
    latest = rows[-1]
    assert latest["address"] == ADDRESS
    assert latest["score"] == 80.0
    assert latest["verdict"] == "OK"
    assert latest["closed_pnl_usd"] == 333.0
    assert latest["volume_usd"] == 500.0
    assert latest["fees_usd"] == 2.0
    assert latest["error"] is None
    assert load_snapshot_history(OTHER_ADDRESS, path=db_path) == []


def test_load_fills_filters_and_orders_newest_first(tmp_path) -> None:
    db_path = tmp_path / "radar.sqlite3"
    save_wallet_snapshots(
        (
            _snapshot(
                ADDRESS,
                score=60.0,
                fills=(
                    _fill(ADDRESS, coin="HYPE", direction="Open Long", time_ms=1_000),
                    _fill(ADDRESS, coin="ETH", direction="Open Short", time_ms=2_000),
                    _fill(OTHER_ADDRESS, coin="HYPE", direction="Open Long", time_ms=3_000),
                ),
            ),
        ),
        path=db_path,
        observed_at_ms=5,
    )

    by_address = load_fills(address=ADDRESS, path=db_path)
    assert [row["time_ms"] for row in by_address] == [2_000, 1_000]
    assert all(row["address"] == ADDRESS for row in by_address)
    first = by_address[0]
    assert first["coin"] == "ETH"
    assert first["direction"] == "Open Short"
    assert first["notional_usd"] == 1000.0
    assert first["side"] == "B"

    by_coin = load_fills(coin="HYPE", path=db_path)
    assert {row["address"] for row in by_coin} == {ADDRESS, OTHER_ADDRESS}
    assert [row["time_ms"] for row in by_coin] == [3_000, 1_000]

    since = load_fills(since_ms=1_500, path=db_path)
    assert {row["time_ms"] for row in since} == {2_000, 3_000}

    assert load_fills(address=OTHER_ADDRESS, coin="ETH", path=db_path) == []


def test_load_position_history_orders_newest_first(tmp_path) -> None:
    db_path = tmp_path / "radar.sqlite3"
    save_wallet_snapshots(
        (
            _snapshot(
                ADDRESS,
                score=60.0,
                positions=(_position(ADDRESS, coin="HYPE", side="LONG", position_value=Decimal("100")),),
            ),
        ),
        path=db_path,
        observed_at_ms=100,
    )
    save_wallet_snapshots(
        (
            _snapshot(
                ADDRESS,
                score=90.0,
                positions=(
                    _position(
                        ADDRESS,
                        coin="HYPE",
                        side="LONG",
                        position_value=Decimal("250"),
                        roe_pct=Decimal("1.25"),
                    ),
                ),
            ),
        ),
        path=db_path,
        observed_at_ms=200,
    )

    rows = load_position_history(ADDRESS, path=db_path)
    assert [row["observed_at_ms"] for row in rows] == [200, 100]
    latest = rows[0]
    assert latest["coin"] == "HYPE"
    assert latest["side"] == "LONG"
    assert latest["position_value"] == 250.0
    assert latest["roe_pct"] == 1.25
    assert latest["entry_price"] == 25.0
    assert latest["unrealized_pnl"] == 10.0
    assert load_position_history(OTHER_ADDRESS, path=db_path) == []


def test_load_coin_flow_aggregates_and_filters_by_since(tmp_path) -> None:
    db_path = tmp_path / "radar.sqlite3"
    save_wallet_snapshots(
        (
            _snapshot(
                ADDRESS,
                score=80.0,
                fills=(
                    _fill(
                        ADDRESS,
                        coin="HYPE",
                        direction="Open Long",
                        time_ms=10_000,
                        notional_usd=Decimal("500"),
                    ),
                ),
                positions=(
                    _position(
                        ADDRESS,
                        coin="HYPE",
                        side="LONG",
                        position_value=Decimal("2000"),
                        roe_pct=Decimal("0.5"),
                    ),
                    _position(
                        ADDRESS,
                        coin="ETH",
                        side="SHORT",
                        position_value=Decimal("800"),
                        roe_pct=Decimal("-0.2"),
                    ),
                ),
            ),
        ),
        path=db_path,
        observed_at_ms=1_000,
    )

    flow = load_coin_flow(since_ms=0, path=db_path)
    by_key = {(row["coin"], row["side"]): row for row in flow}
    assert set(by_key) == {("HYPE", "LONG"), ("ETH", "SHORT")}
    hype = by_key[("HYPE", "LONG")]
    assert hype["position_usd"] == 2000.0
    assert hype["fill_usd"] == 500.0
    assert hype["wallet_count"] == 1
    assert hype["avg_roe"] == 0.5
    assert hype["avg_score"] == 80.0
    assert hype["conviction"] == 2000.0 * 80.0
    eth = by_key[("ETH", "SHORT")]
    assert eth["fill_usd"] == 0.0

    # since_ms between the snapshot batch and the fill: only the fill survives.
    fill_only = load_coin_flow(since_ms=5_000, path=db_path)
    assert len(fill_only) == 1
    assert fill_only[0]["coin"] == "HYPE"
    assert fill_only[0]["side"] == "LONG"
    assert fill_only[0]["position_usd"] == 0.0
    assert fill_only[0]["fill_usd"] == 500.0
    # since_ms after both the snapshot batch and the fills excludes everything.
    assert load_coin_flow(since_ms=20_000, path=db_path) == []
    # Empty DB still returns an empty list cleanly.
    fresh = tmp_path / "fresh.sqlite3"
    assert load_coin_flow(since_ms=0, path=fresh) == []


def test_load_coin_flow_dedupes_repeated_snapshots(tmp_path) -> None:
    db_path = tmp_path / "radar.sqlite3"
    save_wallet_snapshots(
        (
            _snapshot(
                ADDRESS,
                score=80.0,
                positions=(
                    _position(ADDRESS, coin="HYPE", side="LONG", position_value=Decimal("1000")),
                ),
            ),
        ),
        path=db_path,
        observed_at_ms=1_000,
    )
    save_wallet_snapshots(
        (
            _snapshot(
                ADDRESS,
                score=90.0,
                positions=(
                    _position(ADDRESS, coin="HYPE", side="LONG", position_value=Decimal("3000")),
                ),
            ),
        ),
        path=db_path,
        observed_at_ms=2_000,
    )

    flow = load_coin_flow(since_ms=0, path=db_path)
    assert len(flow) == 1
    only = flow[0]
    # Only the latest position batch counts (3000), not 1000+3000.
    assert only["position_usd"] == 3000.0
    assert only["avg_score"] == 90.0
