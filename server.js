// server.js — v3.0.0
// ORS Proxy — Sistema MOM V3
// ===========================
// BULL:    MOM V1 (4 slots) + Bollinger (1 slot)
// LATERAL: MOM V1 75% sizing (5 slots)
// BEAR:    SHORT v3 filtros A+D (3 slots)
//
// Validado en backtest IBKR 2021-2026:
//   MOM+BOLL: PF 3.06 OOS  WFE 0.94
//   MOM LATERAL: PF 5.07 OOS  WFE 1.53
//   SHORT v3: PF 2.97 OOS  WFE 0.93

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

// Capital y riesgo
let CAPITAL_EUR  = parseFloat(process.env.CAPITAL_EUR || '11480');
const RISK_PCT   = parseFloat(process.env.RISK_PCT    || '0.02');

// Slots por sistema
const MAX_MOM    = 4;
const MAX_BOLL   = 1;
const MAX_SHORT  = 3;

// Ejecución automática
const AUTO_EXECUTE = process.env.AUTO_EXECUTE === 'true';

// ── ALPACA ────────────────────────────────────────────
const ALPACA_DATA = 'https://data.alpaca.markets';

const ALPACA_ACCOUNTS = {
  paper2: {
    key:    process.env.ALPACA_KEY_2    || '',
    secret: process.env.ALPACA_SECRET_2 || '',
    base:   'https://paper-api.alpaca.markets',
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
  // AI / Chips
  'NVDA','AMD','AVGO','TSM','MU','QCOM','MRVL','SMCI','ORCL','PLTR',
  // Cloud / Software
  'META','AMZN','GOOGL','MSFT','NFLX','CRM','NOW','SNOW','DDOG','MDB',
  'CRWD','PANW','NET','CRWV',
  // Healthcare / Biotech
  'HCA','ISRG','UNH','LLY','VRTX','ABBV','AMGN','GILD','REGN','MRNA',
  'INSM','CRSP','ALNY',
  // Energy / Nuclear
  'CEG','VST','GEV','NEE','ETR','XOM','CVX','OXY',
  // Airlines
  'DAL','UAL','AAL',
  // Industrial / Defense
  'CAT','HON','ROK','GD','LMT','RTX','FDX',
  // Space
  'RKLB','LUNR','TSLA',
  // Fintech
  'JPM','GS','MS','COIN',
  // Misc
  'HUT','TKO','BE','AMG','EL','HUM','SMCI',
];

// Sector para filtro alcista/bajista
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
const openPositions   = {};  // sym → posición
const pendingOrders   = {};  // sym → orden pendiente confirmación
const sentAlerts      = {};  // keys para evitar duplicados
const monthlyTrades   = {};  // sym_YYYY-MM → true (1 trade/ticker/mes)
let   tradeHistory    = [];  // historial cerradas
let   lastUpdateId    = 0;   // Telegram polling

// ── RÉGIMEN ───────────────────────────────────────────
let MARKET_REGIME = {
  mode: 'BULL',
  sma50: null, sma200: null,
  bearStreak: 0, sma50Bearish: false,
  sizeMult: 1.0, ts: 0,
};

// ── SECTOR SENTIMENT (Claude análisis diario) ─────────
let sectorSentiment  = {};
let sectorLastUpdate = null;

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

// ═══════════════════════════════════════════════════════
// RÉGIMEN DE MERCADO
// ═══════════════════════════════════════════════════════

async function updateRegime() {
  try {
    const bars = await fetchDailyBars('SPY', 210);
    if (!bars || bars.length < 52) return;
    const closes = bars.map(b => b.c);
    const last   = closes[closes.length - 1];
    const sma50  = calcSMA(closes, 50);
    const sma200 = closes.length >= 200 ? calcSMA(closes, 200) : null;

    // Bear streak
    let bearStreak = 0;
    if (sma200) {
      for (let i = closes.length - 1; i >= Math.max(0, closes.length - 6); i--) {
        const s = calcSMA(closes.slice(0, i+1), Math.min(200, i+1));
        if (closes[i] < s) bearStreak++;
        else break;
      }
    }

    // SMA50 bajista
    const sma50Prev  = closes.length >= 55 ? calcSMA(closes.slice(0, -5), 50) : sma50;
    const sma50Bear  = sma50 && sma50Prev && sma50 < sma50Prev;

    // Modo
    let mode, sizeMult;
    if (sma200 && last < sma200 && bearStreak >= 3) {
      mode = 'BEAR'; sizeMult = 1.0; // SHORT usa su propio sizing
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
// SEÑALES — MOM V1
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
  const c2 = !!(o && o.bullish && o.rising);   // OBV — obligatorio
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

  // Vela alcista obligatoria
  const lb = bars15[n-1], pb = bars15[n-2] || lb;
  if (lb.c <= (lb.o || pb.c)) return null;

  // 3 velas consecutivas alcistas
  if (n >= 4 && !(bars15[n-1].c > bars15[n-2].c && bars15[n-2].c > bars15[n-3].c)) return null;

  return { sym, system:'MOM', last, rsi:r, rvol:parseFloat(rv.toFixed(2)),
           score, atr:a, ema20:e20, signal: score>=5 ? 'OPTIMA' : 'SENAL' };
}

// ═══════════════════════════════════════════════════════
// SEÑALES — BOLLINGER BULL
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
// SEÑALES — SHORT v3 (BEAR)
// ═══════════════════════════════════════════════════════

const RS_THRESHOLD  = -5.0;
const BEAR_MIN_DAYS = 5;

function evalShort(sym, bars15, spyRS) {
  // Filtro A: BEAR estricto
  const reg = MARKET_REGIME;
  if (reg.mode !== 'BEAR')               return null;
  if (reg.bearStreak < BEAR_MIN_DAYS)    return null;
  if (!reg.sma50Bearish)                 return null;

  // Filtro D: RS negativa
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
  const c2 = !!(o && o.bearish && o.falling);  // OBV — obligatorio
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

  // Stop
  if (low <= pos.stop) {
    const ep  = pos.stop * (1 - SLIPPAGE);
    const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
    return { close:true, exitPrice:ep, pnl, reason: pos.runner ? 'RunnerStop' : 'Stop' };
  }

  // Bollinger exit — precio toca banda media
  if (pos.system === 'BOLL' && pos.target && price >= pos.target * 0.998 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 1.002).toFixed(2));
    pos.be   = true;
    await sendTelegram(`🎯 <b>BOLL Target — ${sym}</b>\nPrecio tocó banda media $${pos.target.toFixed(2)}\nStop → Breakeven $${pos.stop}`);
  }

  // Breakeven a +3%
  if (gainPct >= 3.0 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 1.001).toFixed(2));
    pos.be   = true;
  }

  // Runner EMA20 diaria
  if (pos.be && dailyBars && dailyBars.length >= 20) {
    const dCloses = dailyBars.map(b => b.c);
    const ema20   = calcEMA(dCloses, 20);
    const obvD    = calcOBV(dailyBars);
    if (ema20 && obvD) {
      if (price > ema20 && obvD.bullish) {
        const rs = parseFloat(ema20.toFixed(2));
        if (rs > pos.stop) { pos.stop = rs; pos.runner = true; }
      } else if (pos.runner) {
        const ep  = price * (1 - SLIPPAGE);
        const pnl = (ep - pos.entry) * pos.qty / EUR_USD;
        return { close:true, exitPrice:ep, pnl, reason:'RunnerExit' };
      }
    }
  }

  // TimeStop — 5 días sin breakeven
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

  // Stop
  if (high >= pos.stop) {
    const ep  = pos.stop * (1 + SLIPPAGE);
    const pnl = (pos.entry - ep) * pos.qty / EUR_USD;
    return { close:true, exitPrice:ep, pnl, reason: pos.runner ? 'RunnerStop' : 'Stop' };
  }

  // Breakeven a +3%
  if (gainPct >= 3.0 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 0.999).toFixed(2));
    pos.be   = true;
  }

  // Runner EMA20 diaria bajista
  if (pos.be && dailyBars && dailyBars.length >= 20) {
    const dCloses = dailyBars.map(b => b.c);
    const ema20   = calcEMA(dCloses, 20);
    const obvD    = calcOBV(dailyBars);
    if (ema20 && obvD) {
      if (price < ema20 && obvD.bearish) {
        const rs = parseFloat(ema20.toFixed(2));
        if (rs < pos.stop) { pos.stop = rs; pos.runner = true; }
      } else if (pos.runner) {
        const ep  = price * (1 + SLIPPAGE);
        const pnl = (pos.entry - ep) * pos.qty / EUR_USD;
        return { close:true, exitPrice:ep, pnl, reason:'RunnerExit' };
      }
    }
  }

  // TimeStop
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
  const open    = 570 + Math.abs(nyOffset)*60;  // 9:30 NY en UTC
  const close   = 960 + Math.abs(nyOffset)*60;  // 16:00 NY en UTC
  return utcMins >= open && utcMins < close;
}

