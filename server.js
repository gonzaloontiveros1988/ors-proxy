// server.js — v3.4.0
// ORS Proxy — Sistema MOM V3
// ===========================
// BULL:    MOM V1 (5 slots) + Bollinger (1 slot)
// LATERAL: MOM V1 75% sizing (5 slots)
// BEAR:    SHORT v3 filtros A+D (3 slots)
//
// v3.1.0: /sync + /sync/history endpoints
// v3.4.0: COMB_FINAL — I10 (Stop VPOC) + D03 (SPY>-1%) + N02 (Wyckoff Spring)
//         Backtest OOS confirmado: PF 3.59 MAR 10.58 DD 6.08%
'use strict';
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
    key:    process.env.ALPACA_KEY_2    || process.env.ALPACA_KEY    || '',
    secret: process.env.ALPACA_SECRET_2 || process.env.ALPACA_SECRET || '',
    base:   process.env.ALPACA_BASE     || 'https://paper-api.alpaca.markets',
    label:  '📊 PAPER €11k',
  },
  live: {
    key:    process.env.ALPACA_LIVE_KEY    || '',
    secret: process.env.ALPACA_LIVE_SECRET || '',
    base:   'https://api.alpaca.markets',
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
const UNIVERSE = [
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
  'HUT','TKO','BE','AMG','EL','HUM','SMCI',
];
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
    const url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Day&limit=${limit}&feed=iex&sort=asc`;
    const r   = await fetch(url, { headers: alpacaHdr() });
    const d   = await r.json();
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
  const price = bar.c, low = bar.l || price;
  if (price > (pos.maxPrice || pos.entry)) pos.maxPrice = price;
  const gainPct = (price - pos.entry) / pos.entry * 100;
  if (low <= pos.stop) {
    const ep  = pos.stop * (1 - SLIPPAGE);
    const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
    return { close:true, exitPrice:ep, pnl, reason: pos.runner ? 'RunnerStop' : 'Stop' };
  }
  if (pos.system === 'BOLL' && pos.target && price >= pos.target * 0.998 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 1.002).toFixed(2));
    pos.be   = true;
    await sendTelegram(`🎯 <b>BOLL Target — ${sym}</b>\nPrecio tocó banda media $${pos.target.toFixed(2)}\nStop → BE $${pos.stop}`);
  }
  // BE dinámico por capitalización
  const beThr = pos.entry > 300 ? 1.5 : pos.entry > 100 ? 2.0 : 3.0;
  if (gainPct >= beThr && !pos.be) {
    pos.stop = parseFloat((pos.entry * 1.001).toFixed(2));
    pos.be   = true;
    await updateAlpacaStop(sym, pos.qty, pos.stop, false);
    console.log(`[BE] ${sym} stop → $${pos.stop}`);
  }
  if (pos.be && dailyBars && dailyBars.length >= 20) {
    const dCloses = dailyBars.map(b => b.c);
    const ema20   = calcEMA(dCloses, 20);
    const obvD    = calcOBV(dailyBars);
    if (ema20 && obvD) {
      if (price > ema20 && obvD.bullish) {
        const rs = parseFloat(ema20.toFixed(2));
        if (rs > pos.stop) {
          pos.stop = rs; pos.runner = true;
          await updateAlpacaStop(sym, pos.qty, pos.stop, false);
          console.log(`[RUNNER] ${sym} stop → $${pos.stop}`);
        }
      } else if (pos.runner) {
        const ep  = price * (1 - SLIPPAGE);
        const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
        return { close:true, exitPrice:ep, pnl, reason:'RunnerExit' };
      }
    }
  }
  if (!pos.be) {
    const days = Math.floor((new Date(date) - new Date(pos.entryDate)) / 86400000);
    if (days >= 5) {
      const ep  = price * (1 - SLIPPAGE);
      const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
      return { close:true, exitPrice:ep, pnl, reason:'TimeStop' };
    }
  }
  return null;
}
async function manageShortExit(sym, pos, bar, date, dailyBars) {
  const price = bar.c, high = bar.h || price;
  if (price < (pos.minPrice || pos.entry)) pos.minPrice = price;
  const gainPct = (pos.entry - price) / pos.entry * 100;
  if (high >= pos.stop) {
    const ep  = pos.stop * (1 + SLIPPAGE);
    const pnl = (pos.entry - ep) * pos.qty / EUR_USD;
    return { close:true, exitPrice:ep, pnl, reason: pos.runner ? 'RunnerStop' : 'Stop' };
  }
  if (gainPct >= 3.0 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 0.999).toFixed(2));
    pos.be   = true;
    await updateAlpacaStop(sym, pos.qty, pos.stop, true);
    console.log(`[BE] SHORT ${sym} stop → $${pos.stop}`);
  }
  if (pos.be && dailyBars && dailyBars.length >= 20) {
    const dCloses = dailyBars.map(b => b.c);
    const ema20   = calcEMA(dCloses, 20);
    const obvD    = calcOBV(dailyBars);
    if (ema20 && obvD) {
      if (price < ema20 && obvD.bearish) {
        const rs = parseFloat(ema20.toFixed(2));
        if (rs < pos.stop) {
          pos.stop = rs; pos.runner = true;
          await updateAlpacaStop(sym, pos.qty, pos.stop, true);
          console.log(`[RUNNER] SHORT ${sym} stop → $${pos.stop}`);
        }
      } else if (pos.runner) {
        const ep  = price * (1 + SLIPPAGE);
        const pnl = (pos.entry - ep) * pos.qty / EUR_USD;
        return { close:true, exitPrice:ep, pnl, reason:'RunnerExit' };
      }
    }
  }
  if (!pos.be) {
    const days = Math.floor((new Date(date) - new Date(pos.entryDate)) / 86400000);
    if (days >= 5) {
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
function isMarketOpen() {
  const now     = new Date();
  const utcDay  = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false;
  const nyOffset = (() => {
    const nyStr = now.toLocaleString('en-US', { timeZone:'America/New_York',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
    const [h, m] = nyStr.split(':').map(Number);
    const utcMins = now.getUTCHours()*60 + now.getUTCMinutes();
    const nyMins  = h*60 + m;
    return Math.round((utcMins - nyMins) / 60);
  })();
  const utcMins = now.getUTCHours()*60 + now.getUTCMinutes();
  const open    = 570 + Math.abs(nyOffset)*60;
  const close   = 960 + Math.abs(nyOffset)*60;
  return utcMins >= open && utcMins < close;
}
function isEntryAllowed() {
  if (!isMarketOpen()) return false;
  const now      = new Date();
  const nyOffset = 4;
  const utcMins  = now.getUTCHours()*60 + now.getUTCMinutes();
  const open     = 570 + nyOffset*60;
  const close    = 960 + nyOffset*60;
  return utcMins >= open + 30 && utcMins < close - 30;
}
async function executeBuy(sym, entry, stop, qty, meta = {}) {
  if (!isMarketOpen()) {
    await sendTelegram(`🚫 Orden bloqueada — mercado cerrado (${sym})`);
    return false;
  }
  try {
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method:'POST', headers:alpacaHdr(),
      body: JSON.stringify({ symbol:sym, qty:String(qty), side:'buy',
        type:'market', time_in_force:'day' }),
    });
    const o = await r.json();
    if (!o.id) {
      await sendTelegram(`❌ Error Alpaca ${sym}: ${o.message || JSON.stringify(o).slice(0,100)}`);
      return false;
    }
    await new Promise(r => setTimeout(r, 1500));
    await fetch(`${alpacaBase()}/v2/orders`, {
      method:'POST', headers:alpacaHdr(),
      body: JSON.stringify({ symbol:sym, qty:String(qty), side:'sell',
        type:'stop', stop_price:String(stop), time_in_force:'gtc' }),
    });
    const riskEur = Math.round((entry - stop) * qty / EUR_USD);
    openPositions[sym] = {
      sym, qty, entry, stop, entryDate: new Date().toISOString().slice(0,10),
      maxPrice: entry, minPrice: entry,
      be:false, runner:false, system: meta.system || 'MOM',
      target: meta.target || null, ts: Date.now(),
    };
    const mode = isLive() ? '🔴 REAL' : '📋 PAPER';
    await sendTelegram(
      `✅ <b>${meta.system||'MOM'} EJECUTADO — ${sym}</b>\n${mode}\n\n` +
      `💰 ${qty} acc @ ~$${entry.toFixed(2)}\n` +
      `🛑 Stop: $${stop} · Riesgo: ~€${riskEur}\n` +
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
    const openOrds = await fetch(`${alpacaBase()}/v2/orders?status=open&symbols=${sym}`,
      { headers:alpacaHdr() }).then(r => r.json()).catch(() => []);
    for (const ord of (Array.isArray(openOrds) ? openOrds : [])) {
      await fetch(`${alpacaBase()}/v2/orders/${ord.id}`,
        { method:'DELETE', headers:alpacaHdr() }).catch(() => {});
    }
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method:'POST', headers:alpacaHdr(),
      body: JSON.stringify({ symbol:sym, qty:String(qty), side:'sell',
        type:'market', time_in_force:'day' }),
    });
    const o = await r.json();
    if (!o.id) return false;
    const pos = openPositions[sym];
    const pnl = pos ? Math.round((price - pos.entry) * qty / EUR_USD) : 0;
    if (pos) {
      tradeHistory.unshift({
        sym, system: pos.system, entry: pos.entry, exit: price,
        qty, pnlEur: pnl, win: pnl > 0,
        entryDate: pos.entryDate, exitDate: new Date().toISOString().slice(0,10),
        exitReason: reason,
      });
      if (tradeHistory.length > 200) tradeHistory = tradeHistory.slice(0, 200);
    }
    delete openPositions[sym];
    await sendTelegram(
      `🤖 <b>AUTO-EXIT — ${sym}</b>\n${qty} acc @ ~$${price.toFixed(2)}\n` +
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
      await executeBuy(sym, entry, stop, qty, { system: sig.type, target });
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
        const r = await fetch(`${alpacaBase()}/v2/orders`, {
          method:'POST', headers:alpacaHdr(),
          body: JSON.stringify({ symbol:sym, qty:String(qty), side:'sell',
            type:'market', time_in_force:'day' }),
        });
        const o = await r.json();
        if (o.id) {
          openPositions[sym] = { sym, qty, entry, stop,
            entryDate: new Date().toISOString().slice(0,10),
            minPrice:entry, be:false, runner:false, system:'SHORT', ts:Date.now() };
          monthlyTrades[`${sym}_short_${month}`] = true;
          const riskEur = Math.round((stop - entry) * qty / EUR_USD);
          await sendTelegram(
            `📉 <b>SHORT EJECUTADO — ${sym}</b>\n\n` +
            `💰 ${qty} acc @ ~$${entry.toFixed(2)}\n` +
            `🛑 Stop: $${stop} · Riesgo: ~€${riskEur}\n` +
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
      const bar = { c: price, h: price * 1.001, l: price * 0.999 };
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
    const d = await r.json();
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
              type:'market', time_in_force:'day' }),
          });
          const o = await r2.json();
          if (o.id) {
            openPositions[sym] = { ...order, entryDate:new Date().toISOString().slice(0,10),
              minPrice:order.entry, be:false, runner:false, ts:Date.now() };
            const month = new Date().toISOString().slice(0,7);
            monthlyTrades[`${sym}_short_${month}`] = true;
            delete pendingOrders[sym];
            await sendTelegram(`✅ SHORT ejecutado — ${sym} ${order.qty} acc`);
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
          `⚙️ <b>Estado V3.4.0</b>\n\n` +
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
          `🤖 <b>ORS V3.4.0</b>\n\n` +
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
  status: 'ORS V3.4.0', version: '3.4.0',
  regime: MARKET_REGIME.mode,
  positions: Object.keys(openPositions).length,
  account: getAcc().label,
  uptime: Math.round(process.uptime()) + 's',
  improvements: ['I10: Stop VPOC', 'D03: SPY>-1%', 'N02: Wyckoff Spring'],
}));
app.get('/health', (req, res) => res.json({
  status: 'ok', version: '3.4.0',
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
app.get('/regime',    (req, res) => res.json(MARKET_REGIME));
app.get('/positions', (req, res) => res.json(openPositions));
app.get('/trades', (req, res) => {
  const wins = tradeHistory.filter(t=>t.win);
  const gw   = wins.reduce((s,t)=>s+(t.pnlEur||0),0);
  const gl   = Math.abs(tradeHistory.filter(t=>!t.win).reduce((s,t)=>s+(t.pnlEur||0),0));
  res.json({
    summary: { n:tradeHistory.length,
      wr: tradeHistory.length ? Math.round(wins.length/tradeHistory.length*100) : 0,
      pf: gl>0 ? parseFloat((gw/gl).toFixed(2)) : 0,
      pnl: Math.round(gw-gl) },
    trades: tradeHistory.slice(0,50),
  });
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
    const r = await fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHdr() });
    const positions = await r.json();
    if (!Array.isArray(positions))
      return res.status(500).json({ error: 'Error Alpaca', raw: positions });
    const synced = [], skipped = [];
    for (const p of positions) {
      const sym = p.symbol;
      if (openPositions[sym]) { skipped.push(sym); continue; }
      const ep   = parseFloat(p.avg_entry_price);
      const qty  = Math.abs(parseInt(p.qty));
      const side = p.side;
      const system = side === 'short' ? 'SHORT' : 'MOM';
      const stop = side === 'short'
        ? parseFloat((ep * 1.03).toFixed(2))
        : parseFloat((ep * 0.97).toFixed(2));
      openPositions[sym] = {
        sym, qty, entry: ep, stop,
        entryDate: new Date().toISOString().slice(0,10),
        maxPrice: ep, minPrice: ep,
        be: false, runner: false, system, ts: Date.now(), synced: true,
      };
      synced.push({ sym, side, qty, entry: ep, stop, system });
    }
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
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.get('/alpaca/account',   async (req, res) => {
  const r = await fetch(`${alpacaBase()}/v2/account`, { headers:alpacaHdr() });
  res.json(await r.json());
});
app.get('/alpaca/positions', async (req, res) => {
  const r = await fetch(`${alpacaBase()}/v2/positions`, { headers:alpacaHdr() });
  res.json(await r.json());
});
app.get('/alpaca/bars/daily', async (req, res) => {
  const { sym, limit = 504 } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });
  try {
    const url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Day&limit=${limit}&feed=iex&sort=asc`;
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
    if (!text || text === 'Not Found') return res.json({ sym, bars: [], prices15: [], count: 0 });
    const d = JSON.parse(text);
    if (!d.bars) return res.json({ sym, bars: [], prices15: [], count: 0 });
    const bars = d.bars.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }));
    res.json({ sym, bars, prices15: bars.map(b=>b.c), count: bars.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/alpaca/snapshots', async (req, res) => {
  const { syms } = req.query;
  if (!syms) return res.json({});
  const r = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${syms}&feed=iex`, { headers:alpacaHdr() });
  res.json(await r.json());
});

// ═══════════════════════════════════════════════════════
// ANÁLISIS MACRO — Alerta temprana con IA
// ═══════════════════════════════════════════════════════
let MACRO_CACHE = { ts:0, data:null, prob:0, regime:'BULL', last_tg:0 };
const MACRO_TTL = { BULL:7*24*3600000, VIGILANCIA:24*3600000, ALERTA:6*3600000 };

async function fetchMacroIndicators() {
  const ind = {};
  // SPY — precio, SMA50, SMA200, drawdown, momentum
  try {
    const r = await fetch(`${ALPACA_DATA}/v2/stocks/SPY/bars?timeframe=1Day&limit=220&feed=iex&sort=asc`, { headers:alpacaHdr() });
    const d = await r.json();
    const bars = (d.bars||[]).map(b=>b.c);
    if (bars.length>=200) {
      const last=bars[bars.length-1];
      const sma50=bars.slice(-50).reduce((a,b)=>a+b,0)/50;
      const sma200=bars.slice(-200).reduce((a,b)=>a+b,0)/200;
      const max52=Math.max(...bars.slice(-252));
      ind.spy = {
        price:last.toFixed(2), sma50:sma50.toFixed(2), sma200:sma200.toFixed(2),
        above_sma50:last>sma50, above_sma200:last>sma200,
        drawdown_52w:((last-max52)/max52*100).toFixed(1),
        mom_20d:((last-bars[bars.length-21])/bars[bars.length-21]*100).toFixed(1),
        regime: last>sma200?(last>sma50?'BULL':'LATERAL'):'BEAR',
      };
    }
  } catch(e){ ind.spy_error=e.message; }

  // VIX proxy (VIXY)
  try {
    const r = await fetch(`${ALPACA_DATA}/v2/stocks/VIXY/bars?timeframe=1Day&limit=20&feed=iex&sort=asc`, { headers:alpacaHdr() });
    const d = await r.json(); const bars=d.bars||[];
    if (bars.length>=5) {
      const last=bars[bars.length-1].c; const prev=bars[bars.length-6]?.c||last;
      ind.vix = { level:last.toFixed(2), chg_5d:((last-prev)/prev*100).toFixed(1), elevated:last>20, spike:((last-prev)/prev*100)>20 };
    }
  } catch(e){}

  // Yield curve proxy TLT/SHY
  try {
    const [r1,r2] = await Promise.all([
      fetch(`${ALPACA_DATA}/v2/stocks/TLT/bars?timeframe=1Day&limit=5&feed=iex&sort=asc`,{headers:alpacaHdr()}),
      fetch(`${ALPACA_DATA}/v2/stocks/SHY/bars?timeframe=1Day&limit=5&feed=iex&sort=asc`,{headers:alpacaHdr()}),
    ]);
    const [d1,d2] = await Promise.all([r1.json(),r2.json()]);
    const tlt=(d1.bars||[]).slice(-1)[0]?.c; const shy=(d2.bars||[]).slice(-1)[0]?.c;
    if (tlt&&shy) ind.yield_curve = { tlt_shy_ratio:(tlt/shy).toFixed(3), inverted:(tlt/shy)<1.1 };
  } catch(e){}

  // Sectores — rotación 20d
  const secs = { QQQ:'Tech/Growth',XLV:'Health',XLE:'Energy',XLF:'Finance',XLU:'Utilities',GLD:'Gold' };
  ind.sectores = {};
  await Promise.all(Object.entries(secs).map(async ([sym,label]) => {
    try {
      const r = await fetch(`${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Day&limit=25&feed=iex&sort=asc`,{headers:alpacaHdr()});
      const d = await r.json(); const bars=(d.bars||[]).map(b=>b.c);
      if (bars.length>=20) {
        const last=bars[bars.length-1];
        ind.sectores[sym] = { label, price:last.toFixed(2), mom_20d:((last-bars[0])/bars[0]*100).toFixed(1), mom_5d:((last-bars[bars.length-6])/bars[bars.length-6]*100).toFixed(1) };
      }
    } catch(e){}
  }));

  // Noticias macro
  try {
    const r = await fetch(`${ALPACA_DATA}/v1beta1/news?symbols=SPY,QQQ,TLT&limit=8&sort=desc`,{headers:alpacaHdr()});
    const d = await r.json();
    ind.noticias = (d.news||d||[]).slice(0,6).map(n=>({ title:n.headline||n.title||'', date:(n.created_at||'').slice(0,10) }));
  } catch(e){ ind.noticias=[]; }

  ind.timestamp = new Date().toISOString();
  return ind;
}

async function analyzeWithClaude(ind) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const spy=ind.spy||{}; const vix=ind.vix||{}; const yc=ind.yield_curve||{};
  const secs=ind.sectores||{}; const news=ind.noticias||[];
  const secStr=Object.entries(secs).map(([s,d])=>`${s}:20d=${d.mom_20d}% 5d=${d.mom_5d}%`).join(' | ');
  const newsStr=news.slice(0,4).map(n=>`• ${n.title} [${n.date}]`).join('\n');
  const prompt = `Eres analista macro cuantitativo experto en crashes de mercado.

INDICADORES ACTUALES:
SPY $${spy.price} | SMA50 $${spy.sma50} | SMA200 $${spy.sma200} | Régimen: ${spy.regime} | DD52w: ${spy.drawdown_52w}% | Mom20d: ${spy.mom_20d}%
VIX proxy: $${vix.level} | Chg5d: ${vix.chg_5d}% | Elevado: ${vix.elevated} | Spike: ${vix.spike}
Yield curve TLT/SHY: ${yc.tlt_shy_ratio} | Invertida: ${yc.inverted}
Sectores 20d: ${secStr}
Noticias: ${newsStr}
Contexto: Fed 3.50-3.75% pausa hawkish jun 2026 | Prima riesgo S&P ~0.02% mínimo histórico

TAXONOMÍA DE CRASHES (para clasificar):
Tipo A (repricing múltiplos): Fed hawkish, tipos suben, caída gradual meses
Tipo B (liquidez): desapalancamiento forzado, V-shape días/semanas
Tipo C (político): decisión política, dependiente de noticias

Responde SOLO JSON sin texto adicional:
{"regime":"BULL|LATERAL|BEAR|ALERTA|PRE-CRASH","prob_crash_30d":0-100,"crash_type_potencial":"A_REPRICING|B_LIQUIDEZ|C_POLITICO|NINGUNO","señales_positivas":["max 3"],"señales_negativas":["max 3"],"indicadores_clave":{"spy_regime":"BULL/LATERAL/BEAR","vix_status":"NORMAL/ELEVADO/SPIKE","yield_curve":"NORMAL/PLANA/INVERTIDA","rotacion_sectorial":"RISK-ON/NEUTRAL/RISK-OFF","momentum_macro":"POSITIVO/NEUTRO/NEGATIVO"},"comparativa_historica":"C1_2022|C3_2024|C4_2025|SIN_PARALELISMO","resumen":"2-3 frases en español","recomendacion_jt":"OPERAR_NORMAL|MODO_ALERTA|REDUCIR_EXPOSICION|SALIR_CASH","proxima_revision":"SEMANAL|DIARIA|6H"}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:800, messages:[{role:'user',content:prompt}] }),
  });
  const data = await r.json();
  const text = data.content?.[0]?.text||'{}';
  try { return JSON.parse(text.replace(/```json|```/g,'').trim()); }
  catch(e) { return { regime:'UNKNOWN', prob_crash_30d:0, resumen:'Error parsing IA', error:text.slice(0,200) }; }
}

