from __future__ import annotations

import json
import math
import mimetypes
import os
import threading
import time
from dataclasses import asdict
from decimal import Decimal
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from typing import Any
from urllib.parse import parse_qs, urlparse

from .smart_money import (
    HyperliquidInfoClient,
    SmartMoneyCandidate,
    SmartMoneyWallet,
    SmartMoneyWalletSnapshot,
    _looks_like_eth_address,
    fetch_leaderboard_candidates,
    fetch_smart_money_snapshots,
    load_smart_money_watchlist,
    save_smart_money_watchlist,
    upsert_smart_money_wallet,
    write_default_smart_money_watchlist,
)
from .storage import (
    init_smart_money_db,
    load_candidate_history,
    load_coin_flow,
    load_fills,
    load_position_history,
    load_snapshot_history,
    save_candidate_observations,
    save_wallet_snapshots,
    smart_money_storage_stats,
)


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


DEFAULT_SMART_MONEY_WEB_HOST = "127.0.0.1"
DEFAULT_SMART_MONEY_WEB_PORT = 8798
STATIC_ROOT = Path(__file__).resolve().parent / "static"
mimetypes.add_type("image/webp", ".webp")
ENABLE_SERVER_WATCHLIST_WRITES = os.environ.get(
    "SMART_MONEY_ENABLE_SERVER_WATCHLIST_WRITES", ""
).lower() in {"1", "true", "yes"}
API_RATE_LIMIT_WINDOW_SECONDS = 60.0
API_RATE_LIMIT_MAX_REQUESTS = _env_int("SMART_MONEY_API_RATE_LIMIT_PER_MINUTE", 180)
_CANDIDATE_CACHE_LOCK = threading.Lock()
_CANDIDATE_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "pool": 0,
    "min_score": 0.0,
    "candidates": (),
}
_RESPONSE_CACHE_LOCK = threading.Lock()
_RESPONSE_CACHE: dict[str, tuple[float, Any]] = {}
_RESPONSE_BUILD_LOCKS: dict[str, threading.Lock] = {}
_RATE_LIMIT_LOCK = threading.Lock()
_RATE_LIMIT_BUCKETS: dict[str, tuple[float, int]] = {}


def main() -> None:
    write_default_smart_money_watchlist()
    init_smart_money_db()
    server = ThreadingHTTPServer(
        (DEFAULT_SMART_MONEY_WEB_HOST, DEFAULT_SMART_MONEY_WEB_PORT),
        SmartMoneyWebHandler,
    )
    url = f"http://{DEFAULT_SMART_MONEY_WEB_HOST}:{DEFAULT_SMART_MONEY_WEB_PORT}"
    print(f"Smart Money Web UI: {url}")
    if "--open" in sys.argv:
        import webbrowser

        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    server.serve_forever()


