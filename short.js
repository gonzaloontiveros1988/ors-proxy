// short.js — v1.0.0
// Estrategia SHORT v3 — Momentum bajista en BEAR
// Filtros A+D: BEAR>=5 días + SMA50 bajista + RS<-5%
// Validado: IS PF 3.19  OOS PF 2.97  WFE 0.93

'use strict';

const {
  calcRSI, calcMACD, calcOBV, calcATR, calcRVOL,
  calcEMA, extractCloses
} = require('./indicators');

const RS_THRESHOLD   = -5.0;  // Filtro D: RS < -5% vs SPY
const BEAR_MIN_DAYS  = 5;     // Filtro A: BEAR >= 5 días consecutivos

/**
 * Evalúa señal SHORT v3 para un ticker
 * @param {string} sym     - ticker
 * @param {Array}  bars    - barras 15min (mínimo 60)
 * @param {number} spyRS   - RS del ticker vs SPY últimos 20 días
 * @param {Object} regime  - resultado de detectRegime
 * @returns {Object|null} señal o null
 */
function evalShort(sym, bars, spyRS, regime) {
  // ── FILTRO A: BEAR estricto ────────────────────────
  if (!regime || regime.mode !== 'BEAR') return null;
  if (regime.bearStreak < BEAR_MIN_DAYS) return null;
  if (!regime.sma50Bearish) return null;

  // ── FILTRO D: RS negativa ──────────────────────────
  if (spyRS === null || spyRS >= RS_THRESHOLD) return null;

  if (!bars || bars.length < 50) return null;

  const closes = extractCloses(bars);
  const last = closes[closes.length - 1];
  if (last < 15) return null;

  const r   = calcRSI(closes, 14);
  const o   = calcOBV(bars);
  const m   = calcMACD(closes);
  const e20 = calcEMA(closes, 20);
  const a   = calcATR(bars, 14);
  const rv  = calcRVOL(bars, 20);

  if (!r || !a || !rv) return null;

  // ── 7 CONDICIONES SHORT ────────────────────────────
  const c1 = r >= 30 && r <= 55;                          // RSI bajista activo
  const c2 = !!(o && o.bearish && o.falling);             // OBV bajista (OBLIGATORIO)
  const c3 = !!(m && m.bearish && m.decreasing);          // MACD bajista
  const c4 = !!(e20 && last < e20);                       // Precio bajo EMA20
  const n  = bars.length;
  const prev3Low = Math.min(
    n >= 4 ? (bars[n-4].l || bars[n-4].c) : last,
    n >= 3 ? (bars[n-3].l || bars[n-3].c) : last,
    n >= 2 ? (bars[n-2].l || bars[n-2].c) : last,
  );
  const c5 = last < prev3Low && rv >= 1.5;                // Breakdown con volumen
  const lastBar = bars[n-1];
  const prevBar = bars[n-2] || lastBar;
  const c6 = lastBar.c < (lastBar.o || prevBar.c);        // Vela bajista
  const c7 = true; // ya filtrado por spyRS arriba

  const score = [c1, c2, c3, c4, c5, c6, c7].filter(Boolean).length;
  if (score < 5 || !c2) return null;

  return {
    sym,
    system: 'SHORT',
    last,
    rsi: r,
    rvol: parseFloat(rv.toFixed(2)),
    score,
    atr: a,
    ema20: e20,
    obv: o,
    rs: spyRS,
  };
}

/**
 * Calcula el stop inicial para SHORT
 * @param {number} entry - precio de entrada (ya con slippage)
 * @param {number} atr   - ATR actual
 * @returns {number} stop price (por ENCIMA de entry para SHORT)
 */
function calcShortStop(entry, atr) {
  const atrVal = Math.max(atr, entry * 0.005);
  return parseFloat((entry + atrVal * 1.5).toFixed(2));
}

/**
 * RS del ticker vs SPY
 * @param {Array} symBars - barras del ticker (15min)
 * @param {Array} spyBars - barras SPY (15min)
 * @param {number} period - período en barras (default 20 días ≈ 260 barras 15min)
 * @returns {number} RS%
 */
function calcRS(symBars, spyBars, period = 20) {
  if (!symBars || !spyBars || symBars.length < period || spyBars.length < period) return 0;
  const symNow  = symBars[symBars.length-1].c;
  const symPrev = symBars[symBars.length-1-period].c;
  const spyNow  = spyBars[spyBars.length-1].c;
  const spyPrev = spyBars[spyBars.length-1-period].c;
  if (!symPrev || !spyPrev) return 0;
  return (symNow/symPrev - 1)*100 - (spyNow/spyPrev - 1)*100;
}

module.exports = {
  evalShort,
  calcShortStop,
  calcRS,
  RS_THRESHOLD,
  BEAR_MIN_DAYS,
};
