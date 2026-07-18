import { esc } from "./format.js?v=20";

const ICON_BASE =
  "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color";

const SYMBOL_ALIASES = {
  KPEPE: "PEPE",
  KSHIB: "SHIB",
  KBONK: "BONK",
  KFLOKI: "FLOKI",
  KLUNC: "LUNC",
};

const ICON_SLUGS = {
  BTC: "btc",
  ETH: "eth",
  SOL: "sol",
  ZEC: "zec",
  XRP: "xrp",
  DOGE: "doge",
  BNB: "bnb",
  AVAX: "avax",
  LINK: "link",
  SUI: "sui",
  APT: "apt",
  ADA: "ada",
  DOT: "dot",
  LTC: "ltc",
  BCH: "bch",
  UNI: "uni",
  AAVE: "aave",
  NEAR: "near",
};

const COINGECKO_IMAGES = {
  AAVE: "https://coin-images.coingecko.com/coins/images/12645/large/aave-token-round.png",
  ADA: "https://coin-images.coingecko.com/coins/images/975/large/cardano.png",
  ALGO: "https://coin-images.coingecko.com/coins/images/4380/large/download.png",
  APT: "https://coin-images.coingecko.com/coins/images/26455/large/Aptos-Network-Symbol-Black-RGB-1x.png?1761789140",
  ARB: "https://coin-images.coingecko.com/coins/images/16547/large/arb.jpg",
  ASTER: "https://coin-images.coingecko.com/coins/images/69040/large/_ASTER.png",
  AVAX: "https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png?1696512369",
  BCH: "https://coin-images.coingecko.com/coins/images/780/large/bitcoin-cash-circle.png",
  BNB: "https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png?1696501970",
  BONK: "https://coin-images.coingecko.com/coins/images/28600/large/bonk.jpg",
  BTC: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400",
  COMP: "https://coin-images.coingecko.com/coins/images/10775/large/COMP.png",
  CRV: "https://coin-images.coingecko.com/coins/images/12124/large/Curve.png",
  DOGE: "https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png?1696501409",
  DOT: "https://coin-images.coingecko.com/coins/images/12171/large/polkadot.jpg",
  ENA: "https://coin-images.coingecko.com/coins/images/36530/large/ethena.png",
  ETH: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628",
  FET: "https://coin-images.coingecko.com/coins/images/5681/large/ASI.png",
  FIL: "https://coin-images.coingecko.com/coins/images/12817/large/filecoin.png",
  FLOKI: "https://coin-images.coingecko.com/coins/images/16746/large/PNG_image.png",
  GRASS: "https://coin-images.coingecko.com/coins/images/40094/large/Grass.jpg",
  HYPE: "https://coin-images.coingecko.com/coins/images/50882/large/hyperliquid.jpg?1729431300",
  INJ: "https://coin-images.coingecko.com/coins/images/12882/large/Other_200x200.png",
  JUP: "https://coin-images.coingecko.com/coins/images/34188/large/jup.png",
  LINK: "https://coin-images.coingecko.com/coins/images/877/large/Chainlink_Logo_500.png?1760023405",
  LIT: "https://coin-images.coingecko.com/coins/images/71121/large/lighter.png",
  LTC: "https://coin-images.coingecko.com/coins/images/2/large/litecoin.png",
  MKR: "https://coin-images.coingecko.com/coins/images/1364/large/Mark_Maker.png",
  NEAR: "https://coin-images.coingecko.com/coins/images/10365/large/near.jpg",
  ONDO: "https://coin-images.coingecko.com/coins/images/26580/large/ONDO.png",
  OP: "https://coin-images.coingecko.com/coins/images/25244/large/Optimism.png",
  PENDLE: "https://coin-images.coingecko.com/coins/images/15069/large/Pendle_Logo_Normal-03.png",
  PEPE: "https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg",
  PUMP: "https://coin-images.coingecko.com/coins/images/67164/large/pump.jpg",
  PYTH: "https://coin-images.coingecko.com/coins/images/31924/large/pyth.png",
  RUNE: "https://coin-images.coingecko.com/coins/images/6595/large/Rune200x200.png",
  SHIB: "https://coin-images.coingecko.com/coins/images/11939/large/shiba.png",
  SOL: "https://coin-images.coingecko.com/coins/images/4128/large/solana.png?1718769756",
  STRK: "https://coin-images.coingecko.com/coins/images/26433/large/starknet.png",
  SUI: "https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png?1727791290",
  TAO: "https://coin-images.coingecko.com/coins/images/28452/large/ARUsPeNQ_400x400.jpeg",
  TIA: "https://coin-images.coingecko.com/coins/images/31967/large/tia.jpg",
  UNI: "https://coin-images.coingecko.com/coins/images/12504/large/uniswap-logo.png",
  WIF: "https://coin-images.coingecko.com/coins/images/33566/large/dogwifhat.jpg",
  WLD: "https://coin-images.coingecko.com/coins/images/31069/large/worldcoin.jpeg",
  XMR: "https://coin-images.coingecko.com/coins/images/69/large/monero_logo.png",
  XRP: "https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
  ZEC: "https://coin-images.coingecko.com/coins/images/486/large/circle-zcash-color.png?1696501740",
};

function normalizeSymbol(coin) {
  const symbol = String(coin || "-").toUpperCase();
  return SYMBOL_ALIASES[symbol] || symbol;
}

export function coinLogo(coin, extraClass = "") {
  const symbol = String(coin || "-").toUpperCase();
  const lookupSymbol = normalizeSymbol(symbol);
  const directUrl = COINGECKO_IMAGES[lookupSymbol]?.replace("/large/", "/small/");
  const slug = ICON_SLUGS[lookupSymbol];
  const glyph = lookupSymbol.slice(0, 1) || "?";
  const fallback = `
    <span class="coin-icon-fallback coin-icon-fallback--${esc(lookupSymbol.toLowerCase())}" ${directUrl || slug ? "hidden" : ""} aria-hidden="true">${esc(glyph)}</span>
  `;
  const src = directUrl || (slug ? `${ICON_BASE}/${esc(slug)}.svg` : "");
  if (!src) return fallback;
  return `
    <span class="coin-logo ${esc(extraClass)}" aria-hidden="true">
      <img
        class="coin-logo__img"
        src="${src}"
        alt=""
        width="24"
        height="24"
        loading="lazy"
        decoding="async"
        onerror="this.hidden=true;this.nextElementSibling.hidden=false"
      >${fallback}
    </span>
  `;
}