class SmartMoneyWebHandler(BaseHTTPRequestHandler):
    server_version = "SmartMoneyWeb/0.3"

    def do_GET(self) -> None:  # noqa: N802
        route = urlparse(self.path)
        if not self._check_api_rate_limit(route.path):
            return
        if route.path in ("/", "/index.html"):
            self._serve_static("index.html")
            return
        if route.path == "/favicon.ico":
            self._serve_static("favicon.svg")
            return
        if route.path == "/ads.txt":
            self._serve_static("ads.txt")
            return
        if route.path == "/robots.txt":
            self._serve_static("robots.txt")
            return
        if route.path == "/sitemap.xml":
            self._serve_static("sitemap.xml")
            return
        if route.path.startswith("/static/"):
            self._serve_static(route.path[len("/static/"):])
            return
        if route.path == "/api/radar/top":
            query = parse_qs(route.query)
            payload = _cached_response(
                _top_radar_cache_key(query),
                15.0,
                lambda: _top_radar_payload(query),
            )
            self._send_json(payload)
            return
        if route.path == "/api/watchlist":
            self._send_json({"wallets": [_wallet_to_json(item) for item in _watchlist()]})
            return
        if route.path == "/api/storage/stats":
            self._send_json(smart_money_storage_stats())
            return
        if route.path == "/api/snapshots":
            query = parse_qs(route.query)
            lookback = _float_query(query, "lookback_hours", 24.0)
            wallets = _watchlist()
            with HyperliquidInfoClient() as client:
                snapshots = fetch_smart_money_snapshots(
                    client=client,
                    wallets=wallets,
                    lookback_hours=lookback,
                )
            saved = save_wallet_snapshots(snapshots)
            self._send_json(
                {
                    "lookback_hours": lookback,
                    "saved": saved,
                    "snapshots": [_snapshot_to_json(item) for item in snapshots],
                }
            )
            return
        if route.path == "/api/discover":
            query = parse_qs(route.query)
            limit = int(_float_query(query, "limit", 150))
            min_score = _float_query(query, "min_score", 45.0)
            candidates = fetch_leaderboard_candidates(limit=limit, min_score=min_score)
            saved = save_candidate_observations(candidates)
            watched = {item.address for item in _watchlist()}
            self._send_json(
                {
                    "source": "hyperliquid_stats_leaderboard",
                    "saved": {"candidate_observations": saved},
                    "candidates": [
                        {
                            **_candidate_to_json(item),
                            "radar_label": _radar_label(item, rank),
                            "radar_tags": _radar_tags(item),
                            "radar_summary": _radar_summary(item),
                            "watched": item.address in watched,
                        }
                        for rank, item in enumerate(candidates, start=1)
                    ],
                }
            )
            return
        wallet_match = _match_wallet_route(route.path)
        if wallet_match is not None:
            action, address = wallet_match
            if not _looks_like_eth_address(address):
                self._send_json({"error": "invalid_address"}, status=HTTPStatus.BAD_REQUEST)
                return
            address = address.lower()
            if action == "history":
                payload = _cached_response(
                    f"wallet_history:{address}",
                    30.0,
                    lambda: _wallet_history_payload(address),
                )
                self._send_json(payload)
                return
            if action == "fills":
                query = parse_qs(route.query)
                limit = max(1, min(500, int(_float_query(query, "limit", 200))))
                payload = _cached_response(
                    f"wallet_fills:{address}:{limit}",
                    20.0,
                    lambda: _wallet_fills_payload(address, limit),
                )
                self._send_json(payload)
                return
            if action == "positions":
                payload = _cached_response(
                    f"wallet_positions:{address}",
                    20.0,
                    lambda: _wallet_positions_payload(address),
                )
                self._send_json(payload)
                return
        if route.path == "/api/coins/flow":
            query = parse_qs(route.query)
            lookback = max(1.0, min(72.0, _float_query(query, "lookback_hours", 6.0)))
            payload = _cached_response(
                f"coins_flow:{lookback}",
                30.0,
                lambda: _coins_flow_payload(lookback),
            )
            self._send_json(payload)
            return
        if route.path == "/api/stats/overview":
            payload = _cached_response(
                "stats_overview",
                60.0,
                _stats_overview_payload,
            )
            self._send_json(payload)
            return
        self._send_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path)
        if not self._check_api_rate_limit(route.path):
            return
        if route.path == "/api/watchlist":
            if not ENABLE_SERVER_WATCHLIST_WRITES:
                self._send_json(
                    {"error": "server_watchlist_writes_disabled"},
                    status=HTTPStatus.FORBIDDEN,
                )
                return
            payload = self._read_json()
            address = str(payload.get("address", "")).lower().strip()
            label = str(payload.get("label") or address[:10]).strip()
            tags = tuple(str(tag).strip() for tag in payload.get("tags", []) if str(tag).strip())
            notes = str(payload.get("notes", "")).strip()
            weight = float(payload.get("weight", 1.0) or 1.0)
            wallet = SmartMoneyWallet(
                label=label,
                address=address,
                tags=tags,
                weight=weight,
                enabled=bool(payload.get("enabled", True)),
                notes=notes,
            )
            wallets = upsert_smart_money_wallet(wallet)
            self._send_json({"ok": True, "wallets": [_wallet_to_json(item) for item in wallets]})
            return
        if route.path == "/api/watchlist/remove":
            if not ENABLE_SERVER_WATCHLIST_WRITES:
                self._send_json(
                    {"error": "server_watchlist_writes_disabled"},
                    status=HTTPStatus.FORBIDDEN,
                )
                return
            payload = self._read_json()
            address = str(payload.get("address", "")).lower().strip()
            wallets = tuple(item for item in _watchlist() if item.address != address)
            save_smart_money_watchlist(wallets)
            self._send_json({"ok": True, "wallets": [_wallet_to_json(item) for item in wallets]})
            return
        self._send_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _read_json(self) -> dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(size) if size > 0 else b"{}"
        payload = json.loads(raw.decode("utf-8"))
        return payload if isinstance(payload, dict) else {}

    def _send_html(self, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_common_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_json(
        self,
        payload: dict[str, Any],
        *,
        status: HTTPStatus = HTTPStatus.OK,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._send_common_headers()
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, rel_path: str) -> None:
        target = (STATIC_ROOT / rel_path).resolve()
        try:
            target.relative_to(STATIC_ROOT)
        except ValueError:
            self._send_json({"error": "forbidden"}, status=HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self._send_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)
            return
        body = target.read_bytes()
        mime, _ = mimetypes.guess_type(target.name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        max_age = 60 if target.suffix in {".css", ".js", ".html"} else 86400
        self.send_header("Cache-Control", f"public, max-age={max_age}")
        self._send_common_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_common_headers(self) -> None:
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://pagead2.googlesyndication.com; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: blob: https://cdn.jsdelivr.net https://coin-images.coingecko.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net; "
            "connect-src 'self' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net; "
            "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com; "
            "font-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'"
        )
        self.send_header("Content-Security-Policy", csp)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

    def _check_api_rate_limit(self, path: str) -> bool:
        if not path.startswith("/api/"):
            return True
        client_id = self.client_address[0] if self.client_address else "unknown"
        allowed, retry_after = _consume_api_rate_limit(client_id)
        if allowed:
            return True
        self._send_json(
            {"error": "rate_limited", "retry_after_seconds": retry_after},
            status=HTTPStatus.TOO_MANY_REQUESTS,
            extra_headers={"Retry-After": str(retry_after)},
        )
        return False


# Whale-pick conviction sub-signal constants (redesigned formula). The JS
# ``buildWhalePicks`` in static/js/picks.js must remain byte-equivalent — same
# constants, same clamp order, same operation order — so the frontend fallback
# and the backend ``/api/radar/top`` payload produce identical conviction values.
POS_CAP = 1_500_000.0
FILL_CAP = 150_000.0
WALLET_CAP = 4.0
SCORE_FLOOR = 50.0
SCORE_CEIL = 95.0
DOM_FLOOR = 0.5
DOM_CEIL = 1.0
CONVICTION_FLOOR = 26.0


def _clamp01(value: float) -> float:
    """Clamp ``value`` into ``[0.0, 1.0]`` (mirrors the JS ``clamp01`` helper)."""
    return 0.0 if value < 0 else (1.0 if value > 1 else value)


def _compute_whale_picks(
    selected: list[tuple[int, SmartMoneyCandidate, SmartMoneyWalletSnapshot]],
) -> list[dict[str, Any]]:
    """Compute whale picks from the selected top-wallet snapshots.

    Faithful Python port of the JS ``buildWhalePicks`` function in ``picks.js``:
    groups open positions and recent fills by ``(coin, LONG|SHORT)``, then scores
    each group with the same conviction formula and returns the qualifying picks
    sorted by conviction descending. Key names mirror the JS pick object so the
    frontend can switch to ``data.picks`` with minimal adaptation.

    Each sub-signal is clamped into ``[0, 1]`` via ``clamp01``; the final
    conviction (clamped to ``[0, 99]``) is::

        sPos    = positionValue / (positionValue + POS_CAP)
        sFill   = fillValue    / (fillValue    + FILL_CAP)
        sWallet = min(walletCount, WALLET_CAP) / WALLET_CAP
        sScore  = (avgScore - SCORE_FLOOR) / (SCORE_CEIL - SCORE_FLOOR)
        sDom    = (dominance - DOM_FLOOR)   / (DOM_CEIL  - DOM_FLOOR)
        sFB     = min(fillCount, 3) / 3.0

        raw = 12.0
            + 28.0 * clamp01(sScore)
            + 34.0 * clamp01(sPos)
            + 14.0 * clamp01(sWallet)
            + 10.0 * clamp01(sFill)
            +  8.0 * clamp01(sDom)
            +  6.0 * clamp01(sFB)

    A group is dropped when ``conviction < CONVICTION_FLOOR (26.0)`` or its
    blended exposure (``positionValue + fillValue * 0.35``) is non-positive.
    """
    grouped: dict[tuple[str, str], dict[str, Any]] = {}

    def ensure(coin: str, side: str) -> dict[str, Any]:
        key = (coin, side)
        group = grouped.get(key)
        if group is None:
            group = {
                "coin": coin,
                "side": side,
                "wallets": set(),
                "positionValue": 0.0,
                "fillValue": 0.0,
                "fillCount": 0,
                "pnl": 0.0,
                "scoreSum": 0.0,
                "scoreCount": 0,
                "roeWeighted": 0.0,
                "roeWeight": 0.0,
            }
            grouped[key] = group
        return group

    for _rank, candidate, snapshot in selected:
        address = candidate.address
        candidate_score = float(candidate.score or 0.0)
        for position in snapshot.open_positions:
            coin = str(position.coin or "").upper()
            side = str(position.side or "").upper()
            if not coin or side not in ("LONG", "SHORT"):
                continue
            value = abs(float(position.position_value or 0.0))
            group = ensure(coin, side)
            group["wallets"].add(address)
            group["positionValue"] += value
            group["pnl"] += float(position.unrealized_pnl or 0.0)
            group["scoreSum"] += candidate_score
            group["scoreCount"] += 1
            roe = float(position.roe_pct) if position.roe_pct is not None else 0.0
            if value > 0 and math.isfinite(roe):
                group["roeWeighted"] += roe * value
                group["roeWeight"] += value

        for fill in snapshot.recent_fills:
            coin = str(fill.coin or "").upper()
            direction = str(fill.direction or "").lower()
            if not coin or "close" in direction:
                continue
            if "short" in direction:
                fill_side = "SHORT"
            elif "long" in direction:
                fill_side = "LONG"
            elif fill.side == "A":
                fill_side = "SHORT"
            else:
                fill_side = "LONG"
            group = ensure(coin, fill_side)
            group["wallets"].add(address)
            group["fillValue"] += abs(float(fill.notional_usd or 0.0))
            group["fillCount"] += 1
            group["scoreSum"] += candidate_score
            group["scoreCount"] += 1

    picks: list[dict[str, Any]] = []
    for group in grouped.values():
        opposite = grouped.get(
            (group["coin"], "SHORT" if group["side"] == "LONG" else "LONG")
        )
        exposure = group["positionValue"] + group["fillValue"] * 0.35
        opposite_position = opposite["positionValue"] if opposite else 0.0
        opposite_fill = opposite["fillValue"] if opposite else 0.0
        opposite_exposure = opposite_position + opposite_fill * 0.35
        dominance = (
            exposure / (exposure + opposite_exposure)
            if (exposure + opposite_exposure) > 0
            else 1.0
        )
        avg_score = group["scoreSum"] / group["scoreCount"] if group["scoreCount"] else 0.0
        avg_roe = group["roeWeighted"] / group["roeWeight"] if group["roeWeight"] else 0.0
        wallet_count = len(group["wallets"])
        position_value = group["positionValue"]
        fill_value = group["fillValue"]
        fill_count = group["fillCount"]
        s_pos = position_value / (position_value + POS_CAP)
        s_fill = fill_value / (fill_value + FILL_CAP)
        s_wallet = min(wallet_count, WALLET_CAP) / WALLET_CAP
        s_score = (avg_score - SCORE_FLOOR) / (SCORE_CEIL - SCORE_FLOOR)
        s_dom = (dominance - DOM_FLOOR) / (DOM_CEIL - DOM_FLOOR)
        s_fb = min(fill_count, 3) / 3.0
        raw = (
            12.0
            + 28.0 * _clamp01(s_score)
            + 34.0 * _clamp01(s_pos)
            + 14.0 * _clamp01(s_wallet)
            + 10.0 * _clamp01(s_fill)
            + 8.0 * _clamp01(s_dom)
            + 6.0 * _clamp01(s_fb)
        )
        conviction = max(0.0, min(99.0, raw))
        if conviction < CONVICTION_FLOOR or exposure <= 0:
            continue
        picks.append(
            {
                "coin": group["coin"],
                "side": group["side"],
                "walletCount": len(group["wallets"]),
                "positionValue": group["positionValue"],
                "fillValue": group["fillValue"],
                "fillCount": group["fillCount"],
                "pnl": group["pnl"],
                "avgScore": avg_score,
                "avgRoe": avg_roe,
                "dominance": dominance,
                "conviction": conviction,
            }
        )
    picks.sort(key=lambda pick: pick["conviction"], reverse=True)
    return picks


def _top_radar_payload(query: dict[str, list[str]]) -> dict[str, Any]:
    top_n = int(_float_query(query, "top", 5))
    pool = int(_float_query(query, "pool", 48))
    scan_limit = int(_float_query(query, "scan_limit", 24))
    min_score = _float_query(query, "min_score", 45.0)
    lookback = _float_query(query, "lookback_hours", 6.0)
    candidates, refreshed = _cached_leaderboard_candidates(pool=pool, min_score=min_score)
    saved_candidates = save_candidate_observations(candidates) if refreshed else 0
    watched = {item.address for item in _watchlist()}
    max_top = max(1, min(20, top_n))
    max_scan = max(max_top, min(max(1, pool), max(1, scan_limit)))
    selected: list[tuple[int, SmartMoneyCandidate, SmartMoneyWalletSnapshot]] = []
    fetched_snapshots: list[SmartMoneyWalletSnapshot] = []
    chunk_size = 10
    with HyperliquidInfoClient() as client:
        for offset in range(0, min(len(candidates), max_scan), chunk_size):
            chunk = candidates[offset : offset + chunk_size]
            wallets = tuple(
                SmartMoneyWallet(
                    label=_radar_label(candidate, offset + idx),
                    address=candidate.address,
                    tags=tuple(_radar_tags(candidate)),
                    weight=1.0,
                    enabled=True,
                    notes=_radar_summary(candidate),
                )
                for idx, candidate in enumerate(chunk, start=1)
            )
            snapshots = fetch_smart_money_snapshots(
                client=client,
                wallets=wallets,
                lookback_hours=lookback,
            )
            fetched_snapshots.extend(snapshots)
            snapshot_by_address = {item.wallet.address: item for item in snapshots}
            for idx, candidate in enumerate(chunk, start=offset + 1):
                snapshot = snapshot_by_address.get(candidate.address)
                if snapshot is None:
                    continue
                if not snapshot.open_positions:
                    continue
                selected.append((idx, candidate, snapshot))
                if len(selected) >= max_top:
                    break
            if len(selected) >= max_top:
                break
    saved_snapshots = save_wallet_snapshots(tuple(fetched_snapshots))
    return {
        "source": "hyperliquid_stats_leaderboard",
        "lookback_hours": lookback,
        "scanned_candidates": min(len(candidates), max_scan),
        "position_wallets": len(selected),
        "candidate_cache_refreshed": refreshed,
        "saved": {
            "candidate_observations": saved_candidates,
            **saved_snapshots,
        },
        "wallets": [
            {
                "rank": rank,
                "candidate": {
                    **_candidate_to_json(candidate),
                    "radar_label": _radar_label(candidate, rank),
                    "radar_tags": _radar_tags(candidate),
                    "radar_summary": _radar_summary(candidate),
                    "watched": candidate.address in watched,
                },
                "snapshot": _snapshot_to_json(snapshot),
            }
            for rank, candidate, snapshot in selected
        ],
        "picks": _compute_whale_picks(selected),
    }


def _top_radar_cache_key(query: dict[str, list[str]]) -> str:
    top_n = int(_float_query(query, "top", 5))
    pool = int(_float_query(query, "pool", 48))
    scan_limit = int(_float_query(query, "scan_limit", 24))
    min_score = _float_query(query, "min_score", 45.0)
    lookback = _float_query(query, "lookback_hours", 6.0)
    return f"radar_top:{top_n}:{pool}:{scan_limit}:{min_score:.2f}:{lookback:.2f}"


def _cached_leaderboard_candidates(
    *,
    pool: int,
    min_score: float,
    ttl_seconds: float = 300.0,
) -> tuple[tuple[SmartMoneyCandidate, ...], bool]:
    now = time.time()
    with _CANDIDATE_CACHE_LOCK:
        cached = tuple(_CANDIDATE_CACHE.get("candidates") or ())
        if (
            cached
            and now < float(_CANDIDATE_CACHE.get("expires_at") or 0)
            and int(_CANDIDATE_CACHE.get("pool") or 0) >= pool
            and float(_CANDIDATE_CACHE.get("min_score") or 0.0) <= min_score
        ):
            filtered = tuple(item for item in cached if item.score >= min_score)
            return filtered[:pool], False

    candidates = fetch_leaderboard_candidates(limit=pool, min_score=min_score)
    with _CANDIDATE_CACHE_LOCK:
        _CANDIDATE_CACHE.update(
            {
                "expires_at": now + ttl_seconds,
                "pool": pool,
                "min_score": min_score,
                "candidates": candidates,
            }
        )
    return candidates, True


def _watchlist() -> tuple[SmartMoneyWallet, ...]:
    write_default_smart_money_watchlist()
    return load_smart_money_watchlist()


def _float_query(query: dict[str, list[str]], key: str, default: float) -> float:
    try:
        return float((query.get(key) or [default])[0])
    except (TypeError, ValueError):
        return default


def _match_wallet_route(path: str) -> tuple[str, str] | None:
    """Return (action, address) for /api/wallet/<addr>/<action> paths."""
    if not path.startswith("/api/wallet/"):
        return None
    parts = path.split("/")
    if len(parts) != 5:
        return None
    _root, api, wallet, address, action = parts
    if api != "api" or wallet != "wallet" or not address or not action:
        return None
    if action not in {"history", "fills", "positions"}:
        return None
    return action, address


def _cached_response(key: str, ttl: float, builder: Any) -> Any:
    now = time.time()
    with _RESPONSE_CACHE_LOCK:
        cached = _RESPONSE_CACHE.get(key)
        if cached is not None and now < cached[0]:
            return cached[1]

        build_lock = _RESPONSE_BUILD_LOCKS.get(key)
        if build_lock is None:
            build_lock = threading.Lock()
            _RESPONSE_BUILD_LOCKS[key] = build_lock

    with build_lock:
        now = time.time()
        with _RESPONSE_CACHE_LOCK:
            cached = _RESPONSE_CACHE.get(key)
            if cached is not None and now < cached[0]:
                return cached[1]
        try:
            value = builder()
        except Exception:
            with _RESPONSE_CACHE_LOCK:
                cached = _RESPONSE_CACHE.get(key)
            if cached is not None:
                value = dict(cached[1]) if isinstance(cached[1], dict) else cached[1]
                if isinstance(value, dict):
                    value["cache_status"] = "stale_on_error"
                    value["cache_error_at_ms"] = int(time.time() * 1000)
                return value
            raise
        with _RESPONSE_CACHE_LOCK:
            _RESPONSE_CACHE[key] = (now + ttl, value)
            return value


def _consume_api_rate_limit(client_id: str) -> tuple[bool, int]:
    now = time.monotonic()
    with _RATE_LIMIT_LOCK:
        window_start, count = _RATE_LIMIT_BUCKETS.get(client_id, (now, 0))
        elapsed = now - window_start
        if elapsed >= API_RATE_LIMIT_WINDOW_SECONDS:
            _RATE_LIMIT_BUCKETS[client_id] = (now, 1)
            return True, 0
        if count >= API_RATE_LIMIT_MAX_REQUESTS:
            retry_after = max(1, math.ceil(API_RATE_LIMIT_WINDOW_SECONDS - elapsed))
            return False, retry_after
        _RATE_LIMIT_BUCKETS[client_id] = (window_start, count + 1)
        if len(_RATE_LIMIT_BUCKETS) > 1000:
            stale_before = now - API_RATE_LIMIT_WINDOW_SECONDS
            for key, (started_at, _requests) in tuple(_RATE_LIMIT_BUCKETS.items()):
                if started_at < stale_before:
                    _RATE_LIMIT_BUCKETS.pop(key, None)
        return True, 0


def _wallet_history_payload(address: str) -> dict[str, Any]:
    candidates = load_candidate_history(address, limit=500)
    snapshots = load_snapshot_history(address, limit=500)
    return {"address": address, "candidates": candidates, "snapshots": snapshots}


def _wallet_fills_payload(address: str, limit: int) -> dict[str, Any]:
    fills = load_fills(address=address, limit=limit)
    return {"address": address, "fills": fills}


def _wallet_positions_payload(address: str) -> dict[str, Any]:
    positions = load_position_history(address, limit=200)
    return {"address": address, "positions": positions}


def _coins_flow_payload(lookback_hours: float) -> dict[str, Any]:
    since_ms = int(time.time() * 1000) - int(lookback_hours * 3600 * 1000)
    coins = load_coin_flow(since_ms=since_ms)
    return {
        "lookback_hours": lookback_hours,
        "since_ms": since_ms,
        "coins": coins,
    }


def _stats_overview_payload() -> dict[str, Any]:
    storage = smart_money_storage_stats()
    now_ms = int(time.time() * 1000)
    since_ms = now_ms - 6 * 3600 * 1000
    flow = load_coin_flow(since_ms=since_ms)
    long_usd = sum(row["position_usd"] for row in flow if row["side"] == "LONG")
    short_usd = sum(row["position_usd"] for row in flow if row["side"] == "SHORT")
    coin_totals: dict[str, float] = {}
    for row in flow:
        coin_totals[row["coin"]] = coin_totals.get(row["coin"], 0.0) + row["position_usd"]
    top_coins = sorted(
        ({"coin": coin, "position_usd": usd} for coin, usd in coin_totals.items()),
        key=lambda item: item["position_usd"],
        reverse=True,
    )[:10]
    return {
        "storage": storage,
        "exposure": {"long_usd": long_usd, "short_usd": short_usd},
        "top_coins": top_coins,
        "generated_at_ms": now_ms,
    }


def _wallet_to_json(wallet: SmartMoneyWallet) -> dict[str, Any]:
    return {
        "label": wallet.label,
        "address": wallet.address,
        "short_address": wallet.short_address,
        "tags": list(wallet.tags),
        "weight": wallet.weight,
        "enabled": wallet.enabled,
        "notes": wallet.notes,
    }


def _snapshot_to_json(snapshot: SmartMoneyWalletSnapshot) -> dict[str, Any]:
    return {
        "wallet": _wallet_to_json(snapshot.wallet),
        "score": snapshot.score,
        "verdict": snapshot.verdict,
        "closed_pnl_usd": snapshot.closed_pnl_usd,
        "fees_usd": snapshot.fees_usd,
        "volume_usd": snapshot.volume_usd,
        "newest_fill_ms": snapshot.newest_fill_ms,
        "newest_fill_age_minutes": snapshot.newest_fill_age_minutes,
        "error": snapshot.error,
        "recent_fills": [asdict(item) for item in snapshot.recent_fills[:25]],
        "open_positions": [asdict(item) for item in snapshot.open_positions],
    }


def _candidate_to_json(candidate: SmartMoneyCandidate) -> dict[str, Any]:
    return asdict(candidate) | {"short_address": candidate.short_address}


def _radar_label(candidate: SmartMoneyCandidate, rank: int) -> str:
    labels = set(candidate.labels)
    behavior_flag = _behavior_flag(candidate)
    if behavior_flag == "insider_suspect":
        persona = "상위 성과 고래"
    elif behavior_flag == "insider_watch":
        persona = "고점수 관찰 지갑"
    elif behavior_flag == "winrate_monster":
        persona = "승률 괴물급"
    elif candidate.month_roi >= Decimal("0.35") and candidate.month_pnl > 0:
        persona = "고수익 추세 고래"
    elif "mega_whale" in labels or candidate.account_value >= Decimal("1000000"):
        persona = "대형 수익 고래"
    elif "high_volume" in labels or candidate.month_volume >= Decimal("10000000"):
        persona = "고회전 트레이더"
    elif "recently_consistent" in labels:
        persona = "안정 수익 지갑"
    elif candidate.week_pnl > 0 and candidate.day_pnl > 0:
        persona = "단기 모멘텀 지갑"
    elif candidate.all_time_pnl > 0:
        persona = "누적 수익 랭커"
    else:
        persona = "관찰 후보 지갑"
    return f"#{rank} {persona}"


def _behavior_flag(candidate: SmartMoneyCandidate) -> str:
    breakdown = candidate.score_breakdown
    score = Decimal(str(candidate.score))
    skill = Decimal(str(breakdown.skill))
    consistency = Decimal(str(breakdown.consistency))
    activity = Decimal(str(breakdown.activity))
    risk_penalty = Decimal(str(breakdown.risk_penalty))
    if (
        score >= Decimal("88")
        and skill >= Decimal("30")
        and consistency >= Decimal("16")
        and activity >= Decimal("8")
        and risk_penalty <= Decimal("8")
        and candidate.month_roi >= Decimal("0.30")
        and candidate.month_pnl > 0
        and candidate.week_pnl > 0
    ):
        return "insider_suspect"
    if (
        score >= Decimal("82")
        and skill >= Decimal("26")
        and consistency >= Decimal("14")
        and candidate.month_roi >= Decimal("0.22")
        and candidate.month_pnl > 0
    ):
        return "insider_watch"
    if (
        score >= Decimal("75")
        and consistency >= Decimal("15")
        and candidate.month_pnl > 0
        and candidate.week_pnl > 0
    ):
        return "winrate_monster"
    return ""


def _radar_tags(candidate: SmartMoneyCandidate) -> list[str]:
    tags: list[str] = []
    behavior_flag = _behavior_flag(candidate)
    if behavior_flag == "insider_suspect":
        tags.append("상위 성과")
    elif behavior_flag == "insider_watch":
        tags.append("고점수 후보")
    elif behavior_flag == "winrate_monster":
        tags.append("승률 괴물")
    if candidate.account_value >= Decimal("1000000"):
        tags.append("대형")
    elif candidate.account_value >= Decimal("100000"):
        tags.append("중대형")
    if candidate.month_pnl > 0:
        tags.append("월간+")
    if candidate.week_pnl > 0:
        tags.append("주간+")
    if candidate.month_roi >= Decimal("0.25"):
        tags.append("고ROI")
    if candidate.month_volume >= Decimal("10000000"):
        tags.append("고거래량")
    if "cooling" in candidate.labels:
        tags.append("냉각")
    return tags[:5] or ["관찰"]


def _radar_summary(candidate: SmartMoneyCandidate) -> str:
    parts: list[str] = []
    if candidate.account_value > 0:
        parts.append(f"계정 ${_compact_decimal(candidate.account_value)}")
    if candidate.month_pnl:
        parts.append(f"월PnL ${_compact_decimal(candidate.month_pnl)}")
    if candidate.month_roi:
        parts.append(f"월ROI {candidate.month_roi * Decimal('100'):.1f}%")
    if candidate.week_pnl:
        parts.append(f"주간 ${_compact_decimal(candidate.week_pnl)}")
    return " · ".join(parts) or "leaderboard 기반 관찰 후보"


def _compact_decimal(value: Decimal) -> str:
    sign = "-" if value < 0 else ""
    amount = abs(value)
    if amount >= Decimal("1000000000"):
        return f"{sign}{amount / Decimal('1000000000'):.2f}B"
    if amount >= Decimal("1000000"):
        return f"{sign}{amount / Decimal('1000000'):.2f}M"
    if amount >= Decimal("1000"):
        return f"{sign}{amount / Decimal('1000'):.1f}K"
    return f"{sign}{amount:.0f}"


def _empty_snapshot_for_candidate(
    candidate: SmartMoneyCandidate,
    rank: int,
) -> SmartMoneyWalletSnapshot:
    return SmartMoneyWalletSnapshot(
        wallet=SmartMoneyWallet(
            label=_radar_label(candidate, rank),
            address=candidate.address,
            tags=tuple(_radar_tags(candidate)),
            notes=_radar_summary(candidate),
        ),
        score=0.0,
        verdict="NO_SNAPSHOT",
        recent_fills=(),
        open_positions=(),
        closed_pnl_usd=Decimal("0"),
        fees_usd=Decimal("0"),
        volume_usd=Decimal("0"),
        newest_fill_ms=None,
        error="snapshot unavailable",
    )


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Path):
        return str(value)
    return str(value)


