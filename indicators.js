// indicators.js — v1.0.0
// Indicadores técnicos centralizados
// Fuente única de verdad para todos los cálculos técnicos
// Sin dependencias externas — vanilla JS

'use strict';

// ── EMA ────────────────────────────────────────────────
function calcEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices[prices.length - period];
  for (let i = prices.length - period + 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// ── RSI ────────────────────────────────────────────────
function calcRSI(prices, period = 14) {
  if (!prices || prices.length < period + 2) return null;
  let gains = [], losses = [];
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  let ag = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
  }
  if (al === 0) return 100;
  return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
}

// ── MACD ───────────────────────────────────────────────
function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (!prices || prices.length < slow + signal + 1) return null;
  const kf = 2 / (fast + 1), ks = 2 / (slow + 1);
  let ef = prices[0], es = prices[0];
  const macdLine = [];
  for (let i = 1; i < prices.length; i++) {
    ef = prices[i] * kf + ef * (1 - kf);
    es = prices[i] * ks + es * (1 - ks);
    if (i >= slow - 1) macdLine.push(ef - es);
  }
  if (macdLine.length < signal) return null;
  const ks2 = 2 / (signal + 1);
  let sv = macdLine[0];
  const sigLine = [sv];
  for (let i = 1; i < macdLine.length; i++) {
    sv = macdLine[i] * ks2 + sv * (1 - ks2);
    sigLine.push(sv);
  }
  const lm = macdLine[macdLine.length - 1];
  const ls = sigLine[sigLine.length - 1];
  const pm = macdLine[macdLine.length - 2];
  const ps = sigLine[sigLine.length - 2];
  const hist = lm - ls;
  const prevHist = pm - ps;
  return {
    macd: lm,
    signal: ls,
    hist,
    bullish: lm > ls,
    bearish: lm < ls,
    increasing: hist > prevHist && hist > 0,
    decreasing: hist < prevHist && hist < 0,
    bullCross: pm <= ps && lm > ls,
    bearCross: pm >= ps && lm < ls,
  };
}

// ── OBV ────────────────────────────────────────────────
function calcOBV(bars) {
  if (!bars || bars.length < 10) return null;
  let obv = 0;
  const series = [];
  for (let i = 1; i < bars.length; i++) {
    const v = bars[i].v || 0;
    if (bars[i].c > bars[i - 1].c) obv += v;
    else if (bars[i].c < bars[i - 1].c) obv -= v;
    series.push(obv);
  }
  const n = series.length;
  const nb = Math.min(14, n);
  const rec = series.slice(-nb);
  const sx = rec.reduce((_, __, i) => _ + i, 0);
  const sy = rec.reduce((a, b) => a + b, 0);
  const sxy = rec.reduce((a, b, i) => a + i * b, 0);
  const sx2 = rec.reduce((a, _, i) => a + i * i, 0);
  const d = nb * sx2 - sx * sx;
  const slope = d !== 0 ? (nb * sxy - sx * sy) / d : 0;
  return {
    value: obv,
    slope,
    bullish: slope > 0,
    bearish: slope < 0,
    rising: n >= 3 && series[n - 1] > series[n - 3],
    falling: n >= 3 && series[n - 1] < series[n - 3],
  };
}

// ── ATR ────────────────────────────────────────────────
function calcATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return null;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const h = bars[i].h || bars[i].c;
    const l = bars[i].l || bars[i].c;
    const pc = bars[i - 1].c;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / period;
}

// ── RVOL ───────────────────────────────────────────────
function calcRVOL(bars, period = 20) {
  if (!bars || bars.length < period + 1) return null;
  const vols = bars.slice(-period - 1).map(b => b.v || 0);
  const avg = vols.slice(0, period).reduce((a, b) => a + b, 0) / period;
  if (avg === 0) return 1;
  return vols[period] / avg;
}

// ── BOLLINGER BANDS ────────────────────────────────────
function calcBollinger(prices, period = 20, k = 2) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + k * sd;
  const lower = mid - k * sd;
  const last = prices[prices.length - 1];
  const width = upper - lower;
  const position = width > 0 ? (last - lower) / width : 0.5;
  return {
    upper: parseFloat(upper.toFixed(4)),
    mid: parseFloat(mid.toFixed(4)),
    lower: parseFloat(lower.toFixed(4)),
    width: parseFloat(width.toFixed(4)),
    position: parseFloat(position.toFixed(3)), // 0=lower, 1=upper
    aboveUpper: last >= upper,
    belowLower: last <= lower,
    aboveMid: last > mid,
  };
}

// ── SMA ────────────────────────────────────────────────
function calcSMA(prices, period) {
  if (!prices || prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── VWAP INTRADAY ──────────────────────────────────────
function calcVWAP(bars) {
  if (!bars || bars.length === 0) return null;
  let cumTPV = 0, cumVol = 0;
  const series = [];
  for (const b of bars) {
    const tp = ((b.h || b.c) + (b.l || b.c) + b.c) / 3;
    const v = b.v || 1;
    cumTPV += tp * v;
    cumVol += v;
    series.push(cumTPV / cumVol);
  }
  return {
    value: series[series.length - 1],
    series,
  };
}

// ── UTILIDADES ─────────────────────────────────────────
function extractCloses(bars) {
  return bars.map(b => b.c);
}

function getLastN(bars, n) {
  return bars.slice(-n);
}

function priceSlope(prices, period = 20) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  const n = slice.length;
  const sx = (n * (n - 1)) / 2;
  const sy = slice.reduce((a, b) => a + b, 0);
  const sxy = slice.reduce((a, b, i) => a + i * b, 0);
  const sx2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const d = n * sx2 - sx * sx;
  return d !== 0 ? (n * sxy - sx * sy) / d : 0;
}

module.exports = {
  calcEMA,
  calcRSI,
  calcMACD,
  calcOBV,
  calcATR,
  calcRVOL,
  calcBollinger,
  calcSMA,
  calcVWAP,
  extractCloses,
  getLastN,
  priceSlope,
};