function isEntryAllowed() {
  if (!isMarketOpen()) return false;
  const now     = new Date();
  const nyOffset = 4; // EDT — simplificado
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
    // Orden mercado
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method:'POST', headers:alpacaHdr(),
      body: JSON.stringify({ symbol:sym, qty:String(qty), side:'buy',
        type:'market', time_in_force:'day' }),
    });
    const o = await r.json();
    if (!o.id) {
      console.log(`[EXEC] ${sym} rechazado:`, o.message || o.code);
      await sendTelegram(`❌ Error Alpaca ${sym}: ${o.message || JSON.stringify(o).slice(0,100)}`);
      return false;
    }

    // Stop loss GTC
    await new Promise(r => setTimeout(r, 1500));
    await fetch(`${alpacaBase()}/v2/orders`, {
      method:'POST', headers:alpacaHdr(),
      body: JSON.stringify({ symbol:sym, qty:String(qty), side:'sell',
        type:'stop', stop_price:String(stop), time_in_force:'gtc' }),
    });

    // Registrar posición
    const riskEur = Math.round((entry - stop) * qty / EUR_USD);
    openPositions[sym] = {
      sym, qty, entry, stop, entryDate: new Date().toISOString().slice(0,10),
      maxPrice: entry, minPrice: entry,
      be:false, runner:false, system: meta.system || 'MOM',
      target: meta.target || null, ts: Date.now(),
    };

    const mode = isLive() ? '🔴 REAL' : '📋 PAPER';
    await sendTelegram(
      `✅ <b>${meta.system||'MOM'} EJECUTADO — ${sym}</b>\n` +
      `${mode}\n\n` +
      `💰 ${qty} acc @ ~$${entry.toFixed(2)}\n` +
      `🛑 Stop: $${stop} · Riesgo: ~€${riskEur}\n` +
      (meta.target ? `🎯 Target: $${meta.target.toFixed(2)}\n` : '') +
      `\n/cerrar_${sym}`
    );
    console.log(`[EXEC] ✅ ${sym} ${qty} acc @ $${entry.toFixed(2)} stop $${stop}`);
    return true;
  } catch(e) {
    console.error('[EXEC]', sym, e.message);
    await sendTelegram(`❌ Error ejecutando ${sym}: ${e.message}`);
    return false;
  }
}