_HTML = r"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>고래지갑추적기</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070a0f;
      --panel: #0d141d;
      --panel2: #101a26;
      --line: #1d2b3b;
      --line2: #2f4359;
      --text: #eef5ff;
      --muted: #8191a5;
      --soft: #b9c9dc;
      --accent: #19d3c5;
      --green: #00d084;
      --red: #ff4d68;
      --yellow: #f5b942;
      --blue: #60a5fa;
      --violet: #a78bfa;
      --cyan: #22d3ee;
      --shadow: 0 20px 70px rgba(0, 0, 0, .34);
      --radius: 18px;
      --mono: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
      --ui: "Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      background:
        radial-gradient(circle at 12% -10%, rgba(25, 211, 197, .22), transparent 28%),
        radial-gradient(circle at 90% 0%, rgba(96, 165, 250, .15), transparent 24%),
        linear-gradient(180deg, #08101a 0%, var(--bg) 44%, #05070b 100%);
      color: var(--text);
      font-family: var(--ui);
    }

    button, input, select {
      font: inherit;
      color: var(--text);
      border-radius: 12px;
      border: 1px solid var(--line2);
      background: #0b1420;
      outline: none;
    }
    button {
      cursor: pointer;
      padding: 10px 13px;
      font-weight: 850;
      transition: transform .12s ease, border-color .12s ease, background .12s ease;
    }
    button:hover { border-color: var(--accent); background: #102034; }
    button:active { transform: translateY(1px); }
    button:disabled { cursor: wait; opacity: .55; }
    input, select { padding: 10px 12px; }
    select { min-width: 132px; }

    .shell { max-width: 1700px; margin: 0 auto; padding: 18px; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      margin: -18px -18px 18px;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: rgba(7, 10, 15, .88);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(16px);
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 260px; }
    .logo {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 13px;
      background: linear-gradient(135deg, var(--accent), #3279ff);
      color: #001114;
      font-weight: 950;
      box-shadow: 0 12px 38px rgba(25, 211, 197, .2);
    }
    h1 { margin: 0; font-size: 21px; letter-spacing: -.02em; }
    .subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .primary {
      background: linear-gradient(135deg, var(--accent), #5aa7ff);
      color: #031018;
      border-color: transparent;
    }
    .ghost { background: rgba(13, 20, 29, .82); }

    .dashboard { display: grid; gap: 16px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(360px, .9fr);
      gap: 16px;
    }
    .card {
      background:
        linear-gradient(180deg, rgba(16, 26, 38, .96), rgba(9, 14, 22, .96)),
        linear-gradient(90deg, rgba(255, 255, 255, .04), transparent 32%);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .hero-main { padding: 24px; position: relative; overflow: hidden; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 950; letter-spacing: .12em; }
    .hero-title { max-width: 760px; margin: 10px 0 8px; font-size: 36px; line-height: 1.08; letter-spacing: -.04em; }
    .hero-copy { max-width: 780px; color: var(--soft); line-height: 1.58; font-size: 14px; }
    .status-strip { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 18px; }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 26px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid #294054;
      background: rgba(12, 22, 34, .94);
      color: var(--soft);
      font-size: 12px;
      font-weight: 850;
      white-space: nowrap;
    }
    .pill.good, .good { color: var(--green); }
    .pill.bad, .bad { color: var(--red); }
    .pill.warn, .warn { color: var(--yellow); }
    .pill.info, .info { color: var(--blue); }

    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .metric {
      padding: 15px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(8, 14, 22, .72);
      min-width: 0;
    }
    .metric-label { color: var(--muted); font-size: 12px; font-weight: 850; }
    .metric-value { margin-top: 8px; font: 950 24px/1 var(--mono); letter-spacing: -.03em; }
    .metric-sub { margin-top: 5px; color: var(--muted); font-size: 11px; }

    .board-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 15px 16px;
      border-bottom: 1px solid var(--line);
    }
    .board-title { font-size: 17px; font-weight: 950; }
    .board-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

    .main-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 420px;
      gap: 16px;
      align-items: start;
    }
    .whale-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 12px;
      padding: 14px;
    }
    .whale-card, .candidate-card {
      position: relative;
      display: grid;
      gap: 12px;
      padding: 16px;
      border-radius: 18px;
      border: 1px solid rgba(50, 79, 113, .88);
      background:
        radial-gradient(circle at 86% 12%, rgba(25, 211, 197, .17), transparent 26%),
        linear-gradient(140deg, rgba(14, 25, 40, .98), rgba(7, 12, 20, .98) 62%),
        #09111b;
      cursor: pointer;
      overflow: hidden;
      transition: transform .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease;
    }
    .whale-card::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px),
        linear-gradient(180deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 26px 26px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,.32), transparent 72%);
    }
    .whale-card.elite {
      border-color: rgba(25, 211, 197, .62);
      box-shadow: 0 0 0 1px rgba(25,211,197,.08), 0 18px 50px rgba(25, 211, 197, .08);
    }
    .whale-card.insider {
      border-color: rgba(167, 139, 250, .72);
      background:
        radial-gradient(circle at 86% 12%, rgba(167, 139, 250, .22), transparent 28%),
        linear-gradient(140deg, rgba(16, 20, 42, .98), rgba(7, 12, 20, .98) 62%);
    }
    .whale-card:hover, .whale-card.selected, .candidate-card:hover, .candidate-card.selected {
      transform: translateY(-2px);
      border-color: rgba(25, 211, 197, .72);
      box-shadow: 0 18px 54px rgba(0, 0, 0, .36), 0 0 0 1px rgba(25,211,197,.08);
      background:
        radial-gradient(circle at top right, rgba(25, 211, 197, .18), transparent 42%),
        #0b1725;
    }
    .whale-top, .candidate-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .whale-title-row { display: flex; align-items: center; gap: 11px; min-width: 0; }
    .wallet-rank {
      position: absolute;
      top: 12px;
      right: 78px;
      color: rgba(185, 201, 220, .54);
      font: 900 11px/1 var(--mono);
      letter-spacing: .08em;
    }
    .pixel-whale {
      width: 48px;
      height: 48px;
      flex: 0 0 48px;
      border-radius: 15px;
      border: 1px solid rgba(25, 211, 197, .55);
      background:
        radial-gradient(circle at 70% 28%, #02131a 0 6%, transparent 7%),
        linear-gradient(90deg, transparent 0 15%, #21e3d8 15% 82%, transparent 82%),
        linear-gradient(180deg, transparent 0 22%, #1188d6 22% 74%, transparent 74%),
        #081522;
      image-rendering: pixelated;
      position: relative;
      box-shadow:
        inset 0 0 0 3px rgba(255,255,255,.045),
        0 0 0 4px rgba(25,211,197,.045),
        0 0 28px rgba(25,211,197,.24);
    }
    .pixel-whale::before {
      content: "";
      position: absolute;
      width: 8px;
      height: 8px;
      right: 11px;
      top: 15px;
      background: #001119;
      border-radius: 3px;
      box-shadow:
        -23px 12px 0 3px #21e3d8,
        -30px 14px 0 0 #21e3d8,
        22px 9px 0 3px #1188d6,
        28px 6px 0 0 #1188d6,
        -2px -12px 0 -2px #e9fbff;
    }
    .pixel-whale::after {
      content: "";
      position: absolute;
      left: 10px;
      bottom: 9px;
      width: 25px;
      height: 5px;
      background: rgba(255,255,255,.78);
      border-radius: 2px;
      box-shadow: 5px -4px 0 -1px rgba(255,255,255,.56);
    }
    .name { font-weight: 950; font-size: 16px; word-break: break-word; }
    .name.hot { color: #f5f0ff; text-shadow: 0 0 20px rgba(167,139,250,.22); }
    .address { margin-top: 4px; color: var(--muted); font: 12px var(--mono); }
    .score-ring {
      --score: 0;
      width: 58px;
      height: 58px;
      flex: 0 0 58px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: conic-gradient(var(--accent) calc(var(--score) * 1%), #182638 0);
      position: relative;
    }
    .score-ring::after {
      content: "";
      position: absolute;
      inset: 6px;
      border-radius: 50%;
      background: #09111b;
    }
    .score-ring span { position: relative; z-index: 1; font: 950 14px var(--mono); }
    .score-ring small {
      position: absolute;
      z-index: 1;
      bottom: 9px;
      color: var(--muted);
      font: 800 8px/1 var(--mono);
      letter-spacing: .08em;
    }
    .stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .stat { padding: 9px; border-radius: 12px; background: rgba(255, 255, 255, .04); border: 1px solid rgba(255,255,255,.035); }
    .stat .k { color: var(--muted); font-size: 11px; }
    .stat .v { margin-top: 4px; font: 850 15px var(--mono); }
    .label-row { display: flex; gap: 6px; flex-wrap: wrap; min-height: 27px; }
    .summary { color: var(--soft); font-size: 12px; line-height: 1.45; }
    .position-mini { display: grid; gap: 8px; }
    .position-card {
      position: relative;
      display: grid;
      gap: 10px;
      padding: 11px;
      border-radius: 14px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, .055), rgba(255, 255, 255, .018)),
        rgba(7, 12, 20, .72);
      border: 1px solid rgba(255, 255, 255, .08);
      overflow: hidden;
    }
    .position-card.long { border-left: 3px solid var(--green); }
    .position-card.short { border-left: 3px solid var(--red); }
    .position-card.long::before, .position-card.short::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at 100% 0%, rgba(0, 208, 132, .12), transparent 34%);
    }
    .position-card.short::before { background: radial-gradient(circle at 100% 0%, rgba(255, 77, 104, .14), transparent 34%); }
    .position-head {
      display: grid;
      grid-template-columns: minmax(76px, .9fr) auto minmax(108px, 1fr) auto;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      position: relative;
      z-index: 1;
    }
    .coin-block { min-width: 0; }
    .coin-block strong { display: block; font-size: 13px; letter-spacing: -.01em; }
    .coin-block .sub { margin-top: 2px; color: var(--muted); font: 10px var(--mono); }
    .side-badge {
      min-width: 36px;
      text-align: center;
      padding: 5px 8px;
      border-radius: 999px;
      font-weight: 950;
      border: 1px solid currentColor;
      background: rgba(255,255,255,.035);
    }
    .roe-chip {
      justify-self: end;
      min-width: 84px;
      padding: 5px 8px;
      border-radius: 11px;
      text-align: right;
      font: 950 13px/1.15 var(--mono);
      background: rgba(0,0,0,.2);
      border: 1px solid rgba(255,255,255,.06);
    }
    .roe-chip .pnl { display: block; margin-top: 2px; font-size: 10px; opacity: .9; }
    .notional-pill {
      justify-self: end;
      padding: 5px 8px;
      border-radius: 999px;
      color: var(--soft);
      background: rgba(96, 165, 250, .10);
      border: 1px solid rgba(96, 165, 250, .18);
      font: 850 11px var(--mono);
    }
    .price-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      position: relative;
      z-index: 1;
    }
    .price-box {
      padding: 8px;
      border-radius: 10px;
      background: rgba(0, 0, 0, .2);
      border: 1px solid rgba(255, 255, 255, .045);
      min-width: 0;
    }
    .price-box.entry { border-color: rgba(96, 165, 250, .14); }
    .price-box.current { border-color: rgba(25, 211, 197, .14); }
    .price-box.liquidation { border-color: rgba(255, 77, 104, .15); }
    .price-box .k { color: var(--muted); font-size: 10px; }
    .price-box .v { margin-top: 3px; font: 900 12px var(--mono); overflow: hidden; text-overflow: ellipsis; }
    .whale-mascot {
      width: 52px;
      height: 52px;
      flex: 0 0 52px;
      border-radius: 16px;
      overflow: visible;
      filter: drop-shadow(0 0 18px rgba(34, 211, 238, .26));
    }
    .whale-mascot .halo { fill: rgba(13, 24, 38, .92); stroke: rgba(34, 211, 238, .55); stroke-width: 1.4; }
    .whale-mascot .body { fill: url(#whaleBody); }
    .whale-mascot .belly { fill: rgba(238, 250, 255, .82); }
    .whale-mascot .eye { fill: #031018; }
    .whale-mascot .spark { fill: var(--accent); opacity: .95; }
    .position-line {
      display: grid;
      grid-template-columns: 64px 58px minmax(0, 1fr) auto;
      gap: 7px;
      align-items: center;
      padding: 7px 8px;
      border-radius: 10px;
      background: rgba(255, 255, 255, .04);
      font-size: 12px;
    }
    .small { color: var(--muted); font-size: 12px; }
    .mono { font-family: var(--mono); }

    .detail {
      position: sticky;
      top: 86px;
      max-height: calc(100dvh - 104px);
      overflow: auto;
    }
    .detail-inner { padding: 16px; }
    .detail-title { font-size: 18px; font-weight: 950; margin-bottom: 5px; }
    .detail-address { color: var(--muted); font-size: 12px; word-break: break-all; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 14px; }
    .section-title { margin: 18px 0 8px; color: var(--muted); font-size: 12px; font-weight: 900; letter-spacing: .08em; }
    .score-line {
      display: grid;
      grid-template-columns: 72px 1fr 42px;
      align-items: center;
      gap: 8px;
      margin: 8px 0;
      color: var(--soft);
      font-size: 12px;
    }
    .bar { height: 9px; border-radius: 999px; overflow: hidden; background: #182638; }
    .fill { height: 100%; width: var(--pct, 0%); background: var(--accent); }
    .fill.risk { background: var(--red); }

    .pick-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
      padding: 14px;
    }
    .pick-card {
      position: relative;
      display: grid;
      gap: 11px;
      padding: 15px;
      border-radius: 17px;
      border: 1px solid rgba(50, 79, 113, .88);
      background:
        radial-gradient(circle at 92% 12%, rgba(34, 211, 238, .17), transparent 30%),
        linear-gradient(150deg, rgba(13, 24, 38, .98), rgba(7, 12, 20, .98));
      overflow: hidden;
    }
    .pick-card.long { border-left: 4px solid var(--green); }
    .pick-card.short { border-left: 4px solid var(--red); }
    .pick-card::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(110deg, transparent 0 48%, rgba(255,255,255,.05) 50%, transparent 54%);
      opacity: .5;
    }
    .pick-top, .pick-main, .pick-stats { position: relative; z-index: 1; }
    .pick-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .pick-symbol { font: 950 22px/1 var(--mono); letter-spacing: -.03em; }
    .direction-badge {
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid currentColor;
      font-weight: 950;
      letter-spacing: .02em;
    }
    .pick-main {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: end;
    }
    .conviction {
      font: 950 30px/1 var(--mono);
      color: var(--accent);
      text-shadow: 0 0 24px rgba(25, 211, 197, .18);
    }
    .pick-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
    }
    .pick-stat {
      padding: 8px;
      border-radius: 11px;
      background: rgba(0, 0, 0, .22);
      border: 1px solid rgba(255,255,255,.045);
    }
    .pick-stat .k { color: var(--muted); font-size: 10px; }
    .pick-stat .v { margin-top: 4px; font: 900 12px var(--mono); }

    .lower-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 16px; }
    .list { display: grid; gap: 8px; padding: 14px; }
    .row {
      display: grid;
      gap: 8px;
      padding: 11px;
      border-radius: 13px;
      border: 1px solid var(--line);
      background: rgba(8, 14, 22, .72);
      cursor: pointer;
    }
    .candidate-row { grid-template-columns: 42px 1fr auto; align-items: center; }
    .flow-row { grid-template-columns: 74px 1fr auto; align-items: center; cursor: default; }
    .empty {
      padding: 26px;
      color: var(--muted);
      text-align: center;
      line-height: 1.6;
    }
    .log {
      padding: 13px 15px;
      color: var(--accent);
      font: 12px/1.55 var(--mono);
      min-height: 48px;
      white-space: pre-wrap;
    }

    @media (max-width: 1180px) {
      .hero, .main-grid, .lower-grid { grid-template-columns: 1fr; }
      .detail { position: static; max-height: none; }
    }
    @media (max-width: 760px) {
      .shell { padding: 12px; }
      .topbar { margin: -12px -12px 12px; align-items: stretch; flex-direction: column; }
      .toolbar { justify-content: stretch; }
      .toolbar > * { flex: 1 1 140px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .hero-title { font-size: 30px; }
      .whale-grid { grid-template-columns: 1fr; }
      .position-line, .position-head, .candidate-row, .flow-row { grid-template-columns: 1fr; }
      .price-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo">HL</div>
        <div>
          <h1>고래지갑추적기</h1>
          <div class="subtitle">현재 포지션이 열린 상위 지갑을 주기적으로 갱신합니다.</div>
        </div>
      </div>
      <div class="toolbar">
        <select id="lookback">
          <option value="3">최근 3시간</option>
          <option value="6" selected>최근 6시간</option>
          <option value="24">최근 24시간</option>
        </select>
        <input id="minScore" type="number" value="45" min="0" max="100" step="5" title="최소 점수" />
        <button class="primary" id="refreshBtn">수동 새로고침</button>
        <button class="ghost" id="pauseBtn">자동 일시정지</button>
      </div>
    </header>

    <main class="dashboard">
      <section class="hero">
        <div class="card hero-main">
          <div class="eyebrow">Hyperliquid 공개 포지션</div>
          <h2 class="hero-title">상위 지갑의 열린 포지션을 확인하세요.</h2>
          <div class="hero-copy">
            페이지가 켜져 있으면 자동으로 랭커 후보를 훑고, 실제로 열린 포지션이 있는 지갑만 골라
            현재 포지션, 최근 체결, 수익 흐름을 바로 보여줍니다.
          </div>
          <div class="status-strip">
            <span class="pill good">자동 추적 ON</span>
            <span class="pill">10초 갱신</span>
            <span class="pill">조회 전용</span>
            <span class="pill">포지션 보유 고래</span>
          </div>
        </div>
        <div class="metrics">
          <div class="metric"><div class="metric-label">포지션 고래</div><div class="metric-value" id="kTop">0</div><div class="metric-sub">최대 12개</div></div>
          <div class="metric"><div class="metric-label">열린 포지션</div><div class="metric-value warn" id="kPositions">0</div><div class="metric-sub">보유 고래 합산</div></div>
          <div class="metric"><div class="metric-label">최근 체결</div><div class="metric-value info" id="kFills">0</div><div class="metric-sub">조회 구간</div></div>
          <div class="metric"><div class="metric-label">롱 노출</div><div class="metric-value good" id="kLong">-</div><div class="metric-sub">포지션 가치</div></div>
          <div class="metric"><div class="metric-label">숏 노출</div><div class="metric-value bad" id="kShort">-</div><div class="metric-sub">포지션 가치</div></div>
          <div class="metric"><div class="metric-label">다음 갱신</div><div class="metric-value" id="kCountdown">-</div><div class="metric-sub" id="kStatus">준비</div></div>
        </div>
      </section>

      <section class="card">
        <div class="board-head">
          <div>
            <div class="board-title">고래 픽 · 체결 급증</div>
            <div class="subtitle">상위 고래들의 열린 포지션과 최근 체결을 묶어서 코인/방향을 추천합니다. 매매 신호가 아니라 관찰 우선순위입니다.</div>
          </div>
          <div class="board-actions">
            <span class="pill warn">조회 전용</span>
            <span class="pill">10초 갱신</span>
          </div>
        </div>
        <div class="pick-grid" id="whalePickBoard">
          <div class="empty">고래 포지션을 집계하는 중입니다.</div>
        </div>
      </section>

      <section class="main-grid">
        <section class="card">
          <div class="board-head">
            <div>
              <div class="board-title">포지션 열린 고래 보드</div>
              <div class="subtitle">점수 높은 후보를 훑어서 실제 포지션을 보유한 지갑만 표시합니다.</div>
            </div>
            <div class="board-actions">
              <span class="pill info" id="lastUpdated">아직 갱신 전</span>
            </div>
          </div>
          <div class="whale-grid" id="topWhaleBoard">
            <div class="empty">자동 탐지를 시작하는 중입니다.</div>
          </div>
        </section>

        <aside class="card detail" id="detailPane">
          <div class="detail-inner">
            <div class="detail-title">상세 패널</div>
            <div class="detail-address">포지션 고래 카드를 누르면 점수 근거와 체결 내역을 표시합니다.</div>
            <div class="empty">첫 갱신 후 자동으로 1위 지갑이 선택됩니다.</div>
          </div>
        </aside>
      </section>

      <section class="lower-grid">
        <section class="card">
          <div class="board-head">
            <div>
              <div class="board-title">포지션 후보 요약</div>
              <div class="subtitle">현재 포지션이 열린 지갑만 간단히 정리합니다.</div>
            </div>
          </div>
          <div class="list" id="candidatePool">
            <div class="empty">자동 갱신 대기 중입니다.</div>
          </div>
        </section>

        <section class="card">
          <div class="board-head">
            <div>
              <div class="board-title">최근 흐름</div>
              <div class="subtitle">포지션 고래들의 최근 체결과 열린 포지션입니다.</div>
            </div>
          </div>
          <div class="list" id="flowList">
            <div class="empty">자동 갱신 대기 중입니다.</div>
          </div>
        </section>
      </section>

      <section class="card log" id="log">자동 탐지 준비 완료.</section>
    </main>
  </div>

  <script>
    let rows = [];
    let autoEnabled = true;
    let selectedAddress = null;
    let refreshTimer = null;
    let countdownTimer = null;
    let nextRefreshAt = 0;
    const refreshMs = 10_000;

    const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    const pctFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    const $ = (id) => document.getElementById(id);

    const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[ch]);

    function money(value) {
      const n = Number(value || 0);
      const sign = n < 0 ? "-" : "";
      const abs = Math.abs(n);
      if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
      if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
      if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
      return `${sign}${fmt.format(abs)}`;
    }

    function signedMoney(value) {
      const n = Number(value || 0);
      return `${n > 0 ? "+" : ""}${money(n)}`;
    }

    function roi(value) {
      const n = Number(value || 0) * 100;
      return `${n > 0 ? "+" : ""}${pctFmt.format(n)}%`;
    }

    function tone(value) {
      const n = Number(value || 0);
      if (n > 0) return "good";
      if (n < 0) return "bad";
      return "";
    }

    async function api(path, opts = {}) {
      const res = await fetch(path, opts);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return await res.json();
    }

    function log(message) {
      $("log").textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    }

    function setStatus(status) {
      $("kStatus").textContent = status;
    }

    function scheduleNext() {
      clearTimeout(refreshTimer);
      clearInterval(countdownTimer);
      if (!autoEnabled) {
        $("kCountdown").textContent = "정지";
        return;
      }
      nextRefreshAt = Date.now() + refreshMs;
      refreshTimer = setTimeout(() => loadRadar(), refreshMs);
      countdownTimer = setInterval(renderCountdown, 1000);
      renderCountdown();
    }

    function renderCountdown() {
      if (!autoEnabled || !nextRefreshAt) {
        $("kCountdown").textContent = "정지";
        return;
      }
      const left = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
      $("kCountdown").textContent = `${left}s`;
    }

    async function loadRadar() {
      try {
        setStatus("갱신중");
        $("refreshBtn").disabled = true;
        const minScore = encodeURIComponent($("minScore").value || 45);
        const lookback = encodeURIComponent($("lookback").value || 6);
        const data = await api(`/api/radar/top?top=12&pool=160&scan_limit=80&min_score=${minScore}&lookback_hours=${lookback}`);
        rows = data.wallets || [];
        renderAll();
        setStatus("정상");
        $("lastUpdated").textContent = `갱신 ${new Date().toLocaleTimeString()}`;
        log(`포지션 열린 고래 ${rows.length}개 자동 갱신 완료`);
      } catch (error) {
        setStatus("오류");
        log(`자동 갱신 실패: ${error.message}`);
      } finally {
        $("refreshBtn").disabled = false;
        scheduleNext();
      }
    }

    async function addWallet(address, label) {
      try {
        await api("/api/watchlist", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            address,
            label: label || address.slice(0, 10),
            tags: ["auto-radar"],
            weight: 1.0,
            enabled: true,
            notes: "Added from auto smart-money radar",
          }),
        });
        rows = rows.map((row) => (
          row.candidate.address === address
            ? {...row, candidate: {...row.candidate, watched: true}}
            : row
        ));
        renderAll();
        log(`관심 지갑 등록: ${address}`);
      } catch (error) {
        log(`관심 지갑 등록 실패: ${error.message}`);
      }
    }

    function renderAll() {
      renderSummary();
      renderWhalePicks();
      renderTopWhales();
      renderCandidatePool();
      renderFlow();
      const selected = rows.find((row) => row.candidate.address === selectedAddress) || rows[0];
      if (selected) renderDetail(selected);
    }

    function renderWhalePicks() {
      const picks = buildWhalePicks().slice(0, 4);
      const board = $("whalePickBoard");
      if (!board) return;
      if (!picks.length) {
        board.innerHTML = '<div class="empty">아직 방향이 모이는 고래 포지션이 없습니다.</div>';
        return;
      }
      board.innerHTML = picks.map((pick, index) => pickCard(pick, index)).join("");
    }

    function buildWhalePicks() {
      const grouped = new Map();
      const ensure = (coin, side) => {
        const key = `${coin}:${side}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            coin,
            side,
            wallets: new Set(),
            positionValue: 0,
            fillValue: 0,
            fillCount: 0,
            pnl: 0,
            scoreSum: 0,
            scoreCount: 0,
            roeWeighted: 0,
            roeWeight: 0,
          });
        }
        return grouped.get(key);
      };

      for (const row of rows) {
        const address = row.candidate.address;
        const candidateScore = Number(row.candidate.score || 0);
        const snapshot = row.snapshot || {};
        for (const position of snapshot.open_positions || []) {
          const coin = String(position.coin || "").toUpperCase();
          const side = String(position.side || "").toUpperCase();
          if (!coin || !["LONG", "SHORT"].includes(side)) continue;
          const value = Math.abs(Number(position.position_value || 0));
          const group = ensure(coin, side);
          group.wallets.add(address);
          group.positionValue += value;
          group.pnl += Number(position.unrealized_pnl || 0);
          group.scoreSum += candidateScore;
          group.scoreCount += 1;
          const roe = Number(position.roe_pct || 0);
          if (value > 0 && Number.isFinite(roe)) {
            group.roeWeighted += roe * value;
            group.roeWeight += value;
          }
        }

        for (const fill of snapshot.recent_fills || []) {
          const coin = String(fill.coin || "").toUpperCase();
          const direction = String(fill.direction || "").toLowerCase();
          if (!coin || direction.includes("close")) continue;
          const side = direction.includes("short") ? "SHORT" : direction.includes("long") ? "LONG" : fill.side === "A" ? "SHORT" : "LONG";
          const group = ensure(coin, side);
          group.wallets.add(address);
          group.fillValue += Math.abs(Number(fill.notional_usd || 0));
          group.fillCount += 1;
          group.scoreSum += candidateScore;
          group.scoreCount += 1;
        }
      }

      const picks = [];
      for (const group of grouped.values()) {
        const opposite = grouped.get(`${group.coin}:${group.side === "LONG" ? "SHORT" : "LONG"}`);
        const exposure = group.positionValue + group.fillValue * 0.35;
        const oppositeExposure = (opposite?.positionValue || 0) + (opposite?.fillValue || 0) * 0.35;
        const dominance = exposure + oppositeExposure > 0 ? exposure / (exposure + oppositeExposure) : 1;
        const avgScore = group.scoreCount ? group.scoreSum / group.scoreCount : 0;
        const avgRoe = group.roeWeight ? group.roeWeighted / group.roeWeight : 0;
        const conviction = Math.max(0, Math.min(99,
          avgScore * 0.38
          + group.wallets.size * 13
          + Math.log10(group.positionValue + 1) * 9
          + Math.log10(group.fillValue + 1) * 7
          + (dominance - 0.5) * 32
          + (group.fillCount >= 3 ? 6 : 0)
        ));
        if (conviction < 35 || exposure <= 0) continue;
        picks.push({
          ...group,
          walletCount: group.wallets.size,
          dominance,
          avgScore,
          avgRoe,
          conviction,
        });
      }
      return picks.sort((a, b) => b.conviction - a.conviction);
    }

    function pickCard(pick, index) {
      const sideClass = pick.side === "LONG" ? "good" : "bad";
      const sideKind = pick.side === "LONG" ? "long" : "short";
      const sideLabel = pick.side === "LONG" ? "롱" : "숏";
      const advice = pick.side === "LONG" ? "롱 포지션" : "숏 포지션";
      return `
        <article class="pick-card ${sideKind}">
          <div class="pick-top">
            <div>
              <div class="small">집중 종목 #${index + 1}</div>
              <div class="pick-symbol">${esc(pick.coin)}</div>
            </div>
            <span class="direction-badge ${sideClass}">${sideLabel}</span>
          </div>
          <div class="pick-main">
            <div>
              <div class="small">${advice} · 방향 일치 ${(pick.dominance * 100).toFixed(0)}%</div>
              <div class="summary">${pick.walletCount}개 지갑이 같은 방향으로 노출되어 있습니다.</div>
            </div>
            <div class="conviction">${pick.conviction.toFixed(0)}</div>
          </div>
          <div class="pick-stats">
            <div class="pick-stat"><div class="k">포지션</div><div class="v">$${money(pick.positionValue)}</div></div>
            <div class="pick-stat"><div class="k">최근 체결</div><div class="v">$${money(pick.fillValue)}</div></div>
            <div class="pick-stat"><div class="k">평균 ROE</div><div class="v ${tone(pick.avgRoe)}">${pick.avgRoe > 0 ? "+" : ""}${pick.avgRoe.toFixed(2)}%</div></div>
          </div>
        </article>
      `;
    }

    function renderSummary() {
      const positions = rows.flatMap((row) => row.snapshot.open_positions || []);
      const fills = rows.flatMap((row) => row.snapshot.recent_fills || []);
      let longValue = 0;
      let shortValue = 0;
      for (const position of positions) {
        const value = Math.abs(Number(position.position_value || 0));
        if (position.side === "LONG") longValue += value;
        else shortValue += value;
      }
      $("kTop").textContent = rows.length;
      $("kPositions").textContent = positions.length;
      $("kFills").textContent = fills.length;
      $("kLong").textContent = longValue > 0 ? `$${money(longValue)}` : "-";
      $("kShort").textContent = shortValue > 0 ? `$${money(shortValue)}` : "-";
    }

    function renderTopWhales() {
      if (!rows.length) {
        $("topWhaleBoard").innerHTML = '<div class="empty">현재 열린 포지션을 가진 고래를 찾지 못했습니다. 최소 점수를 낮추거나 다음 갱신을 기다리세요.</div>';
        return;
      }
      $("topWhaleBoard").innerHTML = rows.map((row, index) => whaleCard(row, index)).join("");
      markSelected(selectedAddress || rows[0].candidate.address);
    }

    function whaleCard(row, index) {
      const candidate = row.candidate;
      const snapshot = row.snapshot || {};
      const score = Math.max(0, Math.min(100, Number(candidate.score || 0)));
      const positions = snapshot.open_positions || [];
      const fills = snapshot.recent_fills || [];
      const label = candidate.radar_label || cleanName(candidate);
      const tags = (candidate.radar_tags || []).map((tag) => `<span class="pill">${esc(tag)}</span>`).join("");
      const positionHtml = positions.slice(0, 3).map((position) => positionCard(position, fills)).join("");
      const newest = fills[0];
      return `
        <article class="whale-card" data-address="${esc(candidate.address)}">
          <div class="whale-top">
            <div class="whale-title-row">
              <div class="pixel-whale" aria-hidden="true"></div>
              <div>
                <div class="name">${esc(label)}</div>
                <div class="address">${esc(candidate.short_address || candidate.address)}</div>
              </div>
            </div>
            <div class="score-ring" style="--score:${score}">
              <span>${score.toFixed(0)}</span>
            </div>
          </div>
          <div class="label-row">${tags || '<span class="pill">관찰</span>'}</div>
          <div class="stat-grid">
            <div class="stat"><div class="k">계정</div><div class="v">$${money(candidate.account_value)}</div></div>
            <div class="stat"><div class="k">월 ROI</div><div class="v ${tone(candidate.month_roi)}">${roi(candidate.month_roi)}</div></div>
            <div class="stat"><div class="k">월 PnL</div><div class="v ${tone(candidate.month_pnl)}">$${signedMoney(candidate.month_pnl)}</div></div>
            <div class="stat"><div class="k">체결</div><div class="v">${fills.length}</div></div>
          </div>
          <div class="summary">${esc(candidate.radar_summary || "")}</div>
          <div class="position-mini">
            ${positionHtml || '<div class="position-line"><span class="small">포지션 데이터 없음</span></div>'}
          </div>
          <div class="small">
            ${newest ? `최근 ${esc(newest.coin)} ${newest.side === "B" ? "매수" : "매도"} · $${money(newest.notional_usd)}` : "최근 체결 없음"}
          </div>
          <div>
            ${candidate.watched ? '<span class="pill good">관심 등록됨</span>' : `<button class="add-wallet" data-address="${esc(candidate.address)}" data-label="${esc(label)}">관심 등록</button>`}
          </div>
        </article>
      `;
    }

    function renderCandidatePool() {
      if (!rows.length) {
        $("candidatePool").innerHTML = '<div class="empty">현재 포지션이 열린 후보가 없습니다.</div>';
        return;
      }
      $("candidatePool").innerHTML = rows.map((row) => {
        const c = row.candidate;
        return `
          <div class="row candidate-row" data-address="${esc(c.address)}">
            <div class="mono">${row.rank}</div>
            <div>
              <div class="name">${esc(c.radar_label || cleanName(c))}</div>
              <div class="address">${esc(c.short_address || c.address)}</div>
            </div>
            <div class="mono ${tone(c.month_pnl)}">$${signedMoney(c.month_pnl)}</div>
          </div>
        `;
      }).join("");
    }

    function renderFlow() {
      const fills = rows
        .flatMap((row) => (row.snapshot.recent_fills || []).map((fill) => ({...fill, label: row.candidate.radar_label})))
        .sort((a, b) => Number(b.time_ms || 0) - Number(a.time_ms || 0))
        .slice(0, 10);
      const positions = rows
        .flatMap((row) => (row.snapshot.open_positions || []).map((position) => ({...position, label: row.candidate.radar_label, fills: row.snapshot.recent_fills || []})))
        .slice(0, 10);

      const fillHtml = fills.map((fill) => `
        <div class="row flow-row">
          <div class="mono small">${timeLabel(fill.time_ms)}</div>
          <div>
            <div class="name">${esc(fill.coin)} <span class="${fill.side === "B" ? "good" : "bad"}">${fill.side === "B" ? "매수" : "매도"}</span></div>
            <div class="address">${esc(fill.label)} · ${esc(fill.direction || fill.side)}</div>
          </div>
          <div class="mono">$${money(fill.notional_usd)}</div>
        </div>
      `).join("");
      const positionHtml = positions.map((position) => positionCard(position, position.fills || [], true)).join("");
      $("flowList").innerHTML = `
        <div class="section-title">최근 체결</div>
        ${fillHtml || '<div class="empty">최근 체결이 없습니다.</div>'}
        <div class="section-title">열린 포지션</div>
        ${positionHtml || '<div class="empty">열린 포지션이 없습니다.</div>'}
      `;
    }

    function renderDetail(row) {
      selectedAddress = row.candidate.address;
      markSelected(selectedAddress);
      const candidate = row.candidate;
      const snapshot = row.snapshot || {};
      const positions = snapshot.open_positions || [];
      const fills = snapshot.recent_fills || [];
      const score = Number(candidate.score || 0);
      $("detailPane").innerHTML = `
        <div class="detail-inner">
          <div class="detail-title">${esc(candidate.radar_label || cleanName(candidate))}</div>
          <div class="detail-address mono">${esc(candidate.address)}</div>
          <div class="status-strip">
            ${(candidate.radar_tags || []).map((tag) => `<span class="pill">${esc(tag)}</span>`).join("")}
            ${candidate.watched ? '<span class="pill good">관심 등록됨</span>' : ""}
          </div>
          <div class="detail-grid">
            ${metric("점수", score.toFixed(1), score >= 70 ? "good" : score >= 50 ? "warn" : "")}
            ${metric("계정", "$" + money(candidate.account_value))}
            ${metric("월 PnL", "$" + signedMoney(candidate.month_pnl), tone(candidate.month_pnl))}
            ${metric("월 ROI", roi(candidate.month_roi), tone(candidate.month_roi))}
            ${metric("체결", String(fills.length))}
            ${metric("포지션", String(positions.length))}
          </div>
          <div class="section-title">점수 구성</div>
          ${scoreBreakdown(candidate.score_breakdown || {})}
          <div class="section-title">현재 포지션</div>
          ${positions.map((position) => positionCard(position, fills)).join("") || '<div class="empty">현재 열린 포지션이 없습니다.</div>'}
          <div class="section-title">최근 체결</div>
          ${fills.slice(0, 8).map((fill) => `
            <div class="position-line">
              <strong>${esc(fill.coin)}</strong>
              <span class="${fill.side === "B" ? "good" : "bad"}">${fill.side === "B" ? "매수" : "매도"}</span>
              <span class="small">$${money(fill.notional_usd)}</span>
              <span class="mono">${timeLabel(fill.time_ms)}</span>
            </div>
          `).join("") || '<div class="empty">최근 체결이 없습니다.</div>'}
          <div class="section-title">액션</div>
          ${candidate.watched
            ? '<span class="pill good">이미 관심 지갑입니다.</span>'
            : `<button class="primary add-wallet" data-address="${esc(candidate.address)}" data-label="${esc(candidate.radar_label || cleanName(candidate))}">관심 지갑으로 등록</button>`
          }
          <div class="section-title">주의</div>
          <div class="small">공개 데이터 기반 추적 후보입니다. 사실 단정 없이 포지션 흐름 관찰용으로만 사용합니다.</div>
        </div>
      `;
    }

    function positionCard(position, fills = [], compact = false) {
      const sideClass = position.side === "LONG" ? "good" : "bad";
      const currentPrice = Number(position.current_price || 0) || impliedCurrentPrice(position);
      const liquidation = Number(position.liquidation_price || 0);
      const openLabel = positionOpenTime(position, fills);
      const roe = position.roe_pct == null ? "-" : `${Number(position.roe_pct) > 0 ? "+" : ""}${Number(position.roe_pct).toFixed(2)}%`;
      const leverage = position.leverage == null ? "-" : `${Number(position.leverage).toFixed(0)}x`;
      return `
        <div class="position-card">
          <div class="position-head">
            <strong>${esc(position.coin)}</strong>
            <span class="${sideClass}">${esc(position.side)}</span>
            <span class="mono ${tone(position.unrealized_pnl)}">$${signedMoney(position.unrealized_pnl)} · ${roe}</span>
            <span class="small">$${money(position.position_value)}</span>
          </div>
          <div class="price-grid">
            <div class="price-box"><div class="k">진입가</div><div class="v">${price(position.entry_price)}</div></div>
            <div class="price-box"><div class="k">현재가</div><div class="v ${sideClass}">${price(currentPrice)}</div></div>
            <div class="price-box"><div class="k">청산가</div><div class="v ${liquidation ? "bad" : ""}">${liquidation ? price(liquidation) : "-"}</div></div>
            <div class="price-box"><div class="k">진입시각</div><div class="v">${esc(openLabel)}</div></div>
            <div class="price-box"><div class="k">증거금</div><div class="v">${position.margin_used == null ? "-" : "$" + money(position.margin_used)}</div></div>
            <div class="price-box"><div class="k">레버리지</div><div class="v">${leverage}</div></div>
          </div>
          ${compact && position.label ? `<div class="small">${esc(position.label)}</div>` : ""}
        </div>
      `;
    }

    function impliedCurrentPrice(position) {
      const value = Math.abs(Number(position.position_value || 0));
      const size = Math.abs(Number(position.size || 0));
      return size > 0 ? value / size : 0;
    }

    function price(value) {
      const n = Number(value || 0);
      if (!Number.isFinite(n) || n === 0) return "-";
      const abs = Math.abs(n);
      if (abs >= 1000) return fmt.format(n);
      if (abs >= 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
      return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    }

    function positionOpenTime(position, fills = []) {
      const sideNeedle = position.side === "LONG" ? "long" : "short";
      const sideFallback = position.side === "LONG" ? "B" : "A";
      const match = (fills || [])
        .filter((fill) => String(fill.coin || "").toUpperCase() === String(position.coin || "").toUpperCase())
        .find((fill) => {
          const direction = String(fill.direction || "").toLowerCase();
          if (direction.includes("open") && direction.includes(sideNeedle)) return true;
          return !direction.includes("close") && String(fill.side || "").toUpperCase() === sideFallback;
        });
      return match?.time_ms ? timeLabel(match.time_ms) : "조회구간 밖";
    }

    function metric(label, value, cls = "") {
      return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value ${cls}">${value}</div></div>`;
    }

    function scoreBreakdown(parts) {
      const rows = [
        ["규모", parts.size || 0, 20, ""],
        ["실력", parts.skill || 0, 40, ""],
        ["일관성", parts.consistency || 0, 20, ""],
        ["활동성", parts.activity || 0, 15, ""],
        ["리스크", parts.risk_penalty || 0, 30, "risk"],
      ];
      return rows.map(([name, value, max, cls]) => {
        const pct = Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100));
        return `
          <div class="score-line">
            <div>${esc(name)}</div>
            <div class="bar"><div class="fill ${cls}" style="--pct:${pct}%"></div></div>
            <div class="mono">${Number(value).toFixed(1)}</div>
          </div>
        `;
      }).join("");
    }

    function cleanName(candidate) {
      const label = String(candidate.label || "").trim();
      if (label && !label.startsWith("0x")) return label;
      return candidate.short_address || candidate.address;
    }

    function markSelected(address) {
      document.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
      if (!address) return;
      document.querySelectorAll(`[data-address="${CSS.escape(address)}"]`).forEach((el) => {
        if (el.classList.contains("whale-card") || el.classList.contains("candidate-row")) {
          el.classList.add("selected");
        }
      });
    }

    function timeLabel(ms) {
      if (!ms) return "-";
      return new Date(Number(ms)).toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }

    function whaleMascot(score = 0, index = 0) {
      const hot = Number(score || 0) >= 88;
      const accent = hot ? "#a78bfa" : "#22d3ee";
      const glow = hot ? "#7c3aed" : "#19d3c5";
      const gradId = `whaleBody${index}`;
      return `
        <svg class="whale-mascot" viewBox="0 0 64 64" role="img" aria-label="whale radar mascot">
          <defs>
            <linearGradient id="${gradId}" x1="12" y1="14" x2="52" y2="50" gradientUnits="userSpaceOnUse">
              <stop stop-color="${accent}"/>
              <stop offset="1" stop-color="#3279ff"/>
            </linearGradient>
          </defs>
          <circle class="halo" cx="32" cy="32" r="29"/>
          <path class="spark" d="M45 9l2.2 5.1 5.5 1-4.2 3.5 1.1 5.4-4.6-2.9-4.7 2.9 1.2-5.4-4.2-3.5 5.5-1L45 9z" fill="${glow}"/>
          <path d="M13 33c0-9.5 8.1-16.8 20.5-16.8 8.6 0 15 3.5 17.9 9.2l5.7-5.1c1.6-1.4 4.1-.2 4 1.9l-.4 11.9c-.1 2-2.4 3.1-4 1.9l-5.1-3.7C49.5 42 42 48.5 31 48.5 20.3 48.5 13 42.1 13 33z" fill="url(#${gradId})"/>
          <path class="belly" d="M16.8 35.2c4.4 5.4 12.8 8.3 23.7 6.1-3.5 4.3-10.7 6.3-17 3.9-4.7-1.8-7.1-5.1-6.7-10z"/>
          <circle class="eye" cx="42.3" cy="27.4" r="2.3"/>
          <path d="M24 26c-4.5-3.1-8.6-3.5-12.3-1.2" fill="none" stroke="${glow}" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M28 22c-4.4-5-9.6-6.8-15.5-5.5" fill="none" stroke="${glow}" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
        </svg>
      `;
    }

    whaleCard = function upgradedWhaleCard(row, index) {
      const candidate = row.candidate;
      const snapshot = row.snapshot || {};
      const score = Math.max(0, Math.min(100, Number(candidate.score || 0)));
      const positions = snapshot.open_positions || [];
      const fills = snapshot.recent_fills || [];
      const label = candidate.radar_label || cleanName(candidate);
      const rawTags = candidate.radar_tags || [];
      const tagText = `${rawTags.join(" ")} ${label}`;
      const cardClass = [
        "whale-card",
        score >= 88 ? "elite" : "",
      ].filter(Boolean).join(" ");
      const tags = rawTags.map((tag) => `<span class="pill">${esc(tag)}</span>`).join("");
      const positionHtml = positions.slice(0, 3).map((position) => positionCard(position, fills)).join("");
      const newest = fills[0];
      return `
        <article class="${cardClass}" data-address="${esc(candidate.address)}">
          <div class="wallet-rank">#${index + 1}</div>
          <div class="whale-top">
            <div class="whale-title-row">
              ${whaleMascot(score, index)}
              <div>
                <div class="name ${score >= 88 ? "hot" : ""}">${esc(label)}</div>
                <div class="address">${esc(candidate.short_address || candidate.address)}</div>
              </div>
            </div>
            <div class="score-ring" style="--score:${score}">
              <span>${score.toFixed(0)}</span>
              <small>EDGE</small>
            </div>
          </div>
          <div class="label-row">${tags || '<span class="pill">포지션 추적</span>'}</div>
          <div class="stat-grid">
            <div class="stat"><div class="k">계정</div><div class="v">$${money(candidate.account_value)}</div></div>
            <div class="stat"><div class="k">월 ROI</div><div class="v ${tone(candidate.month_roi)}">${roi(candidate.month_roi)}</div></div>
            <div class="stat"><div class="k">월 PnL</div><div class="v ${tone(candidate.month_pnl)}">$${signedMoney(candidate.month_pnl)}</div></div>
            <div class="stat"><div class="k">열린 포지션</div><div class="v">${positions.length}</div></div>
          </div>
          <div class="summary">${esc(candidate.radar_summary || "")}</div>
          <div class="position-mini">
            ${positionHtml || '<div class="position-line"><span class="small">현재 열린 포지션 없음</span></div>'}
          </div>
          <div class="small">
            ${newest ? `최근 체결 ${esc(newest.coin)} ${newest.side === "B" ? "매수" : "매도"} · $${money(newest.notional_usd)}` : "최근 체결 없음"}
          </div>
          <div>
            ${candidate.watched ? '<span class="pill good">관심 등록됨</span>' : `<button class="add-wallet" data-address="${esc(candidate.address)}" data-label="${esc(label)}">관심 등록</button>`}
          </div>
        </article>
      `;
    };

    positionCard = function upgradedPositionCard(position, fills = [], compact = false) {
      const sideClass = position.side === "LONG" ? "good" : "bad";
      const sideKind = position.side === "LONG" ? "long" : "short";
      const sideLabel = position.side === "LONG" ? "롱" : "숏";
      const currentPrice = Number(position.current_price || 0) || impliedCurrentPrice(position);
      const liquidation = Number(position.liquidation_price || 0);
      const openLabel = positionOpenTime(position, fills);
      const roe = position.roe_pct == null ? "-" : `${Number(position.roe_pct) > 0 ? "+" : ""}${Number(position.roe_pct).toFixed(2)}%`;
      const leverage = position.leverage == null ? "-" : `${Number(position.leverage).toFixed(0)}x`;
      return `
        <div class="position-card ${sideKind}">
          <div class="position-head">
            <div class="coin-block">
              <strong>${esc(position.coin)}</strong>
              <div class="sub">${esc(openLabel)}</div>
            </div>
            <span class="side-badge ${sideClass}">${sideLabel}</span>
            <span class="roe-chip ${tone(position.unrealized_pnl)}">
              ${roe}
              <span class="pnl">$${signedMoney(position.unrealized_pnl)} PnL</span>
            </span>
            <span class="notional-pill">$${money(position.position_value)}</span>
          </div>
          <div class="price-grid">
            <div class="price-box entry"><div class="k">진입</div><div class="v">${price(position.entry_price)}</div></div>
            <div class="price-box current"><div class="k">현재</div><div class="v ${sideClass}">${price(currentPrice)}</div></div>
            <div class="price-box liquidation"><div class="k">청산</div><div class="v ${liquidation ? "bad" : ""}">${liquidation ? price(liquidation) : "-"}</div></div>
            <div class="price-box"><div class="k">마진</div><div class="v">${position.margin_used == null ? "-" : "$" + money(position.margin_used)}</div></div>
            <div class="price-box"><div class="k">레버</div><div class="v">${leverage}</div></div>
            <div class="price-box"><div class="k">방향</div><div class="v ${sideClass}">${sideLabel}</div></div>
          </div>
          ${compact && position.label ? `<div class="small">${esc(position.label)}</div>` : ""}
        </div>
      `;
    };

    positionOpenTime = function upgradedPositionOpenTime(position, fills = []) {
      const sideNeedle = position.side === "LONG" ? "long" : "short";
      const sideFallback = position.side === "LONG" ? "B" : "A";
      const match = (fills || [])
        .filter((fill) => String(fill.coin || "").toUpperCase() === String(position.coin || "").toUpperCase())
        .find((fill) => {
          const direction = String(fill.direction || "").toLowerCase();
          if (direction.includes("open") && direction.includes(sideNeedle)) return true;
          return !direction.includes("close") && String(fill.side || "").toUpperCase() === sideFallback;
        });
      return match?.time_ms ? timeLabel(match.time_ms) : "조회구간 밖";
    };

    document.addEventListener("click", (event) => {
      const addBtn = event.target.closest("button.add-wallet");
      if (addBtn) {
        event.stopPropagation();
        addWallet(addBtn.dataset.address, addBtn.dataset.label);
        return;
      }
      const item = event.target.closest("[data-address]");
      if (item) {
        const row = rows.find((candidateRow) => candidateRow.candidate.address === item.dataset.address);
        if (row) renderDetail(row);
      }
    });

    $("refreshBtn").addEventListener("click", () => loadRadar());
    $("pauseBtn").addEventListener("click", () => {
      autoEnabled = !autoEnabled;
      $("pauseBtn").textContent = autoEnabled ? "자동 일시정지" : "자동 재개";
      log(autoEnabled ? "자동 갱신 재개" : "자동 갱신 일시정지");
      scheduleNext();
    });
    $("lookback").addEventListener("change", () => loadRadar());
    $("minScore").addEventListener("change", () => loadRadar());
    window.addEventListener("error", (event) => log(`화면 오류: ${event.message}`));

    loadRadar();
  </script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
