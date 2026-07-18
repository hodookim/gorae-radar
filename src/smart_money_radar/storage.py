from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import asdict, dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from .smart_money import SmartMoneyCandidate, SmartMoneyWalletSnapshot


DEFAULT_SMART_MONEY_DB = Path("data/smart_money_radar.sqlite3")


@dataclass(frozen=True)
class StoredFill:
    fill_key: str
    address: str
    wallet_label: str
    coin: str
    side: str
    direction: str
    price: Decimal
    size: Decimal
    notional_usd: Decimal
    time_ms: int
    closed_pnl: Decimal
    fee: Decimal


def init_smart_money_db(path: Path = DEFAULT_SMART_MONEY_DB) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(
            """
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS candidate_observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                observed_at_ms INTEGER NOT NULL,
                address TEXT NOT NULL,
                label TEXT NOT NULL,
                score REAL NOT NULL,
                source TEXT NOT NULL,
                account_value TEXT NOT NULL,
                day_pnl TEXT NOT NULL,
                week_pnl TEXT NOT NULL,
                month_pnl TEXT NOT NULL,
                all_time_pnl TEXT NOT NULL,
                day_roi TEXT NOT NULL,
                week_roi TEXT NOT NULL,
                month_roi TEXT NOT NULL,
                all_time_roi TEXT NOT NULL,
                day_volume TEXT NOT NULL,
                week_volume TEXT NOT NULL,
                month_volume TEXT NOT NULL,
                all_time_volume TEXT NOT NULL,
                size_score REAL NOT NULL,
                skill_score REAL NOT NULL,
                consistency_score REAL NOT NULL,
                activity_score REAL NOT NULL,
                risk_penalty REAL NOT NULL,
                labels_json TEXT NOT NULL,
                reasons_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_candidate_observations_address_time
            ON candidate_observations(address, observed_at_ms DESC);

            CREATE TABLE IF NOT EXISTS wallet_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                observed_at_ms INTEGER NOT NULL,
                address TEXT NOT NULL,
                label TEXT NOT NULL,
                score REAL NOT NULL,
                verdict TEXT NOT NULL,
                closed_pnl_usd TEXT NOT NULL,
                fees_usd TEXT NOT NULL,
                volume_usd TEXT NOT NULL,
                newest_fill_ms INTEGER,
                error TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_address_time
            ON wallet_snapshots(address, observed_at_ms DESC);

            CREATE TABLE IF NOT EXISTS fills (
                fill_key TEXT PRIMARY KEY,
                observed_at_ms INTEGER NOT NULL,
                address TEXT NOT NULL,
                wallet_label TEXT NOT NULL,
                coin TEXT NOT NULL,
                side TEXT NOT NULL,
                direction TEXT NOT NULL,
                price TEXT NOT NULL,
                size TEXT NOT NULL,
                notional_usd TEXT NOT NULL,
                time_ms INTEGER NOT NULL,
                closed_pnl TEXT NOT NULL,
                fee TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_fills_address_time
            ON fills(address, time_ms DESC);

            CREATE TABLE IF NOT EXISTS positions (
                observed_at_ms INTEGER NOT NULL,
                address TEXT NOT NULL,
                wallet_label TEXT NOT NULL,
                coin TEXT NOT NULL,
                side TEXT NOT NULL,
                size TEXT NOT NULL,
                entry_price TEXT NOT NULL,
                position_value TEXT NOT NULL,
                unrealized_pnl TEXT NOT NULL,
                roe_pct TEXT,
                PRIMARY KEY (observed_at_ms, address, coin, side)
            );

            CREATE TABLE IF NOT EXISTS follow_backtest_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_at_ms INTEGER NOT NULL,
                fill_key TEXT NOT NULL,
                address TEXT NOT NULL,
                wallet_label TEXT NOT NULL,
                coin TEXT NOT NULL,
                source_time_ms INTEGER NOT NULL,
                direction TEXT NOT NULL,
                delay_minutes INTEGER NOT NULL,
                horizon_minutes INTEGER NOT NULL,
                take_profit_bps INTEGER NOT NULL,
                entry_price TEXT,
                exit_price TEXT,
                take_profit_hit INTEGER NOT NULL,
                return_bps TEXT,
                notional_usd TEXT NOT NULL,
                skipped_reason TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_follow_backtest_results_run
            ON follow_backtest_results(run_at_ms DESC);
            """
        )


