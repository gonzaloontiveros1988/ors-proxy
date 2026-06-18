// server.js — v3.7.0 (EXITS-ATR: trailing escalonado + sync/history/load)
// ORS Proxy — Sistema MOM V3
// ===========================
// BULL:    MOM V1 (5 slots) + Bollinger (1 slot)
// LATERAL: MOM V1 75% sizing (5 slots)
// BEAR:    SHORT v3 filtros A+D (3 slots)
//
// v3.1.0: /sync + /sync/history endpoints
// v3.4.0: COMB_FINAL — I10 (Stop VPOC) + D03 (SPY>-1%) + N02 (Wyckoff Spring)
//         Backtest OOS confirmado: PF 3.59 MAR 10.58 DD 6.08%
// v3.5.0: HARDENING DE EJECUCIÓN (sin cambios en lógica de señales):
//   F1: Auth x-api-key en endpoints (activar con env PROXY_API_KEY)
//   F2: Órdenes OTO (entrada+stop atómicos) — imposible posición sin stop
//   F3: Fill real leído de Alpaca (waitForFill) — entry/riesgo con precio real
//   F4: Guard anti doble-venta en executeSell (verifica posición en broker)
//   F5: FIX CRÍTICO — cierre de SHORT usaba side:'sell' (aumentaba el corto)
//       y P&L con signo invertido. Ahora buy-to-cover + P&L correcto.
//   F6: reconcilePositions cada 5min (broker vs servidor + stops huérfanos)
//   F7: nyOffset dinámico en isEntryAllowed (regla 30min sobrevive al invierno)
//   F8: Persistencia de estado en state.json (posiciones/diario/monthlyTrades)
//   F9: Sync de arranque lee stops REALES del broker (no inventa ±3%)
'use strict';
const fs = require('fs');
const express = require('express');
const app = express();
app.use(express.json());
// ── CORS ──────────────────────────────────────────────
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
// ── F1: AUTH ──────────────────────────────────────────
// Activar definiendo PROXY_API_KEY en Render. Mientras no esté definida,
// el comportamiento es idéntico al anterior (para no romper el frontend
// hasta que ORS-APP envíe el header x-api-key).
const PROXY_API_KEY = process.env.PROXY_API_KEY || '';
const PUBLIC_PATHS  = ['/', '/health'];
app.use(function(req, res, next) {
  if (!PROXY_API_KEY) return next();
  if (PUBLIC_PATHS.indexOf(req.path) !== -1) return next();
  const k = req.headers['x-api-key'] || req.query.key;
  if (k === PROXY_API_KEY) return next();
  return res.status(401).json({ error: 'unauthorized' });
});
// ── CONFIG ────────────────────────────────────────────
const PORT       = process.env.PORT       || 3000;
const TG_TOKEN   = process.env.TG_TOKEN   || '';
const TG_CHAT    = process.env.TG_CHAT    || '';
const EUR_USD    = 1.08;
const SLIPPAGE   = 0.001;
let CAPITAL_EUR  = parseFloat(process.env.CAPITAL_EUR || '11480');
const RISK_PCT   = parseFloat(process.env.RISK_PCT    || '0.02');
const MAX_MOM    = 5;
const MAX_BOLL   = 1;
const MAX_SHORT  = 3;
const AUTO_EXECUTE = process.env.AUTO_EXECUTE === 'true';
// ── ALPACA ────────────────────────────────────────────
const ALPACA_DATA = 'https://data.alpaca.markets';
const ALPACA_ACCOUNTS = {
  paper2: {
    key:    process.env.ALPACA_KEY_2      || process.env.ALPACA_PAPER_KEY    || process.env.ALPACA_KEY_ID  || process.env.ALPACA_KEY    || '',
    secret: process.env.ALPACA_SECRET_2   || process.env.ALPACA_PAPER_SECRET || process.env.ALPACA_SECRETS || process.env.ALPACA_SECRET || '',
    base:   process.env.ALPACA_BASE_2     || process.env.ALPACA_PAPER_URL    || process.env.ALPACA_BASE    || 'https://paper-api.alpaca.markets',
    label:  '📊 PAPER €11k',
  },
  live: {
    key:    process.env.ALPACA_LIVE_KEY    || '',
    secret: process.env.ALPACA_LIVE_SECRET || '',
    base:   process.env.ALPACA_LIVE_URL    || 'https://api.alpaca.markets',
    label:  '💰 LIVE',
  },
};
let ACTIVE_ACCOUNT = process.env.ALPACA_DEFAULT_ACCOUNT || 'paper2';
const getAcc    = () => ALPACA_ACCOUNTS[ACTIVE_ACCOUNT] || ALPACA_ACCOUNTS.paper2;
const alpacaBase= () => getAcc().base;
const alpacaHdr = () => ({
  'APCA-API-KEY-ID':     getAcc().key,
  'APCA-API-SECRET-KEY': getAcc().secret,
  'Content-Type':        'application/json',
});
const isLive = () => ACTIVE_ACCOUNT === 'live';
// ── UNIVERSO ──────────────────────────────────────────
// Universo base (watchlist curada) — siempre disponible
const UNIVERSE_BASE = [
  'NVDA','AMD','AVGO','TSM','MU','QCOM','MRVL','SMCI','ORCL','PLTR',
  'META','AMZN','GOOGL','MSFT','NFLX','CRM','NOW','SNOW','DDOG','MDB',
  'CRWD','PANW','NET','CRWV',
  'HCA','ISRG','UNH','LLY','VRTX','ABBV','AMGN','GILD','REGN','MRNA',
  'INSM','CRSP','ALNY',
  'CEG','VST','GEV','NEE','ETR','XOM','CVX','OXY',
  'DAL','UAL','AAL',
  'CAT','HON','ROK','GD','LMT','RTX','FDX',
  'RKLB','LUNR','TSLA',
  'JPM','GS','MS','COIN',
  'HUT','TKO','BE','AMG','EL','HUM',
  // SP500 adicionales — expansión del universo
  'AAPL','INTC','LRCX','AMAT','KLAC','MCHP','ON','TXN','ADI','NXPI',
  'ADBE','INTU','ANSS','CDNS','FTNT','OKTA','ZS','WDAY','TEAM','HUBS',
  'SHOP','SQ','PYPL','AFRM','UPST',
  'ABBV','BMY','MRK','PFE','BIIB','VRTX','INCY','JAZZ','EXEL',
  'BA','LHX','NOC','LDOS','SAIC','AXON','KTOS',
  'RCL','CCL','MAR','HLT','MGM','WYNN','LVS',
  'F','GM','RIVN','LCID',
  'WFC','BAC','C','USB','PNC','TFC','SCHW','BLK','BX','KKR','APO',
  'MSTR','RIOT','MARA','CLSK',
  'ASTS','RKLB','SPCE','RBA',
  'CLX','MO','PM','MNST','KHC',
  'SLB','HAL','BKR','MPC','PSX','VLO',
];
// Universo dinámico — se puede expandir en runtime
let UNIVERSE = [...new Set(UNIVERSE_BASE)];

// ── UNIVERSO DINÁMICO — SP500 completo desde Alpaca ──
// Descarga todos los activos de renta variable americana
// filtra por precio, volumen y liquidez mínima
// Se ejecuta al arrancar y una vez al día
let UNIVERSE_LAST_UPDATE = 0;

async function expandUniverse() {
  try {
    // Alpaca Assets API — todos los activos activos de US Equity
    // Assets API — funciona con paper y live por igual
    const brokerBase = getAcc().base || 'https://paper-api.alpaca.markets';
    const r = await fetch(
      `${brokerBase}/v2/assets?status=active&asset_class=us_equity`,
      { headers: alpacaHdr() }
    );
    const assets = await r.json();
    if (!Array.isArray(assets) || assets.length < 100) {
      console.log('[UNIVERSE] Assets API vacía, usando base');
      return;
    }

    // Filtros básicos: tradeable, no OTC, símbolo limpio
    const candidates = assets
      .filter(a =>
        a.tradable &&
        a.exchange !== 'OTC' &&
        a.symbol &&
        /^[A-Z]{1,5}$/.test(a.symbol) &&  // sin puntos ni números
        a.status === 'active'
      )
      .map(a => a.symbol);

    console.log(`[UNIVERSE] ${candidates.length} candidatos de Alpaca Assets`);

    // Ahora filtrar por precio y volumen usando snapshots
    // Alpaca permite hasta 1000 símbolos por request
    const filtered = [];
    const BATCH = 500;

    for (let i = 0; i < Math.min(candidates.length, 3000); i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      try {
        const rs = await fetch(
          `${ALPACA_DATA}/v2/stocks/snapshots?symbols=${batch.join(',')}&feed=iex`,
          { headers: alpacaHdr() }
        );
        const snaps = await rs.json();

        for (const [sym, snap] of Object.entries(snaps || {})) {
          const price  = snap?.latestTrade?.p || snap?.latestQuote?.ap || 0;
          const volume = snap?.dailyBar?.v || 0;
          const close  = snap?.dailyBar?.c || 0;

          // Filtros de liquidez:
          // precio > $5, volumen diario > 500k acciones, precio cierre > $5
          if (price >= 5 && volume >= 500000 && close >= 5) {
            filtered.push(sym);
          }
        }
        // Pausa entre batches para no saturar la API
        if (i + BATCH < candidates.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch(e) {
        console.log(`[UNIVERSE] Error batch ${i}: ${e.message}`);
      }
    }

    if (filtered.length > 100) {
      // Combinar con la base curada (siempre incluirla)
      const combined = [...new Set([...UNIVERSE_BASE, ...filtered])];
      UNIVERSE = combined;
      UNIVERSE_LAST_UPDATE = Date.now();
      console.log(`[UNIVERSE] ✅ Expandido a ${UNIVERSE.length} tickers (${filtered.length} nuevos de Alpaca)`);
      await sendTelegram(`🌍 Universo actualizado: <b>${UNIVERSE.length} tickers</b>\n${filtered.length} de Alpaca + ${UNIVERSE_BASE.length} curados`);
    } else {
      console.log(`[UNIVERSE] Pocos tickers filtrados (${filtered.length}), manteniendo base`);
    }
  } catch(e) {
    console.error('[UNIVERSE] Error expandiendo:', e.message);
    console.error('[UNIVERSE] Stack:', e.stack?.slice(0,200));
    console.log('[UNIVERSE] Usando base de', UNIVERSE.length, 'tickers');
  }
}

// Actualizar universo una vez al día (a las 21:00 UTC = antes del día siguiente)
function scheduleUniverseUpdate() {
  const now   = new Date();
  const next  = new Date();
  next.setUTCHours(21, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const msUntil = next - now;
  setTimeout(async () => {
    await expandUniverse();
    scheduleUniverseUpdate(); // reprogramar para mañana
  }, msUntil);
  console.log(`[UNIVERSE] Próxima actualización en ${Math.round(msUntil/3600000)}h`);
}
const SECTOR_MAP = {
  NVDA:'XLK',AMD:'XLK',AVGO:'XLK',TSM:'XLK',MU:'XLK',
  QCOM:'XLK',MRVL:'XLK',SMCI:'XLK',ORCL:'XLK',PLTR:'XLK',
  META:'XLK',AMZN:'XLK',GOOGL:'XLK',MSFT:'XLK',NFLX:'XLK',
  CRM:'XLK',NOW:'XLK',SNOW:'XLK',DDOG:'XLK',MDB:'XLK',
  CRWD:'XLK',PANW:'XLK',NET:'XLK',CRWV:'XLK',
  HCA:'XLV',ISRG:'XLV',UNH:'XLV',LLY:'XLV',VRTX:'XLV',
  ABBV:'XLV',AMGN:'XLV',GILD:'XLV',REGN:'XLV',MRNA:'XLV',
  INSM:'XLV',CRSP:'XLV',ALNY:'XLV',
  CEG:'XLU',VST:'XLU',GEV:'XLU',NEE:'XLU',ETR:'XLU',
  XOM:'XLE',CVX:'XLE',OXY:'XLE',
  DAL:'JETS',UAL:'JETS',AAL:'JETS',
  CAT:'XLI',HON:'XLI',ROK:'XLI',GD:'XLI',LMT:'XLI',RTX:'XLI',FDX:'XLI',
  RKLB:'XLK',LUNR:'XLK',TSLA:'XLK',
  JPM:'XLF',GS:'XLF',MS:'XLF',COIN:'XLF',
};
// ── ESTADO ────────────────────────────────────────────
const openPositions   = {};
const pendingOrders   = {};
const sentAlerts      = {};
const monthlyTrades   = {};
let   tradeHistory    = [];
let   lastUpdateId    = 0;
let MARKET_REGIME = {
  mode: 'BULL',
  sma50: null, sma200: null,
  bearStreak: 0, sma50Bearish: false,
  sizeMult: 1.0, ts: 0,
};
let sectorSentiment  = {};
let sectorLastUpdate = null;
// Cache SPY diario para D03
let spyDailyCache = { changePct: 0, date: '', ts: 0 };
// LAB y watchlist dinámica
let labHypotheses = [];
let labReviews    = [];
let dynWatchlist  = [];

// ── F8: PERSISTENCIA DE ESTADO ────────────────────────
// Nota: en Render el disco se borra en cada deploy; esto protege frente a
// reinicios del proceso. Para persistencia total entre deploys, montar un
// disco persistente o exportar el diario periódicamente.
const STATE_FILE = process.env.STATE_FILE || './state.json';
function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      openPositions,
      tradeHistory: tradeHistory.slice(0, 500),
      monthlyTrades,
      savedAt: new Date().toISOString(),
    }));
  } catch(e) { console.log('[STATE] save:', e.message); }
}
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (s.openPositions) Object.assign(openPositions, s.openPositions);
    if (Array.isArray(s.tradeHistory)) tradeHistory = s.tradeHistory;
    if (s.monthlyTrades) Object.assign(monthlyTrades, s.monthlyTrades);
    console.log(`[STATE] Restaurado: ${Object.keys(openPositions).length} pos, ${tradeHistory.length} trades (guardado ${s.savedAt})`);
  } catch(e) { console.log('[STATE] load:', e.message); }
}

