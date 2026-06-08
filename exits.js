// exits.js — v1.0.0
// Gestión de salidas: runner, BE, trailing stop, TimeStop
// Válido para posiciones LONG y SHORT

'use strict';

const { calcEMA, calcOBV } = require('./indicators');

/**
 * Gestiona la salida de una posición LONG
 * Incluye: stop hit, BE a +3%, runner EMA20 diaria, TimeStop
 *
 * @param {Object} pos        - posición abierta
 * @param {Object} bar        - barra actual 15min
 * @param {string} date       - fecha actual YYYY-MM-DD
 * @param {Array}  dailyBars  - barras diarias del ticker
 * @returns {Object|null} { shouldClose, exitPrice, reason } o null si sigue abierta
 */
function manageLongExit(pos, bar, date, dailyBars) {
  const price = bar.c;
  const low   = bar.l || price;
  const high  = bar.h || price;

  // Actualizar máximo precio
  if (price > (pos.maxPrice || pos.entry)) pos.maxPrice = price;

  const gainPct = (price - pos.entry) / pos.entry * 100;

  // ── STOP ──────────────────────────────────────────
  if (low <= pos.stop) {
    return {
      shouldClose: true,
      exitPrice: pos.stop * (1 - 0.001),
      reason: pos.runner ? 'RunnerStop' : 'Stop',
    };
  }

  // ── BREAKEVEN a +3% ───────────────────────────────
  if (gainPct >= 3.0 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 1.001).toFixed(2));
    pos.be = true;
  }

  // ── RUNNER EMA20 diaria ───────────────────────────
  if (pos.be && dailyBars && dailyBars.length >= 20) {
    const dailyCloses = dailyBars
      .filter(b => b.t <= date)
      .map(b => b.c);

    const ema20 = calcEMA(dailyCloses, 20);
    const obvData = calcOBV(dailyBars.filter(b => b.t <= date));

    if (ema20 && obvData) {
      if (price > ema20 && obvData.bullish) {
        // Subir stop al EMA20 si es mayor que el stop actual
        const newStop = parseFloat(ema20.toFixed(2));
        if (newStop > pos.stop) {
          pos.stop = newStop;
          pos.runner = true;
        }
      } else if (pos.runner) {
        // EMA20 dejó de ser alcista → salir
        return {
          shouldClose: true,
          exitPrice: price * (1 - 0.001),
          reason: 'RunnerExit',
        };
      }
    }
  }

  // ── TIMESTOP — 5 días sin BE ──────────────────────
  if (!pos.be) {
    const daysHeld = daysBetween(pos.entryDate, date);
    if (daysHeld >= 5) {
      return {
        shouldClose: true,
        exitPrice: price * (1 - 0.001),
        reason: 'TimeStop',
      };
    }
  }

  return null; // sigue abierta
}

/**
 * Gestiona la salida de una posición SHORT
 * Incluye: stop hit, BE a -3%, runner EMA20 diaria bajista, TimeStop
 */
function manageShortExit(pos, bar, date, dailyBars) {
  const price = bar.c;
  const high  = bar.h || price;

  if (price < (pos.minPrice || pos.entry)) pos.minPrice = price;

  const gainPct = (pos.entry - price) / pos.entry * 100;

  // ── STOP (precio sube sobre el stop) ──────────────
  if (high >= pos.stop) {
    return {
      shouldClose: true,
      exitPrice: pos.stop * (1 + 0.001),
      reason: pos.runner ? 'RunnerStop' : 'Stop',
    };
  }

  // ── BREAKEVEN a -3% ───────────────────────────────
  if (gainPct >= 3.0 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 0.999).toFixed(2));
    pos.be = true;
  }

  // ── RUNNER EMA20 diaria bajista ───────────────────
  if (pos.be && dailyBars && dailyBars.length >= 20) {
    const dailyCloses = dailyBars
      .filter(b => b.t <= date)
      .map(b => b.c);

    const ema20 = calcEMA(dailyCloses, 20);
    const obvData = calcOBV(dailyBars.filter(b => b.t <= date));

    if (ema20 && obvData) {
      if (price < ema20 && obvData.bearish) {
        const newStop = parseFloat(ema20.toFixed(2));
        if (newStop < pos.stop) {
          pos.stop = newStop;
          pos.runner = true;
        }
      } else if (pos.runner) {
        return {
          shouldClose: true,
          exitPrice: price * (1 + 0.001),
          reason: 'RunnerExit',
        };
      }
    }
  }

  // ── TIMESTOP — 5 días sin BE ──────────────────────
  if (!pos.be) {
    const daysHeld = daysBetween(pos.entryDate, date);
    if (daysHeld >= 5) {
      return {
        shouldClose: true,
        exitPrice: price * (1 + 0.001),
        reason: 'TimeStop',
      };
    }
  }

  return null;
}

/**
 * Gestiona la salida de una posición BOLLINGER
 * Sale cuando precio toca banda media o TimeStop 8 días
 */
function manageBollExit(pos, bar, date, dailyBars) {
  const price = bar.c;
  const low   = bar.l || price;

  // Stop
  if (low <= pos.stop) {
    return {
      shouldClose: true,
      exitPrice: pos.stop * (1 - 0.001),
      reason: 'Stop',
    };
  }

  // Precio llega a banda media → BE
  if (pos.target && price >= pos.target * 0.998 && !pos.be) {
    pos.stop = parseFloat((pos.entry * 1.002).toFixed(2));
    pos.be = true;
  }

  // Runner tras BE (igual que MOM)
  if (pos.be && dailyBars && dailyBars.length >= 20) {
    const result = manageLongExit(pos, bar, date, dailyBars);
    if (result) return { ...result, reason: result.reason === 'Stop' ? 'BollExit' : result.reason };
  }

  // TimeStop 8 días sin BE
  if (!pos.be) {
    const daysHeld = daysBetween(pos.entryDate, date);
    if (daysHeld >= 8) {
      return {
        shouldClose: true,
        exitPrice: price * (1 - 0.001),
        reason: 'TimeStop',
      };
    }
  }

  return null;
}

// ── UTILIDAD ───────────────────────────────────────────
function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

module.exports = {
  manageLongExit,
  manageShortExit,
  manageBollExit,
  daysBetween,
};