async function executeSell(sym, qty, reason, price) {
  if (!isMarketOpen() && !reason.toLowerCase().includes('stop')) {
    console.log(`[BLOCKED] Venta bloqueada — mercado cerrado (${sym})`);
    return false;
  }
  try {
    // Cancelar órdenes abiertas
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

    // Guardar en historial
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
      `🤖 <b>AUTO-EXIT — ${sym}</b>\n` +
      `${qty} acc @ ~$${price.toFixed(2)}\n` +
      `Motivo: ${reason}\n` +
      `P&L: ${pnl >= 0 ? '+' : ''}€${pnl}`
    );
    return true;
  } catch(e) {
    console.error('[SELL]', sym, e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════
// SCANNER — MOM + BOLL
// ═══════════════════════════════════════════════════════

async function checkMOMSignals() {
  if (!isEntryAllowed()) return;
  const reg  = MARKET_REGIME;
  if (reg.mode === 'BEAR') return;  // MOM no opera en BEAR

  const momCount  = Object.values(openPositions).filter(p => p.system === 'MOM').length;
  const bollCount = Object.values(openPositions).filter(p => p.system === 'BOLL').length;
  if (momCount >= MAX_MOM && bollCount >= MAX_BOLL) return;

  console.log(`[MOM] Modo ${reg.mode} | MOM:${momCount}/${MAX_MOM} BOLL:${bollCount}/${MAX_BOLL}`);

  // Fetch SPY para RS
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

      // ── MOM signal ─────────────────────────────────
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
              if (perf5 < -2.0) { continue; }
            }
          }
          // RS vs SPY
          let rs = 0;
          if (spy20 && spyLast && spy20 > 0) {
            const s20 = bars15.length >= 21 ? bars15[bars15.length-21].c : null;
            if (s20 && s20 > 0) rs = (sig.last/s20-1)*100 - (spyLast/spy20-1)*100;
          }
          candidates.push({ ...sig, rs, type:'MOM' });
        }
      }

      // ── BOLL signal (solo BULL) ────────────────────
      if (bollCount < MAX_BOLL && reg.mode === 'BULL') {
        const dailyBars = await fetchDailyBars(sym, 220);
        if (dailyBars && dailyBars.length >= 205) {
          const sig = evalBollinger(sym, dailyBars);
          if (sig) candidates.push({ ...sig, rs:-99, type:'BOLL' }); // prioridad baja
        }
      }

      await new Promise(r => setTimeout(r, 100));
    } catch(e) { console.log('[MOM]', sym, e.message); }
  }

  // Ordenar por RS (mejor primero)
  candidates.sort((a, b) => b.rs - a.rs);

  for (const sig of candidates) {
    const sym = sig.sym;
    if (openPositions[sym]) continue;

    const entry   = sig.last * (1 + SLIPPAGE);
    const atrVal  = Math.max(sig.atr, sig.last * 0.005);
    const stop    = parseFloat((entry - atrVal * 1.5).toFixed(2));
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
        `📦 ${qty} acc | RSI ${sig.rsi} | RVOL ${sig.rvol}x\n\n` +
        `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════
// SCANNER — SHORT v3
// ═══════════════════════════════════════════════════════

async function checkShortSignals() {
  if (!isEntryAllowed()) return;
  const reg = MARKET_REGIME;
  if (reg.mode !== 'BEAR')          return;
  if (reg.bearStreak < BEAR_MIN_DAYS) return;
  if (!reg.sma50Bearish)             return;

  const shortCount = Object.values(openPositions).filter(p => p.system === 'SHORT').length;
  if (shortCount >= MAX_SHORT) return;

  console.log(`[SHORT] Modo BEAR bearStreak:${reg.bearStreak} | SHORT:${shortCount}/${MAX_SHORT}`);

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

      // RS vs SPY
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

  // Ordenar por RS más negativa (más bajista primero)
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
      // SHORT — orden de venta en corto
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
            `📊 RSI ${sig.rsi} | RS ${sig.spyRS?.toFixed(1)}% vs SPY\n` +
            `\n/cerrar_${sym}`
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

      // Barras para el runner
      const dailyBars = await fetchDailyBars(sym, 30);

      // Crear bar mock para la función de gestión
      const bar = { c: price, h: price * 1.001, l: price * 0.999 };

      let result = null;
      if (pos.system === 'SHORT') {
        result = await manageShortExit(sym, pos, bar, date, dailyBars);
      } else {
        result = await manageLongExit(sym, pos, bar, date, dailyBars);
      }

      if (result && result.close) {
        const isShort = pos.system === 'SHORT';
        const sold = await executeSell(sym, pos.qty, result.reason, result.exitPrice);
        if (sold) {
          console.log(`[EXIT] ${sym} ${result.reason} pnl €${Math.round(result.pnl)}`);
        }
      }

      // Alertas de hitos
      const gainPct = pos.system === 'SHORT'
        ? (pos.entry - price) / pos.entry * 100
        : (price - pos.entry) / pos.entry * 100;

      for (const m of [3, 5, 10, 15]) {
        const mk = `${sym}_hito_${m}`;
        if (gainPct >= m && !sentAlerts[mk]) {
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
// SECTOR SENTIMENT — Claude análisis diario
// ═══════════════════════════════════════════════════════

const SECTOR_ETFS = {
  AI_CHIPS:   'SOXX', CLOUD:'XLK', SPACE:'XAR',
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
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
      await sendTelegram(
        `📊 <b>Análisis Sectorial</b>\n🟢 ${bull.join(', ')||'ninguno'}\n🔴 ${bear.join(', ')||'ninguno'}`
      );
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
  } catch(e) { console.log('[TG]', e.message); return false; }
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
          await sendTelegram(`⏰ Orden ${sym} expirada — señal puede haber cambiado`);
          continue;
        }
        if (!isMarketOpen()) { await sendTelegram('🚫 Mercado cerrado'); continue; }
        if (order.isShort) {
          // Ejecutar short
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
          const p   = openPositions[s];
          const snap= await fetchSnapshot(s).catch(()=>null);
          const px  = snap?.price || p.entry;
          const pct = p.system === 'SHORT'
            ? ((p.entry - px)/p.entry*100).toFixed(1)
            : ((px - p.entry)/p.entry*100).toFixed(1);
          const pnl = Math.round(Math.abs(px - p.entry) * p.qty / EUR_USD);
          const icon= parseFloat(pct)>=0 ? '🟢' : '🔴';
          m += `<b>${s}</b> [${p.system}] ${icon} ${pct>=0?'+':''}${pct}%\n`;
          m += `$${p.entry}→$${px.toFixed(2)} · Stop $${p.stop} · P&L: ${parseFloat(pct)>=0?'+':''}€${pnl}\n\n`;
        }
        await sendTelegram(m);
      }

      else if (text === '/estado') {
        const reg = MARKET_REGIME;
        const m =
          `⚙️ <b>Estado V3</b>\n\n` +
          `🏛️ Régimen: <b>${reg.mode}</b>\n` +
          `SPY $${reg.price?.toFixed(2)||'—'} | SMA50 $${reg.sma50||'—'}\n` +
          `bearStreak: ${reg.bearStreak} | sma50Bear: ${reg.sma50Bearish}\n\n` +
          `💼 Cuenta: ${getAcc().label}\n` +
          `💰 Capital: €${CAPITAL_EUR.toLocaleString('es-ES')}\n` +
          `📊 Posiciones: ${Object.keys(openPositions).length}\n` +
          `🤖 AUTO_EXECUTE: ${AUTO_EXECUTE}\n\n` +
          `Sistemas:\n` +
          `  MOM: ${Object.values(openPositions).filter(p=>p.system==='MOM').length}/${MAX_MOM}\n` +
          `  BOLL: ${Object.values(openPositions).filter(p=>p.system==='BOLL').length}/${MAX_BOLL}\n` +
          `  SHORT: ${Object.values(openPositions).filter(p=>p.system==='SHORT').length}/${MAX_SHORT}`;
        await sendTelegram(m);
      }

      else if (text === '/ayuda' || text === '/help') {
        await sendTelegram(
          `🤖 <b>ORS V3</b>\n\n` +
          `<b>ÓRDENES</b>\n` +
          `/si — Confirmar última orden\n` +
          `/no — Cancelar última orden\n` +
          `/ejecutar_SYM — Ejecutar ticker\n` +
          `/cancelar_SYM — Cancelar ticker\n` +
          `/cerrar_SYM — Cerrar posición\n\n` +
          `<b>INFO</b>\n` +
          `/posiciones — Ver posiciones y P&L\n` +
          `/estado — Estado del servidor\n` +
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
  status: 'ORS V3', version: '3.0.0',
  regime: MARKET_REGIME.mode,
  positions: Object.keys(openPositions).length,
  account: getAcc().label,
  uptime: Math.round(process.uptime()) + 's',
}));

app.get('/health', (req, res) => res.json({
  status: 'ok', version: '3.0.0',
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

app.get('/regime', (req, res) => res.json(MARKET_REGIME));

app.get('/positions', (req, res) => res.json(openPositions));

app.get('/trades', (req, res) => {
  const wins   = tradeHistory.filter(t=>t.win);
  const losses = tradeHistory.filter(t=>!t.win);
  const gw = wins.reduce((s,t)=>s+(t.pnlEur||0),0);
  const gl = Math.abs(losses.reduce((s,t)=>s+(t.pnlEur||0),0));
  res.json({
    summary: {
      n: tradeHistory.length,
      wr: tradeHistory.length ? Math.round(wins.length/tradeHistory.length*100) : 0,
      pf: gl > 0 ? parseFloat((gw/gl).toFixed(2)) : 0,
      pnl: Math.round(gw - gl),
    },
    trades: tradeHistory.slice(0, 50),
  });
});

app.get('/trades/stats/strategy', (req, res) => {
  function stats(trades) {
    const wins = trades.filter(t=>t.win);
    const loses= trades.filter(t=>!t.win);
    const gw = wins.reduce((s,t)=>s+(t.pnlEur||0),0);
    const gl = Math.abs(loses.reduce((s,t)=>s+(t.pnlEur||0),0));
    return { n:trades.length, wins:wins.length, losses:loses.length,
      wr: trades.length ? parseFloat((wins.length/trades.length*100).toFixed(1)) : 0,
      pf: gl > 0 ? parseFloat((gw/gl).toFixed(2)) : 0,
      pnl: Math.round(gw - gl) };
  }
  res.json({
    MOM:   stats(tradeHistory.filter(t=>t.system==='MOM')),
    BOLL:  stats(tradeHistory.filter(t=>t.system==='BOLL')),
    SHORT: stats(tradeHistory.filter(t=>t.system==='SHORT')),
    TOTAL: stats(tradeHistory),
  });
});

app.get('/sector/sentiment', (req, res) => res.json({
  lastUpdate: sectorLastUpdate,
  sentiment:  sectorSentiment,
}));

app.post('/sector/run', async (req, res) => {
  res.json({ ok:true, message:'Análisis sectorial iniciado' });
  updateSectorSentiment().catch(e => console.log('[SECTOR]', e.message));
});

// Proxy Claude
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

// Yahoo proxy
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

// Alpaca pass-through
app.get('/alpaca/account',   async (req, res) => {
  const r = await fetch(`${alpacaBase()}/v2/account`, { headers:alpacaHdr() });
  res.json(await r.json());
});
app.get('/alpaca/positions', async (req, res) => {
  const r = await fetch(`${alpacaBase()}/v2/positions`, { headers:alpacaHdr() });
  res.json(await r.json());
});
app.get('/alpaca/snapshots', async (req, res) => {
  const { syms } = req.query;
  if (!syms) return res.json({});
  const r = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${syms}&feed=iex`, { headers:alpacaHdr() });
  res.json(await r.json());
});

