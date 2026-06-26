// protocol.js — v2.0.0
// PROTOCOLO DE MOMENTUM MULTI-FASE (validado en sesión de backtest)
// =================================================================
// Motor: ranking MENSUAL 12-1 (TOP-15) con filtro z>2, máquina de 5 fases.
// NO ejecuta nada: calcula el ranking y la fase, y devuelve un PLAN.
// El server lo ejecuta con su fontanería (executeBuy/executeSell/Telegram).
//
// VERSIÓN 2 (final): TOP-15 + ponderación HYBRID + gestión de stop BE&TS.
//   - TOP-15 (vs TOP-10): más diversificación, menos drawdown. MAR 3.53 vs 2.70.
//   - BE&TS: stop -20% inicial; al +10% de ganancia, breakeven y luego trailing -15%
//     del máximo. Protege ganancias maduras sin ahogar las jóvenes. El server gestiona
//     el stop dinámicamente cada día (no es un stop fijo OTO).
//   - Resultado v2 (alpaca): MAR 3.53, MaxDD 16.3%, bate al SP500 todos los años.
//
// Fases (validadas):
//   CRASH   vol30 ON (vol>30% Y SPY<SMA10)           -> exposición 0% (cash)
//   REBOTE  vol30 OFF, SPY<SMA200, SMA200 NO cae      -> 50% 12-1 + 50% 6-1
//   GRIND   vol30 OFF, SPY<SMA200, SMA200 cayendo      -> 50% 12-1 + 50% CASH
//   LATERAL SPY>SMA200, SMA200 plana (|pend|<0.5%)     -> 50% 12-1 + 50% 6-1
//   NORMAL  SPY>SMA200, SMA200 subiendo fuerte         -> 100% 12-1
// Filtro z>2: excluir del TOP-10 los nombres sobre-extendidos (z>2 sobre media20).
// Histéresis: tras CRASH, no se reengancha hasta 7 días de calma.
// Ponderación: HYBRID (60% momentum + 40% inverso-vol). Validado en alpaca: MAR 2.55 vs
//   EQUAL 1.91, gana 6/10 años, menos drawdown. Concentra en lo fuerte, penaliza lo volátil.
// Stop -20% por posición: RED contra desplome IDIOSINCRÁTICO (un nombre que se rompe entre
//   rebalanceos). NO contra crisis sistémica — de eso ya saca el vol30/CRASH a cash antes.
//   Las dos protecciones cubren riesgos distintos y no se pisan.
//
// El corto NO está aquí (módulo aparte, universo de volátiles incompatible).
//
// VALIDACIÓN DEL SESGO (alpaca): el sistema tocó 184 tickers distintos (de 501), tenencia
// media 7 meses; solo 0.2% de las entradas al TOP-10 sufrió desplome severo estando dentro.
// El momentum rota fuera antes de la quiebra -> el sesgo de supervivencia apenas afecta a
// esta estrategia rotacional. alpaca es dataset válido para este sistema.

'use strict';

// ── PARÁMETROS (calibrados y validados) ────────────────
const PARAMS = {
  SKIP_DAYS:    21,      // 12-1 y 6-1 saltan el último mes
  LOOKBACK_12:  252,     // ventana momentum largo
  LOOKBACK_6:   126,     // ventana momentum corto (rebote/lateral)
  TOP_N:        15,      // TOP-15 (v2: más diversificación, MAR 3.53 vs 2.70 del TOP-10)
  MIN_PRICE:    15.0,    // descartar penny stocks
  Z_MAX:        2.0,     // filtro sobre-extensión (excluir z>2)
  VOL_TH:       0.30,    // umbral vol30 anualizada para CRASH
  SLOPE_LAG:    21,      // pendiente SMA200 sobre 21 días
  SLOPE_FLAT:   0.005,   // ±0.5% = SMA200 "plana" (lateral)
  REENTRY_DAYS: 7,       // histéresis tras CRASH
  STOP_CAT:     0.20,    // red -20% antes de activar breakeven (idiosincrático)
  BE_TRIGGER:   0.10,    // +10% de ganancia activa breakeven+trailing (v2, robusto)
  TRAIL:        0.15,    // luego stop = máximo - 15% (trailing)
  WEIGHTING:    'HYBRID',// 'EQUAL' | 'HYBRID' (60% momentum + 40% inverso-vol)
  HYB_MOM:      0.60,    // peso del momentum en HYBRID
  HYB_INVVOL:   0.40,    // peso del inverso-vol en HYBRID
};

