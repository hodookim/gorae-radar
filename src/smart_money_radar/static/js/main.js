// main.js — application entry point.
//
// Phase 4 rewrite: main.js now owns ONLY the router bootstrapping and the view
// swap (previous → unmount → empty #app → next → mount) plus the global error
// handler. Per-view event binding lives inside each view's mount().
import { initRouter } from "./router.js?v=23";
import * as landing from "./views/landing.js?v=32";

const viewLoaders = {
  landing: () => landing,
  market: () => import("./views/market.js?v=29"),
  live: () => import("./views/live.js?v=29"),
  whale: () => import("./views/whale.js?v=21"),
  watchlist: () => import("./views/watchlist.js?v=21"),
  stats: () => import("./views/stats.js?v=29"),
};

const viewTitles = {
  landing: "고래지갑추적기 | Hyperliquid 상위 지갑 포지션 분석",
  market: (params) => `${String(params?.coin || "시장").toUpperCase()} 고래 포지션 차트 | 고래지갑추적기`,
  live: "고래 포지션 라이브 | 고래지갑추적기",
  whale: "지갑 리스크 프로필 | 고래지갑추적기",
  watchlist: "관심 지갑 | 고래지갑추적기",
  stats: "노출 분석 | 고래지갑추적기",
};

let current = null;
let viewGeneration = 0;

async function setView(view, params) {
  const generation = ++viewGeneration;
  const activeView = view === "whale" || view === "market" ? "live" : view;

  const title = viewTitles[view] || viewTitles.landing;
  document.title = typeof title === "function" ? title(params || {}) : title;
  document.querySelectorAll(".topbar .toolbar a").forEach((link) => {
    const linkView = link.dataset.view || "";
    if (linkView === activeView) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const brand = document.querySelector(".topbar .brand");
  if (brand) {
    if (view === "landing") brand.setAttribute("aria-current", "page");
    else brand.removeAttribute("aria-current");
  }

  if (current && typeof current.unmount === "function") {
    try {
      current.unmount();
    } catch (err) {
      console.error("view unmount failed:", err);
    }
  }
  current = null;

  const app = document.getElementById("app");
  // Live's unmount moves its DOM into #live-stash, so #app is already empty.
  // For every other view, this clears the previous view's DOM.
  app.innerHTML = "";

  try {
    let next;
    if (view === "landing") {
      next = landing;
    } else {
      app.innerHTML = '<section class="card empty">화면을 준비하고 있습니다.</section>';
      const loader = viewLoaders[view] || viewLoaders.landing;
      next = await loader();
      if (generation !== viewGeneration) return;
      app.innerHTML = "";
    }
    current = next;
    await next.mount(app, params || {});
    if (generation !== viewGeneration) return;
    app.classList.remove("app-loading");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    const heading = app.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    const announcer = document.getElementById("route-announcer");
    if (announcer) announcer.textContent = document.title;
  } catch (err) {
    console.error("view mount failed:", err);
    app.classList.remove("app-loading");
    app.innerHTML = `<section class="card empty">뷰 로드 실패: ${err.message}</section>`;
  }
}

function init() {
  // Global error handler. log() lives in format.js and targets #log, which only
  // exists when the live view is mounted (or stashed); fall back to console when
  // the live DOM is not in the document.
  window.addEventListener("error", (event) => {
    const logEl = document.getElementById("log");
    if (logEl) {
      logEl.textContent = `[${new Date().toLocaleTimeString()}] 화면 오류: ${event.message}`;
    } else {
      console.error("화면 오류:", event.message);
    }
  });

  initRouter(setView);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
