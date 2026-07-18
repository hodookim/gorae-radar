// router.js - supports crawlable HTTP paths while preserving legacy hashes.

const routes = [
  { match: /^#\/?$/,                       view: "landing",   params: () => ({}) },
  { match: /^#\/live\/?$/,                 view: "live",      params: () => ({}) },
  { match: /^#\/market\/([a-z0-9]{1,20})\/?$/i, view: "market", params: (m) => ({ coin: m[1].toUpperCase() }) },
  { match: /^#\/whale\/(0x[a-f0-9]+)$/i,   view: "whale",     params: (m) => ({ address: m[1] }) },
  { match: /^#\/watchlist\/?$/,            view: "watchlist", params: () => ({}) },
  { match: /^#\/stats\/?$/,                view: "stats",     params: () => ({}) },
];

const pathRoutes = [
  { match: /^\/$/,                              view: "landing", params: () => ({}) },
  { match: /^\/live\/?$/i,                    view: "live",    params: () => ({}) },
  { match: /^\/markets\/([a-z0-9]{1,20})\/?$/i, view: "market", params: (m) => ({ coin: m[1].toUpperCase() }) },
];

export function resolveRoute(pathname = "/", hash = "") {
  if (hash && hash !== "#") {
    for (const route of routes) {
      const match = route.match.exec(hash);
      if (match) return { view: route.view, params: route.params(match) };
    }
  }
  for (const route of pathRoutes) {
    const match = route.match.exec(pathname || "/");
    if (match) return { view: route.view, params: route.params(match) };
  }
  return { view: "landing", params: {} };
}

// Resolve the current HTTP path and any legacy hash into {view, params}.
export function currentView() {
  return resolveRoute(location.pathname, location.hash);
}

// Legacy targets stay client-side; crawlable paths use a normal navigation.
export function go(target) {
  if (String(target).startsWith("#")) {
    if (location.hash !== target) location.hash = target;
    return;
  }
  window.location.assign(target);
}

// Watch both navigation styles and render the initial view immediately.
// Returns a detach function (useful for tests/hot-reload).
export function initRouter(onChange) {
  const fire = () => {
    const parsed = currentView();
    try {
      onChange(parsed.view, parsed.params);
    } catch (err) {
      console.error("router onChange failed:", err);
    }
  };
  window.addEventListener("hashchange", fire);
  window.addEventListener("popstate", fire);
  fire();
  return () => {
    window.removeEventListener("hashchange", fire);
    window.removeEventListener("popstate", fire);
  };
}
