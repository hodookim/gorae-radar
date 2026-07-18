from __future__ import annotations

from decimal import Decimal

import httpx

from smart_money_radar.smart_money import (
    HyperliquidInfoClient,
    SmartMoneyWallet,
    fetch_leaderboard_candidates,
    fetch_smart_money_snapshots,
)
from smart_money_radar.storage import (
    save_candidate_observations,
    save_follow_backtest_results,
    save_wallet_snapshots,
    smart_money_storage_stats,
)


def test_save_candidate_observations_records_score_breakdown(tmp_path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "leaderboardRows": [
                    {
                        "ethAddress": "0x2222222222222222222222222222222222222222",
                        "accountValue": "5000000",
                        "displayName": "alpha",
                        "windowPerformances": [
                            ["day", {"pnl": "10000", "roi": "0.02", "vlm": "1000000"}],
                            ["week", {"pnl": "50000", "roi": "0.10", "vlm": "7000000"}],
                            ["month", {"pnl": "200000", "roi": "0.3", "vlm": "20000000"}],
                            ["allTime", {"pnl": "900000", "roi": "1.0", "vlm": "50000000"}],
                        ],
                    }
                ]
            },
        )

    db_path = tmp_path / "radar.sqlite3"
    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        candidates = fetch_leaderboard_candidates(
            client=http_client,
            limit=10,
            min_score=1,
            min_account_value=Decimal("1000"),
        )

    assert save_candidate_observations(candidates, path=db_path, observed_at_ms=123) == 1
    stats = smart_money_storage_stats(db_path)
    assert stats["candidate_observations"] == 1
    assert stats["latest_candidate_observed_at_ms"] == 123


def test_save_wallet_snapshots_records_fills_and_positions(tmp_path) -> None:
    now_ms = 1_800_000_000_000

    def handler(request: httpx.Request) -> httpx.Response:
        payload = request.read()
        if b"userFillsByTime" in payload:
            return httpx.Response(
                200,
                json=[
                    {
                        "coin": "HYPE",
                        "side": "B",
                        "dir": "Open Long",
                        "px": "25",
                        "sz": "100",
                        "time": now_ms,
                        "closedPnl": "120",
                        "fee": "1.2",
                    }
                ],
            )
        if b"clearinghouseState" in payload:
            return httpx.Response(
                200,
                json={
                    "assetPositions": [
                        {
                            "position": {
                                "coin": "HYPE",
                                "szi": "100",
                                "entryPx": "25",
                                "positionValue": "2500",
                                "unrealizedPnl": "50",
                            }
                        }
                    ]
                },
            )
        return httpx.Response(400, json={"error": "unexpected"})

    wallet = SmartMoneyWallet(
        label="alpha",
        address="0x1111111111111111111111111111111111111111",
    )
    db_path = tmp_path / "radar.sqlite3"
    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        snapshots = fetch_smart_money_snapshots(
            client=HyperliquidInfoClient(client=http_client),
            wallets=(wallet,),
        )

    saved = save_wallet_snapshots(snapshots, path=db_path, observed_at_ms=456)
    stats = smart_money_storage_stats(db_path)
    assert saved == {"snapshots": 1, "fills": 1, "positions": 1}
    assert stats["wallet_snapshots"] == 1
    assert stats["fills"] == 1
    assert stats["positions"] == 1
    assert stats["latest_snapshot_observed_at_ms"] == 456


def test_save_follow_backtest_results_records_run(tmp_path) -> None:
    from smart_money_radar.backtest import FollowBacktestResult

    db_path = tmp_path / "radar.sqlite3"
    result = FollowBacktestResult(
        fill_key="fill-1",
        address="0x1111111111111111111111111111111111111111",
        wallet_label="alpha",
        coin="HYPE",
        source_time_ms=1_800_000_000_000,
        direction="LONG",
        delay_minutes=1,
        horizon_minutes=5,
        take_profit_bps=50,
        entry_price=Decimal("100"),
        exit_price=Decimal("101"),
        take_profit_hit=True,
        return_bps=Decimal("50"),
        notional_usd=Decimal("1000"),
    )

    assert save_follow_backtest_results((result,), path=db_path, run_at_ms=789) == 1
    stats = smart_money_storage_stats(db_path)
    assert stats["follow_backtest_results"] == 1
    assert stats["latest_backtest_run_at_ms"] == 789