// ── INDICADORES (puros, sobre arrays de cierres) ───────
function sma(closes, n) {
  if (!closes || closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}
function annualizedVol(closes, n) {
  if (!closes || closes.length < n + 1) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  if (rets.length < 3) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) * (b - m), 0) / rets.length;
  return Math.sqrt(v) * Math.sqrt(252);
}
function zscore20(closes) {
  if (!closes || closes.length < 20) return null;
  const w = closes.slice(-20);
  const m = w.reduce((a, b) => a + b, 0) / 20;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) * (b - m), 0) / 20);
  return sd > 0 ? (closes[closes.length - 1] - m) / sd : 0;
}
function tickerVol(closes, n) {
  // volatilidad anualizada de los últimos n retornos (para el inverso-vol del HYBRID)
  if (!closes || closes.length < n + 1) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  if (rets.length < 3) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) * (b - m), 0) / rets.length;
  return Math.sqrt(v) * Math.sqrt(252);
}

// ── FASE DEL MERCADO ───────────────────────────────────
// spyCloses: array de cierres diarios de SPY (>= 230).
// hysteresisState: { inPanic, calmDays } persistido por el server entre llamadas.
// Devuelve { phase, exposure12, exposure6, detail, hysteresisState }.
function computePhase(spyCloses, hysteresisState) {
  const st = hysteresisState || { inPanic: false, calmDays: 0 };
  if (!spyCloses || spyCloses.length < 230) {
    return { phase: 'NORMAL', exposure12: 1.0, exposure6: 0.0,
             detail: 'datos insuficientes -> NORMAL por defecto', hysteresisState: st };
  }
  const last  = spyCloses[spyCloses.length - 1];
  const s10   = sma(spyCloses, 10);
  const s200  = sma(spyCloses, 200);
  const s200Prev = sma(spyCloses.slice(0, spyCloses.length - PARAMS.SLOPE_LAG), 200);
  const vol30 = annualizedVol(spyCloses, 20);

  // 1) PÁNICO (vol30 ON) con histéresis
  const panicRaw = !!(vol30 && s10 && vol30 > PARAMS.VOL_TH && last < s10);
  if (panicRaw) { st.inPanic = true; st.calmDays = 0; }
  else if (st.inPanic) {
    st.calmDays += 1;
    if (st.calmDays >= PARAMS.REENTRY_DAYS) st.inPanic = false;
  }

  // 2) pendiente SMA200 (tendencia)
  let slope = 0;
  if (s200 && s200Prev && s200Prev > 0) slope = (s200 - s200Prev) / s200Prev;
  const below200 = s200 != null && last < s200;

  let phase, e12, e6;
  if (st.inPanic) {
    phase = 'CRASH'; e12 = 0.0; e6 = 0.0;
  } else if (below200) {
    if (slope >= 0) { phase = 'REBOTE'; e12 = 0.5; e6 = 0.5; }
    else            { phase = 'GRIND';  e12 = 0.5; e6 = 0.0; }
  } else {
    if (Math.abs(slope) < PARAMS.SLOPE_FLAT) { phase = 'LATERAL'; e12 = 0.5; e6 = 0.5; }
    else                                     { phase = 'NORMAL';  e12 = 1.0; e6 = 0.0; }
  }
  const detail = `SPY $${last.toFixed(2)} | SMA200 ${s200 ? '$'+s200.toFixed(2) : 'n/a'}`
    + ` | pend200 ${(slope*100).toFixed(2)}% | vol30 ${vol30 ? (vol30*100).toFixed(0)+'%' : 'n/a'}`
    + (st.inPanic ? ` | PÁNICO(calm ${st.calmDays}/${PARAMS.REENTRY_DAYS})` : '');
  return { phase, exposure12: e12, exposure6: e6, detail, hysteresisState: st };
}

