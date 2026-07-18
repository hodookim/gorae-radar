from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "data" / "smart_money_radar.sqlite3"
DEFAULT_OUTPUT_DIR = ROOT / "data" / "snapshots"


def number(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def load_snapshot(database: Path, published_at: str) -> tuple[int, dict[str, object]]:
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        observed_at_ms = connection.execute(
            "SELECT MAX(observed_at_ms) FROM positions"
        ).fetchone()[0]
        if not observed_at_ms:
            raise RuntimeError("legacy database has no position observations")

        candidate_at_ms = connection.execute(
            "SELECT MAX(observed_at_ms) FROM candidate_observations "
            "WHERE observed_at_ms <= ?",
            (observed_at_ms,),
        ).fetchone()[0]
        candidates = {
            str(row["address"]).lower(): row
            for row in connection.execute(
                "SELECT address, label, score FROM candidate_observations "
                "WHERE observed_at_ms = ?",
                (candidate_at_ms,),
            )
        }
        grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
        labels: dict[str, str] = {}
        for row in connection.execute(
            "SELECT address, wallet_label, coin, side, size, entry_price, position_value, "
            "unrealized_pnl, roe_pct FROM positions WHERE observed_at_ms = ?",
            (observed_at_ms,),
        ):
            address = str(row["address"]).lower()
            labels[address] = str(row["wallet_label"] or "")
            grouped[address].append(
                {
                    "coin": str(row["coin"] or "").upper(),
                    "side": str(row["side"] or "").upper(),
                    "size": number(row["size"]),
                    "entry_price": number(row["entry_price"]),
                    "position_value": abs(number(row["position_value"])),
                    "unrealized_pnl": number(row["unrealized_pnl"]),
                    "roe_pct": number(row["roe_pct"]),
                    "leverage": None,
                }
            )

        wallets = []
        for address in sorted(grouped):
            candidate = candidates.get(address)
            label = str(candidate["label"] if candidate else labels[address]) or address[:10]
            wallets.append(
                {
                    "candidate": {
                        "address": address,
                        "label": label,
                        "score": number(candidate["score"]) if candidate else None,
                    },
                    "snapshot": {
                        "wallet": {"address": address, "label": label},
                        "open_positions": sorted(
                            grouped[address],
                            key=lambda position: -number(position["position_value"]),
                        ),
                    },
                }
            )

        captured_at = datetime.fromtimestamp(observed_at_ms / 1000, timezone.utc)
        snapshot = {
            "schema_version": "1.0",
            "captured_at": captured_at.isoformat().replace("+00:00", "Z"),
            "captured_at_ms": observed_at_ms,
            "report_published_at": published_at,
            "data_source": {
                "name": "Hyperliquid public API legacy local capture",
                "provider": "Hyperliquid",
                "info_api_url": "https://api.hyperliquid.xyz/info",
                "provenance": "Imported read-only from the local positions SQLite table",
            },
            "capture_parameters": {
                "top": None,
                "pool": None,
                "scan_limit": None,
                "min_score": None,
                "lookback_hours": None,
            },
            "observation": {
                "scanned_candidates": len(candidates),
                "position_wallets": len(wallets),
                "imported_legacy_snapshot": True,
                "selected_positions_observed_at_ms": observed_at_ms,
                "selected_candidates_observed_at_ms": candidate_at_ms,
            },
            "wallets": wallets,
        }
        return observed_at_ms, snapshot
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the latest legacy SQLite observation")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--published-at", default=datetime.now(ZoneInfo("Asia/Seoul")).date().isoformat())
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    observed_at_ms, snapshot = load_snapshot(args.database.resolve(), args.published_at)
    observed_at = datetime.fromtimestamp(observed_at_ms / 1000, ZoneInfo("Asia/Seoul"))
    output = args.output_dir.resolve() / observed_at.strftime("%Y-%m-%d-%H%M.json")
    if output.exists() and not args.force:
        raise FileExistsError(f"snapshot already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(output)


if __name__ == "__main__":
    main()
