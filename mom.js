// mom.js — v1.0.0
// Estrategia MOM V1 — Momentum Breakout
// Opera en BULL (100%) y LATERAL (75% sizing)
// Validado: IS PF 3.27  OOS PF 3.06  WFE 0.94

'use strict';

const {
  calcRSI, calcMACD, calcOBV, calcATR, calcRVOL,
  calcEMA, extractCloses
} = require('./indicators');

const SECTOR_MAP = {
  NVDA:'XLK', AMD:'XLK', AVGO:'XLK', TSM:'XLK', MU:'XLK',
  QCOM:'XLK', MRVL:'XLK', SMCI:'XLK', ORCL:'XLK', META:'XLK',
  AMZN:'XLK', GOOGL:'XLK', MSFT:'XLK', AAPL:'XLK', NFLX:'XLK',
  CRM:'XLK', ADBE:'XLK', NOW:'XLK', SNOW:'XLK', DDOG:'XLK',
  CRWD:'XLK', PANW:'XLK', MDB:'XLK', PLTR:'XLK', NET:'XLK',
  CRWV:'XLK', RKLB:'XLK', LUNR:'XLK', TSLA:'XLK',
  HCA:'XLV', ISRG:'XLV', UNH:'XLV', LLY:'XLV', VRTX:'XLV',
  ABBV:'XLV', AMGN:'XLV', GILD:'XLV', REGN:'XLV', MRNA:'XLV',
  INSM:'XLV', CRSP:'XLV', BIIB:'XLV', BEAM:'XLV', ALNY:'XLV',
  XOM:'XLE', CVX:'XLE', COP:'XLE', OXY:'XLE', SLB:'XLE',
  CEG:'XLU', VST:'XLU', GEV:'XLU', NEE:'XLU', ETR:'XLU',
  DAL:'JETS', UAL:'JETS', AAL:'JETS', LUV:'JETS', ALK:'JETS',
  JPM:'XLF', GS:'XLF', MS:'XLF', BAC:'XLF', WFC:'XLF',
  COIN:'XLF', MSTR:'XLF',
  CAT:'XLI', DE:'XLI', HON:'XLI', GD:'XLI', LMT:'XLI',
  RTX:'XLI', BA:'XLI', AXON:'XLI',
};

/**
 * Evalúa señal MOM V1 para un ticker
 * @param {string} sym    - ticker
 * @param {Array}  bars   - barras 15min (mínimo 60)
 * @param {Object} sectorData - { [etf]: closes[] } para filtro sectorial
 * @returns {Object|null} señal o null
 */
function evalMOM(sym, bars, sectorData = {}) {
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

  // ── 5 CONDICIONES ──────────────────────────────────
  const c1 = r >= 45 && r <= 65;                          // RSI zona momentum
  const c2 = !!(o && o.bullish && o.rising);              // OBV alcista (OBLIGATORIO)
  const c3 = !!(m && m.bullish && m.increasing);          // MACD alcista
  const c4 = !!(e20 && last > e20);                       // Precio sobre EMA20
  const n  = bars.length;
  const p3h = Math.max(
    n >= 4 ? (bars[n-4].h || bars[n-4].c) : 0,
    n >= 3 ? (bars[n-3].h || bars[n-3].c) : 0,
    n >= 2 ? (bars[n-2].h || bars[n-2].c) : 0,
  );
  const c5 = last > p3h && rv >= 1.5;                     // Breakout con volumen

  const score = [c1, c2, c3, c4, c5].filter(Boolean).length;
  if (score < 4 || !c2) return null;

  // ── VELA ALCISTA OBLIGATORIA ───────────────────────
  const lastBar = bars[n-1];
  const prevBar = bars[n-2] || lastBar;
  if (lastBar.c <= (lastBar.o || prevBar.c)) return null;

  // ── 3 VELAS ALCISTAS CONSECUTIVAS ─────────────────
  if (n >= 4) {
    if (!(bars[n-1].c > bars[n-2].c && bars[n-2].c > bars[n-3].c)) return null;
  }

  // ── FILTRO SECTORIAL ───────────────────────────────
  const etf = SECTOR_MAP[sym];
  if (etf && sectorData[etf]) {
    const etfCloses = sectorData[etf];
    if (etfCloses.length >= 6) {
      const perf5d = (etfCloses[etfCloses.length-1] - etfCloses[etfCloses.length-6])
                    / etfCloses[etfCloses.length-6] * 100;
      if (perf5d < -2.0) return null; // sector bajista
    }
  }

  return {
    sym,
    system: 'MOM',
    last,
    rsi: r,
    rvol: parseFloat(rv.toFixed(2)),
    score,
    atr: a,
    ema20: e20,
    obv: o,
    signal: score >= 5 ? 'OPTIMA' : 'SENAL',
  };
}

/**
 * Calcula el stop inicial para MOM
 * @param {number} entry - precio de entrada
 * @param {number} atr   - ATR actual
 * @returns {number} stop price
 */
function calcMOMStop(entry, atr) {
  const atrVal = Math.max(atr, entry * 0.005);
  return parseFloat((entry - atrVal * 1.5).toFixed(2));
}

/**
 * RS vs SPY para rankear candidatos MOM
 * @param {Array} symBars - barras del ticker
 * @param {Array} spyBars - barras SPY
 * @param {number} period - período en barras
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

module.exports = { evalMOM, calcMOMStop, calcRS, SECTOR_MAP };