// ── RANKING DE MOMENTUM ────────────────────────────────
// barsBySym: { SYM: [{t,o,h,l,c,v}, ...] } barras DIARIAS por ticker.
// lookback: PARAMS.LOOKBACK_12 o LOOKBACK_6. Aplica filtro z>2 y MIN_PRICE.
// Devuelve array [{ sym, mom, z, vol, weight }] (TOP_N recortado, pesos según WEIGHTING).
function rankMomentum(barsBySym, lookback) {
  const scored = [];
  for (const sym in barsBySym) {
    const bars = barsBySym[sym];
    if (!bars || bars.length < lookback + 1) continue;
    const closes = bars.map(b => b.c);
    const n = closes.length;
    const last = closes[n - 1];
    if (last < PARAMS.MIN_PRICE) continue;
    const pSkip = closes[n - 1 - PARAMS.SKIP_DAYS];      // precio hace 21d
    const pLong = closes[n - 1 - lookback];              // precio hace lookback
    if (!pSkip || !pLong || pLong <= 0) continue;
    const mom = pSkip / pLong - 1;                        // momentum 12-1 (o 6-1)
    const z = zscore20(closes);
    const vol = tickerVol(closes, 20);
    scored.push({ sym, mom, z, vol });
  }
  scored.sort((a, b) => b.mom - a.mom);
  // filtro z>2: saltar sobre-extendidos al rellenar el TOP-N
  const sel = [];
  for (const c of scored) {
    if (c.z != null && c.z > PARAMS.Z_MAX) continue;
    sel.push(c);
    if (sel.length >= PARAMS.TOP_N) break;
  }
  if (!sel.length) return [];
  // ── PESOS ──
  if (PARAMS.WEIGHTING === 'HYBRID') {
    const mn = Math.min(...sel.map(c => c.mom));
    const momRaw = {}; let tm = 0;
    sel.forEach(c => { momRaw[c.sym] = (c.mom - mn) + 0.01; tm += momRaw[c.sym]; });
    const invRaw = {}; let tv = 0;
    sel.forEach(c => { const iv = (c.vol && c.vol > 0) ? 1 / c.vol : 0; invRaw[c.sym] = iv; tv += iv; });
    if (tv <= 0) tv = 1;
    let tot = 0; const out = {};
    sel.forEach(c => {
      out[c.sym] = PARAMS.HYB_MOM * (momRaw[c.sym] / tm) + PARAMS.HYB_INVVOL * (invRaw[c.sym] / tv);
      tot += out[c.sym];
    });
    sel.forEach(c => { c.weight = out[c.sym] / tot; });
  } else { // EQUAL
    const w = 1 / sel.length;
    sel.forEach(c => { c.weight = w; });
  }
  return sel;
}

