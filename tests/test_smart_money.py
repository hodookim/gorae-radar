from __future__ import annotations

from decimal import Decimal

import httpx

from smart_money_radar.smart_money import (
    HyperliquidInfoClient,
    SmartMoneyWallet,
    fetch_leaderboard_candidates,
    fetch_smart_money_snapshots,
    load_smart_money_watchlist,
)


def test_load_smart_money_watchlist_parses_enabled_wallet(tmp_path) -> None:
    path = tmp_path / "watchlist.json"
    path.write_text(
        """
        {
          "wallets": [
            {
              "label": "alpha",
              "address": "0x1111111111111111111111111111111111111111",
              "enabled": true,
              "tags": ["leaderboard"],
              "weight": 1.5
            },
            {"label": "bad", "address": "not-an-address"}
          ]
        }
        """,
        encoding="utf-8",
    )

    wallets = load_smart_money_watchlist(path)

    assert len(wallets) == 1
    assert wallets[0].label == "alpha"
    assert wallets[0].tags == ("leaderboard",)
    assert wallets[0].weight == 1.5


def test_fetch_smart_money_snapshots_scores_recent_wallet() -> None:
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
                                "returnOnEquity": "0.2",
                                "liquidationPx": "12.5",
                                "marginUsed": "250",
                                "leverage": {"type": "cross", "value": 10},
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
    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as http_client:
        client = HyperliquidInfoClient(client=http_client)
        snapshots = fetch_smart_money_snapshots(
            client=client,
            wallets=(wallet,),
            lookback_hours=24,
        )

    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert snapshot.wallet.label == "alpha"
    assert snapshot.closed_pnl_usd == Decimal("120")
    assert snapshot.volume_usd == Decimal("2500")
    assert snapshot.open_positions[0].side == "LONG"
    assert snapshot.open_positions[0].current_price == Decimal("25")
    assert snapshot.open_positions[0].liquidation_price == Decimal("12.5")
    assert snapshot.open_positions[0].margin_used == Decimal("250")
    assert snapshot.open_positions[0].leverage == Decimal("10")
    assert snapshot.recent_fills[0].coin == "HYPE"
    assert snapshot.score > 0


def test_fetch_leaderboard_candidates_parses_stats_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "leaderboardRows": [
                    {
                        "ethAddress": "0x2222222222222222222222222222222222222222",
                        "accountValue": "50000",
                        "displayName": "good-trader",
                        "windowPerformances": [
                            ["day", {"pnl": "3000", "roi": "0.05", "vlm": "2000000"}],
                            ["week", {"pnl": "10000", "roi": "0.12", "vlm": "8000000"}],
                            ["month", {"pnl": "30000", "roi": "0.4", "vlm": "20000000"}],
                            ["allTime", {"pnl": "100000", "roi": "1.5", "vlm": "50000000"}],
                        ],
                    },
                    {
                        "ethAddress": "0x3333333333333333333333333333333333333333",
                        "accountValue": "100",
                        "windowPerformances": [],
                    },
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as http_client:
        candidates = fetch_leaderboard_candidates(
            client=http_client,
            limit=10,
            min_score=10,
            min_account_value=Decimal("1000"),
        )

    assert len(candidates) == 1
    assert candidates[0].address == "0x2222222222222222222222222222222222222222"
    assert candidates[0].label == "good-trader"
    assert candidates[0].score > 10
    assert candidates[0].score_breakdown.skill > 0
    assert candidates[0].score_breakdown.consistency > 0
    assert "profitable_trader" in candidates[0].labels
    assert "month_pnl_positive" in candidates[0].reasons