async function runMacroAnalysis() {
  try {
    const ind      = await fetchMacroIndicators();
    const analysis = await analyzeWithClaude(ind);
    if (!analysis) return null;
    const result   = { ...analysis, indicators:ind, cached:false, updated_at:new Date().toISOString() };
    const prob     = analysis.prob_crash_30d||0;
    const regime   = prob>=70?'ALERTA':prob>=40?'VIGILANCIA':'BULL';
    MACRO_CACHE    = { ts:Date.now(), data:result, prob, regime, last_tg:MACRO_CACHE.last_tg };

    // Telegram si prob > 70% y no enviamos en últimas 6h
    if (prob>=70 && (Date.now()-MACRO_CACHE.last_tg)>6*3600000) {
      MACRO_CACHE.last_tg = Date.now();
      const icon = prob>=85?'🚨':'⚠️';
      await sendTelegram(`${icon} <b>ALERTA MACRO — ${analysis.regime}</b>\n\n📊 Prob crash 30d: <b>${prob}%</b>\n🔴 Tipo: ${analysis.crash_type_potencial||'N/A'}\n📝 ${analysis.resumen||''}\n⚡ JT: <b>${analysis.recomendacion_jt||''}</b>`);
    }
    return result;
  } catch(e) { console.error('[MACRO]', e.message); return null; }
}