// ── GESTIÓN DE STOP BE&TS (dinámico, llamado por el server cada día/posición) ──
// pos: { entry, maxPrice, stop, be } (el server persiste maxPrice/be entre llamadas).
// lastPrice: precio actual. Devuelve { newStop, shouldSell, reason }.
//   - Antes del +10%: stop fijo en -20% de la entrada (red idiosincrática).
//   - Al alcanzar +10% (peak): mueve stop a breakeven y luego trailing -15% del máximo.
//   - shouldSell=true si el precio perfora el stop vigente.
function manageStop(pos, lastPrice) {
  const entry = pos.entry;
  const maxPrice = Math.max(pos.maxPrice || entry, lastPrice);
  const peakGain = maxPrice / entry - 1;
  let newStop = pos.stop != null ? pos.stop : entry * (1 - PARAMS.STOP_CAT);
  let be = !!pos.be;

  if (peakGain >= PARAMS.BE_TRIGGER) {
    // breakeven (entrada) o trailing (máximo - TRAIL), el mayor de los dos
    const trail = maxPrice * (1 - PARAMS.TRAIL);
    const candidate = Math.max(entry, trail);
    if (candidate > newStop) newStop = candidate;   // el stop solo sube, nunca baja
    be = true;
  } else {
    // antes del trigger: red -20% de la entrada
    const cat = entry * (1 - PARAMS.STOP_CAT);
    if (newStop < cat) newStop = cat;
  }
  newStop = parseFloat(newStop.toFixed(2));
  const shouldSell = lastPrice <= newStop;
  return { newStop, maxPrice, be, shouldSell,
           reason: shouldSell ? (be ? 'BE&TS' : 'StopCat') : null };
}
// Combina fase + ranking en un plan que el server ejecuta.
// currentSyms: array de símbolos actualmente en cartera (sistema MOM).
// barsBySym: barras diarias de TODO el universo (incluye SPY).
// hysteresisState: estado persistido.
// Devuelve { phase, detail, targetSyms, toSell, toBuy, exposure12, exposure6,
//            ranking12, ranking6, hysteresisState }.
function buildRebalancePlan(barsBySym, currentSyms, hysteresisState) {
  const spy = barsBySym.SPY;
  const spyCloses = spy ? spy.map(b => b.c) : null;
  const ph = computePhase(spyCloses, hysteresisState);

  // universo sin SPY para rankear
  const universe = {};
  for (const s in barsBySym) if (s !== 'SPY') universe[s] = barsBySym[s];

  let targetSyms = [];
  let ranking12 = [], ranking6 = [];
  let targetWeights = {};   // { sym: peso } para sizing por HYBRID

  if (ph.phase === 'CRASH') {
    targetSyms = [];                                    // todo a cash
  } else {
    ranking12 = rankMomentum(universe, PARAMS.LOOKBACK_12);
    const top12 = ranking12.map(r => r.sym);
    if (ph.exposure6 > 0) {
      ranking6 = rankMomentum(universe, PARAMS.LOOKBACK_6);
      const top6 = ranking6.map(r => r.sym);
      // mitad cartera del 12-1, mitad del 6-1 (sin duplicar)
      const half = Math.round(PARAMS.TOP_N / 2);
      const set = [];
      for (let i = 0; i < half && i < top12.length; i++) set.push(top12[i]);
      for (let i = 0; i < top6.length && set.length < PARAMS.TOP_N; i++) {
        if (set.indexOf(top6[i]) === -1) set.push(top6[i]);
      }
      targetSyms = set;
      // pesos: combinar los dos rankings y renormalizar sobre los seleccionados
      const wmap = {};
      ranking12.forEach(r => { wmap[r.sym] = (wmap[r.sym] || 0) + r.weight * ph.exposure12; });
      ranking6.forEach(r => { wmap[r.sym] = (wmap[r.sym] || 0) + r.weight * ph.exposure6; });
      let tot = 0; set.forEach(s => { tot += (wmap[s] || 0); });
      if (tot <= 0) tot = 1;
      set.forEach(s => { targetWeights[s] = (wmap[s] || 0) / tot; });
    } else {
      targetSyms = top12;                               // NORMAL o GRIND: solo 12-1
      // pesos directos del ranking 12-1 (ya normalizados a 1)
      ranking12.forEach(r => { if (targetSyms.indexOf(r.sym) !== -1) targetWeights[r.sym] = r.weight; });
    }
  }

  const cur = currentSyms || [];
  const toSell = cur.filter(s => targetSyms.indexOf(s) === -1);
  const toBuy  = targetSyms.filter(s => cur.indexOf(s) === -1);

  return {
    phase: ph.phase, detail: ph.detail,
    exposure12: ph.exposure12, exposure6: ph.exposure6,
    targetSyms, targetWeights, toSell, toBuy,
    ranking12, ranking6,
    hysteresisState: ph.hysteresisState,
  };
}

module.exports = {
  PARAMS,
  computePhase,
  rankMomentum,
  buildRebalancePlan,
  manageStop,
  // expuestos para tests
  _sma: sma, _vol: annualizedVol, _z: zscore20,
};
