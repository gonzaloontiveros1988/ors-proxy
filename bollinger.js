// bollinger.js — v1.0.0
// Estrategia Bollinger BULL — Pullback a banda inferior
// Solo opera en régimen BULL, 1 slot máximo
// Validado: IS PF 3.27 combinado  OOS PF 3.06  WFE 0.94

'use strict';

const {
  calcRSI, calcATR, calcRVOL, calcBollinger,
  calcSMA, extractCloses
} = require('./indicators');

/**
 * Evalúa señal Bollinger BULL para un ticker
 * Usa barras DIARIAS (no 15min)
 * @param {string} sym       - ticker
 * @param {Array}  dailyBars - barras diarias (mínimo 205)
 * @returns {Object|null} señal o null
 */
function evalBollinger(sym, dailyBars) {
  if (!dailyBars || dailyBars.length < 205) return null;

  const closes = extractCloses(dailyBars);
  const last = closes[closes.length - 1];
  if (last < 15) return null;

  const bb  = calcBollinger(closes, 20, 2);
  const r   = calcRSI(closes, 14);
  const a   = calcATR(dailyBars, 14);
  const rv  = calcRVOL(dailyBars, 20);
  const s200 = closes.length >= 200 ? calcSMA(closes, 200) : null;

  if (!bb || !r || !a || !rv || !s200) return null;

  // ── CONDICIONES ────────────────────────────────────
  const c1 = last <= bb.lower;   // precio en/bajo banda inferior
  const c2 = r < 35;             // RSI oversold
  const c3 = last > s200;        // precio sobre SMA200 (tendencia larga alcista)
  const c4 = rv >= 1.0;          // volumen mínimo

  if (!(c1 && c2 && c3 && c4)) return null;

  // Stop conservador bajo banda inferior
  const stop = Math.min(
    parseFloat((bb.lower - a * 0.5).toFixed(2)),
    parseFloat((last - a * 1.0).toFixed(2)),
  );

  return {
    sym,
    system: 'BOLL',
    last,
    rsi: r,
    rvol: parseFloat(rv.toFixed(2)),
    upper: bb.upper,
    mid: bb.mid,
    lower: bb.lower,
    stop,
    target: bb.mid,  // target = banda media
    atr: parseFloat(a.toFixed(4)),
  };
}

/**
 * Evalúa salida Bollinger
 * Sale cuando precio toca banda media
 * @param {Object} pos       - posición abierta
 * @param {Array}  dailyBars - barras diarias actualizadas
 * @returns {boolean} true si debe salir
 */
function shouldExitBollinger(pos, dailyBars) {
  if (!dailyBars || dailyBars.length < 22) return false;
  const closes = extractCloses(dailyBars.slice(-22));
  const bb = calcBollinger(closes, 20, 2);
  const r  = calcRSI(closes, 14);
  const lastPrice = closes[closes.length - 1];
  if (!bb) return false;
  // Salir cuando precio toca banda media o RSI supera 50
  return lastPrice >= bb.mid || (r && r > 50);
}

module.exports = { evalBollinger, shouldExitBollinger };