// Scheduler automático
function scheduleMacro() {
  const prob = MACRO_CACHE.prob||0;
  const ttl  = prob>=70?MACRO_TTL.ALERTA:prob>=40?MACRO_TTL.VIGILANCIA:MACRO_TTL.BULL;
  setTimeout(async () => {
    console.log('[MACRO] Análisis automático...');
    await runMacroAnalysis();
    scheduleMacro();
  }, ttl);
}

app.get('/analisis-macro', async (req, res) => {
  const force = req.query.force==='true';
  const now   = Date.now();
  const ttl   = MACRO_TTL[MACRO_CACHE.regime]||MACRO_TTL.BULL;
  if (!force && MACRO_CACHE.data && (now-MACRO_CACHE.ts)<ttl) {
    return res.json({ ...MACRO_CACHE.data, cached:true, cache_age_min:Math.round((now-MACRO_CACHE.ts)/60000) });
  }
  const result = await runMacroAnalysis();
  if (!result) return res.status(500).json({ error:'Error en análisis macro' });
  const prob = result.prob_crash_30d||0;
  res.json({ ...result, modo_revision:prob>=70?'6H':prob>=40?'DIARIA':'SEMANAL' });
});

app.post('/analisis-macro/scan', async (req, res) => {
  MACRO_CACHE.ts = 0; // forzar refresh
  const result = await runMacroAnalysis();
  if (!result) return res.status(500).json({ error:'Error en análisis macro' });
  res.json(result);
});