// ═══════════════════════════════════════════════════════
// ARRANQUE
// ═══════════════════════════════════════════════════════

app.listen(PORT, async () => {
  console.log(`ORS V3 — puerto ${PORT}`);
  console.log(`Cuenta: ${getAcc().label} | AUTO: ${AUTO_EXECUTE}`);

  await sendTelegram(
    `🚀 <b>ORS V3 arrancado</b>\n\n` +
    `BULL:    MOM (4) + BOLL (1)\n` +
    `LATERAL: MOM 75% (5)\n` +
    `BEAR:    SHORT v3 (3)\n\n` +
    `Cuenta: ${getAcc().label}\n` +
    `Capital: €${CAPITAL_EUR.toLocaleString('es-ES')}\n` +
    `Auto: ${AUTO_EXECUTE}`
  );

  // Régimen al arrancar
  setTimeout(updateRegime, 3000);

  // Sync posiciones Alpaca
  setTimeout(async () => {
    try {
      const r = await fetch(`${alpacaBase()}/v2/positions`, { headers:alpacaHdr() });
      const positions = await r.json();
      if (Array.isArray(positions) && positions.length) {
        positions.forEach(p => {
          if (!openPositions[p.symbol]) {
            const ep = parseFloat(p.avg_entry_price);
            openPositions[p.symbol] = {
              sym:p.symbol, qty:parseInt(p.qty), entry:ep,
              stop: parseFloat((ep*0.97).toFixed(2)),
              entryDate: new Date().toISOString().slice(0,10),
              maxPrice:ep, be:false, runner:false, system:'MOM', ts:Date.now(),
            };
          }
        });
        console.log(`[SYNC] ${positions.length} posiciones cargadas`);
        await sendTelegram(`📊 Posiciones sincronizadas: ${positions.map(p=>p.symbol).join(', ')}`);
      }
    } catch(e) { console.log('[SYNC]', e.message); }
  }, 5000);

  // Schedulers
  setInterval(checkMOMSignals,    5 * 60 * 1000);   // cada 5 min
  setInterval(checkShortSignals,  5 * 60 * 1000);   // cada 5 min (solo en BEAR)
  setInterval(managePositions,    3 * 60 * 1000);   // cada 3 min
  setInterval(pollTelegram,       3 * 1000);         // cada 3 seg
  setInterval(updateRegime,       60 * 60 * 1000);  // cada hora

  // Primera señal 30s tras arranque
  setTimeout(checkMOMSignals,  30 * 1000);
  setTimeout(checkShortSignals,35 * 1000);

  // Sector sentiment al cierre (20:15 UTC)
  function scheduleSector() {
    const now    = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
                            now.getUTCDate(), 20, 15, 0));
    if (now >= target) target.setUTCDate(target.getUTCDate() + 1);
    const ms = target - now;
    setTimeout(async () => {
      await updateSectorSentiment();
      scheduleSector();
    }, ms);
  }
  scheduleSector();

  // Régimen al cierre del mercado (20:05 UTC)
  function scheduleRegime() {
    const now    = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
                            now.getUTCDate(), 20, 5, 0));
    if (now >= target) target.setUTCDate(target.getUTCDate() + 1);
    const ms = target - now;
    setTimeout(async () => {
      await updateRegime();
      scheduleRegime();
    }, ms);
  }
  scheduleRegime();
});