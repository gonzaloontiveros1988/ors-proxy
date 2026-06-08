// sizing.js — v1.0.0
// Cálculo de sizing, riesgo y qty para todos los sistemas

'use strict';

const CAPITAL_BASE = 11480;  // capital de referencia

/**
 * Calcula qty para una posición
 * @param {Object} params
 * @param {number} params.entry       - precio de entrada
 * @param {number} params.stop        - precio de stop
 * @param {number} params.capital     - capital actual €
 * @param {number} params.riskPct     - % de riesgo (ej: 0.02)
 * @param {number} params.eurUsd      - tipo de cambio EUR/USD
 * @param {number} params.sizeMult    - multiplicador de régimen (0.75 en LATERAL)
 * @param {number} params.maxCapPct   - máx % del capital por posición (ej: 0.20)
 * @returns {number|null} qty de acciones
 */
function calcQty({ entry, stop, capital, riskPct = 0.02, eurUsd = 1.08, sizeMult = 1.0, maxCapPct = 0.20 }) {
  if (!entry || !stop || entry <= 0) return null;
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare <= 0) return null;

  const riskUsd = capital * riskPct * eurUsd * sizeMult;
  const qtyByRisk = Math.floor(riskUsd / riskPerShare);
  const qtyByCap  = Math.floor(capital * maxCapPct * eurUsd / entry);

  const qty = Math.min(qtyByRisk, qtyByCap);
  return qty >= 1 ? qty : null;
}

/**
 * Calcula qty para SHORT (lógica inversa)
 */
function calcQtyShort({ entry, stop, capital, riskPct = 0.02, eurUsd = 1.08, maxCapPct = 0.20 }) {
  return calcQty({ entry, stop, capital, riskPct, eurUsd, sizeMult: 1.0, maxCapPct });
}

/**
 * P&L de una posición LONG cerrada
 */
function calcPnLLong({ entry, exit, qty, eurUsd = 1.08, slippage = 0.001 }) {
  const exitAdj = exit * (1 - slippage);
  return (exitAdj - entry) * qty / eurUsd;
}

/**
 * P&L de una posición SHORT cerrada
 */
function calcPnLShort({ entry, exit, qty, eurUsd = 1.08, slippage = 0.001 }) {
  const exitAdj = exit * (1 + slippage);
  return (entry - exitAdj) * qty / eurUsd;
}

module.exports = {
  calcQty,
  calcQtyShort,
  calcPnLLong,
  calcPnLShort,
  CAPITAL_BASE,
};
