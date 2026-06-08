// regime.js — v1.0.0
// Detección de régimen de mercado: BULL / LATERAL / BEAR
// Basado en SPY vs SMA50 y SMA200

'use strict';

const { calcSMA } = require('./indicators');

/**
 * Detecta el régimen actual del mercado
 * @param {Array} spyBars - Barras diarias de SPY (mínimo 200)
 * @returns {Object} { mode, sma50, sma200, bearStreak, sma50Bearish }
 */
function detectRegime(spyBars) {
  if (!spyBars || spyBars.length < 50) {
    return { mode: 'BULL', sma50: null, sma200: null, bearStreak: 0, sma50Bearish: false };
  }

  const closes = spyBars.map(b => b.c);
  const last = closes[closes.length - 1];
  const sma50  = calcSMA(closes, Math.min(50, closes.length));
  const sma200 = closes.length >= 200 ? calcSMA(closes, 200) : null;

  // Contar días consecutivos bajo SMA200
  let bearStreak = 0;
  if (sma200) {
    for (let i = closes.length - 1; i >= Math.max(0, closes.length - 6); i--) {
      const s200i = calcSMA(closes.slice(0, i + 1), Math.min(200, i + 1));
      if (closes[i] < s200i) bearStreak++;
      else break;
    }
  }

  // SMA50 bajista (pendiente negativa últimos 5 días)
  let sma50Bearish = false;
  if (closes.length >= 55) {
    const sma50Prev = calcSMA(closes.slice(0, -5), 50);
    sma50Bearish = sma50 !== null && sma50Prev !== null && sma50 < sma50Prev;
  }

  // Determinar modo
  let mode;
  if (sma200 && last < sma200 && bearStreak >= 3) {
    mode = 'BEAR';
  } else if (sma50 && last < sma50) {
    mode = 'LATERAL';
  } else {
    mode = 'BULL';
  }

  return {
    mode,
    sma50: sma50 ? parseFloat(sma50.toFixed(2)) : null,
    sma200: sma200 ? parseFloat(sma200.toFixed(2)) : null,
    bearStreak,
    sma50Bearish,
    price: last,
  };
}

/**
 * Sizing multiplier según régimen
 * @param {string} mode - 'BULL' | 'LATERAL' | 'BEAR'
 * @returns {number} multiplicador de sizing
 */
function getSizingMultiplier(mode) {
  const multipliers = {
    BULL:    1.00,
    LATERAL: 0.75,
    BEAR:    1.00, // SHORT usa su propio sizing
  };
  return multipliers[mode] || 1.0;
}

/**
 * ¿Es válido el BEAR para SHORT? (filtro A)
 * @param {Object} regime - resultado de detectRegime
 * @returns {boolean}
 */
function isBearValid(regime) {
  return (
    regime.mode === 'BEAR' &&
    regime.bearStreak >= 5 &&
    regime.sma50Bearish === true
  );
}

module.exports = {
  detectRegime,
  getSizingMultiplier,
  isBearValid,
};