// ═══════════════════════════════════════════════════════
// INDICADORES
// ═══════════════════════════════════════════════════════
function calcEMA(prices, n) {
  if (!prices || prices.length < n) return null;
  const k = 2 / (n + 1);
  let e = prices[prices.length - n];
  for (let i = prices.length - n + 1; i < prices.length; i++)
    e = prices[i] * k + e * (1 - k);
  return e;
}
function calcRSI(prices, n = 14) {
  if (!prices || prices.length < n + 2) return null;
  let gains = [], losses = [];
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  let ag = gains.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let al = losses.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < gains.length; i++) {
    ag = (ag * (n - 1) + gains[i]) / n;
    al = (al * (n - 1) + losses[i]) / n;
  }
  return al === 0 ? 100 : parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
}
function calcMACD(prices, f = 12, s = 26, sig = 9) {
  if (!prices || prices.length < s + sig + 1) return null;
  const kf = 2/(f+1), ks = 2/(s+1);
  let ef = prices[0], es = prices[0];
  const ml = [];
  for (let i = 1; i < prices.length; i++) {
    ef = prices[i]*kf + ef*(1-kf);
    es = prices[i]*ks + es*(1-ks);
    if (i >= s - 1) ml.push(ef - es);
  }
  if (ml.length < sig) return null;
  const ks2 = 2/(sig+1);
  let sv = ml[0];
  const sa = [sv];
  for (let i = 1; i < ml.length; i++) { sv = ml[i]*ks2 + sv*(1-ks2); sa.push(sv); }
  const lm = ml[ml.length-1], ls = sa[sa.length-1];
  const pm = ml[ml.length-2], ps = sa[sa.length-2];
  return {
    bullish:    lm > ls,
    bearish:    lm < ls,
    increasing: (lm-ls) > (pm-ps) && (lm-ls) > 0,
    decreasing: (lm-ls) < (pm-ps) && (lm-ls) < 0,
    bearCross:  pm >= ps && lm < ls,
  };
}
function calcOBV(bars) {
  if (!bars || bars.length < 10) return null;
  let obv = 0;
  const series = [];
  for (let i = 1; i < bars.length; i++) {
    const v = bars[i].v || 0;
    if (bars[i].c > bars[i-1].c)      obv += v;
    else if (bars[i].c < bars[i-1].c) obv -= v;
    series.push(obv);
  }
  const n = series.length, nb = Math.min(14, n);
  const rec = series.slice(-nb);
  let sx=0, sy=0, sxy=0, sx2=0;
  for (let j=0; j<nb; j++) { sx+=j; sy+=rec[j]; sxy+=j*rec[j]; sx2+=j*j; }
  const d = nb*sx2 - sx*sx;
  const slope = d ? (nb*sxy - sx*sy) / d : 0;
  return {
    bullish: slope > 0,
    bearish: slope < 0,
    rising:  n >= 3 && series[n-1] > series[n-3],
    falling: n >= 3 && series[n-1] < series[n-3],
  };
}
function calcATR(bars, n = 14) {
  if (!bars || bars.length < n + 1) return null;
  let s = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const h = bars[i].h || bars[i].c;
    const l = bars[i].l || bars[i].c;
    s += Math.max(h - l, Math.abs(h - bars[i-1].c), Math.abs(l - bars[i-1].c));
  }
  return s / n;
}
function calcRVOL(bars, n = 20) {
  if (!bars || bars.length < n + 1) return null;
  const vols = bars.slice(-n-1).map(b => b.v || 0);
  const avg  = vols.slice(0, n).reduce((a, b) => a + b, 0) / n;
  return avg > 0 ? vols[n] / avg : 1;
}
function calcBollinger(prices, n = 20, k = 2) {
  if (!prices || prices.length < n) return null;
  const slice = prices.slice(-n);
  const mid   = slice.reduce((a, b) => a + b, 0) / n;
  const sd    = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / n);
  return { upper: mid + k*sd, mid, lower: mid - k*sd };
}
function calcSMA(prices, n) {
  if (!prices || prices.length < n) return null;
  return prices.slice(-n).reduce((a, b) => a + b, 0) / n;
}

// ── v3.4.0: VPOC — Volume Point of Control ──────────────
// Nivel de precio con más volumen acumulado en últimas N barras 15min
// Grupos de $0.05 — donde instituciones compraron más
function calcVPOC(bars, nBars) {
  if (!bars || bars.length < nBars) return null;
  const recent = bars.slice(-nBars);
  const volByLevel = {};
  for (const b of recent) {
    const price = b.c || 0;
    const vol   = b.v || 0;
    if (!price || !vol) continue;
    const level = Math.round(price * 20) / 20; // niveles $0.05
    volByLevel[level] = (volByLevel[level] || 0) + vol;
  }
  if (!Object.keys(volByLevel).length) return null;
  return parseFloat(
    Object.entries(volByLevel).sort((a, b) => b[1] - a[1])[0][0]
  );
}

// ── v3.4.0: Stop bajo VPOC (I10) ────────────────────────
// Si VPOC < entry y dentro de 3×ATR → stop = VPOC×0.999
// Fallback: 1.5×ATR si no hay VPOC válido
function calcStopVPOC(bars, entry, atr) {
  const vpoc = calcVPOC(bars, Math.min(bars.length, 520)); // ~20 días
  if (vpoc && vpoc < entry && (entry - vpoc) < atr * 3) {
    const s = parseFloat((vpoc * 0.999).toFixed(2));
    console.log(`[VPOC] entry=$${entry.toFixed(2)} VPOC=$${vpoc} stop=$${s}`);
    return s;
  }
  return parseFloat((entry - atr * 1.5).toFixed(2));
}

// ── v3.4.0: Wyckoff Spring (N02) ────────────────────────
// Detecta caída brusca (>2%) recuperada el mismo día en últimos N días
// Spring = stops retail saltaron, camino limpio para subir
// Backtest OOS: PF 3.58 vs 3.28 BASE, P&L €+26,549
function detectWyckoffSpring(dailyBars, nDays = 10) {
  if (!dailyBars || dailyBars.length < nDays) return false;
  const recent = dailyBars.slice(-nDays);
  for (const b of recent) {
    const open  = b.o || b.c;
    const low   = b.l || b.c;
    const close = b.c;
    if (open <= 0) continue;
    const fallFromOpen = (open - low) / open * 100;
    // Caída >2% desde open recuperada al cierre (close ≥ 99% del open)
    if (fallFromOpen > 2.0 && close >= open * 0.99) return true;
  }
  return false;
}

// ── v3.4.0: SPY cambio diario para D03 ──────────────────
async function getSPYDailyChange() {
  // Cache de 15 minutos para no llamar Alpaca en cada tick
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  if (spyDailyCache.date === today && now - spyDailyCache.ts < 15*60*1000) {
    return spyDailyCache.changePct;
  }
  try {
    const snap = await fetchSnapshot('SPY');
    if (snap && typeof snap.changePct === 'number') {
      spyDailyCache = { changePct: snap.changePct, date: today, ts: now };
      return snap.changePct;
    }
  } catch(e) { console.log('[D03] Error SPY snapshot:', e.message); }
  return spyDailyCache.changePct || 0;
}