def save_candidate_observations(
    candidates: tuple[SmartMoneyCandidate, ...],
    *,
    path: Path = DEFAULT_SMART_MONEY_DB,
    observed_at_ms: int | None = None,
) -> int:
    init_smart_money_db(path)
    observed_at_ms = observed_at_ms or _now_ms()
    rows = [
        (
            observed_at_ms,
            item.address,
            item.label,
            item.score,
            item.source,
            _decimal_text(item.account_value),
            _decimal_text(item.day_pnl),
            _decimal_text(item.week_pnl),
            _decimal_text(item.month_pnl),
            _decimal_text(item.all_time_pnl),
            _decimal_text(item.day_roi),
            _decimal_text(item.week_roi),
            _decimal_text(item.month_roi),
            _decimal_text(item.all_time_roi),
            _decimal_text(item.day_volume),
            _decimal_text(item.week_volume),
            _decimal_text(item.month_volume),
            _decimal_text(item.all_time_volume),
            item.score_breakdown.size,
            item.score_breakdown.skill,
            item.score_breakdown.consistency,
            item.score_breakdown.activity,
            item.score_breakdown.risk_penalty,
            json.dumps(list(item.labels), ensure_ascii=False),
            json.dumps(list(item.reasons), ensure_ascii=False),
        )
        for item in candidates
    ]
    with sqlite3.connect(path) as conn:
        conn.executemany(
            """
            INSERT INTO candidate_observations (
                observed_at_ms, address, label, score, source, account_value,
                day_pnl, week_pnl, month_pnl, all_time_pnl,
                day_roi, week_roi, month_roi, all_time_roi,
                day_volume, week_volume, month_volume, all_time_volume,
                size_score, skill_score, consistency_score, activity_score,
                risk_penalty, labels_json, reasons_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    return len(rows)


def save_wallet_snapshots(
    snapshots: tuple[SmartMoneyWalletSnapshot, ...],
    *,
    path: Path = DEFAULT_SMART_MONEY_DB,
    observed_at_ms: int | None = None,
) -> dict[str, int]:
    init_smart_money_db(path)
    observed_at_ms = observed_at_ms or _now_ms()
    snapshot_rows = [
        (
            observed_at_ms,
            item.wallet.address,
            item.wallet.label,
            item.score,
            item.verdict,
            _decimal_text(item.closed_pnl_usd),
            _decimal_text(item.fees_usd),
            _decimal_text(item.volume_usd),
            item.newest_fill_ms,
            item.error,
        )
        for item in snapshots
    ]
    fill_rows: list[tuple[Any, ...]] = []
    position_rows: list[tuple[Any, ...]] = []
    for snapshot in snapshots:
        for fill in snapshot.recent_fills:
            fill_rows.append(
                (
                    _fill_key(fill),
                    observed_at_ms,
                    fill.address,
                    fill.wallet_label,
                    fill.coin,
                    fill.side,
                    fill.direction,
                    _decimal_text(fill.price),
                    _decimal_text(fill.size),
                    _decimal_text(fill.notional_usd),
                    fill.time_ms,
                    _decimal_text(fill.closed_pnl),
                    _decimal_text(fill.fee),
                )
            )
        for position in snapshot.open_positions:
            position_rows.append(
                (
                    observed_at_ms,
                    position.address,
                    position.wallet_label,
                    position.coin,
                    position.side,
                    _decimal_text(position.size),
                    _decimal_text(position.entry_price),
                    _decimal_text(position.position_value),
                    _decimal_text(position.unrealized_pnl),
                    None if position.roe_pct is None else _decimal_text(position.roe_pct),
                )
            )
    with sqlite3.connect(path) as conn:
        conn.executemany(
            """
            INSERT INTO wallet_snapshots (
                observed_at_ms, address, label, score, verdict, closed_pnl_usd,
                fees_usd, volume_usd, newest_fill_ms, error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            snapshot_rows,
        )
        conn.executemany(
            """
            INSERT OR REPLACE INTO fills (
                fill_key, observed_at_ms, address, wallet_label, coin, side, direction,
                price, size, notional_usd, time_ms, closed_pnl, fee
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            fill_rows,
        )
        conn.executemany(
            """
            INSERT OR REPLACE INTO positions (
                observed_at_ms, address, wallet_label, coin, side, size, entry_price,
                position_value, unrealized_pnl, roe_pct
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            position_rows,
        )
    return {
        "snapshots": len(snapshot_rows),
        "fills": len(fill_rows),
        "positions": len(position_rows),
    }


def load_recent_fills_for_backtest(
    *,
    path: Path = DEFAULT_SMART_MONEY_DB,
    limit: int = 200,
) -> tuple[StoredFill, ...]:
    init_smart_money_db(path)
    with sqlite3.connect(path) as conn:
        rows = conn.execute(
            """
            SELECT fill_key, address, wallet_label, coin, side, direction, price, size,
                   notional_usd, time_ms, closed_pnl, fee
            FROM fills
            ORDER BY time_ms DESC
            LIMIT ?
            """,
            (max(1, limit),),
        ).fetchall()
    return tuple(
        StoredFill(
            fill_key=str(row[0]),
            address=str(row[1]),
            wallet_label=str(row[2]),
            coin=str(row[3]),
            side=str(row[4]),
            direction=str(row[5]),
            price=Decimal(str(row[6])),
            size=Decimal(str(row[7])),
            notional_usd=Decimal(str(row[8])),
            time_ms=int(row[9]),
            closed_pnl=Decimal(str(row[10])),
            fee=Decimal(str(row[11])),
        )
        for row in rows
    )


def save_follow_backtest_results(
    results: tuple[Any, ...],
    *,
    path: Path = DEFAULT_SMART_MONEY_DB,
    run_at_ms: int | None = None,
) -> int:
    init_smart_money_db(path)
    run_at_ms = run_at_ms or _now_ms()
    rows = [
        (
            run_at_ms,
            item.fill_key,
            item.address,
            item.wallet_label,
            item.coin,
            item.source_time_ms,
            item.direction,
            item.delay_minutes,
            item.horizon_minutes,
            item.take_profit_bps,
            None if item.entry_price is None else _decimal_text(item.entry_price),
            None if item.exit_price is None else _decimal_text(item.exit_price),
            1 if item.take_profit_hit else 0,
            None if item.return_bps is None else _decimal_text(item.return_bps),
            _decimal_text(item.notional_usd),
            item.skipped_reason,
        )
        for item in results
    ]
    with sqlite3.connect(path) as conn:
        conn.executemany(
            """
            INSERT INTO follow_backtest_results (
                run_at_ms, fill_key, address, wallet_label, coin, source_time_ms,
                direction, delay_minutes, horizon_minutes, take_profit_bps,
                entry_price, exit_price, take_profit_hit, return_bps, notional_usd,
                skipped_reason
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    return len(rows)


def smart_money_storage_stats(path: Path = DEFAULT_SMART_MONEY_DB) -> dict[str, Any]:
    init_smart_money_db(path)
    with sqlite3.connect(path) as conn:
        return {
            "path": str(path),
            "candidate_observations": _table_count(conn, "candidate_observations"),
            "wallet_snapshots": _table_count(conn, "wallet_snapshots"),
            "fills": _table_count(conn, "fills"),
            "positions": _table_count(conn, "positions"),
            "follow_backtest_results": _table_count(conn, "follow_backtest_results"),
            "latest_candidate_observed_at_ms": _table_max(conn, "candidate_observations"),
            "latest_snapshot_observed_at_ms": _table_max(conn, "wallet_snapshots"),
            "latest_backtest_run_at_ms": _table_max(
                conn,
                "follow_backtest_results",
                column="run_at_ms",
            ),
        }


def _table_count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def _table_max(
    conn: sqlite3.Connection,
    table: str,
    *,
    column: str = "observed_at_ms",
) -> int | None:
    value = conn.execute(f"SELECT MAX({column}) FROM {table}").fetchone()[0]
    return int(value) if value is not None else None


def _decimal_text(value: Decimal) -> str:
    return format(value, "f")


def _fill_key(fill: Any) -> str:
    payload = asdict(fill)
    return "|".join(
        str(payload[key])
        for key in ("address", "coin", "side", "direction", "price", "size", "time_ms")
    )


def _now_ms() -> int:
    return int(time.time() * 1000)


def load_candidate_history(
    address: str,
    *,
    limit: int = 500,
    path: Path = DEFAULT_SMART_MONEY_DB,
) -> list[dict[str, Any]]:
    """Return candidate observations for one wallet ordered oldest -> newest."""
    init_smart_money_db(path)
    normalized = str(address).lower()
    with sqlite3.connect(path) as conn:
        rows = conn.execute(
            """
            SELECT observed_at_ms, address, label, score, source, account_value,
                   day_pnl, week_pnl, month_pnl, all_time_pnl,
                   day_roi, week_roi, month_roi, all_time_roi,
                   day_volume, week_volume, month_volume, all_time_volume,
                   size_score, skill_score, consistency_score, activity_score,
                   risk_penalty, labels_json, reasons_json
            FROM candidate_observations
            WHERE address = ?
            ORDER BY observed_at_ms ASC
            LIMIT ?
            """,
            (normalized, max(1, int(limit))),
        ).fetchall()
    return [_candidate_row_to_dict(row) for row in rows]


def load_snapshot_history(
    address: str,
    *,
    limit: int = 500,
    path: Path = DEFAULT_SMART_MONEY_DB,
) -> list[dict[str, Any]]:
    """Return wallet snapshot series for one wallet ordered oldest -> newest."""
    init_smart_money_db(path)
    normalized = str(address).lower()
    with sqlite3.connect(path) as conn:
        rows = conn.execute(
            """
            SELECT observed_at_ms, address, label, score, verdict,
                   closed_pnl_usd, fees_usd, volume_usd, newest_fill_ms, error
            FROM wallet_snapshots
            WHERE address = ?
            ORDER BY observed_at_ms ASC
            LIMIT ?
            """,
            (normalized, max(1, int(limit))),
        ).fetchall()
    return [
        {
            "observed_at_ms": int(row[0]),
            "address": str(row[1]),
            "label": str(row[2]),
            "score": float(row[3]),
            "verdict": str(row[4]),
            "closed_pnl_usd": _to_float(row[5]),
            "fees_usd": _to_float(row[6]),
            "volume_usd": _to_float(row[7]),
            "newest_fill_ms": int(row[8]) if row[8] is not None else None,
            "error": row[9],
        }
        for row in rows
    ]


def load_fills(
    *,
    address: str | None = None,
    coin: str | None = None,
    since_ms: int | None = None,
    limit: int = 200,
    path: Path = DEFAULT_SMART_MONEY_DB,
) -> list[dict[str, Any]]:
    """Return fills filtered by optional address/coin/since_ms, newest first."""
    init_smart_money_db(path)
    clauses: list[str] = []
    params: list[Any] = []
    if address is not None:
        clauses.append("address = ?")
        params.append(str(address).lower())
    if coin is not None:
        clauses.append("coin = ?")
        params.append(str(coin))
    if since_ms is not None:
        clauses.append("time_ms >= ?")
        params.append(int(since_ms))
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(max(1, int(limit)))
    sql = (
        """
        SELECT fill_key, observed_at_ms, address, wallet_label, coin, side, direction,
               price, size, notional_usd, time_ms, closed_pnl, fee
        FROM fills
        """
        + where
        + """
        ORDER BY time_ms DESC
        LIMIT ?
        """
    )
    with sqlite3.connect(path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [
        {
            "fill_key": str(row[0]),
            "observed_at_ms": int(row[1]),
            "address": str(row[2]),
            "wallet_label": str(row[3]),
            "coin": str(row[4]),
            "side": str(row[5]),
            "direction": str(row[6]),
            "price": _to_float(row[7]),
            "size": _to_float(row[8]),
            "notional_usd": _to_float(row[9]),
            "time_ms": int(row[10]),
            "closed_pnl": _to_float(row[11]),
            "fee": _to_float(row[12]),
        }
        for row in rows
    ]


def load_position_history(
    address: str,
    *,
    limit: int = 200,
    path: Path = DEFAULT_SMART_MONEY_DB,
) -> list[dict[str, Any]]:
    """Return position snapshots for one wallet ordered newest -> oldest."""
    init_smart_money_db(path)
    normalized = str(address).lower()
    with sqlite3.connect(path) as conn:
        rows = conn.execute(
            """
            SELECT observed_at_ms, address, wallet_label, coin, side, size,
                   entry_price, position_value, unrealized_pnl, roe_pct
            FROM positions
            WHERE address = ?
            ORDER BY observed_at_ms DESC
            LIMIT ?
            """,
            (normalized, max(1, int(limit))),
        ).fetchall()
    return [
        {
            "observed_at_ms": int(row[0]),
            "address": str(row[1]),
            "wallet_label": str(row[2]),
            "coin": str(row[3]),
            "side": str(row[4]),
            "size": _to_float(row[5]),
            "entry_price": _to_float(row[6]),
            "position_value": _to_float(row[7]),
            "unrealized_pnl": _to_float(row[8]),
            "roe_pct": _to_optional_float(row[9]),
        }
        for row in rows
    ]


def load_coin_flow(
    *,
    since_ms: int,
    path: Path = DEFAULT_SMART_MONEY_DB,
) -> list[dict[str, Any]]:
    """Aggregate recent positions + fills by (coin, side) for flow analysis.

    Positions are deduped to the latest snapshot per (address, coin, side) so a
    single open position is not double counted across snapshot batches.
    """
    init_smart_money_db(path)
    cutoff = int(since_ms)
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_positions_coin ON positions(coin, side)"
        )
        pos_rows = conn.execute(
            """
            SELECT p.coin AS coin, p.side AS side,
                   SUM(CAST(p.position_value AS REAL)) AS position_usd,
                   AVG(CAST(p.roe_pct AS REAL)) AS avg_roe,
                   COUNT(DISTINCT p.address) AS wallet_count,
                   AVG(COALESCE(ls.score, 0.0)) AS avg_score
            FROM positions p
            INNER JOIN (
                SELECT address, coin, side, MAX(observed_at_ms) AS max_ms
                FROM positions
                GROUP BY address, coin, side
            ) m ON m.address = p.address AND m.coin = p.coin
                AND m.side = p.side AND m.max_ms = p.observed_at_ms
            LEFT JOIN (
                SELECT address, MAX(observed_at_ms) AS max_ms
                FROM wallet_snapshots
                GROUP BY address
            ) ws_m ON ws_m.address = p.address
            LEFT JOIN wallet_snapshots ls
                ON ls.address = ws_m.address AND ls.observed_at_ms = ws_m.max_ms
            WHERE p.observed_at_ms >= ?
            GROUP BY p.coin, p.side
            """,
            (cutoff,),
        ).fetchall()
        for row in pos_rows:
            coin = str(row[0])
            side = str(row[1])
            entry = _coin_flow_entry(merged, coin, side)
            entry["position_usd"] = float(row[2] or 0.0)
            entry["avg_roe"] = _to_optional_float(row[3]) or 0.0
            entry["wallet_count"] = int(row[4] or 0)
            entry["avg_score"] = float(row[5] or 0.0)
        fill_rows = conn.execute(
            """
            SELECT coin, side,
                   SUM(notional_usd) AS fill_usd,
                   COUNT(DISTINCT address) AS fill_wallet_count
            FROM (
                SELECT coin, address, CAST(notional_usd AS REAL) AS notional_usd,
                    CASE WHEN direction LIKE '%short%' THEN 'SHORT'
                         WHEN direction LIKE '%long%' THEN 'LONG'
                         WHEN side = 'A' THEN 'SHORT'
                         ELSE 'LONG' END AS side
                FROM fills
                WHERE time_ms >= ?
            )
            GROUP BY coin, side
            """,
            (cutoff,),
        ).fetchall()
        for row in fill_rows:
            coin = str(row[0])
            side = str(row[1])
            entry = _coin_flow_entry(merged, coin, side)
            entry["fill_usd"] = float(row[2] or 0.0)
            entry["wallet_count"] = max(entry["wallet_count"], int(row[3] or 0))
    for entry in merged.values():
        entry["conviction"] = entry["position_usd"] * entry["avg_score"]
    return sorted(
        merged.values(),
        key=lambda item: (item["conviction"], item["position_usd"], item["fill_usd"]),
        reverse=True,
    )


def _coin_flow_entry(
    merged: dict[tuple[str, str], dict[str, Any]],
    coin: str,
    side: str,
) -> dict[str, Any]:
    key = (coin, side)
    entry = merged.get(key)
    if entry is None:
        entry = {
            "coin": coin,
            "side": side,
            "position_usd": 0.0,
            "fill_usd": 0.0,
            "wallet_count": 0,
            "avg_score": 0.0,
            "avg_roe": 0.0,
            "conviction": 0.0,
        }
        merged[key] = entry
    return entry


def _candidate_row_to_dict(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "observed_at_ms": int(row[0]),
        "address": str(row[1]),
        "label": str(row[2]),
        "score": float(row[3]),
        "source": str(row[4]),
        "account_value": _to_float(row[5]),
        "day_pnl": _to_float(row[6]),
        "week_pnl": _to_float(row[7]),
        "month_pnl": _to_float(row[8]),
        "all_time_pnl": _to_float(row[9]),
        "day_roi": _to_float(row[10]),
        "week_roi": _to_float(row[11]),
        "month_roi": _to_float(row[12]),
        "all_time_roi": _to_float(row[13]),
        "day_volume": _to_float(row[14]),
        "week_volume": _to_float(row[15]),
        "month_volume": _to_float(row[16]),
        "all_time_volume": _to_float(row[17]),
        "score_breakdown": {
            "size": float(row[18]),
            "skill": float(row[19]),
            "consistency": float(row[20]),
            "activity": float(row[21]),
            "risk_penalty": float(row[22]),
        },
        "labels": _json_list(row[23]),
        "reasons": _json_list(row[24]),
    }


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _to_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _json_list(raw: Any) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [str(item) for item in data] if isinstance(data, list) else []
