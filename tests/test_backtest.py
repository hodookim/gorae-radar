from __future__ import annotations

from decimal import Decimal

from smart_money_radar.backtest import run_follow_backtest, summarize_follow_backtest
from smart_money_radar.storage import StoredFill


class FakeCandleClient:
    def candle_snapshot(
        self,
        *,
        coin: str,
        interval: str,
        start_time_ms: int,
        end_time_ms: int,
    ) -> list[dict[str, object]]:
        return [
            {
                "s": coin,
                "i": interval,
                "t": start_time_ms,
                "T": start_time_ms + 59_999,
                "o": "100",
                "h": "101",
                "l": "99.8",
                "c": "100.8",
                "v": "10",
                "n": 10,
            },
            {
                "s": coin,
                "i": interval,
                "t": start_time_ms + 60_000,
                "T": start_time_ms + 119_999,
                "o": "100.8",
                "h": "101.2",
                "l": "100.4",
                "c": "101",
                "v": "10",
                "n": 10,
            },
        ]


def test_run_follow_backtest_hits_half_take_profit() -> None:
    fill = StoredFill(
        fill_key="fill-1",
        address="0x1111111111111111111111111111111111111111",
        wallet_label="alpha",
        coin="HYPE",
        side="B",
        direction="Open Long",
        price=Decimal("99"),
        size=Decimal("1"),
        notional_usd=Decimal("99"),
        time_ms=1_800_000_000_000,
        closed_pnl=Decimal("0"),
        fee=Decimal("0"),
    )

    results = run_follow_backtest(
        client=FakeCandleClient(),  # type: ignore[arg-type]
        fills=(fill,),
        delay_minutes=1,
        horizon_minutes=2,
        take_profit_bps=50,
    )
    summary = summarize_follow_backtest(results)

    assert len(results) == 1
    assert results[0].take_profit_hit is True
    assert results[0].return_bps is not None
    assert results[0].return_bps > 0
    assert summary["completed"] == 1
    assert summary["wins"] == 1