// ═══════════════════════════════════════════════════════
// DATOS ALPACA
// ═══════════════════════════════════════════════════════
async function fetchBars15min(sym) {
  try {
    const start = new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10);
    const url   = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&limit=200&feed=iex&sort=asc&start=${start}`;
    const r     = await fetch(url, { headers: alpacaHdr() });
    const text  = await r.text();
    if (!text || text === 'Not Found') return null;
    const d = JSON.parse(text);
    if (!d.bars || !d.bars.length) return null;
    return d.bars.map(b => ({ t:b.t, o:b.o, h:b.h, l:b.l, c:b.c, v:b.v||0 }));
  } catch(e) { return null; }
}
async function fetchDailyBars(sym, limit = 220) {
  try {
    const url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Day&limit=${limit}&feed=sip&sort=asc`;
    const r   = await fetch(url, { headers: alpacaHdr() });
    const text = await r.text();
    if (!text || text.trim().startsWith('<')) return null;
    const d = JSON.parse(text);
    if (!d.bars) return null;
    return d.bars.map(b => ({ t:b.t.slice(0,10), o:b.o, h:b.h, l:b.l, c:b.c, v:b.v||0 }));
  } catch(e) { return null; }
}
async function fetchSnapshot(sym) {
  try {
    const r    = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${sym}&feed=iex`, { headers: alpacaHdr() });
    const d    = await r.json();
    const snap = d[sym];
    if (!snap) return null;
    const lt   = snap.latestTrade || {};
    const prev = snap.prevDailyBar || {};
    const price = lt.p || snap.dailyBar?.c || 0;
    return { price, changePct: prev.c ? (price - prev.c) / prev.c * 100 : 0 };
  } catch(e) { return null; }
}
async function spyDrawdown60() {
  try {
    const bars = await fetchDailyBars('SPY', 65);
    if (!bars || bars.length < 10) return 0;
    const closes = bars.map(b => b.c);
    const current = closes[closes.length - 1];
    const max60   = Math.max(...closes.slice(-60));
    return (current - max60) / max60 * 100;
  } catch(e) { return 0; }
}

// ═══════════════════════════════════════════════════════
// RÉGIMEN
// ═══════════════════════════════════════════════════════
async function updateRegime() {
  try {
    const bars = await fetchDailyBars('SPY', 210);
    if (!bars || bars.length < 52) return;
    const closes = bars.map(b => b.c);
    const last   = closes[closes.length - 1];
    const sma50  = calcSMA(closes, 50);
    const sma200 = closes.length >= 200 ? calcSMA(closes, 200) : null;
    let bearStreak = 0;
    if (sma200) {
      for (let i = closes.length - 1; i >= Math.max(0, closes.length - 6); i--) {
        const s = calcSMA(closes.slice(0, i+1), Math.min(200, i+1));
        if (closes[i] < s) bearStreak++;
        else break;
      }
    }
    const sma50Prev  = closes.length >= 55 ? calcSMA(closes.slice(0, -5), 50) : sma50;
    const sma50Bear  = sma50 && sma50Prev && sma50 < sma50Prev;
    let mode, sizeMult;
    if (sma200 && last < sma200 && bearStreak >= 3) {
      mode = 'BEAR'; sizeMult = 1.0;
    } else if (sma50 && last < sma50) {
      mode = 'LATERAL'; sizeMult = 0.75;
    } else {
      mode = 'BULL'; sizeMult = 1.0;
    }
    const prev = MARKET_REGIME.mode;
    MARKET_REGIME = { mode, sma50: Math.round(sma50*100)/100,
      sma200: sma200 ? Math.round(sma200*100)/100 : null,
      bearStreak, sma50Bearish: sma50Bear, sizeMult,
      price: last, ts: Date.now() };
    console.log(`[REGIME] ${mode} | SPY $${last.toFixed(2)} SMA50 $${sma50.toFixed(2)} bearStreak:${bearStreak}`);
    if (prev !== mode) {
      const icons = { BULL:'🟢', LATERAL:'🟡', BEAR:'🔴' };
      await sendTelegram(`${icons[mode]||'⚪'} <b>Régimen: ${prev} → ${mode}</b>\nSPY $${last.toFixed(2)} | SizeMult: ${sizeMult}x`);
    }
  } catch(e) { console.log('[REGIME]', e.message); }
}

// ═══════════════════════════════════════════════════════
// SEÑALES — MOM
// ═══════════════════════════════════════════════════════
function evalMOM(sym, bars15) {
  if (!bars15 || bars15.length < 50) return null;
  const closes = bars15.map(b => b.c);
  const last   = closes[closes.length - 1];
  if (last < 15) return null;
  const r   = calcRSI(closes, 14);
  const o   = calcOBV(bars15);
  const m   = calcMACD(closes);
  const e20 = calcEMA(closes, 20);
  const a   = calcATR(bars15, 14);
  const rv  = calcRVOL(bars15, 20);
  if (!r || !a || !rv) return null;
  const c1 = r >= 45 && r <= 65;
  const c2 = !!(o && o.bullish && o.rising);
  const c3 = !!(m && m.bullish && m.increasing);
  const c4 = !!(e20 && last > e20);
  const n  = bars15.length;
  const p3h = Math.max(
    n >= 4 ? (bars15[n-4].h || bars15[n-4].c) : 0,
    n >= 3 ? (bars15[n-3].h || bars15[n-3].c) : 0,
    n >= 2 ? (bars15[n-2].h || bars15[n-2].c) : 0,
  );
  const c5 = last > p3h && rv >= 1.5;
  const score = [c1,c2,c3,c4,c5].filter(Boolean).length;
  if (score < 4 || !c2) return null;
  const lb = bars15[n-1], pb = bars15[n-2] || lb;
  if (lb.c <= (lb.o || pb.c)) return null;
  if (n >= 4 && !(bars15[n-1].c > bars15[n-2].c && bars15[n-2].c > bars15[n-3].c)) return null;
  return { sym, system:'MOM', last, rsi:r, rvol:parseFloat(rv.toFixed(2)),
           score, atr:a, ema20:e20, signal: score>=5 ? 'OPTIMA' : 'SENAL' };
}

// ═══════════════════════════════════════════════════════
// SEÑALES — BOLLINGER
// ═══════════════════════════════════════════════════════
function evalBollinger(sym, dailyBars) {
  if (!dailyBars || dailyBars.length < 205) return null;
  const closes = dailyBars.map(b => b.c);
  const last   = closes[closes.length - 1];
  if (last < 15) return null;
  const bb   = calcBollinger(closes, 20, 2);
  const r    = calcRSI(closes, 14);
  const a    = calcATR(dailyBars, 14);
  const rv   = calcRVOL(dailyBars, 20);
  const s200 = calcSMA(closes, 200);
  if (!bb || !r || !a || !rv || !s200) return null;
  if (!(last <= bb.lower && r < 35 && last > s200 && rv >= 1.0)) return null;
  const stop = Math.min(
    parseFloat((bb.lower - a * 0.5).toFixed(2)),
    parseFloat((last - a * 1.0).toFixed(2)),
  );
  return { sym, system:'BOLL', last, rsi:r, rvol:parseFloat(rv.toFixed(2)),
           lower:bb.lower, mid:bb.mid, upper:bb.upper, stop, target:bb.mid, atr:a };
}

// ═══════════════════════════════════════════════════════
// SEÑALES — SHORT
// ═══════════════════════════════════════════════════════
const RS_THRESHOLD  = -5.0;
const BEAR_MIN_DAYS = 5;
function evalShort(sym, bars15, spyRS) {
  const reg = MARKET_REGIME;
  if (reg.mode !== 'BEAR')               return null;
  if (reg.bearStreak < BEAR_MIN_DAYS)    return null;
  if (!reg.sma50Bearish)                 return null;
  if (spyRS === null || spyRS >= RS_THRESHOLD) return null;
  if (!bars15 || bars15.length < 50) return null;
  const closes = bars15.map(b => b.c);
  const last   = closes[closes.length - 1];
  if (last < 15) return null;
  const r   = calcRSI(closes, 14);
  const o   = calcOBV(bars15);
  const m   = calcMACD(closes);
  const e20 = calcEMA(closes, 20);
  const a   = calcATR(bars15, 14);
  const rv  = calcRVOL(bars15, 20);
  if (!r || !a || !rv) return null;
  const c1 = r >= 30 && r <= 55;
  const c2 = !!(o && o.bearish && o.falling);
  const c3 = !!(m && m.bearish && m.decreasing);
  const c4 = !!(e20 && last < e20);
  const n  = bars15.length;
  const p3l = Math.min(
    n >= 4 ? (bars15[n-4].l || bars15[n-4].c) : last,
    n >= 3 ? (bars15[n-3].l || bars15[n-3].c) : last,
    n >= 2 ? (bars15[n-2].l || bars15[n-2].c) : last,
  );
  const c5 = last < p3l && rv >= 1.5;
  const lb = bars15[n-1], pb = bars15[n-2] || lb;
  const c6 = lb.c < (lb.o || pb.c);
  const score = [c1,c2,c3,c4,c5,c6].filter(Boolean).length;
  if (score < 5 || !c2) return null;
  return { sym, system:'SHORT', last, rsi:r, rvol:parseFloat(rv.toFixed(2)),
           score, atr:a, ema20:e20, rs:spyRS };
}

// ═══════════════════════════════════════════════════════
// SIZING
// ═══════════════════════════════════════════════════════
function calcQty(entry, stop, sizeMult = 1.0) {
  const riskPer = Math.abs(entry - stop);
  if (riskPer <= 0) return null;
  const riskUSD   = CAPITAL_EUR * RISK_PCT * EUR_USD * sizeMult;
  const qtyByRisk = Math.floor(riskUSD / riskPer);
  const qtyByCap  = Math.floor(CAPITAL_EUR * 0.20 * EUR_USD / entry);
  const qty = Math.min(qtyByRisk, qtyByCap);
  return qty >= 1 ? qty : null;
}

// ═══════════════════════════════════════════════════════
// GESTIÓN POSICIONES — EXITS
// ═══════════════════════════════════════════════════════
async function manageLongExit(sym, pos, bar, date, dailyBars) {
  // v3.6.0 EXITS-ATR: trailing por ATR escalonado. Reemplaza el BE pegado
  // (que mataba posiciones por ruido) y el trailing por EMA20 diaria (que iba
  // tan rezagado que devolvía ganancias grandes — el caso HUM: +1800€→BE).
  // Principio: el stop SOLO sube, nunca baja; la distancia se aprieta según R.
  const price = bar.c, low = bar.l || price;
  if (price > (pos.maxPrice || pos.entry)) pos.maxPrice = price;

  // 0) Stop tocado → salir (red primaria; el GTC del broker es la red dura)
  if (low <= pos.stop) {
    const ep  = pos.stop * (1 - SLIPPAGE);
    const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
    return { close:true, exitPrice:ep, pnl, reason: pos.runner ? 'RunnerStop' : 'Stop' };
  }

  // ATR de referencia: el guardado en la entrada (riesgo inicial R), con fallback
  const atr = pos.atr || Math.abs(pos.entry - pos.entrySenalStop || 0) || (pos.entry * 0.02);
  const R   = pos.entry - (pos.initialStop || (pos.entry - atr * 1.5)); // riesgo inicial en $
  const gainR = R > 0 ? (price - pos.entry) / R : 0;  // ganancia en múltiplos de R
  const maxP  = pos.maxPrice;

  // 1) BOLL target: cerrar al tocar banda media (lógica propia de BOLL)
  if (pos.system === 'BOLL' && pos.target && price >= pos.target * 0.998) {
    const ep  = price * (1 - SLIPPAGE);
    const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
    return { close:true, exitPrice:ep, pnl, reason:'BollTarget' };
  }

  // 2) Trailing escalonado por ATR — la distancia se aprieta cuanto más sube.
  //    Estos múltiplos son el corazón del fix del caso HUM.
  let trailMult = null;
  if      (gainR >= 5) trailMult = 1.0;   // +5R o más → muy ceñido (protege ganancia grande)
  else if (gainR >= 3) trailMult = 1.5;   // +3R → ceñido
  else if (gainR >= 1) trailMult = 3.0;   // +1R → holgado, deja correr
  // (por debajo de +1R no se traila: el stop inicial manda; deja respirar)

  if (trailMult !== null && atr > 0) {
    const trailStop = parseFloat((maxP - atr * trailMult).toFixed(2));
    // El stop SOLO sube. Y una vez en +1R, nunca por debajo de BE+0.5ATR.
    const beFloor = parseFloat((pos.entry + atr * 0.5).toFixed(2));
    const candidate = Math.max(trailStop, gainR >= 1 ? beFloor : pos.stop);
    if (candidate > pos.stop + 0.01) {
      pos.stop = candidate;
      if (!pos.be && pos.stop >= pos.entry) pos.be = true;
      if (gainR >= 1) pos.runner = true;
      await updateAlpacaStop(sym, pos.qty, pos.stop, false);
      console.log(`[TRAIL] ${sym} +${gainR.toFixed(1)}R stop → $${pos.stop} (x${trailMult}ATR bajo max $${maxP.toFixed(2)})`);
    }
  }

  // 3) TimeStop solo si la posición NO ha despegado (sigue por debajo de +1R)
  //    tras 7 días. Más laxo que antes (5d): da margen a desarrollarse.
  if (gainR < 1) {
    const days = Math.floor((new Date(date) - new Date(pos.entryDate)) / 86400000);
    if (days >= 7) {
      const ep  = price * (1 - SLIPPAGE);
      const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
      return { close:true, exitPrice:ep, pnl, reason:'TimeStop' };
    }
  }
  return null;
}
async function manageShortExit(sym, pos, bar, date, dailyBars) {
  // v3.6.0 EXITS-ATR: espejo del trailing escalonado para cortos.
  // El stop SOLO baja (mejora), nunca sube; se aprieta según R de ganancia.
  const price = bar.c, high = bar.h || price;
  if (price < (pos.minPrice || pos.entry)) pos.minPrice = price;

  if (high >= pos.stop) {
    const ep  = pos.stop * (1 + SLIPPAGE);
    const pnl = (pos.entry - ep) * pos.qty / EUR_USD;
    return { close:true, exitPrice:ep, pnl, reason: pos.runner ? 'RunnerStop' : 'Stop' };
  }

  const atr   = pos.atr || (pos.entry * 0.02);
  const R     = (pos.initialStop || (pos.entry + atr * 1.5)) - pos.entry; // riesgo inicial $
  const gainR = R > 0 ? (pos.entry - price) / R : 0;
  const minP  = pos.minPrice;

  let trailMult = null;
  if      (gainR >= 5) trailMult = 1.0;
  else if (gainR >= 3) trailMult = 1.5;
  else if (gainR >= 1) trailMult = 3.0;

  if (trailMult !== null && atr > 0) {
    const trailStop = parseFloat((minP + atr * trailMult).toFixed(2));
    const beFloor   = parseFloat((pos.entry - atr * 0.5).toFixed(2));
    const candidate = Math.min(trailStop, gainR >= 1 ? beFloor : pos.stop);
    if (candidate < pos.stop - 0.01) {
      pos.stop = candidate;
      if (!pos.be && pos.stop <= pos.entry) pos.be = true;
      if (gainR >= 1) pos.runner = true;
      await updateAlpacaStop(sym, pos.qty, pos.stop, true);
      console.log(`[TRAIL] SHORT ${sym} +${gainR.toFixed(1)}R stop → $${pos.stop}`);
    }
  }

  if (gainR < 1) {
    const days = Math.floor((new Date(date) - new Date(pos.entryDate)) / 86400000);
    if (days >= 7) {
      const ep  = price * (1 + SLIPPAGE);
      const pnl = (pos.entry - ep) * pos.qty / EUR_USD;
      return { close:true, exitPrice:ep, pnl, reason:'TimeStop' };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// ALPACA EXECUTION
// ═══════════════════════════════════════════════════════
function nyOffsetHours() {
  const now   = new Date();
  const nyStr = now.toLocaleString('en-US', { timeZone:'America/New_York',
    hour:'2-digit', minute:'2-digit', hour12:false });
  const [h, m]  = nyStr.split(':').map(Number);
  const utcMins = now.getUTCHours()*60 + now.getUTCMinutes();
  let diff = utcMins - (h*60 + m);
  if (diff < -720) diff += 1440;   // cruce de medianoche UTC
  if (diff >  720) diff -= 1440;
  return Math.round(diff / 60);
}
function isMarketOpen() {
  const now    = new Date();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false;
  const off     = Math.abs(nyOffsetHours());
  const utcMins = now.getUTCHours()*60 + now.getUTCMinutes();
  const open    = 570 + off*60;
  const close   = 960 + off*60;
  return utcMins >= open && utcMins < close;
}
function isEntryAllowed() {
  if (!isMarketOpen()) return false;
  // F7: offset dinámico (antes hardcodeado a 4 — la regla de 30min
  // desaparecía en horario de invierno)
  const off     = Math.abs(nyOffsetHours());
  const now     = new Date();
  const utcMins = now.getUTCHours()*60 + now.getUTCMinutes();
  const open    = 570 + off*60;
  const close   = 960 + off*60;
  return utcMins >= open + 30 && utcMins < close - 30;
}
// F3: esperar y leer el fill real de una orden (hasta maxSecs segundos)
async function waitForFill(orderId, maxSecs = 10) {
  for (let i = 0; i < maxSecs; i++) {
    try {
      const o = await fetch(`${alpacaBase()}/v2/orders/${orderId}`,
        { headers: alpacaHdr() }).then(r => r.json());
      if (o.status === 'filled') {
        return { price: parseFloat(o.filled_avg_price), qty: parseFloat(o.filled_qty) };
      }
      if (['canceled','rejected','expired'].indexOf(o.status) !== -1) return null;
    } catch(e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

async function executeBuy(sym, entry, stop, qty, meta = {}) {
  if (!isMarketOpen()) {
    await sendTelegram(`🚫 Orden bloqueada — mercado cerrado (${sym})`);
    return false;
  }
  try {
    // F2: orden OTO — entrada market + stop GTC atómicos en el broker.
    // Si Alpaca acepta la entrada, el stop existe por construcción.
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method:'POST', headers:alpacaHdr(),
      body: JSON.stringify({
        symbol:sym, qty:String(qty), side:'buy',
        type:'market', time_in_force:'gtc',
        order_class:'oto',
        stop_loss:{ stop_price:String(stop) },
      }),
    });
    const o = await r.json();
    if (!o.id) {
      await sendTelegram(`❌ Error Alpaca ${sym}: ${o.message || JSON.stringify(o).slice(0,100)}`);
      return false;
    }
    // F3: registrar con el precio de fill REAL, no el teórico
    const fill = await waitForFill(o.id, 10);
    const entryReal = (fill && fill.price) ? fill.price : entry;
    if (!fill) await sendTelegram(`⚠️ ${sym}: sin confirmación de fill en 10s — registrado con precio teórico $${entry.toFixed(2)}. RECON lo corregirá.`);
    const riskEur = Math.round((entryReal - stop) * qty / EUR_USD);
    openPositions[sym] = {
      sym, qty, entry: entryReal, stop, entryDate: new Date().toISOString().slice(0,10),
      maxPrice: entryReal, minPrice: entryReal,
      be:false, runner:false, system: meta.system || 'MOM',
      target: meta.target || null, ts: Date.now(),
      orderId: o.id, entrySenal: entry,
      // v3.6.0 EXITS-ATR: guardar ATR y stop inicial para el trailing escalonado
      atr: meta.atr || Math.abs(entryReal - stop) / 1.5,
      initialStop: stop,
    };
    saveState();
    const mode = isLive() ? '🔴 REAL' : '📋 PAPER';
    const slipBps = entry > 0 ? Math.round((entryReal/entry - 1) * 10000) : 0;
    await sendTelegram(
      `✅ <b>${meta.system||'MOM'} EJECUTADO — ${sym}</b>\n${mode}\n\n` +
      `💰 ${qty} acc @ $${entryReal.toFixed(2)} (señal $${entry.toFixed(2)} · slip ${slipBps>=0?'+':''}${slipBps}bps)\n` +
      `🛑 Stop: $${stop} (OTO) · Riesgo: ~€${riskEur}\n` +
      (meta.target ? `🎯 Target: $${meta.target.toFixed(2)}\n` : '') +
      `\n/cerrar_${sym}`
    );
    return true;
  } catch(e) {
    await sendTelegram(`❌ Error ejecutando ${sym}: ${e.message}`);
    return false;
  }
}
async function executeSell(sym, qty, reason, price) {
  if (!isMarketOpen() && !reason.toLowerCase().includes('stop')) return false;
  try {
    const pos = openPositions[sym];
    const isShortPos = pos && pos.system === 'SHORT';
    // F5: P&L con signo correcto según dirección
    const pnlOf = (exitPx) => pos
      ? Math.round((isShortPos ? (pos.entry - exitPx) : (exitPx - pos.entry)) * qty / EUR_USD)
      : 0;

    // F4: guard anti doble-venta — ¿la posición sigue viva en el broker?
    // Si el stop GTC de Alpaca ya se ejecutó, registrar y NO enviar orden
    // (antes: se enviaba otra venta a mercado → corto accidental).
    const chk = await fetch(`${alpacaBase()}/v2/positions/${sym}`, { headers: alpacaHdr() });
    if (chk.status === 404) {
      if (pos) {
        const pnl = pnlOf(price);
        tradeHistory.unshift({
          sym, system: pos.system, entry: pos.entry, exit: price,
          qty, pnlEur: pnl, win: pnl > 0,
          entryDate: pos.entryDate, exitDate: new Date().toISOString().slice(0,10),
          exitReason: 'StopBroker',
        });
        if (tradeHistory.length > 500) tradeHistory = tradeHistory.slice(0, 500);
        delete openPositions[sym];
        saveState();
        await sendTelegram(`🛑 <b>${sym} ya cerrado por stop del broker</b>\nP&L estimado: ${pnlOf(price) >= 0 ? '+' : ''}€${pnlOf(price)}`);
      }
      return true;
    }

    const openOrds = await fetch(`${alpacaBase()}/v2/orders?status=open&symbols=${sym}`,
      { headers:alpacaHdr() }).then(r => r.json()).catch(() => []);
    for (const ord of (Array.isArray(openOrds) ? openOrds : [])) {
      await fetch(`${alpacaBase()}/v2/orders/${ord.id}`,
        { method:'DELETE', headers:alpacaHdr() }).catch(() => {});
    }
    // F5: para cerrar un SHORT se COMPRA (buy-to-cover), no se vende más
    const side = isShortPos ? 'buy' : 'sell';
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method:'POST', headers:alpacaHdr(),
      body: JSON.stringify({ symbol:sym, qty:String(qty), side,
        type:'market', time_in_force:'day' }),
    });
    const o = await r.json();
    if (!o.id) return false;
    // F3: usar fill real también en la salida
    const fill = await waitForFill(o.id, 10);
    const exitReal = (fill && fill.price) ? fill.price : price;
    const pnl = pnlOf(exitReal);
    if (pos) {
      tradeHistory.unshift({
        sym, system: pos.system, entry: pos.entry, exit: exitReal,
        qty, pnlEur: pnl, win: pnl > 0,
        entryDate: pos.entryDate, exitDate: new Date().toISOString().slice(0,10),
        exitReason: reason,
      });
      if (tradeHistory.length > 500) tradeHistory = tradeHistory.slice(0, 500);
    }
    delete openPositions[sym];
    saveState();
    await sendTelegram(
      `🤖 <b>AUTO-EXIT — ${sym}</b>\n${qty} acc @ $${exitReal.toFixed(2)} (${side})\n` +
      `Motivo: ${reason}\nP&L: ${pnl >= 0 ? '+' : ''}€${pnl}`
    );
    return true;
  } catch(e) { return false; }
}

// ═══════════════════════════════════════════════════════
// ACTUALIZAR STOP EN ALPACA
// ═══════════════════════════════════════════════════════
async function updateAlpacaStop(sym, qty, newStop, isShort = false) {
  try {
    const openOrds = await fetch(
      `${alpacaBase()}/v2/orders?status=open&symbols=${sym}`,
      { headers: alpacaHdr() }
    ).then(r => r.json()).catch(() => []);
    for (const ord of (Array.isArray(openOrds) ? openOrds : [])) {
      if (ord.type === 'stop' || ord.type === 'stop_limit') {
        await fetch(`${alpacaBase()}/v2/orders/${ord.id}`,
          { method: 'DELETE', headers: alpacaHdr() }).catch(() => {});
      }
    }
    const side = isShort ? 'buy' : 'sell';
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method: 'POST', headers: alpacaHdr(),
      body: JSON.stringify({
        symbol: sym, qty: String(qty), side,
        type: 'stop', stop_price: String(newStop),
        time_in_force: 'gtc',
      }),
    });
    const o = await r.json();
    if (o.id) {
      console.log(`[STOP] ✅ ${sym} stop → $${newStop}`);
      return true;
    }
    return false;
  } catch(e) {
    console.log(`[STOP] Error ${sym}:`, e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════
// SCANNER — MOM + BOLL (v3.4.0: D03 + I10 + N02)
// ═══════════════════════════════════════════════════════
const BUSY = { scan:false, manage:false, recon:false };
async function withLock(name, fn) {
  if (BUSY[name]) { console.log(`[LOCK] ${name} en ejecucion — skip`); return; }
  if ((name === 'manage' && BUSY.recon) || (name === 'recon' && BUSY.manage)) {
    console.log(`[LOCK] ${name} pospuesto`); return;
  }
  BUSY[name] = true;
  try { return await fn(); }
  catch(e) { console.log(`[LOCK ${name}]`, e.message); }
  finally { BUSY[name] = false; }
}

async function checkMOMSignals() {
  if (!isEntryAllowed()) return;

  // ── v3.4.0 D03: Bloquear si SPY cae >1% hoy ─────────
  // Backtest confirmado: OOS PF 3.59 vs 3.28 BASE (COMB_FINAL)
  const spyChange = await getSPYDailyChange();
  if (spyChange <= -1.0) {
    console.log(`[D03] Bloqueado — SPY ${spyChange.toFixed(2)}% hoy (umbral -1%)`);
    return;
  }

  const reg  = MARKET_REGIME;
  if (reg.mode === 'BEAR') return;
  const momCount  = Object.values(openPositions).filter(p => p.system === 'MOM').length;
  const bollCount = Object.values(openPositions).filter(p => p.system === 'BOLL').length;
  if (momCount >= MAX_MOM && bollCount >= MAX_BOLL) return;
  console.log(`[MOM] Modo ${reg.mode} | MOM:${momCount}/${MAX_MOM} BOLL:${bollCount}/${MAX_BOLL} | SPY:${spyChange.toFixed(2)}%`);

  const spyBars = await fetchBars15min('SPY');
  const spyLast = spyBars ? spyBars[spyBars.length-1].c : null;
  const spy20   = spyBars && spyBars.length >= 20 ? spyBars[spyBars.length-21].c : null;

  const candidates = [];
  for (const sym of UNIVERSE) {
    try {
      if (openPositions[sym]) continue;
      const month = new Date().toISOString().slice(0,7);
      if (monthlyTrades[`${sym}_${month}`]) continue;

      const bars15 = await fetchBars15min(sym);
      if (!bars15 || bars15.length < 50) continue;

      if (momCount < MAX_MOM) {
        const sig = evalMOM(sym, bars15);
        if (sig) {
          // Filtro sectorial
          const etf = SECTOR_MAP[sym];
          if (etf) {
            const etfBars = await fetchBars15min(etf);
            if (etfBars && etfBars.length >= 6) {
              const perf5 = (etfBars[etfBars.length-1].c - etfBars[etfBars.length-6].c)
                           / etfBars[etfBars.length-6].c * 100;
              if (perf5 < -2.0) continue;
            }
          }
          // RS vs SPY
          let rs = 0;
          if (spy20 && spyLast && spy20 > 0) {
            const s20 = bars15.length >= 21 ? bars15[bars15.length-21].c : null;
            if (s20 && s20 > 0) rs = (sig.last/s20-1)*100 - (spyLast/spy20-1)*100;
          }
          // H2: RS mínimo +2% vs SPY en 20 días
          if (rs < 2.0) continue;

          // ── v3.4.0 N02: Wyckoff Spring ─────────────
          // Solo entrar si ha habido Spring en últimos 10 días
          // Backtest OOS confirmado: PF 3.58 P&L €+26,549
          const dailyBars15 = await fetchDailyBars(sym, 15);
          if (dailyBars15 && !detectWyckoffSpring(dailyBars15, 10)) {
            console.log(`[N02] ${sym} sin Spring en 10d — skip`);
            continue;
          }

          candidates.push({ ...sig, rs, type:'MOM' });
        }
      }

      if (bollCount < MAX_BOLL && reg.mode === 'BULL') {
        const dailyBars = await fetchDailyBars(sym, 220);
        if (dailyBars && dailyBars.length >= 205) {
          const sig = evalBollinger(sym, dailyBars);
          if (sig) candidates.push({ ...sig, rs:-99, type:'BOLL' });
        }
      }
      await new Promise(r => setTimeout(r, 100));
    } catch(e) { console.log('[MOM]', sym, e.message); }
  }

  candidates.sort((a, b) => b.rs - a.rs);

  for (const sig of candidates) {
    const sym = sig.sym;
    if (openPositions[sym]) continue;
    const entry   = sig.last * (1 + SLIPPAGE);
    const atrVal  = Math.max(sig.atr, sig.last * 0.005);

    // ── v3.4.0 I10: Stop bajo VPOC ─────────────────
    // Backtest OOS confirmado: PF 3.59 vs 3.28 BASE
    const bars15Fresh = await fetchBars15min(sym);
    const stop = bars15Fresh
      ? calcStopVPOC(bars15Fresh, entry, atrVal)
      : parseFloat((entry - atrVal * 1.5).toFixed(2));

    const qty     = calcQty(entry, stop, reg.sizeMult);
    if (!qty) continue;
    const target = sig.type === 'BOLL' ? sig.target : null;
    const month  = new Date().toISOString().slice(0,7);
    const key    = `${sym}_mom_${Math.floor(Date.now()/(4*3600*1000))}`;
    if (sentAlerts[key]) continue;
    sentAlerts[key] = Date.now();

    if (AUTO_EXECUTE) {
      await executeBuy(sym, entry, stop, qty, { system: sig.type, target, atr: atrVal });
      monthlyTrades[`${sym}_${month}`] = true;
      if (sig.type === 'MOM' && Object.values(openPositions).filter(p=>p.system==='MOM').length >= MAX_MOM) break;
      if (sig.type === 'BOLL' && Object.values(openPositions).filter(p=>p.system==='BOLL').length >= MAX_BOLL) break;
    } else {
      pendingOrders[sym] = { sym, entry, stop, qty, target, system:sig.type, ts:Date.now() };
      const icon = sig.type === 'BOLL' ? '📉' : '🚀';
      await sendTelegram(
        `${icon} <b>${sig.type} SIGNAL — ${sym}</b>\n\n` +
        `💰 $${sig.last.toFixed(2)} | Stop: $${stop}` + (target ? ` | Target: $${target.toFixed(2)}` : '') + `\n` +
        `📦 ${qty} acc | RSI ${sig.rsi} | RVOL ${sig.rvol}x | RS ${sig.rs?.toFixed(1)}%\n` +
        `🌊 Spring ✅ | VPOC stop ✅ | SPY ${spyChange.toFixed(2)}%\n\n` +
        `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════
// SCANNER — SHORT
// ═══════════════════════════════════════════════════════
async function checkShortSignals() {
  if (!isEntryAllowed()) return;
  const reg = MARKET_REGIME;
  if (reg.mode !== 'BEAR')            return;
  if (reg.bearStreak < BEAR_MIN_DAYS) return;
  if (!reg.sma50Bearish)              return;
  const spyDD = await spyDrawdown60();
  if (spyDD >= -10.0) {
    console.log(`[SHORT] Bloqueado — SPY DD ${spyDD.toFixed(1)}% (umbral: -10%)`);
    return;
  }
  console.log(`[SHORT] ✅ Crisis activa — SPY DD ${spyDD.toFixed(1)}%`);
  const shortCount = Object.values(openPositions).filter(p => p.system === 'SHORT').length;
  if (shortCount >= MAX_SHORT) return;
  console.log(`[SHORT] BEAR bearStreak:${reg.bearStreak} | SHORT:${shortCount}/${MAX_SHORT}`);
  const spyBars = await fetchBars15min('SPY');
  const spyLast = spyBars ? spyBars[spyBars.length-1].c : null;
  const spy20   = spyBars && spyBars.length >= 21 ? spyBars[spyBars.length-21].c : null;
  const candidates = [];
  for (const sym of UNIVERSE) {
    try {
      if (openPositions[sym]) continue;
      const month = new Date().toISOString().slice(0,7);
      if (monthlyTrades[`${sym}_short_${month}`]) continue;
      const bars15 = await fetchBars15min(sym);
      if (!bars15 || bars15.length < 50) continue;
      let spyRS = null;
      if (spy20 && spyLast && spy20 > 0) {
        const s20 = bars15.length >= 21 ? bars15[bars15.length-21].c : null;
        if (s20 && s20 > 0) spyRS = (bars15[bars15.length-1].c/s20-1)*100 - (spyLast/spy20-1)*100;
      }
      const sig = evalShort(sym, bars15, spyRS);
      if (sig) candidates.push({ ...sig, spyRS });
      await new Promise(r => setTimeout(r, 100));
    } catch(e) { console.log('[SHORT]', sym, e.message); }
  }
  candidates.sort((a, b) => a.spyRS - b.spyRS);
  for (const sig of candidates) {
    const sym = sig.sym;
    if (openPositions[sym]) continue;
    const shortNow = Object.values(openPositions).filter(p=>p.system==='SHORT').length;
    if (shortNow >= MAX_SHORT) break;
    const entry  = sig.last * (1 - SLIPPAGE);
    const atrVal = Math.max(sig.atr, sig.last * 0.005);
    const stop   = parseFloat((entry + atrVal * 1.5).toFixed(2));
    const qty    = calcQty(entry, stop);
    if (!qty) continue;
    const month = new Date().toISOString().slice(0,7);
    const key   = `${sym}_short_${Math.floor(Date.now()/(4*3600*1000))}`;
    if (sentAlerts[key]) continue;
    sentAlerts[key] = Date.now();
    if (AUTO_EXECUTE) {
      try {
        // F2: OTO también en SHORT — entrada + stop de recompra atómicos
        const r = await fetch(`${alpacaBase()}/v2/orders`, {
          method:'POST', headers:alpacaHdr(),
          body: JSON.stringify({ symbol:sym, qty:String(qty), side:'sell',
            type:'market', time_in_force:'gtc',
            order_class:'oto', stop_loss:{ stop_price:String(stop) } }),
        });
        const o = await r.json();
        if (o.id) {
          const fill = await waitForFill(o.id, 10);
          const entryReal = (fill && fill.price) ? fill.price : entry;
          openPositions[sym] = { sym, qty, entry: entryReal, stop,
            entryDate: new Date().toISOString().slice(0,10),
            minPrice:entryReal, be:false, runner:false, system:'SHORT',
            ts:Date.now(), orderId:o.id, entrySenal:entry,
            atr: atrVal, initialStop: stop };
          monthlyTrades[`${sym}_short_${month}`] = true;
          saveState();
          const riskEur = Math.round((stop - entryReal) * qty / EUR_USD);
          await sendTelegram(
            `📉 <b>SHORT EJECUTADO — ${sym}</b>\n\n` +
            `💰 ${qty} acc @ $${entryReal.toFixed(2)}\n` +
            `🛑 Stop: $${stop} (OTO) · Riesgo: ~€${riskEur}\n` +
            `📊 RSI ${sig.rsi} | RS ${sig.spyRS?.toFixed(1)}% vs SPY\n\n/cerrar_${sym}`
          );
        }
      } catch(e) { console.log('[SHORT EXEC]', sym, e.message); }
    } else {
      pendingOrders[sym] = { sym, entry, stop, qty, system:'SHORT', ts:Date.now(), isShort:true };
      await sendTelegram(
        `📉 <b>SHORT SIGNAL — ${sym}</b>\n\n` +
        `💰 $${sig.last.toFixed(2)} | Stop: $${stop}\n` +
        `📦 ${qty} acc | RSI ${sig.rsi} | RS ${sig.spyRS?.toFixed(1)}% vs SPY\n\n` +
        `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════
// GESTIÓN POSICIONES ABIERTAS
// ═══════════════════════════════════════════════════════
async function managePositions() {
  const syms = Object.keys(openPositions);
  if (!syms.length) return;
  for (const sym of syms) {
    try {
      const pos  = openPositions[sym];
      if (!pos) continue;
      const snap = await fetchSnapshot(sym);
      if (!snap) continue;
      const price = snap.price;
      const date  = new Date().toISOString().slice(0,10);
      const dailyBars = await fetchDailyBars(sym, 30);
      // v3.6.0 EXITS-ATR: si la posición no tiene atr/initialStop (adoptada por
      // sync o de una versión anterior), derivarlos ahora para que el trailing
      // escalonado funcione también con posiciones preexistentes.
      if (!pos.atr) {
        const b15 = await fetchBars15min(sym).catch(() => null);
        const a = b15 ? calcATR(b15, 14) : null;
        pos.atr = a || Math.abs(pos.entry - pos.stop) / 1.5 || pos.entry * 0.02;
      }
      if (!pos.initialStop) pos.initialStop = pos.stop;
      // Usar high/low reales de la última vela 15m (no la vela sintética ±0.1%)
      let bar = { c: price, h: price, l: price };
      try {
        const b15b = await fetchBars15min(sym).catch(() => null);
        if (b15b && b15b.length) {
          const lb = b15b[b15b.length - 1];
          bar = { c: price, h: Math.max(lb.h || price, price), l: Math.min(lb.l || price, price) };
        }
      } catch(_) {}
      let result = null;
      if (pos.system === 'SHORT') {
        result = await manageShortExit(sym, pos, bar, date, dailyBars);
      } else {
        result = await manageLongExit(sym, pos, bar, date, dailyBars);
      }
      if (result && result.close) {
        await executeSell(sym, pos.qty, result.reason, result.exitPrice);
      }
      const gainPct = pos.system === 'SHORT'
        ? (pos.entry - price) / pos.entry * 100
        : (price - pos.entry) / pos.entry * 100;
      for (const mh of [3, 5, 10, 15]) {
        const mk = `${sym}_hito_${mh}`;
        if (gainPct >= mh && !sentAlerts[mk]) {
          sentAlerts[mk] = Date.now();
          const pnl = Math.round(Math.abs(price - pos.entry) * pos.qty / EUR_USD);
          await sendTelegram(`📈 <b>${pos.system} ${sym} +${gainPct.toFixed(1)}%</b>\n$${price.toFixed(2)} · P&L: +€${pnl}\nStop: $${pos.stop}`);
        }
      }
      await new Promise(r => setTimeout(r, 300));
    } catch(e) { console.log('[MANAGE]', sym, e.message); }
  }
}

// ═══════════════════════════════════════════════════════
// F6: RECONCILIACIÓN BROKER ↔ SERVIDOR (cada 5 min)
// El servidor deja de "creer" su estado: lo verifica contra Alpaca.
// ═══════════════════════════════════════════════════════
async function reconcilePositions() {
  try {
    const [posRes, ordRes] = await Promise.all([
      fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHdr() }).then(r=>r.json()).catch(()=>[]),
      fetch(`${alpacaBase()}/v2/orders?status=open&limit=200`, { headers: alpacaHdr() }).then(r=>r.json()).catch(()=>[]),
    ]);
    const alpacaPos = Array.isArray(posRes) ? posRes : [];
    const orders    = Array.isArray(ordRes) ? ordRes : [];
    const posBySym  = {};
    alpacaPos.forEach(p => { posBySym[p.symbol] = p; });
    const stopBySym = {};
    orders.forEach(o => {
      if (o.type === 'stop' || o.type === 'stop_limit') stopBySym[o.symbol] = o;
    });

    // 1) El servidor cree que está abierta pero el broker ya la cerró
    //    (el stop GTC se ejecutó entre polls) → registrar trade y limpiar
    for (const sym of Object.keys(openPositions)) {
      if (!posBySym[sym]) {
        const pos  = openPositions[sym];
        const snap = await fetchSnapshot(sym).catch(() => null);
        const px   = (snap && snap.price) ? snap.price : pos.stop;
        const pnl  = Math.round(
          (pos.system === 'SHORT' ? (pos.entry - px) : (px - pos.entry)) * pos.qty / EUR_USD
        );
        tradeHistory.unshift({
          sym, system: pos.system, entry: pos.entry, exit: px, qty: pos.qty,
          pnlEur: pnl, win: pnl > 0, entryDate: pos.entryDate,
          exitDate: new Date().toISOString().slice(0,10), exitReason: 'StopBroker',
        });
        if (tradeHistory.length > 500) tradeHistory = tradeHistory.slice(0, 500);
        delete openPositions[sym];
        await sendTelegram(`🔄 <b>RECON: ${sym} cerrado en broker</b>\nStop GTC ejecutado · P&L estimado: ${pnl >= 0 ? '+' : ''}€${pnl}`);
      }
    }
    // 2) Posición en el broker que el servidor no conoce → alertar
    for (const p of alpacaPos) {
      if (!openPositions[p.symbol]) {
        await sendTelegram(`⚠️ <b>RECON: posición huérfana ${p.symbol}</b> (${p.qty} acc, ${p.side})\nUsa POST /sync para adoptarla.`);
      }
    }
    // 3) Posición registrada SIN stop vivo en el broker → recolocar y alertar
    for (const sym of Object.keys(openPositions)) {
      if (posBySym[sym] && !stopBySym[sym]) {
        const pos = openPositions[sym];
        await sendTelegram(`🚨 <b>RECON: ${sym} SIN STOP en broker</b>\nRecolocando stop $${pos.stop}`);
        await updateAlpacaStop(sym, pos.qty, pos.stop, pos.system === 'SHORT');
      }
      // 3b) Stop existe en broker — sincronizar servidor con broker
      // Si el stop del broker es MEJOR (más alto para long, más bajo para short)
      // actualizar el servidor para no sobrescribir stops manuales
      if (posBySym[sym] && stopBySym[sym]) {
        const pos        = openPositions[sym];
        const brokerStop = parseFloat(stopBySym[sym].stop_price);
        const isShort    = pos.system === 'SHORT';
        const brokerIsBetter = isShort
          ? brokerStop < pos.stop   // short: stop más bajo = mejor protección
          : brokerStop > pos.stop;  // long:  stop más alto = mejor protección
        if (brokerIsBetter && Math.abs(brokerStop - pos.stop) > 0.05) {
          console.log(`[RECON] ${sym} stop broker $${brokerStop} > servidor $${pos.stop} → adoptando broker`);
          openPositions[sym].stop = brokerStop;
          // Si el stop está por encima del entry en long → marcar BE
          if (!isShort && brokerStop > pos.entry) {
            openPositions[sym].be = true;
          }
          if (isShort && brokerStop < pos.entry) {
            openPositions[sym].be = true;
          }
        }
      }
    }
    // 4) Diferencia de cantidad → alertar (fills parciales, intervención manual)
    for (const sym of Object.keys(openPositions)) {
      const p = posBySym[sym];
      if (p && Math.abs(parseInt(p.qty)) !== openPositions[sym].qty) {
        await sendTelegram(`⚠️ <b>RECON: qty difiere en ${sym}</b>\nServidor: ${openPositions[sym].qty} · Broker: ${Math.abs(parseInt(p.qty))}`);
      }
    }
    saveState();
  } catch(e) { console.log('[RECON]', e.message); }
}

// ═══════════════════════════════════════════════════════
// SECTOR SENTIMENT
// ═══════════════════════════════════════════════════════
const SECTOR_ETFS = {
  AI_CHIPS:'SOXX', CLOUD:'XLK', SPACE:'XAR',
  CLEAN_ENERGY:'ICLN', BIOTECH:'XBI', HEALTHCARE:'XLV',
  AIRLINES:'JETS', INDUSTRIAL:'XLI', FINTECH:'XLF',
};
async function updateSectorSentiment() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;
    const etfData = {};
    for (const [sector, etf] of Object.entries(SECTOR_ETFS)) {
      const bars = await fetchDailyBars(etf, 30);
      if (!bars || bars.length < 10) continue;
      const closes = bars.map(b => b.c);
      const last   = closes[closes.length-1];
      const perf5d = (last - closes[closes.length-6]) / closes[closes.length-6] * 100;
      etfData[sector] = { etf, perf5d: parseFloat(perf5d.toFixed(2)), last };
    }
    const etfText = Object.entries(etfData).map(([s,d]) =>
      `${s}(${d.etf}): ${d.perf5d>0?'+':''}${d.perf5d}% 5d`
    ).join('\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1000,
        system: 'Responde SOLO con JSON válido. Sin markdown.',
        messages: [{ role:'user', content:
          `ETFs sectoriales hoy:\n${etfText}\n\n` +
          `Para cada sector da: status (BULLISH/NEUTRAL/BEARISH), score (0-100), reason (max 60 chars).\n` +
          `Sectores: AI_CHIPS, CLOUD, SPACE, CLEAN_ENERGY, BIOTECH, HEALTHCARE, AIRLINES, INDUSTRIAL, FINTECH\n` +
          `Formato: {"AI_CHIPS":{"status":"BULLISH","score":75,"reason":"..."},...}`
        }],
      }),
    });
    const d    = await r.json();
    const text = (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    const j1 = text.indexOf('{'), j2 = text.lastIndexOf('}');
    if (j1 >= 0 && j2 >= 0) {
      sectorSentiment  = JSON.parse(text.slice(j1, j2+1));
      sectorLastUpdate = new Date().toISOString().slice(0,10);
      const bull = Object.entries(sectorSentiment).filter(([,v])=>v.status==='BULLISH').map(([k])=>k);
      const bear = Object.entries(sectorSentiment).filter(([,v])=>v.status==='BEARISH').map(([k])=>k);
      await sendTelegram(`📊 <b>Análisis Sectorial</b>\n🟢 ${bull.join(', ')||'ninguno'}\n🔴 ${bear.join(', ')||'ninguno'}`);
    }
  } catch(e) { console.log('[SECTOR]', e.message); }
}

// ═══════════════════════════════════════════════════════
// TELEGRAM
// ═══════════════════════════════════════════════════════
async function sendTelegram(msg) {
  if (!TG_TOKEN || !TG_CHAT) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ chat_id:TG_CHAT, text:msg, parse_mode:'HTML' }),
    });
    const d = await r.json();
    return d.ok;
  } catch(e) { return false; }
}
async function pollTelegram() {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${lastUpdateId+1}&timeout=5`);
    const text = await r.text();
    if (!text || text.trim().startsWith('<')) return;
    const d = JSON.parse(text);
    if (!d.ok || !d.result.length) return;
    for (const update of d.result) {
      lastUpdateId = update.update_id;
      const msg  = update.message;
      if (!msg?.text) continue;
      const text = msg.text.trim().toLowerCase();
      if (msg.chat.id.toString() !== TG_CHAT) continue;
      console.log(`[TG CMD] ${text}`);
      if (text === '/si' || text.startsWith('/ejecutar_')) {
        const sym = text.startsWith('/ejecutar_')
          ? text.replace('/ejecutar_','').toUpperCase()
          : Object.keys(pendingOrders)[0];
        if (!sym || !pendingOrders[sym]) { await sendTelegram('⚠️ Sin orden pendiente'); continue; }
        const order = pendingOrders[sym];
        if (Date.now() - order.ts > 10*60*1000) {
          delete pendingOrders[sym];
          await sendTelegram(`⏰ Orden ${sym} expirada`);
          continue;
        }
        if (!isMarketOpen()) { await sendTelegram('🚫 Mercado cerrado'); continue; }
        if (order.isShort) {
          const r2 = await fetch(`${alpacaBase()}/v2/orders`, {
            method:'POST', headers:alpacaHdr(),
            body: JSON.stringify({ symbol:sym, qty:String(order.qty), side:'sell',
              type:'market', time_in_force:'gtc',
              order_class:'oto', stop_loss:{ stop_price:String(order.stop) } }),
          });
          const o = await r2.json();
          if (o.id) {
            const fill = await waitForFill(o.id, 10);
            const entryReal = (fill && fill.price) ? fill.price : order.entry;
            openPositions[sym] = { ...order, entry: entryReal,
              entryDate:new Date().toISOString().slice(0,10),
              minPrice:entryReal, be:false, runner:false, ts:Date.now(), orderId:o.id };
            const month = new Date().toISOString().slice(0,7);
            monthlyTrades[`${sym}_short_${month}`] = true;
            delete pendingOrders[sym];
            saveState();
            await sendTelegram(`✅ SHORT ejecutado — ${sym} ${order.qty} acc @ $${entryReal.toFixed(2)} (stop OTO $${order.stop})`);
          }
        } else {
          await executeBuy(sym, order.entry, order.stop, order.qty,
            { system:order.system, target:order.target });
          const month = new Date().toISOString().slice(0,7);
          monthlyTrades[`${sym}_${month}`] = true;
          delete pendingOrders[sym];
        }
      }
      else if (text === '/no' || text.startsWith('/cancelar_')) {
        const sym = text.startsWith('/cancelar_')
          ? text.replace('/cancelar_','').toUpperCase()
          : Object.keys(pendingOrders)[0];
        if (sym && pendingOrders[sym]) { delete pendingOrders[sym]; await sendTelegram(`❌ ${sym} cancelado`); }
      }
      else if (text.startsWith('/cerrar_')) {
        const sym = text.replace('/cerrar_','').toUpperCase();
        const pos = openPositions[sym];
        if (!pos) { await sendTelegram(`⚠️ Sin posición en ${sym}`); continue; }
        const snap = await fetchSnapshot(sym);
        const price = snap?.price || pos.entry;
        await executeSell(sym, pos.qty, 'Manual', price);
      }
      else if (text === '/posiciones') {
        const syms = Object.keys(openPositions);
        if (!syms.length) { await sendTelegram('📊 Sin posiciones abiertas'); continue; }
        let m = `💼 <b>POSICIONES (${syms.length})</b>\n\n`;
        for (const s of syms) {
          const p    = openPositions[s];
          const snap = await fetchSnapshot(s).catch(()=>null);
          const px   = snap?.price || p.entry;
          const pct  = p.system === 'SHORT'
            ? ((p.entry - px)/p.entry*100).toFixed(1)
            : ((px - p.entry)/p.entry*100).toFixed(1);
          const pnl  = Math.round(Math.abs(px - p.entry) * p.qty / EUR_USD);
          const icon = parseFloat(pct)>=0 ? '🟢' : '🔴';
          m += `<b>${s}</b> [${p.system}] ${icon} ${parseFloat(pct)>=0?'+':''}${pct}%\n`;
          m += `$${p.entry}→$${px.toFixed(2)} · Stop $${p.stop} · P&L: ${parseFloat(pct)>=0?'+':''}€${pnl}\n\n`;
        }
        await sendTelegram(m);
      }
      else if (text === '/estado') {
        const reg = MARKET_REGIME;
        const spyChg = await getSPYDailyChange();
        await sendTelegram(
          `⚙️ <b>Estado V3.7.0</b>\n\n` +
          `🏛️ Régimen: <b>${reg.mode}</b>\n` +
          `SPY $${reg.price?.toFixed(2)||'—'} (${spyChg>=0?'+':''}${spyChg.toFixed(2)}% hoy)\n` +
          `SMA50 $${reg.sma50||'—'} | bearStreak: ${reg.bearStreak}\n\n` +
          `💰 Capital: €${CAPITAL_EUR.toLocaleString('es-ES')}\n` +
          `📊 Posiciones: ${Object.keys(openPositions).length}\n` +
          `🤖 AUTO: ${AUTO_EXECUTE}\n\n` +
          `MOM: ${Object.values(openPositions).filter(p=>p.system==='MOM').length}/${MAX_MOM}\n` +
          `BOLL: ${Object.values(openPositions).filter(p=>p.system==='BOLL').length}/${MAX_BOLL}\n` +
          `SHORT: ${Object.values(openPositions).filter(p=>p.system==='SHORT').length}/${MAX_SHORT}\n\n` +
          `✅ D03: SPY ${spyChg<=-1.0?'BLOQUEADO':'activo'}\n` +
          `✅ I10: Stop VPOC activo\n` +
          `✅ N02: Wyckoff Spring activo`
        );
      }
      else if (text === '/trades') {
        const wins = tradeHistory.filter(t=>t.win);
        const gl   = Math.abs(tradeHistory.filter(t=>!t.win).reduce((s,t)=>s+(t.pnlEur||0),0));
        const gw   = wins.reduce((s,t)=>s+(t.pnlEur||0),0);
        const wr   = tradeHistory.length ? Math.round(wins.length/tradeHistory.length*100) : 0;
        const pf   = gl>0 ? (gw/gl).toFixed(2) : '∞';
        await sendTelegram(
          `📈 <b>Historial (${tradeHistory.length} trades)</b>\n\n` +
          `WR: ${wr}% | PF: ${pf}\n` +
          `P&L: €${Math.round(gw-gl)>=0?'+':''}${Math.round(gw-gl)}\n\n` +
          tradeHistory.slice(0,8).map(t=>
            `${t.win?'✅':'❌'} ${t.sym} [${t.system}] €${t.pnlEur>=0?'+':''}${t.pnlEur} (${t.exitReason})`
          ).join('\n')
        );
      }
      else if (text === '/ayuda' || text === '/help') {
        await sendTelegram(
          `🤖 <b>ORS V3.7.0</b>\n\n` +
          `<b>ÓRDENES</b>\n` +
          `/si — Confirmar última orden\n` +
          `/no — Cancelar última orden\n` +
          `/ejecutar_SYM — Ejecutar ticker\n` +
          `/cancelar_SYM — Cancelar ticker\n` +
          `/cerrar_SYM — Cerrar posición\n\n` +
          `<b>INFO</b>\n` +
          `/posiciones — Ver posiciones y P&L\n` +
          `/estado — Estado del servidor\n` +
          `/trades — Historial de trades\n` +
          `/ayuda — Este menú`
        );
      }
      else if (text.startsWith('/capital')) {
        const parts = text.split(' ');
        const newCap = parseFloat(parts[1]);
        if (!newCap || newCap < 1000) {
          await sendTelegram(`💰 Capital actual: €${CAPITAL_EUR.toLocaleString('es-ES')}\nUso: /capital 13480`);
        } else {
          CAPITAL_EUR = newCap;
          await sendTelegram(`✅ Capital → €${CAPITAL_EUR.toLocaleString('es-ES')}`);
        }
      }
    }
  } catch(e) { console.log('[TG POLL]', e.message); }
}

// ═══════════════════════════════════════════════════════
// RUTAS API
// ═══════════════════════════════════════════════════════
app.get('/', (req, res) => res.json({
  status: 'ORS V3.7.0', version: '3.7.0',
  regime: MARKET_REGIME.mode,
  positions: Object.keys(openPositions).length,
  account: getAcc().label,
  uptime: Math.round(process.uptime()) + 's',
  improvements: ['I10: Stop VPOC', 'D03: SPY>-1%', 'N02: Wyckoff Spring'],
}));
app.get('/health', (req, res) => res.json({
  status: 'ok', version: '3.7.0',
  regime: MARKET_REGIME,
  positions: Object.keys(openPositions),
  systems: {
    MOM:   Object.values(openPositions).filter(p=>p.system==='MOM').length  +'/'+MAX_MOM,
    BOLL:  Object.values(openPositions).filter(p=>p.system==='BOLL').length +'/'+MAX_BOLL,
    SHORT: Object.values(openPositions).filter(p=>p.system==='SHORT').length+'/'+MAX_SHORT,
  },
  account: ACTIVE_ACCOUNT,
  autoExecute: AUTO_EXECUTE,
}));
app.get('/regime',        (req, res) => res.json(MARKET_REGIME));
app.get('/market/regime', (req, res) => res.json(MARKET_REGIME));
app.get('/positions', (req, res) => res.json(openPositions));
app.get('/trades', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  // Incluir posiciones abiertas actuales como trades con status='open'
  const openTrades = Object.entries(openPositions).map(([sym, pos]) => ({
    id:           `OPEN_${sym}_${pos.entryDate}`,
    sym:          sym,
    ticker:       sym,
    system:       pos.system || 'MOM',
    module:       pos.system || 'MOM',
    status:       'open',
    entry_date:   pos.edate,
    entry_price:  pos.entry,
    stop:         pos.stop,
    qty:          pos.qty,
    pnl_eur:      null,
    win:          null,
    reason:       null,
    be_active:    pos.be || false,
    runner:       pos.runner || false,
  }));
  // Trades cerrados del historial
  const closedTrades = tradeHistory.slice(0, limit).map(t => ({
    ...t,
    id:          t.id || `${t.sym}_${t.exitDate||t.date}`,
    ticker:      t.sym,
    module:      t.system || 'MOM',
    status:      'closed',
    entry_date:  t.date,
    exit_date:   t.exitDate,
    entry_price: t.entry,
    exit_price:  t.exit,
    pnl_eur:     t.pnlEur || t.pnl || 0,
    win:         t.win,
  }));
  // Devolver array directo (no objeto wrapeado)
  res.json([...openTrades, ...closedTrades]);
});
app.get('/trades/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const closed = tradeHistory.slice(0, limit).map(t => ({
    ...t,
    id:          t.id || `${t.sym}_${t.exitDate}`,
    ticker:      t.sym,
    module:      t.system || 'MOM',
    status:      'closed',
    entry_date:  t.entryDate,
    exit_date:   t.exitDate,
    entry_price: t.entry,
    exit_price:  t.exit,
    pnl_eur:     t.pnlEur || 0,
    win:         t.win,
    reason:      t.exitReason || '',
  }));
  res.json(closed);
});