// ═══════════════════════════════════════════════════════
// ARRANQUE
// ═══════════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log(`ORS V3.4.0 — puerto ${PORT}`);
  // Arrancar scheduler análisis macro (primer análisis en 15s)
  setTimeout(() => { runMacroAnalysis().then(()=>scheduleMacro()); }, 15000);
  console.log(`Cuenta: ${getAcc().label} | AUTO: ${AUTO_EXECUTE}`);
  console.log(`Mejoras activas: I10(VPOC) + D03(SPY>-1%) + N02(Spring)`);
  await sendTelegram(
    `🚀 <b>ORS V3.4.0 arrancado</b>\n\n` +
    `BULL:    MOM (5) + BOLL (1)\n` +
    `LATERAL: MOM 75% (5)\n` +
    `BEAR:    SHORT v3 (3)\n\n` +
    `<b>Mejoras v3.4.0:</b>\n` +
    `✅ I10: Stop bajo VPOC\n` +
    `✅ D03: Bloquear si SPY<-1%\n` +
    `✅ N02: Wyckoff Spring\n` +
    `📊 OOS: PF 3.59 MAR 10.58 DD 6.08%\n\n` +
    `Cuenta: ${getAcc().label}\n` +
    `Capital: €${CAPITAL_EUR.toLocaleString('es-ES')}\n` +
    `Auto: ${AUTO_EXECUTE}`
  );
  setTimeout(updateRegime, 3000);
  setTimeout(async () => {
    try {
      const r = await fetch(`${alpacaBase()}/v2/positions`, { headers:alpacaHdr() });
      const positions = await r.json();
      if (Array.isArray(positions) && positions.length) {
        const synced = [];
        positions.forEach(p => {
          if (!openPositions[p.symbol]) {
            const ep   = parseFloat(p.avg_entry_price);
            const side = p.side;
            const system = side === 'short' ? 'SHORT' : 'MOM';
            const stop = side === 'short'
              ? parseFloat((ep*1.03).toFixed(2))
              : parseFloat((ep*0.97).toFixed(2));
            openPositions[p.symbol] = {
              sym:p.symbol, qty:Math.abs(parseInt(p.qty)), entry:ep, stop,
              entryDate: new Date().toISOString().slice(0,10),
              maxPrice:ep, minPrice:ep, be:false, runner:false,
              system, ts:Date.now(), synced:true,
            };
            synced.push(p.symbol);
          }
        });
        if (synced.length) {
          console.log(`[SYNC] ${synced.length} posiciones: ${synced.join(', ')}`);
          await sendTelegram(`📊 <b>Posiciones al arrancar:</b> ${synced.join(', ')}`);
        }
      }
    } catch(e) { console.log('[SYNC]', e.message); }
  }, 5000);
  setInterval(checkMOMSignals,   5*60*1000);
  setInterval(checkShortSignals, 5*60*1000);
  setInterval(managePositions,   3*60*1000);
  setInterval(pollTelegram,      3*1000);
  setInterval(updateRegime,      60*60*1000);
  setTimeout(checkMOMSignals,    30*1000);
  setTimeout(checkShortSignals,  35*1000);
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