app.get('/trades/stats/strategy', (req, res) => {
  function stats(trades) {
    const wins  = trades.filter(t=>t.win);
    const loses = trades.filter(t=>!t.win);
    const gw = wins.reduce((s,t)=>s+(t.pnlEur||0),0);
    const gl = Math.abs(loses.reduce((s,t)=>s+(t.pnlEur||0),0));
    return { n:trades.length, wins:wins.length, losses:loses.length,
      wr: trades.length ? parseFloat((wins.length/trades.length*100).toFixed(1)) : 0,
      pf: gl>0 ? parseFloat((gw/gl).toFixed(2)) : 0,
      pnl: Math.round(gw-gl) };
  }
  res.json({
    MOM:   stats(tradeHistory.filter(t=>t.system==='MOM')),
    BOLL:  stats(tradeHistory.filter(t=>t.system==='BOLL')),
    SHORT: stats(tradeHistory.filter(t=>t.system==='SHORT')),
    TOTAL: stats(tradeHistory),
  });
});
app.get('/sector/sentiment', (req, res) => res.json({
  lastUpdate: sectorLastUpdate, sentiment: sectorSentiment,
}));
app.post('/sector/run', async (req, res) => {
  res.json({ ok:true });
  updateSectorSentiment().catch(e => console.log('[SECTOR]', e.message));
});
app.get('/regime/update', async (req, res) => {
  try {
    // Test directo de fetchDailyBars con sip
    const url = `${ALPACA_DATA}/v2/stocks/SPY/bars?timeframe=1Day&limit=5&feed=sip&sort=asc`;
    const r   = await fetch(url, { headers: alpacaHdr() });
    const d   = await r.json();
    if (!d.bars || d.bars.length === 0) {
      return res.json({
        error: 'fetchDailyBars falló',
        status: r.status,
        response: d,
        key_ok: !!alpacaHdr()['APCA-API-KEY-ID'],
        key_prefix: (alpacaHdr()['APCA-API-KEY-ID']||'').slice(0,6),
      });
    }
    await updateRegime();
    res.json({ ok: true, regime: MARKET_REGIME, spy_bars: d.bars.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/sync/history/load', async (req, res) => {
  // GET alias — permite cargar historial desde el navegador sin necesitar POST.
  // Lee órdenes cerradas de Alpaca y las importa al tradeHistory del servidor.
  try {
    const days = parseInt(req.query.days || '30');
    const after = new Date(Date.now() - days*24*3600*1000).toISOString().slice(0,10);
    const r = await fetch(
      `${alpacaBase()}/v2/orders?status=closed&after=${after}&limit=200&direction=desc`,
      { headers: alpacaHdr() }
    );
    const orders = await r.json();
    if (!Array.isArray(orders)) return res.status(500).json({ error:'Error Alpaca', raw:orders });
    const filled = orders.filter(o => o.status === 'filled');
    const bySymbol = {};
    for (const o of filled) {
      const sym = o.symbol;
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push({ side:o.side, qty:parseFloat(o.filled_qty||o.qty),
        price:parseFloat(o.filled_avg_price||0), time:o.filled_at||o.created_at, type:o.type });
    }
    const trades = [];
    for (const [sym, ords] of Object.entries(bySymbol)) {
      const buys   = ords.filter(o=>o.side==='buy').sort((a,b)=>new Date(a.time)-new Date(b.time));
      const sells  = ords.filter(o=>o.side==='sell').sort((a,b)=>new Date(a.time)-new Date(b.time));
      const shorts = ords.filter(o=>o.side==='sell_short').sort((a,b)=>new Date(a.time)-new Date(b.time));
      const covers = ords.filter(o=>o.side==='buy_to_cover').sort((a,b)=>new Date(a.time)-new Date(b.time));
      for (let i=0; i<Math.min(buys.length,sells.length); i++) {
        const buy=buys[i], sell=sells[i];
        if (new Date(sell.time) > new Date(buy.time)) {
          const pnlEur = Math.round((sell.price-buy.price)*buy.qty/EUR_USD);
          const trade = { sym, system:'MOM', entry:buy.price, exit:sell.price, qty:buy.qty,
            pnlEur, win:pnlEur>0, entryDate:buy.time.slice(0,10), exitDate:sell.time.slice(0,10),
            exitReason:sell.type==='stop'?'StopBroker':'Exit', synced:true };
          if (!tradeHistory.some(t=>t.sym===sym&&t.entryDate===trade.entryDate&&t.exitDate===trade.exitDate)) {
            tradeHistory.unshift(trade); trades.push(trade);
          }
        }
      }
      for (let i=0; i<Math.min(shorts.length,covers.length); i++) {
        const sh=shorts[i], cv=covers[i];
        if (new Date(cv.time) > new Date(sh.time)) {
          const pnlEur = Math.round((sh.price-cv.price)*sh.qty/EUR_USD);
          const trade = { sym, system:'SHORT', entry:sh.price, exit:cv.price, qty:sh.qty,
            pnlEur, win:pnlEur>0, entryDate:sh.time.slice(0,10), exitDate:cv.time.slice(0,10),
            exitReason:'StopBroker', synced:true };
          if (!tradeHistory.some(t=>t.sym===sym&&t.entryDate===trade.entryDate&&t.exitDate===trade.exitDate)) {
            tradeHistory.unshift(trade); trades.push(trade);
          }
        }
      }
    }
    tradeHistory.sort((a,b)=>new Date(b.exitDate)-new Date(a.exitDate));
    if (tradeHistory.length>500) tradeHistory=tradeHistory.slice(0,500);
    saveState();
    const wins = trades.filter(t=>t.win);
    const pnl  = trades.reduce((s,t)=>s+t.pnlEur,0);
    res.json({ ok:true, recovered:trades.length, total:tradeHistory.length,
      wr:trades.length?Math.round(wins.length/trades.length*100):0, pnl, trades });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.get('/sync', async (req, res) => {
  try {
    const r = await fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHdr() });
    const alpacaPositions = await r.json();
    res.json({
      alpaca: Array.isArray(alpacaPositions) ? alpacaPositions.map(p => ({
        sym: p.symbol, side: p.side, qty: p.qty,
        entry: p.avg_entry_price, current: p.current_price, pnl: p.unrealized_pl,
      })) : [],
      server: Object.keys(openPositions),
      missing: Array.isArray(alpacaPositions)
        ? alpacaPositions.filter(p => !openPositions[p.symbol]).map(p => p.symbol)
        : [],
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/sync', async (req, res) => {
  try {
    const [posRes, ordRes] = await Promise.all([
      fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHdr() }).then(r=>r.json()),
      fetch(`${alpacaBase()}/v2/orders?status=open&limit=200`, { headers: alpacaHdr() }).then(r=>r.json()).catch(()=>[]),
    ]);
    const positions = posRes;
    if (!Array.isArray(positions))
      return res.status(500).json({ error: 'Error Alpaca', raw: positions });
    const stopBySym = {};
    (Array.isArray(ordRes) ? ordRes : []).forEach(o => {
      if (o.type === 'stop' || o.type === 'stop_limit') stopBySym[o.symbol] = o;
    });
    const synced = [], skipped = [];
    for (const p of positions) {
      const sym = p.symbol;
      if (openPositions[sym]) { skipped.push(sym); continue; }
      const ep   = parseFloat(p.avg_entry_price);
      const qty  = Math.abs(parseInt(p.qty));
      const side = p.side;
      const system = side === 'short' ? 'SHORT' : 'MOM';
      // F9: stop real del broker si existe; fallback ±3% marcado
      const realStop = stopBySym[sym] ? parseFloat(stopBySym[sym].stop_price) : null;
      const stop = realStop !== null ? realStop : (side === 'short'
        ? parseFloat((ep * 1.03).toFixed(2))
        : parseFloat((ep * 0.97).toFixed(2)));
      openPositions[sym] = {
        sym, qty, entry: ep, stop,
        entryDate: new Date().toISOString().slice(0,10),
        maxPrice: ep, minPrice: ep,
        be: false, runner: false, system, ts: Date.now(), synced: true,
      };
      synced.push({ sym, side, qty, entry: ep, stop, system, stopReal: realStop !== null });
    }
    saveState();
    if (synced.length > 0) {
      await sendTelegram(
        `📊 <b>Posiciones sincronizadas</b>\n\n` +
        synced.map(p =>
          `${p.system==='SHORT'?'📉':'📈'} <b>${p.sym}</b> ${p.qty}acc @ $${p.entry.toFixed(2)}\nStop: $${p.stop}`
        ).join('\n\n')
      );
    }
    res.json({ ok:true, synced:synced.length, skipped:skipped.length,
      positions:synced, total_open:Object.keys(openPositions).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/sync/history', (req, res) => {
  const wins = tradeHistory.filter(t=>t.win);
  const gw   = wins.reduce((s,t)=>s+(t.pnlEur||0),0);
  const gl   = Math.abs(tradeHistory.filter(t=>!t.win).reduce((s,t)=>s+(t.pnlEur||0),0));
  res.json({
    total: tradeHistory.length,
    wr: tradeHistory.length ? Math.round(wins.length/tradeHistory.length*100) : 0,
    pf: gl>0 ? parseFloat((gw/gl).toFixed(2)) : 0,
    pnl: Math.round(gw-gl),
    trades: tradeHistory.slice(0,50),
  });
});
app.post('/sync/history', async (req, res) => {
  try {
    const days  = parseInt(req.query.days || '7');
    const after = new Date(Date.now() - days*24*3600*1000).toISOString().slice(0,10);
    const r = await fetch(
      `${alpacaBase()}/v2/orders?status=closed&after=${after}&limit=200&direction=desc`,
      { headers: alpacaHdr() }
    );
    const orders = await r.json();
    if (!Array.isArray(orders))
      return res.status(500).json({ error: 'Error Alpaca orders', raw: orders });
    const filled = orders.filter(o => o.status === 'filled');
    const bySymbol = {};
    for (const o of filled) {
      const sym = o.symbol;
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push({
        side: o.side, qty: parseFloat(o.filled_qty||o.qty),
        price: parseFloat(o.filled_avg_price||0),
        time: o.filled_at||o.created_at, type: o.type,
      });
    }
    const trades = [];
    for (const [sym, ords] of Object.entries(bySymbol)) {
      const buys  = ords.filter(o=>o.side==='buy').sort((a,b)=>new Date(a.time)-new Date(b.time));
      const sells = ords.filter(o=>o.side==='sell').sort((a,b)=>new Date(a.time)-new Date(b.time));
      for (let i=0; i<Math.min(buys.length,sells.length); i++) {
        const buy=buys[i], sell=sells[i];
        if (new Date(sell.time)>new Date(buy.time)) {
          const pnlEur = Math.round((sell.price-buy.price)*buy.qty/EUR_USD);
          const trade  = { sym, system:'MOM', entry:buy.price, exit:sell.price,
            qty:buy.qty, pnlEur, win:pnlEur>0,
            entryDate:buy.time.slice(0,10), exitDate:sell.time.slice(0,10),
            exitReason: sell.type==='stop'?'Stop':'Manual', synced:true };
          const exists = tradeHistory.some(t=>t.sym===sym&&t.entryDate===trade.entryDate&&t.exitDate===trade.exitDate);
          if (!exists) { tradeHistory.unshift(trade); trades.push(trade); }
        }
      }
    }
    tradeHistory.sort((a,b)=>new Date(b.exitDate)-new Date(a.exitDate));
    if (tradeHistory.length>200) tradeHistory=tradeHistory.slice(0,200);
    const wins  = trades.filter(t=>t.win);
    const pnl   = trades.reduce((s,t)=>s+t.pnlEur,0);
    await sendTelegram(
      `📚 <b>Historial sincronizado</b>\n\nTrades recuperados: ${trades.length}\n` +
      `Ganadores: ${wins.length} | Perdedores: ${trades.length-wins.length}\n` +
      `P&L: €${pnl>=0?'+':''}${pnl}\n\n` +
      trades.slice(0,5).map(t=>
        `${t.win?'✅':'❌'} ${t.sym} [${t.system}] €${t.pnlEur>=0?'+':''}${t.pnlEur} (${t.exitReason})`
      ).join('\n')
    );
    res.json({ ok:true, recovered:trades.length, total_history:tradeHistory.length,
      summary:{wins:wins.length,losses:trades.length-wins.length,pnl}, trades });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error:'ANTHROPIC_API_KEY no configurada' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify(req.body),
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.get('/yahoo', async (req, res) => {
  const { sym, range='2y', interval='1d' } = req.query;
  if (!sym) return res.status(400).json({ error:'sym required' });
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,
      { headers:{ 'User-Agent':'Mozilla/5.0' } }
    );
    const text = await r.text();
    if (!text || text.trim().startsWith('<')) return res.json({});
    try { res.json(JSON.parse(text)); } catch(e) { res.json({}); }
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.get('/alpaca/account', async (req, res) => {
  try {
    const r = await fetch(`${alpacaBase()}/v2/account`, { headers:alpacaHdr() });
    const text = await r.text();
    if (!text || text.trim().startsWith('<')) return res.json({});
    try { res.json(JSON.parse(text)); } catch(e) { res.json({}); }
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.get('/alpaca/positions', async (req, res) => {
  try {
    const r = await fetch(`${alpacaBase()}/v2/positions`, { headers:alpacaHdr() });
    const text = await r.text();
    if (!text || text.trim().startsWith('<')) return res.json([]);
    try { res.json(JSON.parse(text)); } catch(e) { res.json([]); }
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.get('/alpaca/bars/daily', async (req, res) => {
  const { sym, limit = 504 } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });
  try {
    const url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Day&limit=${limit}&feed=sip&sort=asc`;
    const r   = await fetch(url, { headers: alpacaHdr() });
    const d   = await r.json();
    if (!d.bars) return res.json({ sym, bars: [], count: 0 });
    const bars = d.bars.map(b => ({
      t: b.t.slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0,
    }));
    res.json({ sym, bars, count: bars.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/alpaca/bars/15min', async (req, res) => {
  const { sym, limit = 200, start } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });
  try {
    const startDate = start || new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10);
    const url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&limit=${limit}&feed=iex&sort=asc&start=${startDate}`;
    const r   = await fetch(url, { headers: alpacaHdr() });
    const text = await r.text();
    if (!text || text === 'Not Found' || text.trim().startsWith('<'))
      return res.json({ sym, bars: [], prices15: [], count: 0 });
    let d;
    try { d = JSON.parse(text); } catch(e) {
      return res.json({ sym, bars: [], prices15: [], count: 0 });
    }
    if (!d.bars) return res.json({ sym, bars: [], prices15: [], count: 0 });
    const bars = d.bars.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }));
    res.json({ sym, bars, prices15: bars.map(b=>b.c), count: bars.length });
  } catch(e) { res.json({ sym, bars: [], prices15: [], count: 0 }); }
});
app.get('/alpaca/snapshots', async (req, res) => {
  const { syms } = req.query;
  if (!syms) return res.json({});
  try {
    const r = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${syms}&feed=iex`, { headers:alpacaHdr() });
    const text = await r.text();
    if (!text || text.trim().startsWith('<')) return res.json({});
    res.json(JSON.parse(text));
  } catch(e) { res.json({}); }
});

// ═══════════════════════════════════════════════════════
// ENDPOINTS ADICIONALES — v3.5.1
// ═══════════════════════════════════════════════════════

// ── WATCHLIST DINÁMICA ───────────────────────────────────
app.get('/watchlist/dynamic', (req, res) => {
  res.json({ dynamic: dynWatchlist });
});
app.post('/watchlist/dynamic', (req, res) => {
  const { sym } = req.body;
  if (!sym) return res.status(400).json({ error: 'sym required' });
  if (!dynWatchlist.find(x => x.sym === sym))
    dynWatchlist.push({ sym: sym.toUpperCase(), ts: Date.now() });
  res.json({ ok: true, dynamic: dynWatchlist });
});
app.delete('/watchlist/dynamic/:sym', (req, res) => {
  dynWatchlist = dynWatchlist.filter(x => x.sym !== req.params.sym.toUpperCase());
  res.json({ ok: true, dynamic: dynWatchlist });
});

// ── LAB — HIPÓTESIS ─────────────────────────────────────
app.get('/lab/hypotheses', (req, res) => res.json(labHypotheses));
app.post('/lab/hypotheses', (req, res) => {
  const h = req.body;
  if (!h || !h.hypothesis) return res.status(400).json({ error: 'hypothesis required' });
  const entry = { id: Date.now().toString(), hypothesis: h.hypothesis,
    category: h.category || 'general', status: h.status || 'pending',
    created: new Date().toISOString(), notes: h.notes || '' };
  labHypotheses.unshift(entry);
  res.json({ ok: true, id: entry.id, entry });
});
app.put('/lab/hypotheses/:id', (req, res) => {
  const idx = labHypotheses.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  labHypotheses[idx] = Object.assign(labHypotheses[idx], req.body, { id: req.params.id });
  res.json({ ok: true, entry: labHypotheses[idx] });
});
app.delete('/lab/hypotheses/:id', (req, res) => {
  labHypotheses = labHypotheses.filter(h => h.id !== req.params.id);
  res.json({ ok: true });
});

// ── LAB — REVIEWS ───────────────────────────────────────
app.get('/lab/reviews', (req, res) => res.json(labReviews));
app.post('/lab/reviews', (req, res) => {
  const r = req.body;
  const entry = { id: Date.now().toString(), title: r.title || 'Review',
    content: r.content || '', created: new Date().toISOString(),
    decisions: r.decisions || '' };
  labReviews.unshift(entry);
  res.json({ ok: true, id: entry.id, entry });
});

// ── TRADES — STATS DB ────────────────────────────────────
app.get('/trades/stats/db', (req, res) => {
  const days  = parseInt(req.query.days) || 30;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = tradeHistory.filter(t => new Date(t.exitDate || t.date).getTime() >= since);
  const wins   = recent.filter(t => t.pnl > 0);
  const losses = recent.filter(t => t.pnl <= 0);
  const grossW = wins.reduce((s,t) => s+t.pnl, 0);
  const grossL = Math.abs(losses.reduce((s,t) => s+t.pnl, 0));
  res.json({
    days, n: recent.length, wins: wins.length, losses: losses.length,
    wr:    recent.length ? (wins.length/recent.length*100).toFixed(1) : 0,
    pf:    grossL > 0 ? (grossW/grossL).toFixed(2) : null,
    pnl:   recent.reduce((s,t) => s+t.pnl, 0).toFixed(2),
    grossW: grossW.toFixed(2), grossL: grossL.toFixed(2),
  });
});

// ── TRADES — DECISIONS ───────────────────────────────────
app.get('/trades/decisions', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(tradeHistory.slice(0, limit).map(t => ({ ...t, decisions: t.reason || '' })));
});

// ── NOTICIAS ─────────────────────────────────────────────
app.get('/alpaca/news', async (req, res) => {
  try {
    const { syms, limit = 10 } = req.query;
    if (!syms) return res.json([]);
    const r = await fetch(`${ALPACA_DATA}/v1beta1/news?symbols=${syms}&limit=${limit}`, { headers: alpacaHdr() });
    const d = await r.json();
    res.json(d.news || d || []);
  } catch(e) { res.json([]); }
});
app.get('/news/headlines', async (req, res) => {
  try {
    const { syms } = req.query;
    if (!syms) return res.json([]);
    const r = await fetch(`${ALPACA_DATA}/v1beta1/news?symbols=${syms}&limit=20`, { headers: alpacaHdr() });
    const d = await r.json();
    res.json(d.news || d || []);
  } catch(e) { res.json([]); }
});

// ── SCANNER MOM ──────────────────────────────────────────
app.get('/scan/mom', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json(UNIVERSE.slice(0, limit).filter(sym => !openPositions[sym])
    .map(sym => ({ sym, inUniverse: true, open: false })));
});

// ── ALPACA — CUENTA ACTIVA / SWITCH ──────────────────────
app.get('/alpaca/active', (req, res) => res.json({
  account: ACTIVE_ACCOUNT, label: getAcc().label,
  base: alpacaBase(), isLive: isLive(),
}));
app.post('/alpaca/switch', (req, res) => {
  const { account } = req.body;
  if (!account || !ALPACA_ACCOUNTS[account])
    return res.status(400).json({ error: 'Invalid account. Use: paper2 or live' });
  ACTIVE_ACCOUNT = account;
  console.log(`[ACCOUNT] Cambiado a: ${getAcc().label}`);
  res.json({ ok: true, account: ACTIVE_ACCOUNT, label: getAcc().label });
});

// ── ALPACA — ÓRDENES MANUALES ────────────────────────────
app.post('/alpaca/order', async (req, res) => {
  try {
    const { sym, qty, side, type = 'market', tif = 'day' } = req.body;
    if (!sym || !qty || !side) return res.status(400).json({ error: 'sym, qty, side required' });
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method: 'POST', headers: alpacaHdr(),
      body: JSON.stringify({ symbol: sym, qty: String(qty), side, type, time_in_force: tif }),
    });
    const d = await r.json();
    if (d.id) {
      console.log(`[ORDER] ${side} ${qty} ${sym} → ${d.id}`);
      await sendTelegram(`📋 <b>Orden manual</b>\n${side.toUpperCase()} ${qty} ${sym}\nID: ${d.id}`);
    }
    res.json(d);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TELEGRAM — enviar mensaje manual ────────────────────
app.post('/telegram', async (req, res) => {
  try {
    const msg = req.body.text || req.body.message || '';
    if (!msg) return res.status(400).json({ error: 'text required' });
    await sendTelegram(msg);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── IBKR — stubs ─────────────────────────────────────────
app.get('/ibkr/status',    (req, res) => res.json({ connected: false, message: 'IBKR no conectado en V3' }));
app.get('/ibkr/positions', (req, res) => res.json([]));

// ═══════════════════════════════════════════════════════
// ANÁLISIS IA — Capitol Trades + Noticias + Claude
// v3.6.0: endpoint unificado /analisis-ticker/:sym
// Combina señal CT (Quiver Quantitative) + noticias
// (Alpaca News) + análisis Claude en una sola llamada.
// Variables de entorno opcionales:
//   QUIVER_API_KEY — Quiver Quantitative (gratuita)
// Sin keys: el análisis Claude funciona igual pero sin CT
// ═══════════════════════════════════════════════════════

async function fetchCapitolTradesQuiver(ticker) {
  const key = process.env.QUIVER_API_KEY || '';
  if (!key) return { signal: 'NO_KEY', summary: 'QUIVER_API_KEY no configurada', trades: [] };
  try {
    const r = await fetch(
      `https://api.quiverquant.com/beta/historical/congresstrading/${ticker}`,
      { headers: { 'Accept': 'application/json', 'Authorization': `Token ${key}` } }
    );
    if (!r.ok) return { signal: 'NO_DATA', summary: `Quiver HTTP ${r.status}`, trades: [] };
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0)
      return { signal: 'NEUTRAL', summary: 'Sin trades de congresistas registrados', trades: [] };

    // Solo últimos 90 días con fecha de REPORTE (no transacción)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const recent = data.filter(t => {
      const d = new Date(t.ReportDate || t.Date || '');
      return d >= cutoff;
    });
    if (recent.length === 0)
      return { signal: 'NEUTRAL', summary: 'Sin trades reportados en últimos 90 días', trades: [] };

    let compras = 0, ventas = 0;
    const compradores = new Set(), vendedores = new Set();
    const detalles = [];
    recent.forEach(t => {
      const tipo = (t.Transaction || '').toLowerCase();
      const amt  = parseFloat(t.Amount || '15000') || 15000;
      const pol  = t.Representative || t.Senator || 'Desconocido';
      const fecha = (t.ReportDate || t.Date || '').slice(0, 10);
      if (tipo.includes('purchase') || tipo.includes('buy')) {
        compras += amt; compradores.add(pol);
        detalles.push(`COMPRA: ${pol} ~$${amt.toLocaleString()} (reportado ${fecha})`);
      } else if (tipo.includes('sale') || tipo.includes('sell')) {
        ventas += amt; vendedores.add(pol);
        detalles.push(`VENTA: ${pol} ~$${amt.toLocaleString()} (reportado ${fecha})`);
      }
    });

    const neto = compras - ventas;
    let signal, summary;
    if      (neto > 50000 && compradores.size >= 2) { signal = 'BULLISH';      summary = `${compradores.size} congresistas compraron neto $${neto.toLocaleString()} (90d)`; }
    else if (neto > 20000 && compradores.size >= 1) { signal = 'BULLISH_WEAK'; summary = `${compradores.size} congresista(s) compraron neto $${neto.toLocaleString()} (90d)`; }
    else if (neto < -50000 && vendedores.size >= 2) { signal = 'BEARISH';      summary = `${vendedores.size} congresistas vendieron neto $${Math.abs(neto).toLocaleString()} (90d)`; }
    else                                             { signal = 'NEUTRAL';      summary = `Actividad mixta: +$${compras.toLocaleString()} / -$${ventas.toLocaleString()}`; }

    return { signal, summary, trades: detalles.slice(0, 5), n_comp: compradores.size, n_vend: vendedores.size };
  } catch(e) {
    return { signal: 'ERROR', summary: `Error CT: ${e.message}`, trades: [] };
  }
}

async function fetchNoticiasAlpaca(ticker) {
  try {
    const r = await fetch(
      `${ALPACA_DATA}/v1beta1/news?symbols=${ticker}&limit=5&sort=desc`,
      { headers: alpacaHdr() }
    );
    const d = await r.json();
    const news = (d.news || d || []).slice(0, 5);
    if (!news.length) return { headlines: [], summary: 'Sin noticias recientes en Alpaca' };
    const headlines = news.map(n => ({
      title:   n.headline || n.title || '',
      summary: (n.summary || '').slice(0, 120),
      date:    (n.created_at || n.updated_at || '').slice(0, 10),
      source:  n.source || '',
    }));
    return { headlines, summary: `${headlines.length} noticias recientes` };
  } catch(e) {
    return { headlines: [], summary: `Error noticias: ${e.message}` };
  }
}

// GET /analisis-ticker/:sym?momentum=481&precio=124&sector=Tech&regimen=BULL
app.get('/analisis-ticker/:sym', async (req, res) => {
  const sym = (req.params.sym || '').toUpperCase();
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const { momentum, precio, sector, regimen, empresa } = req.query;

  try {
    // Paralelizar CT + noticias
    const [ct, noticias] = await Promise.all([
      fetchCapitolTradesQuiver(sym),
      fetchNoticiasAlpaca(sym),
    ]);

    // Construir prompt para Claude
    const ctSection = ct.signal !== 'NO_KEY'
      ? `\nCAPITOL TRADES (últimos 90 días — fecha de reporte, sin look-ahead):\n  Señal: ${ct.signal}\n  ${ct.summary}\n${ct.trades.map(t=>'  '+t).join('\n')}`
      : '\nCAPITOL TRADES: No disponible (configurar QUIVER_API_KEY)';

    const newsSection = noticias.headlines.length
      ? `\nNOTICIAS RECIENTES (Alpaca News):\n${noticias.headlines.map(h=>`  • [${h.date}] ${h.title} (${h.source})`).join('\n')}`
      : '\nNOTICIAS: Sin noticias recientes';

    const prompt = `Eres un analista cuantitativo experto en momentum investing (estrategia Jegadeesh-Titman 12-1).

TICKER: ${sym}${empresa ? ` (${empresa})` : ''}
MOMENTUM 12-1: ${momentum || 'N/A'}%
PRECIO: $${precio || 'N/A'}
SECTOR: ${sector || 'N/A'}
RÉGIMEN MERCADO: ${regimen || 'BULL'}
${ctSection}
${newsSection}

TAREA: Analiza si ${sym} es candidato sólido para el módulo de momentum mensual.
El sistema selecciona los 10 tickers con mejor momentum 12-1 y los mantiene 1 mes.

Evalúa brevemente:
1. 📈 MOMENTUM: ¿Sostenible o pico especulativo?
2. 🏛️ CAPITOL TRADES: ¿Confirma o contradice la tesis?
3. 📰 NOTICIAS: ¿Catalizadores reales o ruido?
4. ⚠️ RIESGOS: Top 2 riesgos para los próximos 30 días
5. ✅ VEREDICTO: COMPRAR / VIGILAR / EVITAR (una palabra) + razón en una línea

Responde en español. Máximo 180 palabras. Sé directo y concreto.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const claudeData = await claudeRes.json();
    const analisis = claudeData.content?.[0]?.text || 'Sin respuesta de Claude';

    res.json({
      sym,
      momentum:       momentum || null,
      precio:         precio   || null,
      sector:         sector   || null,
      capitol_trades: ct,
      noticias:       noticias.headlines,
      analisis_ia:    analisis,
      timestamp:      new Date().toISOString(),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DEBUG — verificar variables de entorno ───────────────
app.get('/debug/env', (req, res) => {
  const acc = getAcc();
  res.json({
    version: '3.7.0',
    active_account: ACTIVE_ACCOUNT,
    key_defined:    !!acc.key,
    key_prefix:     (acc.key||'').slice(0,6),
    secret_defined: !!acc.secret,
    base:           acc.base,
    env_keys: {
      ALPACA_KEY_2:      !!(process.env.ALPACA_KEY_2),
      ALPACA_SECRET_2:   !!(process.env.ALPACA_SECRET_2),
      ALPACA_BASE_2:     process.env.ALPACA_BASE_2 || 'NOT SET',
      ALPACA_PAPER_KEY:  !!(process.env.ALPACA_PAPER_KEY),
      ALPACA_PAPER_SECRET: !!(process.env.ALPACA_PAPER_SECRET),
      ALPACA_PAPER_URL:  process.env.ALPACA_PAPER_URL || 'NOT SET',
      ALPACA_KEY_ID:     !!(process.env.ALPACA_KEY_ID),
      ALPACA_SECRETS:    !!(process.env.ALPACA_SECRETS),
    }
  });
});

// ═══════════════════════════════════════════════════════
// ARRANQUE
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// ANÁLISIS MACRO — Alerta temprana con IA v3.6.0
// ═══════════════════════════════════════════════════════
let MACRO_CACHE = { ts:0, data:null, prob:0, regime:"BULL", last_tg:0 };
const MACRO_TTL = { BULL:7*24*3600000, VIGILANCIA:24*3600000, ALERTA:6*3600000 };

async function fetchMacroIndicators() {
  const ind = {};
  try {
    const r = await fetch(`${ALPACA_DATA}/v2/stocks/SPY/bars?timeframe=1Day&limit=220&feed=iex&sort=asc`,{headers:alpacaHdr()});
    const d = await r.json();
    const bars=(d.bars||[]).map(b=>b.c);
    if(bars.length>=200){
      const last=bars[bars.length-1];
      const sma50=bars.slice(-50).reduce((a,b)=>a+b,0)/50;
      const sma200=bars.slice(-200).reduce((a,b)=>a+b,0)/200;
      const max52=Math.max(...bars.slice(-252));
      ind.spy={price:last.toFixed(2),sma50:sma50.toFixed(2),sma200:sma200.toFixed(2),
        above_sma50:last>sma50,above_sma200:last>sma200,
        drawdown_52w:((last-max52)/max52*100).toFixed(1),
        mom_20d:((last-bars[bars.length-21])/bars[bars.length-21]*100).toFixed(1),
        regime:last>sma200?(last>sma50?"BULL":"LATERAL"):"BEAR"};
    }
  }catch(e){ind.spy_error=e.message;}
  try{
    const r=await fetch(`${ALPACA_DATA}/v2/stocks/VIXY/bars?timeframe=1Day&limit=20&feed=iex&sort=asc`,{headers:alpacaHdr()});
    const d=await r.json();const bars=d.bars||[];
    if(bars.length>=5){const last=bars[bars.length-1].c;const prev=bars[bars.length-6]?.c||last;
      ind.vix={level:last.toFixed(2),chg_5d:((last-prev)/prev*100).toFixed(1),elevated:last>20,spike:((last-prev)/prev*100)>20};}
  }catch(e){}
  try{
    const [r1,r2]=await Promise.all([
      fetch(`${ALPACA_DATA}/v2/stocks/TLT/bars?timeframe=1Day&limit=5&feed=iex&sort=asc`,{headers:alpacaHdr()}),
      fetch(`${ALPACA_DATA}/v2/stocks/SHY/bars?timeframe=1Day&limit=5&feed=iex&sort=asc`,{headers:alpacaHdr()}),
    ]);
    const [d1,d2]=await Promise.all([r1.json(),r2.json()]);
    const tlt=(d1.bars||[]).slice(-1)[0]?.c;const shy=(d2.bars||[]).slice(-1)[0]?.c;
    if(tlt&&shy)ind.yield_curve={tlt_shy_ratio:(tlt/shy).toFixed(3),inverted:(tlt/shy)<1.1};
  }catch(e){}
  const secs={QQQ:"Tech/Growth",XLV:"Health",XLE:"Energy",XLF:"Finance",XLU:"Utilities",GLD:"Gold"};
  ind.sectores={};
  await Promise.all(Object.entries(secs).map(async([sym,label])=>{
    try{
      const r=await fetch(`${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Day&limit=25&feed=iex&sort=asc`,{headers:alpacaHdr()});
      const d=await r.json();const bars=(d.bars||[]).map(b=>b.c);
      if(bars.length>=20){const last=bars[bars.length-1];
        ind.sectores[sym]={label,price:last.toFixed(2),mom_20d:((last-bars[0])/bars[0]*100).toFixed(1),mom_5d:((last-bars[bars.length-6])/bars[bars.length-6]*100).toFixed(1)};}
    }catch(e){}
  }));
  try{
    const r=await fetch(`${ALPACA_DATA}/v1beta1/news?symbols=SPY,QQQ,TLT&limit=6&sort=desc`,{headers:alpacaHdr()});
    const d=await r.json();
    ind.noticias=(d.news||d||[]).slice(0,5).map(n=>({title:n.headline||n.title||"",date:(n.created_at||"").slice(0,10)}));
  }catch(e){ind.noticias=[];}
  ind.timestamp=new Date().toISOString();
  return ind;
}

async function analyzeWithClaude_macro(ind){
  const apiKey=process.env.ANTHROPIC_API_KEY;if(!apiKey)return null;
  const spy=ind.spy||{};const vix=ind.vix||{};const yc=ind.yield_curve||{};
  const secs=ind.sectores||{};const news=ind.noticias||[];
  const secStr=Object.entries(secs).map(([s,d])=>`${s}:20d=${d.mom_20d}% 5d=${d.mom_5d}%`).join(" | ");
  const newsStr=news.slice(0,4).map(n=>`• ${n.title} [${n.date}]`).join("\n");
  const prompt=`Eres analista macro cuantitativo experto en crashes de mercado.\n\nINDICADORES ACTUALES:\nSPY $${spy.price} | SMA50 $${spy.sma50} | SMA200 $${spy.sma200} | Régimen: ${spy.regime} | DD52w: ${spy.drawdown_52w}% | Mom20d: ${spy.mom_20d}%\nVIX proxy (VIXY): $${vix.level} | Cambio 5d: ${vix.chg_5d}%\nYield curve TLT/SHY: ${yc.tlt_shy_ratio} | Invertida: ${yc.inverted}\nSectores 20d: ${secStr}\nNoticias: ${newsStr}\n\nResponde SOLO JSON:\n{"regime":"BULL|LATERAL|BEAR|ALERTA|PRE-CRASH","prob_crash_30d":0-100,"crash_type_potencial":"A_REPRICING|B_LIQUIDEZ|C_POLITICO|NINGUNO","señales_positivas":["max 3"],"señales_negativas":["max 3"],"indicadores_clave":{"spy_regime":"BULL/LATERAL/BEAR","vix_status":"NORMAL/ELEVADO/SPIKE","yield_curve":"NORMAL/PLANA/INVERTIDA","rotacion_sectorial":"RISK-ON/NEUTRAL/RISK-OFF","momentum_macro":"POSITIVO/NEUTRO/NEGATIVO"},"comparativa_historica":"C1_2022|C3_2024|C4_2025|SIN_PARALELISMO","resumen":"2-3 frases en español","recomendacion_jt":"OPERAR_NORMAL|MODO_ALERTA|REDUCIR_EXPOSICION|SALIR_CASH","proxima_revision":"SEMANAL|DIARIA|6H"}`;
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01"},
    body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:800,messages:[{role:"user",content:prompt}]})});
  const data=await r.json();const text=data.content?.[0]?.text||"{}";
  try{return JSON.parse(text.replace(/```json|```/g,"").trim());}
  catch(e){return{regime:"UNKNOWN",prob_crash_30d:0,resumen:"Error parsing IA"};}
}

async function runMacroAnalysis(){
  try{
    const ind=await fetchMacroIndicators();
    const analysis=await analyzeWithClaude_macro(ind);
    if(!analysis)return null;
    const result={...analysis,indicators:ind,cached:false,updated_at:new Date().toISOString()};
    const prob=analysis.prob_crash_30d||0;
    const regime=prob>=70?"ALERTA":prob>=40?"VIGILANCIA":"BULL";
    MACRO_CACHE={ts:Date.now(),data:result,prob,regime,last_tg:MACRO_CACHE.last_tg};
    if(prob>=70&&(Date.now()-MACRO_CACHE.last_tg)>6*3600000){
      MACRO_CACHE.last_tg=Date.now();
      await sendTelegram(`${prob>=85?"🚨":"⚠️"} <b>ALERTA MACRO — ${analysis.regime}</b>\n\n📊 Prob crash 30d: <b>${prob}%</b>\n📝 ${analysis.resumen||""}\n⚡ JT: <b>${analysis.recomendacion_jt||""}</b>`);
    }
    return result;
  }catch(e){console.error("[MACRO]",e.message);return null;}
}

function scheduleMacro(){
  const prob=MACRO_CACHE.prob||0;
  const ttl=prob>=70?MACRO_TTL.ALERTA:prob>=40?MACRO_TTL.VIGILANCIA:MACRO_TTL.BULL;
  setTimeout(async()=>{ await runMacroAnalysis(); scheduleMacro(); },ttl);
}

app.get('/universe', (req, res) => {
  res.json({
    total:       UNIVERSE.length,
    base:        UNIVERSE_BASE.length,
    last_update: UNIVERSE_LAST_UPDATE ? new Date(UNIVERSE_LAST_UPDATE).toISOString() : 'nunca',
    sample:      UNIVERSE.slice(0, 20),
  });
});

app.post('/universe/refresh', async (req, res) => {
  res.json({ status: 'refreshing', current: UNIVERSE.length });
  expandUniverse().catch(e => console.error('[UNIVERSE]', e.message));
});

app.get("/analisis-macro",async(req,res)=>{
  const force=req.query.force==="true";
  const now=Date.now();
  const ttl=MACRO_TTL[MACRO_CACHE.regime]||MACRO_TTL.BULL;
  if(!force&&MACRO_CACHE.data&&(now-MACRO_CACHE.ts)<ttl)
    return res.json({...MACRO_CACHE.data,cached:true,cache_age_min:Math.round((now-MACRO_CACHE.ts)/60000)});
  const result=await runMacroAnalysis();
  if(!result)return res.status(500).json({error:"Error análisis macro"});
  res.json({...result,modo_revision:(result.prob_crash_30d||0)>=70?"6H":(result.prob_crash_30d||0)>=40?"DIARIA":"SEMANAL"});
});

app.post("/analisis-macro/scan",async(req,res)=>{
  MACRO_CACHE.ts=0;
  const result=await runMacroAnalysis();
  if(!result)return res.status(500).json({error:"Error análisis macro"});
  res.json(result);
});


app.listen(PORT, async () => {
  console.log(`ORS V3.7.0 — puerto ${PORT}`);
  console.log(`Cuenta: ${getAcc().label} | AUTO: ${AUTO_EXECUTE}`);
  console.log(`Mejoras activas: I10(VPOC) + D03(SPY>-1%) + N02(Spring) + /analisis-ticker (CT+News+IA)`);
  await sendTelegram(
    `🚀 <b>ORS V3.7.0 arrancado</b>\n\n` +
    `BULL:    MOM (5) + BOLL (1)\n` +
    `LATERAL: MOM 75% (5)\n` +
    `BEAR:    SHORT v3 (3)\n\n` +
    `<b>Nuevo v3.7.0:</b>\n` +
    `✅ /analisis-ticker — CT + Noticias + IA\n` +
    `✅ I10: Stop bajo VPOC\n` +
    `✅ D03: Bloquear si SPY<-1%\n` +
    `✅ N02: Wyckoff Spring\n\n` +
    `Cuenta: ${getAcc().label}\n` +
    `Capital: €${CAPITAL_EUR.toLocaleString('es-ES')}\n` +
    `Auto: ${AUTO_EXECUTE}`
  );
  setTimeout(async () => {
    console.log('[BOOT] Iniciando updateRegime...');
    try {
      // Test rápido de Alpaca antes de updateRegime
      const testR = await fetch(
        `${ALPACA_DATA}/v2/stocks/SPY/bars?timeframe=1Day&limit=3&feed=sip&sort=asc`,
        { headers: alpacaHdr() }
      );
      const testD = await testR.json();
      console.log(`[BOOT] Alpaca test: status=${testR.status} bars=${testD.bars?.length||0}`);
      if (testD.bars && testD.bars.length > 0) {
        await updateRegime();
        console.log(`[BOOT] Régimen OK: ${MARKET_REGIME.mode} SMA50=${MARKET_REGIME.sma50}`);
      } else {
        console.log('[BOOT] Alpaca no devuelve barras — régimen pendiente');
        console.log('[BOOT] Response:', JSON.stringify(testD).slice(0,200));
      }
    } catch(e) { console.error('[BOOT] Error updateRegime:', e.message); }
  }, 3000);
  loadState(); // F8: restaurar estado antes del sync
  setTimeout(async () => {
    try {
      const [posRes, ordRes] = await Promise.all([
        fetch(`${alpacaBase()}/v2/positions`, { headers:alpacaHdr() }).then(r=>r.json()),
        fetch(`${alpacaBase()}/v2/orders?status=open&limit=200`, { headers:alpacaHdr() }).then(r=>r.json()).catch(()=>[]),
      ]);
      const positions = posRes;
      const stopBySym = {};
      (Array.isArray(ordRes) ? ordRes : []).forEach(o => {
        if (o.type === 'stop' || o.type === 'stop_limit') stopBySym[o.symbol] = o;
      });
      if (Array.isArray(positions) && positions.length) {
        const synced = [];
        positions.forEach(p => {
          if (!openPositions[p.symbol]) {
            const ep   = parseFloat(p.avg_entry_price);
            const side = p.side;
            const system = side === 'short' ? 'SHORT' : 'MOM';
            // F9: usar el stop GTC REAL que sigue vivo en el broker.
            // Solo si no existe, fallback ±3% con aviso explícito.
            const realStop = stopBySym[p.symbol]
              ? parseFloat(stopBySym[p.symbol].stop_price) : null;
            const stop = realStop !== null ? realStop : (side === 'short'
              ? parseFloat((ep*1.03).toFixed(2))
              : parseFloat((ep*0.97).toFixed(2)));
            openPositions[p.symbol] = {
              sym:p.symbol, qty:Math.abs(parseInt(p.qty)), entry:ep, stop,
              entryDate: new Date().toISOString().slice(0,10),
              maxPrice:ep, minPrice:ep, be:false, runner:false,
              system, ts:Date.now(), synced:true,
            };
            synced.push(p.symbol + (realStop !== null ? '' : '(stop inventado ±3% ⚠️)'));
          }
        });
        if (synced.length) {
          console.log(`[SYNC] ${synced.length} posiciones: ${synced.join(', ')}`);
          await sendTelegram(`📊 <b>Posiciones al arrancar:</b> ${synced.join(', ')}`);
        }
        saveState();
      }
    } catch(e) { console.log('[SYNC]', e.message); }
  }, 5000);
  setInterval(() => withLock('scan',   checkMOMSignals),    5*60*1000);
  setInterval(() => withLock('scan',   checkShortSignals),  5*60*1000);
  setInterval(() => withLock('manage', managePositions),    3*60*1000);
  setInterval(() => withLock('recon',  reconcilePositions), 5*60*1000); // F6
  setInterval(saveState,          5*60*1000); // F8
  setInterval(pollTelegram,      3*1000);
  setInterval(updateRegime,      60*60*1000);
  setTimeout(()=>{ runMacroAnalysis().then(()=>scheduleMacro()); }, 20000);
  // Expandir universo al arrancar y programar actualización diaria
  expandUniverse().catch(e => console.log('[UNIVERSE] Error:', e.message));
  scheduleUniverseUpdate();

  // Calcular régimen inmediatamente al arrancar (no esperar 1 hora)
  updateRegime().then(() => {
    console.log('[BOOT] Régimen calculado:', MARKET_REGIME.mode, 'SMA50:', MARKET_REGIME.sma50);
  }).catch(e => console.error('[BOOT] Error régimen:', e.message));

  // Recuperar posiciones de Alpaca al arrancar
  setTimeout(async () => {
    try {
      const r = await fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHdr() });
      const positions = await r.json();
      if (!Array.isArray(positions)) return;
      let recovered = 0;
      for (const p of positions) {
        const sym  = p.symbol;
        const qty  = Math.abs(parseInt(p.qty));
        const side = p.side; // 'long' o 'short'
        if (openPositions[sym]) continue; // ya conocida
        const entry = parseFloat(p.avg_entry_price);
        const isShort = side === 'short';
        // Buscar stop activo en Alpaca
        let stop = isShort ? entry * 1.05 : entry * 0.95;
        try {
          const ro = await fetch(`${alpacaBase()}/v2/orders?status=open&symbols=${sym}&limit=10`, { headers: alpacaHdr() });
          const orders = await ro.json();
          const stopOrder = (orders || []).find(o => o.type === 'stop' || o.order_type === 'stop');
          if (stopOrder) stop = parseFloat(stopOrder.stop_price);
        } catch(e) {}
        const currentPx = parseFloat(p.current_price || entry);
        const gainPct   = entry > 0 ? (currentPx - entry) / entry * 100 : 0;
        const beThr     = entry > 300 ? 1.5 : entry > 100 ? 2.0 : 3.0;

        // Usar el stop del broker si es mejor que el calculado
        // (el usuario puede haber subido el stop manualmente)
        const brokerStop = stop;
        const calcStop   = isShort
          ? parseFloat((entry * 0.999).toFixed(2))   // BE short
          : parseFloat((entry * 1.001).toFixed(2));   // BE long
        
        // Si el stop del broker ya está por encima del entry (long) → ya está en BE
        const beFromBroker = !isShort
          ? brokerStop > entry   // stop por encima de entrada = BE
          : brokerStop < entry;  // stop por debajo de entrada = BE short

        const beActive = gainPct >= beThr || beFromBroker;

        // Usar el stop del broker tal cual — no recalcular
        // Así respetamos stops manuales que el usuario haya puesto
        openPositions[sym] = {
          sym, qty,
          entry,
          stop:      brokerStop,  // respetar stop actual del broker
          entryDate: new Date().toISOString().slice(0,10),
          maxPrice:  isShort ? Math.min(entry, currentPx) : Math.max(entry, currentPx),
          minPrice:  Math.min(entry, currentPx),
          be:        beActive,
          runner:    false,
          system:    isShort ? 'SHORT' : 'MOM',
          ts:        Date.now(),
          synced:    true,
        };
        recovered++;
        console.log(`[BOOT] Posición recuperada: ${sym} ${side} ${qty} @ $${entry} stop $${stop}`);
      }
      if (recovered > 0) {
        console.log(`[BOOT] ${recovered} posiciones recuperadas de Alpaca`);
        await sendTelegram(`🔄 <b>Servidor reiniciado</b>\n${recovered} posición(es) recuperada(s) de Alpaca:\n${Object.keys(openPositions).join(', ')}`);
      }
    } catch(e) { console.error('[BOOT] Error recuperando posiciones:', e.message); }
  }, 5000);
  setTimeout(() => withLock('scan',  checkMOMSignals),     30*1000);
  setTimeout(() => withLock('scan',  checkShortSignals),   35*1000);
  setTimeout(() => withLock('recon', reconcilePositions),  20*1000);
  function scheduleSector() {
    const now    = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),20,15,0));
    if (now>=target) target.setUTCDate(target.getUTCDate()+1);
    setTimeout(async()=>{ await updateSectorSentiment(); scheduleSector(); }, target-now);
  }
  scheduleSector();
  function scheduleRegime() {
    const now    = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),20,5,0));
    if (now>=target) target.setUTCDate(target.getUTCDate()+1);
    setTimeout(async()=>{ await updateRegime(); scheduleRegime(); }, target-now);
  }
  scheduleRegime();
});
