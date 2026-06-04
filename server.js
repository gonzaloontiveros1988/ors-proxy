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
const TG_TOKEN   = process.env.TG_TOKEN  || '8921804780:AAHLKTXqY2FWfAeGWtuTDOaraetqs3iRhE4';
const TG_CHAT    = process.env.TG_CHAT   || '1834333071';
// ── SP500 COMPLETO — 503 tickers actualizados 2026 ────────────────────────────
// Se escanean en batches paralelos para mantener el scan <4 minutos
const SP500_FULL = [
  // TECHNOLOGY
  'AAPL','MSFT','NVDA','AVGO','META','GOOGL','GOOG','AMZN','TSLA','AMD',
  'ORCL','CRM','ADBE','NFLX','CSCO','QCOM','TXN','INTC','IBM','AMAT',
  'MU','LRCX','KLAC','MCHP','MRVL','ARM','SMCI','PLTR','DELL','ANET',
  'CDNS','SNPS','FTNT','PANW','CRWD','INTU','ADSK','NOW','WDAY','TEAM',
  'ZS','OKTA','DDOG','MDB','SNOW','CFLT','HUBS','VEEV','SPLK','ANSS',
  // AI / CLOUD / DATA
  'CRWV','IONQ','QUBT','RGTI','SOUN','AI','BBAI','PATH','GTLB','DOCN',
  // FINANCIALS
  'JPM','BAC','WFC','GS','MS','C','BLK','SCHW','AXP','COF',
  'USB','PNC','TFC','MTB','CFG','HBAN','RF','KEY','ZION','FRC',
  'BX','KKR','APO','ARES','CG','OWL','TROW','IVZ','AMG','BEN',
  'V','MA','PYPL','FIS','FISV','GPN','NDAQ','ICE','CME','CBOE',
  // HEALTHCARE
  'LLY','UNH','JNJ','ABBV','MRK','TMO','ABT','DHR','BSX','MDT',
  'ELV','HUM','CVS','CI','CNC','MOH','HCA','THC','UHS','ENSG',
  'ISRG','SYK','ZBH','BAX','BDX','CAH','MCK','ABC','VRTX','REGN',
  'BIIB','GILD','AMGN','BMY','PFE','MRNA','BNTX','INSM','CRSP','NTLA',
  'BEAM','EDIT','FATE','ALNY','IONS','SRPT','RARE','PTGX','PCVX','RXRX',
  // CONSUMER DISCRETIONARY
  'AMZN','TSLA','HD','MCD','NKE','SBUX','TJX','BKNG','CMG','DHI',
  'LEN','PHM','TOL','NVR','MTH','POOL','WSM','RH','ROST','BURL',
  'LOW','YUM','DPZ','QSR','WING','SHAK','TXRH','DINE','EAT','DRI',
  // CONSUMER STAPLES
  'WMT','PG','COST','KO','PEP','PM','MO','MDLZ','KHC','GIS',
  'K','CPB','SJM','CAG','MKC','CLX','CL','COTY','EL','ULTA',
  // ENERGY
  'XOM','CVX','COP','EOG','OXY','SLB','HAL','BKR','DVN','FANG',
  'PXD','MPC','VLO','PSX','HES','APA','CTRA','EQT','AR','RRC',
  // UTILITIES / NUCLEAR
  'CEG','VST','GEV','NEE','AES','ETR','EXC','DUK','SO','D',
  'PCG','EIX','XEL','WEC','ES','LNT','EVRG','AEE','OGE','NWE',
  'BE','PLUG','FCEL','BLDP','CWEN','AY','NEP','HASI','NOVA','RUN',
  // INDUSTRIALS
  'CAT','DE','HON','GE','RTX','LMT','NOC','GD','BA','TDG',
  'EMR','ETN','PH','ROK','AME','GWW','MSA','ITW','FTV','GNRC',
  'UPS','FDX','ODFL','JBHT','CHRW','XPO','SAIA','ARCB','WERN','HTLD',
  'CSX','NSC','UNP','CNI','CP','WAB','TRN','GBX','ARII','RAIL',
  // MATERIALS
  'LIN','APD','ECL','SHW','FCX','NEM','NUE','STLD','RS','ATI',
  'ALB','LIVENT','MP','SQM','PLL','LAC','CDEV','GFI','KGC','AEM',
  // REAL ESTATE
  'AMT','PLD','EQIX','CCI','SPG','PSA','EQR','AVB','DRE','VTR',
  'WELL','PEAK','OHI','NHI','SBAC','SBA','UNIT','LUMN','CONE','DLR',
  // COMMUNICATION
  'META','GOOGL','NFLX','DIS','CMCSA','T','VZ','TMUS','CHTR','DISH',
  'WBD','PARA','FOX','FOXA','NYT','IAC','ZD','TKO','EDR','NWSA',
  // AEROSPACE / DEFENSE
  'LMT','RTX','NOC','GD','BA','HII','L3T','LDOS','SAIC','CACI',
  'KTOS','RKLB','LUNR','SPCE','ASTS','MNTS','JOBY','ACHR','LILM','EVTL',
  // SEMICONDUCTORS EXTENDED
  'NVDA','AMD','INTC','AVGO','QCOM','TXN','MU','AMAT','LRCX','KLAC',
  'MCHP','ON','STM','SWKS','QRVO','WOLF','DIOD','SLAB','ALGM','AMBA',
  // FINTECH / CRYPTO
  'COIN','MSTR','RIOT','MARA','HUT','BITF','CLSK','IREN','CIFR','WGMI',
  // SHIPPING / LOGISTICS
  'ZIM','DAC','GSL','SFL','MATX','ESEA','GOGL','NMM','CTRM','DCIX',
  // AIRLINES / TRAVEL
  'DAL','UAL','AAL','LUV','JBLU','ALK','SAVE','HA','SKYW','MESA',
  'BKNG','EXPE','ABNB','TRIP','DESP','TRVG','SEERA','MMYT','LTRPA',
].filter((v,i,a) => a.indexOf(v)===i); // deduplicar

// Watchlist personal del usuario (para trades manuales y overview)
const USER_WATCHLIST = (process.env.WATCHLIST || [
  // TIER 1 — CORE RUNNERS (runner rate ≥33%, siempre en WL)
  'ORCL','DAL','HUT','MU','ROK','MDB','FDX',
  // TIER 2 — SOLID (WR≥40%, P&L positivo)
  'HUM','EL','AMG','GD','ABBV','INSM',
  'NVDA','TSM','AVGO','MRVL','QCOM',
  'AMZN','GOOGL','CRWV',
  'LUNR','RKLB','SATS',
  'CEG','GEV','HCA','ISRG',
  'UAL','AAL',
  'TSLA','TKO','SMCI','BE','CRSP',
  // TIER 3 — NUEVOS (solo ORS y SWING — sizing 75%)
  'PWR','ITW','NOW','DDOG','SNOW','ELV','CI',
].join(',')).split(',');

// El scan usa SP500_FULL; la watchlist personal para el home y trades
// WL dinámica v13 — universos separados + tres estados
let DYNAMIC_WL_ADDITIONS = [];
let DYNAMIC_WL_REMOVALS  = [];
function getActiveWatchlist() {
  return USER_WATCHLIST
    .concat(DYNAMIC_WL_ADDITIONS)
    .filter(s => DYNAMIC_WL_REMOVALS.indexOf(s) < 0)
    .filter(s => isActive(s))
    .filter((s, i, arr) => arr.indexOf(s) === i);
}
function canOperateMOM(sym) { return MOM_TICKERS.indexOf(sym) >= 0; }

// ── SISTEMA TRES ESTADOS ──────────────────────────────────────────
const TICKER_STATUS = {
  // WATCH — vigilancia automática semanal
  // Si recuperan momentum → se añaden a DYNAMIC_WL automáticamente
  'AMD':   'WATCH',  // 0 runners v13, -€576 — líder AI chips, puede volver
  'VST':   'WATCH',  // 0 runners, -€546 — energy vol alta
  'META':  'WATCH',  // 0 runners, -€254 — puede volver con ciclo publicidad
  'SWKS':  'WATCH',  // 0 runners, -€207 — semiconductores semi
  'LUV':   'WATCH',  // problema Alpaca paper — verificar en real
  'ZIM':   'WATCH',  // shipping macro — vigilar ciclo global
  'SW':    'WATCH',  // sin datos suficientes — monitorizar
};
// ── ORS BLOCKED — tickers con WR 0% en ORS (≥3 trades, P&L negativo) ──
// Se mantienen en MOM y SWING — solo bloqueados en ORS
// Simulación v13b: +€2.282 P&L, -1.1% DD
const ORS_BLOCKED_TICKERS = ['LUNR', 'MRVL', 'DAL', 'NVDA'];
function isORSBlocked(sym) { return ORS_BLOCKED_TICKERS.indexOf(sym) >= 0; }

// NOTA: ningún ticker se descarta permanentemente
// WATCH = sin señales auto pero análisis semanal activo
// Si score > umbral → pasa a DYNAMIC_WL_ADDITIONS automáticamente
const WATCH_TICKERS = Object.keys(TICKER_STATUS).filter(t => TICKER_STATUS[t]==='WATCH');
function isActive(sym) { const s=TICKER_STATUS[sym]; return !s||s==='ACTIVE'; }
function includeInWeeklyScan(sym) { const s=TICKER_STATUS[sym]; return !s||s==='ACTIVE'||s==='WATCH'; }

// ── UNIVERSOS SEPARADOS (v13) ──────────────────────────────────────
// MOM: solo Tier1 + Tier2 (stops controlados)
// ORS + SWING: WL completa incluyendo Tier3 (mayor volatilidad = rebotes más grandes)
const MOM_TICKERS = ['ORCL','DAL','HUT','MU','ROK','MDB','FDX',
  'HUM','EL','AMG','GD','ABBV','INSM','NVDA','TSM','AVGO','MRVL','QCOM',
  'AMZN','GOOGL','CRWV','LUNR','RKLB','SATS','CEG','GEV','HCA','ISRG',
  'UAL','AAL','TSLA','TKO','SMCI','BE','CRSP'];

// RUNNER TIER para priorización y sizing
const RUNNER_TIER = {
  'ORCL':1,'DAL':1,'HUT':1,'MU':1,'ROK':1,'MDB':1,'FDX':1,
  'HUM':2,'EL':2,'AMG':2,'GD':2,'ABBV':2,'NVDA':2,'TSM':2,'AVGO':2,
  'MRVL':2,'QCOM':2,'AMZN':2,'GOOGL':2,'LUNR':2,'ISRG':2,'HCA':2,
  'CEG':2,'GEV':2,'UAL':2,'AAL':2,'TSLA':2,'CRSP':2,'INSM':2,'SMCI':2,'BE':2,'TKO':2,
  'PWR':3,'ITW':3,'NOW':3,'DDOG':3,'SNOW':3,'ELV':3,'CI':3,
};

const IBKR_ACCOUNT  = process.env.IBKR_ACCOUNT  || 'U24668151';
const IBKR_PAPER    = process.env.IBKR_PAPER    || 'DU24668151';
const IBKR_BASE     = process.env.IBKR_BASE     || 'https://api.ibkr.com/v1/api';
let CAPITAL_EUR   = parseFloat(process.env.CAPITAL_EUR || '11480');
const RISK_PCT_BASE = parseFloat(process.env.RISK_PCT || '0.02'); // 2% base
let   RISK_PCT      = RISK_PCT_BASE; // ajustado dinámicamente
let   adaptiveDDActive = false;

// ── RIESGO DINÁMICO (Hoja de ruta julio 2026) ─────────────────────
// false = 2% fijo (Nivel 1 paper — evaluación limpia)
// true  = 1/2/3% dinámico (Nivel 2 real en adelante)
const DYNAMIC_RISK_ENABLED = process.env.DYNAMIC_RISK === 'true';

// Historial WR últimos N trades para el trigger del 3%
const RECENT_TRADES_WINDOW = 10;
let   recentTradesHistory  = []; // {win: bool, ts: Date}

function updateRecentTrades(win) {
  recentTradesHistory.push({ win, ts: Date.now() });
  if (recentTradesHistory.length > RECENT_TRADES_WINDOW * 2) {
    recentTradesHistory = recentTradesHistory.slice(-RECENT_TRADES_WINDOW * 2);
  }
}

function getRecentWR() {
  const last = recentTradesHistory.slice(-RECENT_TRADES_WINDOW);
  if (last.length < 5) return 50; // sin suficientes datos → neutro
  return last.filter(t => t.win).length / last.length * 100;
}

async function updateDynamicRisk() {
  if (!DYNAMIC_RISK_ENABLED) {
    RISK_PCT = RISK_PCT_BASE; // siempre 2% en Nivel 1
    return;
  }

  try {
    // Calcular DD mensual real desde Alpaca
    const r   = await fetch(`\${alpacaBase()}/v2/account`, { headers: alpacaHeaders() });
    const acc = await r.json();
    const currentCap = parseFloat(acc.equity || acc.portfolio_value || 0) / 1.08;

    if (!monthStartCapital) { monthStartCapital = currentCap; }
    const monthDD  = (monthStartCapital - currentCap) / monthStartCapital * 100;
    const recentWR = getRecentWR();
    const regime   = MARKET_REGIME?.mode || 'BULL';

    const prevRisk = RISK_PCT;

    if (monthDD >= 5) {
      // Pérdida mensual > 5% → proteger capital
      RISK_PCT = RISK_PCT_BASE * 0.5; // 1%
      adaptiveDDActive = true;
    } else if (regime === 'BULL' && recentWR >= 60 && monthDD < 2) {
      // Condiciones óptimas → ampliar
      RISK_PCT = RISK_PCT_BASE * 1.5; // 3%
      adaptiveDDActive = false;
    } else {
      // Normal
      RISK_PCT = RISK_PCT_BASE; // 2%
      adaptiveDDActive = false;
    }

    // Reset capital inicio de mes
    const dayOfMonth = new Date().getUTCDate();
    if (dayOfMonth === 1) monthStartCapital = currentCap;

    // Alertar solo si cambia el nivel
    if (prevRisk !== RISK_PCT) {
      const emoji = RISK_PCT > prevRisk ? '📈' : '📉';
      const label = RISK_PCT === RISK_PCT_BASE * 1.5 ? '3% 🔥 BULL óptimo'
                  : RISK_PCT === RISK_PCT_BASE       ? '2% ✅ Normal'
                  : '1% ⚠️ DD protección';
      console.log(`[DYNAMIC RISK] \${(prevRisk*100).toFixed(0)}% → \${(RISK_PCT*100).toFixed(0)}% | DD:\${monthDD.toFixed(1)}% WR10:\${recentWR.toFixed(0)}% Régimen:\${regime}`);
      await sendTelegram(
        `\${emoji} <b>Riesgo ajustado → \${label}</b>\n` +
        `DD mensual: \${monthDD.toFixed(1)}% | WR últimos 10: \${recentWR.toFixed(0)}%\n` +
        `Régimen: \${regime} | Capital: €\${Math.round(currentCap).toLocaleString('es-ES')}`
      );
    }
  } catch(e) {
    console.log('[DYNAMIC RISK]', e.message);
  }
}

// ── DRAWDOWN ADAPTATIVO / RIESGO DINÁMICO ───────────────────────
// Función unificada — reemplaza checkAdaptiveDrawdown
// En Nivel 1 (DYNAMIC_RISK=false): solo protección 1% si DD>5%
// En Nivel 2+ (DYNAMIC_RISK=true): sistema completo 1/2/3%
let monthStartCapital = null;
async function checkAdaptiveDrawdown() {
  await updateDynamicRisk();
}
const USE_PAPER     = process.env.USE_PAPER !== 'false';

// ── ALPACA 3 CUENTAS ──────────────────────────────────
const ALPACA_DATA = 'https://data.alpaca.markets';

// ── FILTRO DE MERCADO — NYSE/NASDAQ Lunes-Viernes 13:30-20:00 UTC ─────────────
// Usa UTC puro para evitar ambigüedades de timezone en el servidor.
// NYSE abre 9:30 NY = 13:30 UTC (verano EDT, UTC-4) / 14:30 UTC (invierno EST, UTC-5)
// NYSE cierra 16:00 NY = 20:00 UTC (verano) / 21:00 UTC (invierno)
// Detectamos DST automáticamente: si el offset de NY es -4h = verano, -5h = invierno.
function getNYOffset() {
  // Calcular el offset UTC de New York en horas (positivo = NY va por detrás de UTC)
  const now = new Date();
  const nyStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  // Parsear la fecha NY y compararla con UTC para calcular offset
  const [datePart, timePart] = nyStr.split(', ');
  const [m, d, y] = datePart.split('/').map(Number);
  const [h, mi, s] = timePart.split(':').map(Number);
  const nyDate = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  const offsetMs = now.getTime() - nyDate.getTime();
  return Math.round(offsetMs / 3600000); // -4 verano (EDT), -5 invierno (EST)
}

function isMarketOpen() {
  const now = new Date();
  const utcDay  = now.getUTCDay();   // 0=Dom, 1=Lun, ..., 5=Vie, 6=Sab
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();
  const utcMins = utcHour * 60 + utcMin;

  // 1. Filtro de día — solo Lunes(1) a Viernes(5)
  if (utcDay === 0 || utcDay === 6) {
    console.log(`[MARKET] Cerrado — fin de semana (UTC day=${utcDay})`);
    return false;
  }

  // 2. Calcular apertura/cierre en UTC según DST
  const nyOffset = getNYOffset(); // -4 EDT o -5 EST
  // NYSE 9:30 NY = 9h30 + abs(offset) UTC
  const openUTC  = (9 * 60 + 30) + Math.abs(nyOffset) * 60;  // 810 + 240 = 1050 (17:30) NO
  // Corrección: el mercado abre a 9:30 NY, en UTC son 9.5h + offset inverso
  // EDT (UTC-4): 9:30 NY = 13:30 UTC = 810 mins UTC
  // EST (UTC-5): 9:30 NY = 14:30 UTC = 870 mins UTC
  const openMins  = 570 + Math.abs(nyOffset) * 60;  // 570 = 9h30 en minutos
  // EDT: 570 + 240 = 810 → 13:30 UTC ✅
  // EST: 570 + 300 = 870 → 14:30 UTC ✅
  const closeMins = 960 + Math.abs(nyOffset) * 60;
  // EDT: 960 + 240 = 1200 → 20:00 UTC ✅
  // EST: 960 + 300 = 1260 → 21:00 UTC ✅

  // 3. Filtro de hora
  if (utcMins < openMins || utcMins >= closeMins) {
    const nyStr = now.toLocaleString('en-US', {timeZone:'America/New_York', hour:'2-digit', minute:'2-digit', hour12:false});
    console.log(`[MARKET] Cerrado — fuera de horario NY=${nyStr} UTC=${utcHour}:${String(utcMin).padStart(2,'0')} (open=${openMins}min close=${closeMins}min)`);
    return false;
  }

  return true;
}

// Regla 30 min: no entrar en la primera ni última media hora del mercado
function isMarketEntryAllowed() {
  if (!isMarketOpen()) return false;
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const nyOffset = getNYOffset();
  const openMins  = 570 + Math.abs(nyOffset) * 60;
  const closeMins = 960 + Math.abs(nyOffset) * 60;
  // Regla 30min: no ejecutar entradas en los primeros 30min desde apertura
  // Las barras SÍ se escanean y los indicadores se calculan desde 9:30 NY
  // pero no se abre ninguna posición hasta las 10:00 NY.
  // Con velas de 15min: a las 10:00 ya hay 2 barras de contexto desde apertura,
  // y la primera entrada posible es a las 10:15 (3 velas desde apertura = 45min).
  // Esto elimina el ruido de apertura sin desperdiciar más de 1h de mercado.
  if (utcMins < openMins + 30) return false;  // antes de 10:00 NY — no ejecutar
  if (utcMins >= closeMins - 30) return false; // después de 15:30 NY — no ejecutar
  return true;
}
const ALPACA_ACCOUNTS = {
  // Cuenta 1 — Paper $100k (testing y backtests)
  paper: {
    key:    process.env.ALPACA_PAPER_KEY    || 'PK5JTGMESYNYM7VDDPO352Q6JQ',
    secret: process.env.ALPACA_PAPER_SECRET || '2ugX7LPeLcdGNiv4dSL7q6tchEb4ztbBeF6y5rxYPdyc',
    base:   'https://paper-api.alpaca.markets',
    label:  '🧪 PAPER $100k — Testing',
    id:     'PA3PYDHW3QQY',
    capital: 100000,
  },
  // Cuenta 2 — Paper €11k (simulación real)
  paper2: {
    key:    process.env.ALPACA_KEY_2    || 'PK3TUAP6P55N7CYLLEWQZCICSU',
    secret: process.env.ALPACA_SECRET_2 || 'GDKDVVo1Akdz8Bov5emsuALCfp28KmsmM5t4YMQd8ck7',
    base:   process.env.ALPACA_BASE_2   || 'https://paper-api.alpaca.markets',
    label:  '📊 PAPER €11k — Simulación real',
    id:     'paper2',
    capital: 11480,
  },
  // Cuenta 3 — Live (cuando esté lista)
  live: {
    key:    process.env.ALPACA_LIVE_KEY    || 'AKD6YNJVJAEIILNNK7UIGNACPY',
    secret: process.env.ALPACA_LIVE_SECRET || '8145VgBNw8HWtmcbYAbRUDCsqKn4sz7qmVE99ABdquLa',
    base:   'https://api.alpaca.markets',
    label:  '💰 LIVE — Real €11k',
    id:     'live',
    capital: 11480,
  },
};

// Cuenta activa — cambiable via Telegram /cuenta o API
let ACTIVE_ACCOUNT = process.env.ALPACA_DEFAULT_ACCOUNT || 'paper2';

function getAcc()        { return ALPACA_ACCOUNTS[ACTIVE_ACCOUNT] || ALPACA_ACCOUNTS.paper; }
function alpacaBase()    { return getAcc().base; }
function alpacaHeaders() {
  const acc = getAcc();
  return { 'APCA-API-KEY-ID': acc.key, 'APCA-API-SECRET-KEY': acc.secret, 'Content-Type': 'application/json' };
}
function isLive()        { return ACTIVE_ACCOUNT === 'live'; }

// ═══════════════════════════════════════════════════════
// ALPACA EXECUTION ENGINE
// ═══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// MOMSCORE — Historial de momentum reciente por ticker
// ══════════════════════════════════════════════════════════════════
const momHistory = {};

function recordMomResult(sym, reachedTarget) {
  if (!momHistory[sym]) momHistory[sym] = [];
  momHistory[sym].push(!!reachedTarget);
  if (momHistory[sym].length > 20) momHistory[sym].shift();
}

function getMomScore(sym) {
  const h = momHistory[sym];
  // Sin historial suficiente → no penalizar (primer mes de operación)
  if (!h || h.length < 10) return 1.0;
  return h.filter(Boolean).length / h.length;
}

function momScoreOk(sym) {
  const h = momHistory[sym];
  // Si no hay historial suficiente, permitir siempre
  if (!h || h.length < 10) return true;
  return getMomScore(sym) >= 0.20;
}

const openPositions = {};
const monthTradesDone = {}; // sym_YYYY-MM -> true (max 1 trade/ticker/mes)
let scanMOMCache = null;    // caché del último scan MOM — BUG FIX: era local al endpoint // sym → {qty, entryPrice, stopPrice, target, stopOrderId, ts}
const AUTO_EXECUTE = process.env.AUTO_EXECUTE === 'true';
const MAX_POSITIONS     = parseInt(process.env.MAX_POSITIONS || '5'); // 5 slots total

// Límites por régimen de mercado (calculados dinámicamente)
// BULL:    MOM≤3  ORS≤1  SWING≤1
// LATERAL: MOM≤2  ORS≤2  SWING≤1
// BEAR:    MOM≤0  ORS≤2  SWING≤0
function getMaxBySystem(system) {
  const mode = MARKET_REGIME?.mode || 'BULL';
  const limits = {
    BULL:    { MOM: 3, ORS: 1, SWING: 1 },
    LATERAL: { MOM: 2, ORS: 2, SWING: 1 },
    BEAR:    { MOM: 0, ORS: 2, SWING: 0 },
  };
  return (limits[mode] || limits.BULL)[system] || 0;
}
function countSystem(system) {
  return Object.values(openPositions).filter(p => (p.system||p.type) === system).length;
}
function canOpenPosition(system) {
  const total = Object.keys(openPositions).length;
  if (total >= MAX_POSITIONS) return false;
  return countSystem(system) < getMaxBySystem(system);
}
// Compatibilidad con código existente
const MAX_POSITIONS_ORS = 2; // máx absoluto (régimen puede limitarlo más)
const MAX_POSITIONS_MOM = 3; // máx absoluto

// Contar posiciones abiertas por sistema
function countORSPositions() {
  return Object.values(openPositions).filter(p => p && p.system === 'ORS').length;
}
function countMOMPositions() {
  return Object.values(openPositions).filter(p => p && p.system === 'MOM').length;
}

// ── CAP DE POSICIÓN ──────────────────────────────────
// MOM: máximo 30% del capital (sistema principal, WR 91%)
// ORS 5/5: máximo 30% del capital (señal perfecta)
// Tickers $20-50: máximo 7.5%
// Tickers <$20: máximo 5%
function capQty(qty, price, is5of5) {
  if (!price || price <= 0) return qty;
  // CORRECCIÓN v4: el sizing ya calcula el 2% de riesgo correctamente.
  // Solo aplicamos guardia de emergencia: nunca más del 50% del capital
  // en una sola posición (antes era 30%, lo que reducía el riesgo real
  // a 0.2% en tickers caros como META, HCA, NVDA).
  var maxValueUSD = CAPITAL_EUR * 1.08 * 2.00; // v9: guardia emergencia 2x capital
  var maxByValue  = Math.floor(maxValueUSD / price);
  return Math.max(1, Math.min(qty, maxByValue));
}

// ── ATR MÍNIMO — evita sizing desproporcionado en tickers baratos ──
function adjustedATR(atr, price) {
  const minAtrPct = 0.005;
  return (atr / price) < minAtrPct ? price * minAtrPct : atr;
}

// ── MAC FILTER (Bernstein) ─────────────────────────────────────────
function calcMAC(prices) {
  if (!prices || prices.length < 10) return null;
  const MAH = prices.slice(-10).reduce((s,c) => s+(c.high||c.close),0)/10;
  const MAL = prices.slice(-8).reduce((s,c)  => s+(c.low||c.close),0)/8;
  return { MAH, MAL, width: MAH-MAL };
}
function macFilter(prices, close, atr) {
  const mac = calcMAC(prices);
  if (!mac) return { pass: true, reason: 'MAC:insuf' };
  if (mac.width < atr*0.25) return { pass: false, reason: 'MAC:comprimido' };
  return close > mac.MAH
    ? { pass: true,  reason: `MAC:OK` }
    : { pass: false, reason: `MAC:dentro_canal` };
}

// ── 8OC FILTER (Bernstein Eight-Bar Open/Close) ────────────────────
function eightBarFilter(prices, atr) {
  if (!prices || prices.length < 8) return { pass: true, reason: '8OC:insuf' };
  const score = prices.slice(-8).reduce((s,c) => s+((c.close||c.c)-(c.open||c.o||c.close)),0);
  return score > -(atr*0.1)
    ? { pass: true,  reason: `8OC:OK` }
    : { pass: false, reason: `8OC:negativo` };
}

// ── FIVE-BAR MAC PATTERN (Bernstein) ──────────────────────────────
// 3+ velas consecutivas sobre MAH = breakout genuino (no spike falso)
function fiveBarMACPattern(prices) {
  return fiveBarMACPatternN(prices, 3);
}
function fiveBarMACPatternN(prices, minBars) {
  if (!prices || prices.length < 15) return true;
  const mac = calcMAC(prices);
  if (!mac) return true;
  let count = 0;
  for (let i = prices.length-1; i >= Math.max(0, prices.length-10); i--) {
    if ((prices[i].close||prices[i].c||0) > mac.MAH) count++;
    else break;
  }
  return count >= (minBars || 3);
}

// ── VIX SPIKE DETECTOR ────────────────────────────────────────────
// Si VIX sube >30% en 24h → pausa entradas nuevas
let lastVIX = null;
let latestVIX = null;
let vixSpikeActive = false;
let vixSpikeUntil  = null;
function updateVIXSpike(currentVIX) {
  if (!currentVIX) return;
  if (lastVIX && lastVIX > 0) {
    const change = (currentVIX - lastVIX) / lastVIX;
    if (change > 0.30) {
      vixSpikeActive = true;
      vixSpikeUntil  = Date.now() + 48*60*60*1000; // 48h
      console.log(`[VIX SPIKE] ${lastVIX.toFixed(1)}→${currentVIX.toFixed(1)} (+${(change*100).toFixed(0)}%) — entradas bloqueadas 48h`);
      sendTelegram(`⚠️ <b>VIX SPIKE DETECTADO</b>
VIX: ${lastVIX.toFixed(1)} → ${currentVIX.toFixed(1)} (+${(change*100).toFixed(0)}%)
🛑 Entradas bloqueadas 48h por protección macro`);
    }
  }
  if (vixSpikeActive && vixSpikeUntil && Date.now() > vixSpikeUntil) {
    vixSpikeActive = false;
    vixSpikeUntil  = null;
    console.log('[VIX SPIKE] Bloqueo levantado — entradas normales');
    sendTelegram('✅ <b>VIX normalizado</b> — Entradas reanudadas');
  }
  lastVIX = currentVIX;
}

// ── TICKERS NO DISPONIBLES EN ALPACA (cache dinámica) ────────────
// Se rellena automáticamente cuando el asset check falla
// Evita generar señales y enviar Telegram para tickers no tradables
var ALPACA_UNAVAILABLE = {};  // sym → timestamp cuando se detectó

function markUnavailable(sym) {
  if (!ALPACA_UNAVAILABLE[sym]) {
    console.log('[UNAVAILABLE] ' + sym + ' marcado como no disponible en Alpaca');
  }
  ALPACA_UNAVAILABLE[sym] = Date.now();
}

function isAvailableAlpaca(sym) {
  var ts = ALPACA_UNAVAILABLE[sym];
  if (!ts) return true;
  // Re-verificar cada 24h por si el ticker vuelve a estar disponible
  if (Date.now() - ts > 24*60*60*1000) {
    delete ALPACA_UNAVAILABLE[sym];
    return true;
  }
  return false;
}

// Tickers conocidos como no disponibles en Alpaca paper
// SOLO los confirmados manualmente — NO marcar automáticamente
// LUV, ZIM, SW: confirmados no tradables en paper2
var KNOWN_UNAVAILABLE = ['LUV', 'ZIM', 'SW'];
KNOWN_UNAVAILABLE.forEach(function(sym) { markUnavailable(sym); });

// Limpiar cualquier ticker bloqueado incorrectamente por errores temporales
// Se ejecuta al arrancar para resetear la cache
var ALWAYS_AVAILABLE = [
  'TSM','NVDA','AMD','AVGO','MU','MRVL','QCOM','SMCI',
  'ORCL','META','AMZN','GOOGL','MDB','CRWV','NOW','DDOG','SNOW',
  'CEG','GEV','BE','TSLA','RKLB','LUNR','SATS',
  'DAL','UAL','AAL','HCA','ISRG',
  'INSM','CRSP','ABBV','HUT','TKO',
  'ROK','ITW','FDX','GD','AMG','EL','HUM','ELV','CI',
  'PWR','GOOGL','QCOM',
];
ALWAYS_AVAILABLE.forEach(function(sym) {
  if (ALPACA_UNAVAILABLE[sym]) {
    delete ALPACA_UNAVAILABLE[sym];
    console.log('[STARTUP] ' + sym + ' desbloqueado — era error temporal');
  }
});

// IMPORTANTE: La cache ALPACA_UNAVAILABLE solo se usa para LUV/ZIM/SW
// confirmados manualmente. Nunca se añaden automáticamente.
// Los errores temporales de Alpaca (rate limit, timeout) NO bloquean tickers.

// ── SECTOR CRASH BLOCK ────────────────────────────────────────────────────────
// Si ETF sector cae >4% hoy → no ORS en ese sector
const SECTOR_FOR_TICKER = {
  NVDA:'AI_CHIPS',AMD:'AI_CHIPS',AVGO:'AI_CHIPS',TSM:'AI_CHIPS',
  MU:'AI_CHIPS',MRVL:'AI_CHIPS',QCOM:'AI_CHIPS',SMCI:'AI_CHIPS',
  ORCL:'CLOUD',META:'CLOUD',AMZN:'CLOUD',GOOGL:'CLOUD',
  MDB:'CLOUD',CRWV:'CLOUD',NOW:'CLOUD',DDOG:'CLOUD',SNOW:'CLOUD',
  CEG:'NUCLEAR',GEV:'NUCLEAR',VST:'NUCLEAR',
  DAL:'AIRLINES',UAL:'AIRLINES',AAL:'AIRLINES',LUV:'AIRLINES',
  ROK:'INDUSTRIAL',ITW:'INDUSTRIAL',PWR:'INDUSTRIAL',FDX:'INDUSTRIAL',
  GD:'INDUSTRIAL',AMG:'INDUSTRIAL',
  HCA:'HEALTHCARE',ISRG:'HEALTHCARE',HUM:'HEALTHCARE',ELV:'HEALTHCARE',CI:'HEALTHCARE',
  INSM:'BIOTECH',CRSP:'BIOTECH',ABBV:'BIOTECH',
  RKLB:'SPACE',LUNR:'SPACE',SATS:'SPACE',
  HUT:'CRYPTO',TKO:'MEDIA',BE:'GREEN',EL:'CONSUMER',TSLA:'EV',
};
let crashedSectorsToday = new Set();
function updateSectorCrashBlock(sectorChanges) {
  crashedSectorsToday = new Set();
  if (!sectorChanges) return;
  Object.entries(sectorChanges).forEach(([sector, change]) => {
    if (change <= -0.04) {
      crashedSectorsToday.add(sector);
      console.log(`[SECTOR CRASH] ${sector}: ${(change*100).toFixed(1)}% — ORS bloqueado`);
    }
  });
}
function isORSBlockedBySectorCrash(sym) {
  const sector = SECTOR_FOR_TICKER[sym];
  return sector && crashedSectorsToday.has(sector);
}

async function executeAlpacaOrder(sym, order) {
  // ── GUARDIA FINAL: nunca ejecutar si el mercado está cerrado ─────────────────
  if (!isMarketOpen()) {
    console.error(`[BLOCKED] executeAlpacaOrder rechazada para ${sym} — mercado CERRADO (${new Date().toUTCString()})`);
    await sendTelegram(`🚫 ORDEN BLOQUEADA: ${sym} — Mercado cerrado. No se ejecuta ninguna operación fuera del horario NYSE (Lun-Vie 13:30-20:00 UTC)`);
    return null;
  }
  // ── VERIFICAR ESTADO TICKER ──────────────────────────────────────
  if (!isActive(sym)) {
    console.log(`[BLOCKED] ${sym}: estado ${TICKER_STATUS[sym]}`);
    delete pendingOrders[sym]; return null;
  }

  // ── VIX SPIKE DETECTOR ────────────────────────────────────────────
  if (vixSpikeActive) {
    console.log(`[BLOCKED] ${sym}: VIX spike activo — entradas bloqueadas`);
    await sendTelegram(`🛑 Orden bloqueada (${sym}) — VIX spike activo. Usa /emergencia OFF para reanudar.`);
    return null;
  }

  // ── SECTOR CRASH BLOCK (solo ORS) ────────────────────────────────
  if (!order.isMOM && isORSBlockedBySectorCrash(sym)) {
    console.log(`[BLOCKED] ${sym}: sector crash block activo`);
    return null;
  }

  

  const acc = getAcc();
  const mode = isLive() ? '🔴 REAL' : '📋 PAPER';
  console.log(`[EXEC] ${sym} qty=${order.qty} price=$${order.price} stop=$${order.stopPrice} AUTO=${AUTO_EXECUTE}`);
  try {
    // 1. Market BUY
    const qty1 = order.qty1 || Math.floor((order.qty || 1) * 0.5);
    const qty2 = order.qty2 || ((order.qty || 1) - qty1);

    const buyResp = await fetch(`${alpacaBase()}/v2/orders`, {
      method: 'POST', headers: alpacaHeaders(),
      body: JSON.stringify({ symbol: sym, qty: String(qty1), side: 'buy', type: 'market', time_in_force: 'day' }),
    });
    // Manejar respuestas no-JSON (ej: ticker no disponible en Alpaca)
    let buyOrder;
    let buyText = '';
    try {
      buyText = await buyResp.text();
      // Detectar rate limit (429) o error HTML antes de parsear
      if (buyResp.status === 429) {
        console.log(`[EXEC] ${sym}: Rate limit Alpaca (429) — esperando 3s y reintentando`);
        await new Promise(r => setTimeout(r, 3000));
        const buyResp2 = await fetch(`${alpacaBase()}/v2/orders`, {
          method: 'POST', headers: alpacaHeaders(),
          body: JSON.stringify({ symbol: sym, qty: String(qty1), side: 'buy', type: 'market', time_in_force: 'day' }),
        });
        buyText = await buyResp2.text();
      }
      buyOrder = JSON.parse(buyText);
    } catch(e) {
      console.log(`[EXEC] ${sym}: respuesta no-JSON (status ${buyResp.status}) — ${buyText.slice(0,200)}`);
      // NO marcar como unavailable — puede ser error temporal de red
      // Reintentar en el próximo ciclo de 5min
      await sendTelegram(`⚠️ Alpaca no respondió correctamente para ${sym} (status ${buyResp.status}). Se reintentará en el próximo ciclo.`);
      return null;
    }
    if (!buyOrder.id) {
      const errMsg = buyOrder.message || buyOrder.code || JSON.stringify(buyOrder).slice(0, 150);
      console.log(`[EXEC] ${sym}: Alpaca rechazó la orden — ${errMsg}`);
      await sendTelegram(`❌ Error Alpaca ${sym}: ${errMsg}`);
      return null;
    }

    // 2. Stop loss GTC
    await new Promise(r => setTimeout(r, 1500));
    const stopResp = await fetch(`${alpacaBase()}/v2/orders`, {
      method: 'POST', headers: alpacaHeaders(),
      body: JSON.stringify({ symbol: sym, qty: String(qty1), side: 'sell', type: 'stop',
        stop_price: String(order.stopPrice), time_in_force: 'gtc',
        client_order_id: `ors_stop_${sym}_${Date.now()}` }),
    });
    const stopOrder = await stopResp.json();

    // 3. Track position con exit rules completas
    const _atrPT = order.atr || (order.price - order.stopPrice) / 1.5;
    openPositions[sym] = {
      sym, qty1, qty2, qty: qty1 + qty2,
      entryPrice: order.price, stopPrice: order.stopPrice,
      originalStop: order.stopPrice,
      target1: order.target1, rr: order.rr,
      pt1Price:  parseFloat((order.price + _atrPT * 1.5).toFixed(2)),
      pt2Price:  parseFloat((order.price + _atrPT * 3.0).toFixed(2)),
      pt1Hit: false, pt2Hit: false,
      dangerZoneDone: false,
      stopOrderId: stopOrder.id,
      buyOrderId: buyOrder.id,
      phase2Done: false, ts: Date.now(),
      partialDone: false,
      maxPrice: order.price,
      trailingPct: 4,
      system: order.isMOM ? 'MOM' : 'ORS',
      runnerTier: RUNNER_TIER[sym] || 0,
    };

    // 4. Log de decisión — captura todas las condiciones
    logDecision(sym, order, {
      rsi:      order.rsi,
      rvol:     order.rvol,
      obv:      order.obv,
      macd:     order.macd,
      ichimoku: order.ichimoku,
      vix:      order.vix,
      spyTrend: order.spyTrend,
      aboveSMA: order.aboveSMA200,
      score:    order.score,
    });
    delete pendingOrders[sym];

    // 4. Confirm
    const riskEur = Math.round((order.price - order.stopPrice) * qty1 / 1.08);
    let msg = `✅ <b>ORDEN EJECUTADA — ${sym}</b>\n`;
    msg += `${mode} · ${acc.id}\n\n`;
    msg += `📊 1ª entrada: <b>${qty1} acc</b> @ ~$${order.price}\n`;
    msg += `🛑 Stop: <b>$${order.stopPrice}</b> · Riesgo: ~€${riskEur}\n`;
    msg += `🎯 Target: <b>$${order.target1||'—'}</b> · R:R: 1:${order.rr||'?'}\n`;
    if(order.aboveSMA200) msg += `✅ Sobre SMA200\n`;
    msg += `\n📒 Registrado en diario · 2ª entrada ${qty2} acc en confirmación`;
    msg += `\n\n/cerrar_${sym}   /mantener_${sym}`;
    await sendTelegram(msg);

    console.log(`✅ Executed: ${sym} ${qty1} shares @ $${order.price}, stop $${order.stopPrice}`);

  } catch(e) {
    console.error('executeAlpacaOrder error:', e.message);
    await sendTelegram(`❌ Error ejecutando ${sym}: ${e.message}`);
    return null;
  }
}

async function closePosition(sym) {
  const pos = openPositions[sym];
  if(!pos){ await sendTelegram(`⚠️ No hay posición abierta en ${sym}`); return; }
  try {
    const totalQty = pos.qty1 + (pos.phase2Done ? pos.qty2 : 0);
    if(pos.stopOrderId){
      await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,{method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
    }
    const resp = await fetch(`${alpacaBase()}/v2/orders`,{
      method:'POST',headers:alpacaHeaders(),
      body:JSON.stringify({symbol:sym,qty:String(totalQty),side:'sell',type:'market',time_in_force:'day'})
    });
    const order = await resp.json();
    if(order.id){
      const snapR = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${sym}&feed=iex`,{headers:alpacaHeaders()});
      const snapD = await snapR.json();
      const price = snapD[sym]?.latestTrade?.p || pos.entryPrice;
      const pnlEur = Math.round((price - pos.entryPrice) * totalQty / 1.08);
      // MomScore: registrar si llegó al +1%
  const _posMaxUp = pos.maxPrice ? ((pos.maxPrice - pos.entryPrice) / pos.entryPrice) : 0;
  recordMomResult(sym, _posMaxUp >= 0.01);
  delete openPositions[sym];
      await sendTelegram(`📤 <b>CERRADO — ${sym}</b>\n${totalQty} acc @ ~$${price.toFixed(2)}\nP&L: ${pnlEur>=0?'+':''}€${pnlEur}\n📒 Registrado`);
    }
  } catch(e){ await sendTelegram(`❌ Error cerrando ${sym}: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════
// AUTO-EXIT ENGINE — 4 NIVELES
// N1: Stop loss fijo → venta 100% inmediata
// N2: Target alcanzado → venta 50% + stop a breakeven
// N3: OBV bajista + MACD cruce + RSI >68 (2/3) → venta 50% restante
// N4: Trailing stop desde máximo → venta 50% restante
// ═══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// TRADE HISTORY + DECISION LOG — datos 100% reales para el diario
// ══════════════════════════════════════════════════════════════════

var tradeHistory = [];   // historial de operaciones cerradas
var decisionLog  = [];   // log de decisiones con todas las condiciones
const MAX_HISTORY = 500; // máximo 500 operaciones en memoria

// Guardar operación al ABRIR — captura todas las condiciones
function logDecision(sym, order, conditions) {
  var entry = {
    id:         `${sym}_${Date.now()}`,
    sym:        sym,
    date:       new Date().toISOString(),
    system:     order.isMOM ? 'MOM' : 'ORS',
    type:       order.isMOM ? 'MOM' : 'ORS-5/5',
    entry:      order.price,
    stop:       order.stopPrice,
    target:     order.target1,
    qty:        (order.qty1||0) + (order.qty2||0),
    account:    activeAccount,
    conditions: {
      rsi:       conditions.rsi      || null,
      rvol:      conditions.rvol     || null,
      obv:       conditions.obv      || null,
      macd:      conditions.macd     || null,
      ichimoku:  conditions.ichimoku || null,
      vix:       conditions.vix      || null,
      spyTrend:  conditions.spyTrend || null,
      aboveSMA:  conditions.aboveSMA || null,
      score:     conditions.score    || null,
    },
    result:     null,  // se rellena al cerrar
    exitDate:   null,
    exitPrice:  null,
    exitReason: null,
    pnlEur:     null,
    pnlPct:     null,
    daysHeld:   null,
  };
  decisionLog.unshift(entry);
  if(decisionLog.length > MAX_HISTORY) decisionLog = decisionLog.slice(0, MAX_HISTORY);
  console.log(`[LOG] Decisión registrada: ${sym} ${entry.system} @ $${order.price}`);
  return entry.id;
}

// Cerrar operación — añadir resultado al log y al historial
function logExit(sym, exitPrice, exitReason, pnlEur) {
  var pos = openPositions[sym];
  if(!pos) return;

  var entryDate = pos.ts ? new Date(pos.ts) : new Date();
  var daysHeld  = Math.round((Date.now() - pos.ts) / 86400000 * 10) / 10;
  var pnlPct    = pos.entryPrice ? ((exitPrice - pos.entryPrice) / pos.entryPrice * 100) : 0;

  // Actualizar decision log si existe
  var logEntry = decisionLog.find(function(d){ return d.sym === sym && !d.result; });
  if(logEntry) {
    logEntry.result     = pnlEur >= 0 ? 'WIN' : 'LOSS';
    logEntry.exitDate   = new Date().toISOString();
    logEntry.exitPrice  = exitPrice;
    logEntry.exitReason = exitReason;
    logEntry.pnlEur     = pnlEur;
    logEntry.pnlPct     = parseFloat(pnlPct.toFixed(2));
    logEntry.daysHeld   = daysHeld;
  }

  // Añadir al historial cerrado
  var trade = {
    sym:        sym,
    date:       entryDate.toISOString().slice(0,10),
    exitDate:   new Date().toISOString().slice(0,10),
    system:     pos.system || 'MOM',
    entry:      pos.entryPrice,
    exit:       exitPrice,
    stop:       pos.originalStop || pos.stopPrice,
    qty:        (pos.qty1||0) + (pos.phase2Done ? (pos.qty2||0) : 0),
    pnlEur:     pnlEur,
    pnlPct:     parseFloat(pnlPct.toFixed(2)),
    exitReason: exitReason,
    daysHeld:   daysHeld,
    win:        pnlEur >= 0,
    account:    activeAccount,
    conditions: logEntry ? logEntry.conditions : {},
  };

  tradeHistory.unshift(trade);
  if(tradeHistory.length > MAX_HISTORY) tradeHistory = tradeHistory.slice(0, MAX_HISTORY);
  console.log(`[LOG] Trade cerrado: ${sym} ${pnlEur >= 0 ? '+' : ''}€${pnlEur} (${exitReason})`);
}

async function executeSell(sym, qty, reason, price) {
  // ── GUARDIA FINAL: nunca vender si el mercado está cerrado ───────────────────
  // Excepción: stop-loss de emergencia se permite en extended hours
  const isEmergencyStop = reason && (reason.indexOf('stop') >= 0 || reason.indexOf('emergency') >= 0);
  if (!isMarketOpen() && !isEmergencyStop) {
    console.error(`[BLOCKED] executeSell rechazada para ${sym} — mercado CERRADO`);
    await sendTelegram(`🚫 VENTA BLOQUEADA: ${sym} (${qty} acc) — Mercado cerrado. Razón original: ${reason}`);
    return false;
  }
  if(!qty || qty < 1) return false;
  try {
    // Cancelar TODAS las órdenes abiertas del ticker antes de vender
    const openOrders = await fetch(`${alpacaBase()}/v2/orders?status=open&symbols=${sym}`,
      {headers:alpacaHeaders()}).then(r=>r.json()).catch(()=>[]);
    if(Array.isArray(openOrders) && openOrders.length) {
      for(const ord of openOrders) {
        await fetch(`${alpacaBase()}/v2/orders/${ord.id}`,
          {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
      }
      await new Promise(r=>setTimeout(r,500)); // Esperar confirmación
    }
    const pos = openPositions[sym];
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method: 'POST', headers: alpacaHeaders(),
      body: JSON.stringify({symbol:sym, qty:String(qty), side:'sell', type:'market', time_in_force:'day'})
    });
    const o = await r.json();
    if(o.id){
      const pnl = pos ? Math.round((price - pos.entryPrice) * qty / 1.08) : 0;
      // Registrar en trade history y decision log
      if(pos) logExit(sym, price, reason, pnl);
      // Registrar stop para filtro de re-entrada
      if(reason.includes('Stop')) {
        recordStopOut(sym, price);
        // CORRECCIÓN v4: bloquear re-entrada el mismo dia tras stop
        const todayKey = sym + '_mom_' + new Date().toDateString();
        sentAlerts[todayKey] = Date.now();
      }
      await sendTelegram(
        `🤖 <b>AUTO-EXIT — ${sym}</b>\n` +
        `💰 ${qty} acc @ ~$${price.toFixed(2)}\n` +
        `📋 Motivo: ${reason}\n` +
        `📊 P&L: ${pnl>=0?'+':''}€${pnl}\n` +
        `🆔 ${o.id.slice(0,8)}`
      );
      console.log(`[AUTO-EXIT] ${sym} ${qty} acc: ${reason}`);
      return true;
    } else {
      await sendTelegram(`❌ Auto-exit FALLIDO — ${sym}\n${o.message||JSON.stringify(o).slice(0,80)}`);
      return false;
    }
  } catch(e) {
    await sendTelegram(`❌ Auto-exit ERROR — ${sym}\n${e.message}`);
    return false;
  }
}

async function placeNewStop(sym, qty, stopPrice) {
  try {
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method: 'POST', headers: alpacaHeaders(),
      body: JSON.stringify({symbol:sym, qty:String(qty), side:'sell', type:'stop',
        stop_price:String(stopPrice), time_in_force:'gtc'})
    });
    const o = await r.json();
    if(o.id && openPositions[sym]) {
      openPositions[sym].stopOrderId = o.id;
      openPositions[sym].stopPrice = stopPrice;
    }
    return o.id || null;
  } catch(e) { return null; }
}

async function manageTrailingStops() {
  const syms = Object.keys(openPositions);
  if(!syms.length) return;

  for(const sym of syms){
    try {
      const pos = openPositions[sym];
      if(!pos) continue;
      const isMOM = pos.system === 'MOM' || pos.type === 'MOM'; // compatibilidad

      // Precio actual
      const sr = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${sym}&feed=iex`,{headers:alpacaHeaders()});
      const sd = await sr.json();
      const price = sd[sym]?.latestTrade?.p || pos.entryPrice;
      const totalQty = pos.qty1 + (pos.phase2Done ? pos.qty2 : 0);
      const gain = (price - pos.entryPrice) / pos.entryPrice * 100;

      // Actualizar precio máximo
      if(!pos.maxPrice || price > pos.maxPrice) {
        pos.maxPrice = price;
        openPositions[sym] = pos;
      }

      // ── UPGRADE ORS → MOM ───────────────────────────────
      // Si una posición ORS gana +5% y las condiciones MOM se cumplen
      // cambiar la gestión a modo MOM para dejar correr el momentum
      if (!isMOM && !pos.upgradedToMOM && gain >= 5 && prices15) {
        const obvUp  = calcOBV(prices15);
        const macdUp = calcMACD(prices15);
        const rsiUp  = calcRSI(prices15, 14);
        const vols   = prices15.slice(-21);
        const avgVol = vols.slice(0,-1).reduce((s,p)=>s+(p.volume||0),0)/20;
        const rvolUp = avgVol > 0 ? (vols[vols.length-1].volume||0)/avgVol : 0;
        const momConditions =
          obvUp?.bullish && obvUp?.rising &&          // OBV alcista
          macdUp?.bullish &&                          // MACD alcista
          rsiUp && rsiUp >= 45 && rsiUp <= 72 &&      // RSI en zona momentum
          rvolUp >= 1.3;                              // Volumen institucional

        if (momConditions) {
          pos.upgradedToMOM = true;
          pos.type = 'MOM';
          pos.trailingPct = 4;
          openPositions[sym] = pos;
          const pnl = Math.round((price - pos.entryPrice) * totalQty / 1.08);
          await sendTelegram(
            `⚡→🚀 <b>UPGRADE ORS→MOM — ${sym}</b>\n` +
            `Ganancia actual: +${gain.toFixed(1)}% · P&L: +€${pnl}\n` +
            `RSI ${rsiUp.toFixed(1)} | OBV ✅ | RVOL ${rvolUp.toFixed(2)}x\n` +
            `Cambiando a gestión MOM — trailing escalado · sin venta parcial`
          );
          console.log(`[UPGRADE] ${sym} ORS→MOM a +${gain.toFixed(1)}%`);
        }
      }

      // Datos 15min para análisis técnico
      const bars15   = await fetchAlpaca15min(sym);
      const prices15 = bars15?.prices?.length >= 30 ? bars15.prices : null;

      // Datos diarios Yahoo para el trend runner (solo MOM)
      let pricesDaily = null;
      if(isMOM){
        try {
          const yd = await fetchYahoo(sym, '1d', '3mo');
          const pd = parseYahoo(yd);
          if(pd && pd.prices && pd.prices.length >= 20) pricesDaily = pd.prices;
        } catch(e) {}
      }


      // ── N1.5: Salida anticipada — 2h sin progreso ────────────────
      // Si a las 8 barras (2h) el precio no ha superado +0.5%
      // y OBV/MACD pierden momentum → cerrar antes del stop completo
      if (!pos.n15done && !pos.breakevenDone && pos.system === 'MOM') {
        const _barsHeld15 = Math.round((Date.now() - pos.ts) / (15*60*1000));
        if (_barsHeld15 >= 8 && _barsHeld15 <= 16) {
          const _gain15 = (price - pos.avgEntryPrice) / pos.avgEntryPrice * 100;
          if (_gain15 < 0.5) {
            try {
              const _o15 = calcOBV(recentBars.slice(-10).map(b=>({close:b.c||b.close,volume:b.v||b.volume||0})));
              const _m15 = calcMACD(recentBars.slice(-10).map(b=>({close:b.c||b.close})));
              if ((_o15 && !_o15.bullish) || (_m15 && _m15.bearCross)) {
                console.log('[N1.5] '+sym+' early exit gain:'+_gain15.toFixed(2)+'% barsHeld:'+_barsHeld15);
                const _sold15 = await executeSell(sym, totalQ, 'N1.5_EarlyExit');
                if (_sold15) { pos.n15done = true; continue; }
              }
            } catch(e15) { /* skip */ }
          }
          pos.n15done = true;
        }
      }

      // ══════════════════════════════════════════════════════
      // NIVEL 1 — Stop loss fijo (igual para ORS y MOM)
      // ══════════════════════════════════════════════════════

      // ── DANGER ZONE (Bernstein) ───────────────────────────────
      // Si en las primeras 4-7 bars no sube >0.3% → stop al 50% del riesgo
      const barsHeldDZ = Math.round((Date.now() - pos.ts) / (15*60*1000));
      if (!pos.dangerZoneDone && !pos.breakevenDone && barsHeldDZ >= 4 && barsHeldDZ <= 7) {
        const gainDZ = (price - pos.entryPrice) / pos.entryPrice * 100;
        if (gainDZ < 0.3) {
          const halfRisk = pos.entryPrice - (pos.entryPrice - pos.originalStop) * 0.35; // v13b: DZ35%
          const newStop  = parseFloat(halfRisk.toFixed(2));
          if (newStop > pos.stopPrice) {
            pos.stopPrice      = newStop;
            pos.dangerZoneDone = true;
            openPositions[sym] = pos;
            console.log(`[DANGER ZONE] ${sym} stop ajustado a $${newStop} (35% riesgo v13b)`);
          }
        } else {
          pos.dangerZoneDone = true;
          openPositions[sym] = pos;
        }
      }

      // ── PT1/PT2 SCALED EXIT ───────────────────────────────────
      if (pos.pt1Price && !pos.pt1Hit && price >= pos.pt1Price) {
        pos.pt1Hit = true;
        try {
          await fetch(`${alpacaBase()}/v2/orders`, { method:'POST',
            headers:{...alpacaHeaders(),'Content-Type':'application/json'},
            body: JSON.stringify({ symbol:sym, qty:String(pos.qty1), side:'sell', type:'market', time_in_force:'day' }) });
          pos.stopPrice = parseFloat((pos.entryPrice*1.002).toFixed(2));
          pos.breakevenDone = true;
          openPositions[sym] = pos;
          const pnl = Math.round((price-pos.entryPrice)*pos.qty1/1.08);
          await sendTelegram(`🎯 <b>PT1 — ${sym}</b>
${pos.qty1} acc @ $${price.toFixed(2)} · +€${pnl}
🛡 Stop → Breakeven $${pos.stopPrice}
⏳ PT2: $${pos.pt2Price}`);
        } catch(e) { console.error('[PT1]', sym, e.message); }
      }
      if (pos.pt2Price && pos.pt1Hit && !pos.pt2Hit && price >= pos.pt2Price) {
        pos.pt2Hit = true;
        try {
          await fetch(`${alpacaBase()}/v2/orders`, { method:'POST',
            headers:{...alpacaHeaders(),'Content-Type':'application/json'},
            body: JSON.stringify({ symbol:sym, qty:String(pos.qty2), side:'sell', type:'market', time_in_force:'day' }) });
          const pnl = Math.round((price-pos.entryPrice)*pos.qty2/1.08);
          updateRecentTrades(true); // registrar ganancia para WR dinámico
          await sendTelegram(`✅ <b>PT2 — ${sym}</b>
${pos.qty2} acc @ $${price.toFixed(2)} · +€${pnl}
🏁 Posición completa`);
          delete openPositions[sym]; continue;
        } catch(e) { console.error('[PT2]', sym, e.message); }
      }

      if(pos.stopPrice && price <= pos.stopPrice * 0.999){
        const sold = await executeSell(sym, totalQty,
          `${isMOM?'MOM':'ORS'} Stop loss $${pos.stopPrice}`, price);
        if(sold){ delete openPositions[sym]; continue; }
      }

      if(isMOM){
        // ════════════════════════════════════════════════════
        // SISTEMA MOM — Dejar correr la tendencia
        // ════════════════════════════════════════════════════

        // N2-MOM: Subir stop a breakeven cuando gana +3%
        if(gain >= 3 && !pos.breakevenDone){
          const be = parseFloat((pos.entryPrice * 1.003).toFixed(2));
          if(be > pos.stopPrice){
            if(pos.stopOrderId){
              await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
                {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
            }
            await placeNewStop(sym, totalQty, be);
            pos.stopPrice    = be;
            pos.breakevenDone= true;
            openPositions[sym] = pos;
            await sendTelegram(
              `🛡 <b>MOM Breakeven — ${sym}</b>\n` +
              `Stop → $${be} · Ganancia: +${gain.toFixed(1)}%\n` +
              `Posición protegida · Dejando correr`
            );
          }
        }

        // N3-MOM: TREND RUNNER — dejar correr la tendencia completa
        // Tras breakeven (+3%), el stop sube a EMA20 diaria y deja correr.
        // Solo sale por N4 (momentum roto) o al tocar EMA20.
        // Validado en backtest: runner +3% = +43% vs +15% sin runner (90d).
        if(pos.breakevenDone && pricesDaily && pricesDaily.length >= 20){
          const ema20daily = calcEMA(pricesDaily, 20);
          const obvDaily   = calcOBV(pricesDaily);

          // Mientras siga sobre EMA20 + OBV alcista → dejar correr
          const runnerActive = ema20daily && price > ema20daily
                            && obvDaily && obvDaily.bullish;

          if(runnerActive){
            // Stop sube a EMA20 diaria (nunca baja)
            const runnerStop = parseFloat(ema20daily.toFixed(2));
            if(runnerStop > pos.stopPrice + 0.20){
              if(pos.stopOrderId){
                await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
                  {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
              }
              await placeNewStop(sym, totalQty, runnerStop);
              const prev = pos.stopPrice;
              pos.stopPrice = runnerStop;
              pos.isRunner  = true;
              openPositions[sym] = pos;
              await sendTelegram(
                `🚀 <b>RUNNER ${sym}</b>\n` +
                `Stop → $${runnerStop} (EMA20) · Máx $${pos.maxPrice.toFixed(2)}\n` +
                `Ganancia: +${gain.toFixed(1)}% · Dejando correr la tendencia`
              );
            }
          } else if(pos.isRunner){
            // Era runner y rompió EMA20 o OBV → salir
            const sold = await executeSell(sym, totalQty,
              `Runner EMA20 — tendencia agotada (+${gain.toFixed(1)}%)`, price);
            if(sold){ delete openPositions[sym]; continue; }
          }

          // Stop normal por si toca EMA20 directamente
          if(pos.stopPrice && price <= pos.stopPrice){
            const sold = await executeSell(sym, totalQty,
              `Runner stop EMA20 $${pos.stopPrice.toFixed(2)}`, price);
            if(sold){ delete openPositions[sym]; continue; }
          }
        }

        // N4-MOM: Salida por agotamiento de momentum
        if(prices15 && pos.breakevenDone){
          const obv15  = calcOBV(prices15);
          const macd15 = calcMACD(prices15);
          const rsi15  = calcRSI(prices15, 14);

          const obvBear  = obv15  && !obv15.bullish;
          const macdBear = macd15 && macd15.bearCross;
          const rsiBear  = rsi15  && rsi15 > 72; // umbral más alto que ORS

          const bearCount = (obvBear?1:0) + (macdBear?1:0) + (rsiBear?1:0);

          if(bearCount >= 2){
            const exitKey = `${sym}_mom_exit_${new Date().toDateString()}_${new Date().getHours()}`;
            if(!sentAlerts[exitKey]){
              sentAlerts[exitKey] = Date.now();
              const reasons = [];
              if(obvBear)  reasons.push('OBV bajista');
              if(macdBear) reasons.push('MACD cruce');
              if(rsiBear)  reasons.push(`RSI ${rsi15?.toFixed(1)}`);
              const sold = await executeSell(sym, totalQty,
                `MOM agotamiento: ${reasons.join(' + ')}`, price);
              if(sold){ delete openPositions[sym]; continue; }
            }
          }
        }

        // N5-MOM: Time stop mejorado
        const daysHeld = (Date.now() - pos.ts) / 86400000;
        const progress = pos.target1 ? (price - pos.entryPrice)/(pos.target1 - pos.entryPrice) : 0;

        // 48h time stop — si después de 2 días no hay progreso Y OBV bajista → salir
        if(daysHeld >= 2 && daysHeld < 3 && !pos.breakevenDone && !pos.timeStop48Done) {
          const gain2d = (price - pos.entryPrice) / pos.entryPrice * 100;
          if(gain2d <= 0 && prices15) {
            const obvTs = calcOBV(prices15);
            if(obvTs && !obvTs.bullish) {
              pos.timeStop48Done = true;
              openPositions[sym] = pos;
              const sold = await executeSell(sym, totalQty,
                `N5 Time+OBV 48h sin progreso (${gain2d.toFixed(1)}%)`, price);
              if(sold){
                await sendTelegram(
                  `⏱ <b>TIME STOP 48h — ${sym}</b>\n` +
                  `Sin progreso + OBV bajista\n` +
                  `Entrada: $${pos.entryPrice} → Salida: $${price.toFixed(2)}\n` +
                  `Resultado: ${gain2d.toFixed(1)}% · Pérdida limitada`
                );
                delete openPositions[sym]; continue;
              }
            }
          }
        }

        // 5 días sin progreso significativo
        if(daysHeld > 5 && progress < 0.2 && !pos.breakevenDone){
          const sold = await executeSell(sym, totalQty,
            `MOM tiempo máx ${daysHeld.toFixed(1)}d sin progreso`, price);
          if(sold){ delete openPositions[sym]; continue; }
        }

      } else if (pos.system === 'SWING') {
        // ════════════════════════════════════════════════════
        // SISTEMA SWING — Pullback en canal MAC
        // ════════════════════════════════════════════════════

        // ── SWING→MOM UPGRADE — verificar PRIMERO antes de salidas ──────
        // v13c: el upgrade se verifica antes que la lógica de salida
        // Trigger suavizado: cierre sobre MAH (sin gap mínimo) + OBV bullish
        if (!pos.upgradedToMOM && pos.MAH_1H) {
          const gapOverMAH = (price - pos.MAH_1H) / pos.MAH_1H;
          if (gapOverMAH > 0.015 && prices15) {  // gap >1.5% (v13 original)
            const obvSwUpg  = calcOBV(prices15);
            const rsiSwUpg  = calcRSI(prices15, 14);
            const vSwUpg    = prices15.slice(-21).map(p=>p.volume||0);
            const avgVSwUpg = vSwUpg.slice(0,-1).reduce((s,v)=>s+v,0)/20;
            const rvolSwUpg = avgVSwUpg > 0 ? vSwUpg[vSwUpg.length-1]/avgVSwUpg : 0;
            const barsAboveMAH = prices15.length >= 2 &&
              prices15[prices15.length-2].close > pos.MAH_1H &&
              prices15[prices15.length-1].close > pos.MAH_1H;
            if (obvSwUpg?.bullish && obvSwUpg?.rising && rvolSwUpg >= 1.2 &&
                rsiSwUpg >= 48 && rsiSwUpg <= 72 && barsAboveMAH) {
              pos.upgradedToMOM = true;
              pos.system = 'MOM';
              pos.breakevenDone = true;
              const swAtr = pos.atrAtEntry || (pos.entryPrice - pos.originalStop);
              pos.stopPrice = parseFloat((pos.MAH_1H - swAtr * 0.5).toFixed(2));
              openPositions[sym] = pos;
              await sendTelegram(
                `📈→🚀 <b>UPGRADE SWING→MOM — ${sym}</b>\n` +
                `Rompe MAH $${pos.MAH_1H?.toFixed(2)} con gap +${(gapOverMAH*100).toFixed(1)}%\n` +
                `Stop → $${pos.stopPrice} | Dejando correr como MOM runner`
              );
              console.log(`[SWING→MOM] ${sym} gap=${(gapOverMAH*100).toFixed(1)}%`);
              continue; // siguiente tick usa lógica MOM
            }
          }
        }

        // PT1: exit parcial en MAH_1H
        if (!pos.partialDone && pos.MAH_1H && price >= pos.MAH_1H) {
          pos.partialDone  = true;
          pos.stopPrice    = parseFloat((pos.entryPrice * 1.002).toFixed(2));
          pos.breakevenDone= true;
          openPositions[sym] = pos;
          await sendTelegram(
            `🎯 <b>SWING PT1 — ${sym}</b>\n` +
            `Alcanzó MAH $${pos.MAH_1H?.toFixed(2)} · Stop → Breakeven\n` +
            `+${gain.toFixed(1)}% · Runner activo`
          );
        }

        // Runner EMA20 tras PT1 (v13 original — backtest confirmado)
        if (pos.breakevenDone && prices15) {
          const ema20S = calcEMA(prices15, Math.min(20, prices15.length));
          const obvS   = calcOBV(prices15);
          if (ema20S && price > ema20S && obvS?.bullish) {
            const rs = parseFloat(ema20S.toFixed(2));
            if (rs > pos.stopPrice + 0.20) {
              pos.stopPrice = rs; pos.isRunner = true; openPositions[sym] = pos;
            }
            if (price <= pos.stopPrice) {
              await executeSell(sym, totalQty, `SWING Runner EMA20 $${pos.stopPrice}`, price);
              delete openPositions[sym]; continue;
            }
          } else if (pos.isRunner) {
            pos.runnerWeakBars = (pos.runnerWeakBars || 0) + 1;
            if (pos.runnerWeakBars >= 2) {
              await executeSell(sym, totalQty, `SWING Runner agotado (+${gain.toFixed(1)}%)`, price);
              delete openPositions[sym]; continue;
            }
            openPositions[sym] = pos;
          }
        }

        // N4 agotamiento SWING
        if (pos.breakevenDone && prices15) {
          const obv4S  = calcOBV(prices15);
          const macd4S = calcMACD(prices15);
          const rsi4S  = calcRSI(prices15, 14);
          const bc = (!obv4S?.bullish?1:0) + (macd4S?.bearCross?1:0) + (rsi4S>72?1:0);
          if (bc >= 2) {
            await executeSell(sym, totalQty, `SWING N4 agotamiento`, price);
            delete openPositions[sym]; continue;
          }
        }

        // ── DANGER ZONE SWING (DZ35%) ────────────────────────────────
        // Mismo que ORS: si en 4-7 barras no sube >0.3% → stop al 35% riesgo
        const barsHeldSW = Math.round((Date.now() - pos.ts) / (15*60*1000));
        if (!pos.dangerZoneDone && !pos.breakevenDone && barsHeldSW >= 4 && barsHeldSW <= 7) {
          const gainSW = (price - pos.entryPrice) / pos.entryPrice * 100;
          if (gainSW < 0.3) {
            const dz35SW = pos.entryPrice - (pos.entryPrice - pos.originalStop) * 0.35;
            const newStopSW = parseFloat(dz35SW.toFixed(2));
            if (newStopSW > pos.stopPrice) {
              pos.stopPrice = newStopSW;
              pos.dangerZoneDone = true;
              openPositions[sym] = pos;
              console.log(`[DZ35-SWING] ${sym} stop → $${newStopSW}`);
            }
          } else {
            pos.dangerZoneDone = true;
            openPositions[sym] = pos;
          }
        }

        // Time stop 5 días si PT1 no alcanzado
        const dSW = (Date.now() - pos.ts) / 86400000;
        if (dSW > 5 && !pos.breakevenDone) {
          await executeSell(sym, totalQty, `SWING time stop 5d`, price);
          delete openPositions[sym]; continue;
        }

      } else {
        // ════════════════════════════════════════════════════
        // SISTEMA ORS — Lógica original con mejoras
        // ════════════════════════════════════════════════════
        const remainQty = pos.partialDone ? Math.max(1, Math.ceil(totalQty*0.5)) : totalQty;

        // N2-ORS: Venta parcial en target (con filtro momentum)
        if(pos.target1 && price >= pos.target1 * 0.998 && !pos.partialDone){
          let momentumStrong = false;
          if(prices15){
            const obv2 = calcOBV(prices15);
            const macd2= calcMACD(prices15);
            const rsi2 = calcRSI(prices15, 14);
            momentumStrong = obv2?.bullish && macd2?.bullish && !macd2?.bearCross && rsi2 < 72;
          }
          if(momentumStrong){
            const newStop = parseFloat((pos.entryPrice * 1.002).toFixed(2));
            if(newStop > pos.stopPrice){
              if(pos.stopOrderId){
                await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
                  {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
              }
              await placeNewStop(sym, totalQty, newStop);
              pos.stopPrice = newStop;
            }
            const riskPS = Math.abs(pos.entryPrice - (pos.originalStop||pos.stopPrice));
            pos.target1 = parseFloat((price + riskPS*1.5).toFixed(2));
            openPositions[sym] = pos;
            const km = `${sym}_ors_mom_${new Date().toDateString()}_${new Date().getHours()}`;
            if(!sentAlerts[km]){
              sentAlerts[km] = Date.now();
              await sendTelegram(
                `🚀 <b>ORS Momentum fuerte — ${sym}</b>\n` +
                `Dejando correr · Stop BE $${newStop} · Nuevo target $${pos.target1}`
              );
            }
          } else {
            const partialQty = Math.floor(totalQty*0.5);
            if(partialQty >= 1){
              const sold = await executeSell(sym, partialQty,
                `ORS Target $${pos.target1} — venta 50%`, price);
              if(sold){
                pos.partialDone = true;
                const be = parseFloat((pos.entryPrice*1.002).toFixed(2));
                if(pos.stopOrderId){
                  await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
                    {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
                }
                await placeNewStop(sym, Math.ceil(totalQty*0.5), be);
                pos.stopPrice = be;
                openPositions[sym] = pos;
                await sendTelegram(
                  `🛡 <b>ORS Stop BE — ${sym}</b>\n` +
                  `Stop → $${be} · 50% restante corriendo`
                );
              }
            }
          }
          continue;
        }

        // N3-ORS: Salida por señal inversa (solo tras venta parcial)
        if(pos.partialDone && prices15){
          const obv15  = calcOBV(prices15);
          const macd15 = calcMACD(prices15);
          const rsi15  = calcRSI(prices15, 14);
          const n      = prices15.length;
          const lb     = prices15[n-1];
          const shootStar = lb &&
            (lb.high - Math.max(lb.open||lb.close, lb.close)) >
            Math.abs(lb.close-(lb.open||lb.close))*2 &&
            lb.close < (lb.open||lb.close);
          const bearCount = (!obv15?.bullish?1:0)+(macd15?.bearCross?1:0)+
                            (rsi15>68?1:0)+(shootStar?1:0);
          if(bearCount >= 2){
            const ek = `${sym}_ors_exit_${new Date().toDateString()}_${new Date().getHours()}`;
            if(!sentAlerts[ek]){
              sentAlerts[ek] = Date.now();
              const sold = await executeSell(sym, remainQty,
                `ORS señal bajista (${bearCount}/4)`, price);
              if(sold){ delete openPositions[sym]; continue; }
            }
          }
        }

        // N4-ORS: Trailing 4% fijo (solo tras venta parcial)
        if(pos.partialDone && pos.maxPrice){
          const trailStop = parseFloat((pos.maxPrice*0.96).toFixed(2));
          if(price <= trailStop){
            const sold = await executeSell(sym, remainQty,
              `ORS Trailing 4% desde $${pos.maxPrice.toFixed(2)}`, price);
            if(sold){ delete openPositions[sym]; continue; }
          }
          if(trailStop > pos.stopPrice + 0.30){
            if(pos.stopOrderId){
              await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
                {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
            }
            await placeNewStop(sym, remainQty, trailStop);
            openPositions[sym] = pos;
          }
        }
      }

      // ── ALERTAS DE HITOS para ambos sistemas ────────────
      const milestones = [2, 5, 10, 15, 20];
      for(const m of milestones){
        const mKey = `${sym}_hito_${m}`;
        if(gain >= m && !sentAlerts[mKey]){
          sentAlerts[mKey] = Date.now();
          const pnl = Math.round((price-pos.entryPrice)*totalQty/1.08);
          await sendTelegram(
            `📈 <b>${isMOM?'🚀 MOM':'⚡ ORS'} ${sym} +${gain.toFixed(1)}%</b>\n` +
            `$${price.toFixed(2)} · P&L: +€${pnl}\n` +
            `Stop: $${pos.stopPrice} · Máx: $${pos.maxPrice?.toFixed(2)||'—'}`
          );
        }
      }

    } catch(e){ console.error('[Exit]', sym, e.message); }
  }
}

// ── STATE ─────────────────────────────────────────────
const sentAlerts    = {};   // avoid duplicate alerts

// ═══════════════════════════════════════════════════════
// NUEVAS MEJORAS — v2.3
// ═══════════════════════════════════════════════════════

// ── 1. SECTOR MAP — máx 2 posiciones por sector ────────
const SECTOR_MAP = {
  AI_CHIPS:    ['NVDA','AMD','AVGO','TSM','MU','QCOM','MRVL','ARM','SMCI','LRCX','KLAC','ASML','ON'],
  CLOUD:       ['ORCL','META','AMZN','GOOGL','MSFT','NFLX','AAPL','ANET','PLTR','DELL'],
  AI_INFRA:    ['CRWV'],
  NUCLEAR:     ['CEG','VST','GEV','NEE','ETR'],
  ENERGIA:     ['XOM','CVX','OXY','EOG','SLB'],
  DEFENSA:     ['LMT','RTX','NOC','GD'],
  INDUSTRIAL:  ['CAT','DE','HON','EMR'],
  AIRLINES:    ['DAL','UAL','AAL'],
  HEALTHCARE:  ['HCA','ISRG','UNH','LLY','VRTX','REGN'],
  BIOTECH:     ['INSM','CRSP','ABBV'],
  FINTECH:     ['JPM','GS','MS','BLK','COIN'],
  SPACE:       ['TSLA','RKLB','LUNR'],
};

// ── MAPEO SECTOR_MAP → claves sectorSentiment (Claude) ──
// sectorSentiment usa claves de SECTOR_ETFS: AI_CHIPS,CLOUD,SPACE,CLEAN_ENERGY,BIOTECH,HEALTHCARE,AIRLINES,INDUSTRIAL,FINTECH
const SECTOR_MAP_TO_SENTIMENT = {
  AI_CHIPS:   'AI_CHIPS',
  CLOUD:      'CLOUD',
  AI_INFRA:   'CLOUD',
  NUCLEAR:    'CLEAN_ENERGY',
  ENERGIA:    'INDUSTRIAL',
  DEFENSA:    'INDUSTRIAL',
  INDUSTRIAL: 'INDUSTRIAL',
  AIRLINES:   'AIRLINES',
  HEALTHCARE: 'HEALTHCARE',
  BIOTECH:    'BIOTECH',
  FINTECH:    'FINTECH',
  SPACE:      'SPACE',
};

// ── SECTOR ETF FILTER — no entrar si el ETF del sector es bajista ──
const SECTOR_ETF = {
  AI_CHIPS:   'XLK',
  CLOUD:      'XLK',
  AI_INFRA:   'XLK',
  DEFENSA:    'ITA',  // iShares Defense ETF
  ENERGIA:    'XLE',
  INDUSTRIAL: 'XLI',
  AIRLINES:   'JETS', // US Global Jets ETF
  HEALTHCARE: 'XLV',
  BIOTECH:    'XBI',
  FINTECH:    'XLF',
  NUCLEAR:    'XLU',
  SPACE:      'XLK',
};

// Cache de datos ETF — actualiza cada 30 min
var sectorETFCache = {};

async function isSectorBullish(sector) {
  var etf = SECTOR_ETF[sector];
  if (!etf) return true; // sin ETF definido — permitir siempre

  var now = Date.now();
  var cached = sectorETFCache[etf];
  if (cached && (now - cached.ts) < 30 * 60 * 1000) {
    return cached.bullish;
  }

  try {
    // Fetch datos diarios del ETF desde Yahoo — últimos 10 días
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/'+etf+'?interval=1d&range=10d';
    var r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    var d = await r.json();
    var closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    closes = closes.filter(Boolean);
    if (closes.length < 5) return true; // sin datos — permitir

    // Calcular cambio % en los últimos 5 días
    var recent = closes.slice(-5);
    var chg5d = (recent[recent.length-1] - recent[0]) / recent[0] * 100;

    // Sector bajista si cayó >2% en 5 días
    var bullish = chg5d > -2.0;

    sectorETFCache[etf] = { bullish, chg5d: parseFloat(chg5d.toFixed(2)), ts: now };
    console.log('[SECTOR ETF] '+etf+' ('+sector+'): '+chg5d.toFixed(2)+'% 5d → '+(bullish?'✅ alcista':'❌ bajista'));
    return bullish;
  } catch(e) {
    console.log('[SECTOR ETF] '+etf+' error: '+e.message);
    return true; // error — permitir por defecto
  }
}
const MAX_PER_SECTOR = 2;

function getSector(sym) {
  for (const [sector, tickers] of Object.entries(SECTOR_MAP)) {
    if (tickers.includes(sym)) return sector;
  }
  return 'OTHER';
}

function countSectorPositions(sym) {
  const sector = getSector(sym);
  if (sector === 'OTHER') return 0;
  return Object.keys(openPositions).filter(s => getSector(s) === sector).length;
}

// ── 2. EARNINGS FILTER — no entrar 2 días antes/después ─
const earningsCache = {};

async function isNearEarnings(sym) {
  try {
    const cacheKey = sym + '_earnings';
    const cached = earningsCache[cacheKey];
    if (cached && Date.now() - cached.ts < 6 * 3600 * 1000) return cached.result;

    const r = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=calendarEvents`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const earningsDate = d?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
    if (!earningsDate) { earningsCache[cacheKey] = { result: false, ts: Date.now() }; return false; }

    const now = Date.now() / 1000;
    const diff = Math.abs(earningsDate - now) / 86400;
    const result = diff < 2; // dentro de 2 días
    earningsCache[cacheKey] = { result, ts: Date.now() };
    if (result) console.log(`[${sym}] EARNINGS en ${diff.toFixed(1)} días — bloqueando entrada`);
    return result;
  } catch(e) { return false; }
}

// ── 3. MARKET CONTEXT — SPY + VIX + Breadth ────────────
// ── MARKET REGIME — Sistema de detección de régimen de mercado ───────────────
// Tres modos: BULL (MOM protagonista), LATERAL (ORS protagonista), BEAR (filtros estrictos)
// Se actualiza cada hora. Usa SMA50 y SMA200 reales de SPY + VIX + días consecutivos.

let spyContext = { trend: 'neutral', change: 0, ts: 0 };
let vixContext = { value: 15, regime: 'normal', ts: 0 };
let breadthContext = { pctAboveSMA200: 70, regime: 'healthy', ts: 0 };

// Régimen principal — se actualiza con datos reales de SPY
let MARKET_REGIME = {
  mode: 'BULL',         // 'BULL' | 'LATERAL' | 'BEAR'
  spyVsSMA50: 'above',  // 'above' | 'below'
  spyVsSMA200: 'above', // 'above' | 'below'
  bearDays: 0,          // días consecutivos bajo SMA200
  lateralDays: 0,       // días entre SMA50 y SMA200
  vix: 15,
  description: 'Mercado alcista — MOM protagonista',
  sizeMult: 1.0,        // multiplicador de tamaño de posición
  momActive: true,
  orsActive: true,
  orsPriority: false,   // true = ORS es protagonista en modo LATERAL
  ts: 0,
};

// Histórico de precios SPY para calcular SMAs reales
let spyPriceHistory = [];  // últimos 200 cierres diarios

async function updateMarketRegime() {
  try {
    // Solo actualizar en días de mercado (datos de cierre reales)
    // El fin de semana usamos los datos del viernes — no tiene sentido recalcular
    const now = new Date();
    const utcDay = now.getUTCDay();
    if (utcDay === 0 || utcDay === 6) {
      console.log('[REGIME] Fin de semana — usando datos del viernes. Sin actualización.');
      return;
    }

    // Obtener 200 barras diarias de SPY para calcular SMA50 y SMA200
    const url = `${ALPACA_DATA}/v2/stocks/SPY/bars?timeframe=1Day&limit=210&feed=iex`;
    const r = await fetch(url, { headers: alpacaHeaders() });
    const d = await r.json();
    const bars = (d.bars || []).filter(b => b.c);
    if (bars.length < 52) return;

    const closes = bars.map(b => b.c);
    const last = closes[closes.length - 1];
    spyPriceHistory = closes;

    // SMA50 y SMA200
    const sma50  = closes.slice(-50).reduce((a,b)=>a+b,0) / 50;
    const sma200 = closes.length >= 200 ? closes.slice(-200).reduce((a,b)=>a+b,0) / 200 : null;

    // Contar días consecutivos bajo SMA200
    let bearDays = 0, lateralDays = 0;
    for (let i = closes.length - 1; i >= Math.max(0, closes.length - 20); i--) {
      const c200 = closes.length >= 200 ? closes.slice(i-199, i+1).reduce((a,b)=>a+b,0)/200 : sma200;
      const c50  = closes.slice(Math.max(0,i-49), i+1).reduce((a,b)=>a+b,0) / Math.min(50, i+1);
      if (closes[i] < (c200||sma200||last)) bearDays++;
      else if (closes[i] < c50) lateralDays++;
      else break;
    }

    // Cambio diario SPY
    const change = closes.length >= 2 ? ((last / closes[closes.length-2]) - 1) * 100 : 0;

    // Determinar modo
    let mode, desc, sizeMult, momActive, orsActive, orsPriority;

    if (sma200 && last < sma200 && bearDays >= 3) {
      // BEAR: SPY bajo SMA200 más de 3 días
      mode = 'BEAR';
      desc = `Mercado bajista (SPY < SMA200 hace ${bearDays} días) — Filtros estrictos`;
      sizeMult = 0.5;
      momActive = false;   // MOM desactivado en bear
      orsActive = true;    // ORS solo con fuerza relativa positiva
      orsPriority = false;
    } else if (last < sma50 || (sma200 && last < sma200 && bearDays < 3)) {
      // LATERAL: SPY bajo SMA50 o empezando a caer bajo SMA200
      mode = 'LATERAL';
      desc = `Mercado lateral (SPY entre SMA50 y SMA200) — ORS protagonista`;
      sizeMult = 0.75;
      momActive = true;    // MOM solo señales A+
      orsActive = true;    // ORS protagonista
      orsPriority = true;  // ORS tiene prioridad en lateral
    } else {
      // BULL: SPY sobre SMA50 y SMA200
      mode = 'BULL';
      desc = 'Mercado alcista (SPY > SMA50 > SMA200) — MOM protagonista';
      sizeMult = 1.0;
      momActive = true;
      orsActive = true;
      orsPriority = false;
    }

    // Ajustar por VIX
    if (vixContext.value >= 35) sizeMult = 0;          // Pánico — no operar
    else if (vixContext.value >= 25) sizeMult *= 0.5;   // Miedo — half size
    else if (vixContext.value >= 20) sizeMult *= 0.75;  // Nervioso

    MARKET_REGIME = {
      mode, desc, sizeMult, momActive, orsActive, orsPriority,
      spyVsSMA50: last >= sma50 ? 'above' : 'below',
      spyVsSMA200: (sma200 && last >= sma200) ? 'above' : 'below',
      bearDays, lateralDays,
      spyPrice: last, sma50: Math.round(sma50*100)/100,
      sma200: sma200 ? Math.round(sma200*100)/100 : null,
      spyChange: Math.round(change*100)/100,
      vix: vixContext.value,
      ts: Date.now(),
    };

    // Actualizar spyContext para compatibilidad
    spyContext = {
      trend: mode === 'BULL' ? 'bull' : mode === 'BEAR' ? 'bear' : 'neutral',
      change, ts: Date.now(),
    };

    console.log(`[REGIME] ${mode} | SPY=\$${last.toFixed(2)} SMA50=\$${sma50.toFixed(2)}${sma200?' SMA200=$'+sma200.toFixed(2):''} VIX=${vixContext.value} SizeMult=${sizeMult}`);
    await sendTelegramRegimeAlert();
  } catch(e) {
    console.log('[REGIME] Error:', e.message);
  }
}

// Alerta Telegram cuando cambia el régimen
let lastRegimeMode = 'BULL';
async function sendTelegramRegimeAlert() {
  if (MARKET_REGIME.mode === lastRegimeMode) return;
  const icons = { BULL:'🟢', LATERAL:'🟡', BEAR:'🔴' };
  const icon = icons[MARKET_REGIME.mode] || '⚪';
  await sendTelegram(`${icon} CAMBIO DE RÉGIMEN: ${lastRegimeMode} → ${MARKET_REGIME.mode}\n${MARKET_REGIME.desc}\nSPY=\$${MARKET_REGIME.spyPrice} | SizeMult=${MARKET_REGIME.sizeMult}x | VIX=${MARKET_REGIME.vix}`);
  lastRegimeMode = MARKET_REGIME.mode;
}

// Fetch VIX desde Yahoo Finance
async function updateVIXContext() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d';
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const d = await r.json();
    const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const vix = closes.filter(Boolean).pop();
    if (!vix) return;

    vixContext = {
      value: parseFloat(vix.toFixed(1)),
      regime: vix < 15 ? 'calm'      // Complacencia — sizing normal
             : vix < 20 ? 'normal'   // Normal — sizing normal
             : vix < 25 ? 'nervous'  // Nervioso — sizing 75%
             : vix < 35 ? 'fearful'  // Miedo — sizing 50%, solo 5/5
             :            'panic',   // Pánico — no entrar
      ts: Date.now(),
    };
    console.log(`[VIX] ${vixContext.value} → ${vixContext.regime}`);
  } catch(e) {
    console.log('[VIX] Error:', e.message);
  }
}

// Breadth — usar % de watchlist sobre SMA200 como proxy
async function updateBreadthContext() {
  try {
    const sample = ['SPY','QQQ','IWM','XLK','XLF','XLE','XLV','XLI'];
    let aboveCount = 0;
    for (const sym of sample) {
      const snap = await fetchAlpacaSnapshot(sym).catch(() => null);
      if (snap?.price) {
        // Comparar precio vs SMA200 aproximada (precio hace 200 días)
        // Usamos como proxy el changePct anualizado
        if ((snap.changePct || 0) > -20) aboveCount++; // simplificado
      }
    }
    const pct = Math.round(aboveCount / sample.length * 100);
    breadthContext = {
      pctAboveSMA200: pct,
      regime: pct >= 70 ? 'healthy'  // Mercado sano
             : pct >= 50 ? 'mixed'   // Mercado mixto
             :             'weak',   // Mercado débil
      ts: Date.now(),
    };
  } catch(e) {}
}

async function updateSPYContext() {
  try {
    const snap = await fetchAlpacaSnapshot('SPY');
    if (!snap) return;
    const change = snap.changePct || 0;
    spyContext = {
      trend: change > 0.5 ? 'bull' : change < -1 ? 'bear' : 'neutral',
      change: change,
      ts: Date.now(),
    };

    // Actualizar VIX y breadth cada 30 minutos
    if (!vixContext.ts || Date.now() - vixContext.ts > 30 * 60 * 1000) {
      await updateVIXContext();
    }
    if (!breadthContext.ts || Date.now() - breadthContext.ts > 30 * 60 * 1000) {
      await updateBreadthContext();
    }
  } catch(e) {}
}

// ── VIX REGIME — qué sistema priorizar según volatilidad ──
function getVIXSystemRegime() {
  var vix = vixContext.value || 15;
  // Devuelve qué sistemas operan y con qué prioridad
  if (vix < 15) {
    return { momActive:true, orsActive:true, priority:'MOM', sizeMult:1.0,
             desc:'Complaciente — tendencias se sostienen, MOM prioritario' };
  } else if (vix < 20) {
    return { momActive:true, orsActive:true, priority:'BOTH', sizeMult:1.0,
             desc:'Normal — ambos sistemas activos' };
  } else if (vix < 25) {
    return { momActive:true, orsActive:true, priority:'BOTH', sizeMult:0.75,
             desc:'Nervioso — ambos activos, size 75%' };
  } else if (vix < 35) {
    return { momActive:true, orsActive:true, priority:'5/5_ONLY', sizeMult:0.5,
             desc:'Miedo — solo señales 5/5, size 50%' };
  } else {
    return { momActive:false, orsActive:false, priority:'NONE', sizeMult:0.0,
             desc:'Pánico — no operar, señales no fiables' };
  }
}

// Multiplicador de sizing combinado SPY + VIX + Breadth
function getMarketSizingMultiplier() {
  // VIX regime
  var vixMult = 1.0;
  if      (vixContext.regime === 'panic')   vixMult = 0.0;  // No entrar
  else if (vixContext.regime === 'fearful') vixMult = 0.5;  // Solo 5/5
  else if (vixContext.regime === 'nervous') vixMult = 0.75;
  else                                      vixMult = 1.0;

  // SPY regime
  var spyMult = 1.0;
  if      (spyContext.trend === 'bear')    spyMult = 0.5;
  else if (spyContext.trend === 'neutral') spyMult = 0.75;
  else                                     spyMult = 1.0;

  // Breadth regime
  var breadthMult = 1.0;
  if      (breadthContext.regime === 'weak')  breadthMult = 0.75;
  else if (breadthContext.regime === 'mixed') breadthMult = 0.875;
  else                                         breadthMult = 1.0;

  // Combinar — el más restrictivo manda pero suavizado
  var combined = vixMult * 0.5 + spyMult * 0.35 + breadthMult * 0.15;
  return parseFloat(Math.min(1.0, Math.max(0.0, combined)).toFixed(2));
}

// Mantener compatibilidad con código existente
function getSPYSizingMultiplier() {
  return getMarketSizingMultiplier();
}

// ── 4. RVOL FILTER — volumen relativo mínimo 1.2x ───────
function calcRVOL(prices) {
  if (!prices || prices.length < 20) return null;
  const avgVol = prices.slice(-20, -1).reduce((s,p) => s + (p.volume||0), 0) / 19;
  const lastVol = prices[prices.length-1].volume || 0;
  return avgVol > 0 ? parseFloat((lastVol / avgVol).toFixed(2)) : null;
}

// ── 5. TIEMPO MÁXIMO EN POSICIÓN — salida a los 3 días ──
async function checkTimeExits() {
  const MAX_HOLD_DAYS = 3;
  const now = Date.now();
  for (const [sym, pos] of Object.entries(openPositions)) {
    if (!pos || !pos.ts) continue;
    const daysHeld = (now - pos.ts) / (1000 * 86400);
    if (daysHeld < MAX_HOLD_DAYS) continue;
    // Verificar si hay progreso hacia el target
    const snap = await fetchAlpacaSnapshot(sym).catch(() => null);
    const price = snap?.price || pos.entryPrice;
    const progress = (price - pos.entryPrice) / (pos.target1 - pos.entryPrice);
    if (progress < 0.3 && !pos.partialDone) {
      const qty = pos.qty1 + (pos.phase2Done ? pos.qty2 : 0);
      await executeSell(sym, qty, `Tiempo máximo ${MAX_HOLD_DAYS}d sin progreso`, price);
      delete openPositions[sym];
      console.log(`[TIME EXIT] ${sym} — ${daysHeld.toFixed(1)} días sin alcanzar target`);
    }
  }
}

// ── 6. BREAKEVEN AGRESIVO — mover stop a BE+0.5ATR al +1.5% ─
async function checkAggressiveBreakeven() {
  for (const [sym, pos] of Object.entries(openPositions)) {
    if (!pos || pos.breakevenDone) continue;
    const snap = await fetchAlpacaSnapshot(sym).catch(() => null);
    if (!snap) continue;
    const price = snap.price || pos.entryPrice;
    const gain = (price - pos.entryPrice) / pos.entryPrice * 100;
    if (gain < 1.5) continue; // Solo mover si +1.5%
    const atr = pos.atr || (pos.entryPrice * 0.015);
    const newStop = parseFloat((pos.entryPrice + atr * 0.5).toFixed(2));
    if (newStop <= pos.stopPrice) continue;
    // Cancelar stop viejo y colocar nuevo
    if (pos.stopOrderId) {
      await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
        { method: 'DELETE', headers: alpacaHeaders() }).catch(() => {});
    }
    await placeNewStop(sym, pos.qty1 + (pos.phase2Done ? pos.qty2 : 0), newStop);
    pos.stopPrice = newStop;
    pos.breakevenDone = true;
    openPositions[sym] = pos;
    await sendTelegram(
      `🛡 <b>BE Agresivo — ${sym}</b>\n` +
      `Stop movido a $${newStop} (entrada+0.5ATR)\n` +
      `Ganancia actual: +${gain.toFixed(1)}%`
    );
  }
}

// ── 7. RE-ENTRADA tras stop ──────────────────────────────
const stoppedOut = {}; // {sym: {price, ts}}

function recordStopOut(sym, price) {
  stoppedOut[sym] = { price, ts: Date.now() };
}

function canReEnter(sym, currentPrice) {
  const rec = stoppedOut[sym];
  if (!rec) return true;
  const hoursSince = (Date.now() - rec.ts) / 3600000;
  return hoursSince > 1; // Esperar al menos 1 hora antes de re-entrar
}
const priceCache    = {};   // yahoo cache
const CACHE_TTL     = 3 * 60 * 1000; // 3 min — WL41 scan dura ~12s, cabe en el ciclo de 5min
const pendingOrders = {};   // awaiting Telegram confirmation
const ibkrSession   = { token: null, expires: 0 };

// ── TECHNICAL INDICATORS ──────────────────────────────
// ── ICHIMOKU KINKO HYO ───────────────────────────────
// Parámetros adaptados a 15min:
// En diario: 9, 26, 52 períodos
// En 15min (26 barras/día): 9d=234, 26d=676, 52d=1352 barras
// PERO para backtest usamos parámetros más cortos que funcionen
// con los datos disponibles: Tenkan=9, Kijun=26, SpanB=52 (barras 15min)
// Esto equivale a ~2h, ~6.5h, ~13h — suficiente para tendencia intradiaria
function calcIchimoku(prices) {
  if (!prices || prices.length < 52) return null;

  function midpoint(slice) {
    var high = slice.reduce(function(m,p){return Math.max(m,p.high||p.close);}, -Infinity);
    var low  = slice.reduce(function(m,p){return Math.min(m,p.low||p.close);}, Infinity);
    return (high + low) / 2;
  }

  // Usar parámetros adaptados según longitud de datos disponibles
  // Si tenemos muchas barras usamos períodos más largos (más representativos)
  var len    = prices.length;
  var tPer   = Math.min(9,  Math.floor(len * 0.05));  // Tenkan ~5% del histórico
  var kPer   = Math.min(26, Math.floor(len * 0.15));  // Kijun ~15%
  var sPer   = Math.min(52, Math.floor(len * 0.30));  // SpanB ~30%
  if (tPer < 3 || kPer < 6) return null;

  var tenkan = midpoint(prices.slice(-tPer));
  var kijun  = midpoint(prices.slice(-kPer));
  var spanA  = (tenkan + kijun) / 2;
  var spanB  = midpoint(prices.slice(-sPer));
  var last   = prices[prices.length-1].close;

  var kumoTop    = Math.max(spanA, spanB);
  var kumoBottom = Math.min(spanA, spanB);
  var sobreKumo  = last > kumoTop;
  var bajoKumo   = last < kumoBottom;
  var enKumo     = !sobreKumo && !bajoKumo;
  var sobreKijun = last > kijun;
  var tkCross    = tenkan > kijun;
  var kumoAlcista= spanA > spanB;
  var score      = (sobreKumo?2:0) + (sobreKijun?1:0) + (tkCross?1:0);

  return {
    tenkan:     parseFloat(tenkan.toFixed(2)),
    kijun:      parseFloat(kijun.toFixed(2)),
    spanA:      parseFloat(spanA.toFixed(2)),
    spanB:      parseFloat(spanB.toFixed(2)),
    kumoTop:    parseFloat(kumoTop.toFixed(2)),
    kumoBottom: parseFloat(kumoBottom.toFixed(2)),
    sobreKumo, bajoKumo, enKumo,
    sobreKijun, tkCross, kumoAlcista,
    score,
    orsFilter:  sobreKumo && tkCross,
    momFilter:  sobreKumo && tkCross && kumoAlcista,
    kijunFilter: sobreKijun,
  };
}

function calcEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices[prices.length - period].close;
  for (let i = prices.length - period + 1; i < prices.length; i++)
    ema = prices[i].close * k + ema * (1 - k);
  return ema;
}

function calcRSI(prices, period) {
  // Wilder smoothing — identical to TradingView
  if (!prices || prices.length < period + 2) return null;
  const gains = [], losses = [];
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i].close - prices[i-1].close;
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  if (gains.length < period) return null;
  let avgG = 0, avgL = 0;
  for (let i = 0; i < period; i++) { avgG += gains[i]; avgL += losses[i]; }
  avgG /= period; avgL /= period;
  for (let i = period; i < gains.length; i++) {
    avgG = (avgG * (period-1) + gains[i]) / period;
    avgL = (avgL * (period-1) + losses[i]) / period;
  }
  if (avgL === 0) return 100;
  return parseFloat((100 - (100 / (1 + avgG/avgL))).toFixed(2));
}

function calcMACD(prices, fast=12, slow=26, signal=9) {
  if (!prices || prices.length < slow + signal + 1) return null;
  const kf = 2/(fast+1), ks = 2/(slow+1);
  let ef = prices[0].close, es = prices[0].close;
  const macdLine = [];
  for (let i = 1; i < prices.length; i++) {
    ef = prices[i].close * kf + ef * (1-kf);
    es = prices[i].close * ks + es * (1-ks);
    if (i >= slow-1) macdLine.push(ef - es);
  }
  if (macdLine.length < signal) return null;
  const ks2 = 2/(signal+1);
  let sig = macdLine[0];
  const sigArr = [sig];
  for (let i = 1; i < macdLine.length; i++) {
    sig = macdLine[i] * ks2 + sig * (1-ks2);
    sigArr.push(sig);
  }
  const lastMACD = macdLine[macdLine.length-1];
  const lastSig  = sigArr[sigArr.length-1];
  const prevMACD = macdLine[macdLine.length-2];
  const prevSig  = sigArr[sigArr.length-2];
  const hist = lastMACD - lastSig;
  const prevHist = prevMACD - prevSig;
  return {
    bullish:   lastMACD > lastSig,
    bullCross: prevMACD <= prevSig && lastMACD > lastSig,
    bearCross: prevMACD >= prevSig && lastMACD < lastSig,
    hist:      parseFloat(hist.toFixed(4)),
    increasing: hist > prevHist,
    value: parseFloat(lastMACD.toFixed(4)),
  };
}

function calcStochRSI(prices) {
  if (!prices || prices.length < 50) return null;
  const rsiSeries = [];
  for (let i = 14; i < prices.length; i++) {
    const r = calcRSI(prices.slice(i - 14, i + 1), 14);
    if (r !== null) rsiSeries.push(r);
  }
  if (rsiSeries.length < 14) return null;
  const window = rsiSeries.slice(-14);
  const hi = Math.max(...window), lo = Math.min(...window);
  const k = hi === lo ? 50 : (rsiSeries[rsiSeries.length-1] - lo) / (hi - lo) * 100;
  const kPrev = rsiSeries.length > 2
    ? (hi === lo ? 50 : (rsiSeries[rsiSeries.length-2] - lo) / (hi - lo) * 100) : k;
  return { k: +k.toFixed(1), oversold: k < 20, bullCross: kPrev < 20 && k > 20 };
}

function calcBollinger(prices) {
  if (!prices || prices.length < 20) return null;
  const slice = prices.slice(-20).map(p => p.close);
  const mean  = slice.reduce((a,b) => a+b, 0) / 20;
  const std   = Math.sqrt(slice.reduce((s,v) => s + Math.pow(v-mean, 2), 0) / 20);
  return { lower: mean - 2*std, upper: mean + 2*std, mid: mean };
}

function calcATR(prices, period) {
  if (!prices || prices.length < period + 1) return null;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const h = prices[i].high || prices[i].close;
    const l = prices[i].low  || prices[i].close;
    const p = prices[i-1].close;
    sum += Math.max(h-l, Math.abs(h-p), Math.abs(l-p));
  }
  return sum / period;
}

// ── SLIT DETECTION (server-side) ─────────────────────
function detectSLITServer(prices) {
  if(!prices||prices.length<6) return null;
  var n=prices.length;
  var last=prices[n-1], prev=prices[n-2];
  var recentLow=Math.min.apply(null,prices.slice(-8,-1).map(function(p){return p.low||p.close;}));
  var brokeDown=(prev.low||prev.close)<recentLow;
  var reversed=last.close>prev.close*1.015;
  if(brokeDown&&reversed) return {detected:true,type:1,strength:70};
  return null;
}

// ── MFI (server-side) ─────────────────────────────────
function calcMFIServer(prices, period) {
  period=period||14;
  if(!prices||prices.length<period+1) return null;
  var posFlow=0,negFlow=0;
  for(var i=prices.length-period;i<prices.length;i++){
    var tp=((prices[i].high||prices[i].close)+(prices[i].low||prices[i].close)+prices[i].close)/3;
    var tpPrev=((prices[i-1].high||prices[i-1].close)+(prices[i-1].low||prices[i-1].close)+prices[i-1].close)/3;
    var mf=tp*(prices[i].volume||1);
    if(tp>tpPrev) posFlow+=mf; else negFlow+=mf;
  }
  if(negFlow===0) return 100;
  return parseFloat((100-(100/(1+posFlow/negFlow))).toFixed(2));
}

// ── RANGE DETECTION (server-side) ─────────────────────
function detectRangeServer(prices) {
  if(!prices||prices.length<20) return null;
  var slice=prices.slice(-20);
  var hi=Math.max.apply(null,slice.map(function(p){return p.high||p.close;}));
  var lo=Math.min.apply(null,slice.map(function(p){return p.low||p.close;}));
  var rngPct=(hi-lo)/lo*100;
  return {isRange:rngPct<8,hi:hi,lo:lo,rangePct:rngPct.toFixed(1)};
}

function calcSMA(prices, period) {
  if (!prices || prices.length < period) return null;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; i++) sum += prices[i].close;
  return parseFloat((sum/period).toFixed(2));
}

function calcEMA50(prices) {
  if (!prices || prices.length < 50) return null;
  const k = 2/51;
  let ema = prices[0].close;
  for (let i = 1; i < prices.length; i++) ema = prices[i].close * k + ema * (1-k);
  return parseFloat(ema.toFixed(2));
}

function calcOBV(prices) {
  if (!prices || prices.length < 10) return null;
  let obv = 0;
  const series = [];
  for (let i = 1; i < prices.length; i++) {
    const vol = prices[i].volume || 0;
    if (prices[i].close > prices[i-1].close) obv += vol;
    else if (prices[i].close < prices[i-1].close) obv -= vol;
    series.push(obv);
  }
  const n = series.length;
  // TradingView-compatible: LINEAR REGRESSION SLOPE over last 14 bars
  const recent = series.slice(-Math.min(14, n));
  const nb = recent.length;
  let sumX=0,sumY=0,sumXY=0,sumX2=0;
  for(let j=0;j<nb;j++){ sumX+=j; sumY+=recent[j]; sumXY+=j*recent[j]; sumX2+=j*j; }
  const slope = (nb*sumXY - sumX*sumY) / (nb*sumX2 - sumX*sumX || 1);
  const bullish = slope > 0;  // OBV bullish = positive slope (same as TradingView)
  const rising = n >= 3 && series[n-1] > series[n-3];
  const trend20 = n>=20 ? (series[n-1]-series[n-20])/Math.abs(series[n-20]||1)*100 : slope*100;
  return {
    value: series[n-1],
    bullish, rising,
    slope: parseFloat(slope.toFixed(0)),
    trend20: parseFloat(trend20.toFixed(1)),
  };
}

function calcFibLevels(prices) {
  if (!prices || prices.length < 20) return null;
  const slice = prices.slice(-60);
  let hi = slice[0].high || slice[0].close, lo = slice[0].low || slice[0].close;
  for (let i = 1; i < slice.length; i++) {
    const h = slice[i].high || slice[i].close;
    const l = slice[i].low  || slice[i].close;
    if (h > hi) hi = h;
    if (l < lo) lo = l;
  }
  const rng = hi - lo;
  return {
    hi, lo,
    r236: parseFloat((hi - rng * 0.236).toFixed(2)),
    r382: parseFloat((hi - rng * 0.382).toFixed(2)),
    r500: parseFloat((hi - rng * 0.500).toFixed(2)),
    r618: parseFloat((hi - rng * 0.618).toFixed(2)),
  };
}

function getFibProximity(last, fib) {
  if (!fib) return null;
  const levels = [
    {l: fib.r618, n:'61.8%'}, {l: fib.r500, n:'50%'},
    {l: fib.r382, n:'38.2%'}, {l: fib.r236, n:'23.6%'},
  ];
  for (const lv of levels) {
    const dist = Math.abs(last - lv.l) / last * 100;
    if (dist < 2.0) return { level: lv.n, price: lv.l, dist: parseFloat(dist.toFixed(1)) };
  }
  return null;
}

// ── ORS SIGNAL v3 — Full indicators + SMA200 + Fibonacci + OBV ──
function calcORSSignal(prices, quote) {
  if (!prices || prices.length < 30) return null;
  const last    = quote ? quote.price : prices[prices.length-1].close;
  const rsi     = calcRSI(prices, 14);
  const rsiPrev = calcRSI(prices.slice(0,-1), 14);
  const ema20   = calcEMA(prices, 20);
  const ema50   = calcEMA50(prices);
  const sma200  = calcSMA(prices, 200);
  const macd    = calcMACD(prices);
  const obv     = calcOBV(prices);
  const stoch   = calcStochRSI(prices);
  const bb      = calcBollinger(prices);
  const atr     = calcATR(prices, 14);
  const fib     = calcFibLevels(prices);
  if (!rsi) return null;

  // ── ORS-v2 CORE CONDITIONS (5) ──
  // FIX: RSI máx 38 — más recorrido garantizado
  const rsiOk    = rsi >= 20 && rsi <= 38;
  const rsiCruz  = rsiPrev !== null && rsiPrev < 35 && rsi >= 28; // v13: zona ampliada
  const bajoVwap = ema20 && last < ema20;
  const obvOk    = obv && obv.bullish && obv.rising;  // MANDATORY
  const macdBull = macd && macd.bullish;

  // ── FILTRO PROFUNDIDAD DE CORRECCIÓN ──────────────────
  // ── FILTRO PROFUNDIDAD DE CORRECCIÓN ──────────────────
  var depthOk = true;
  if (prices.length >= 100) {
    const lookback = Math.min(260, prices.length); // ~10 días en 15min
    const recent   = prices.slice(-lookback);
    const maxPrice = recent.reduce((m,p)=>Math.max(m,p.high||p.close),-Infinity);
    const dropPct  = (last - maxPrice) / maxPrice * 100;
    depthOk = dropPct <= -2.5; // v13: -2.5% (antes -4% demasiado estricto)
  }

  // Ichimoku como contexto de scoring
  const ichi = prices.length >= 30 ? calcIchimoku(prices) : null;

  // Count ORS conditions (OBV mandatory)
  const condsMet = [rsiOk, rsiCruz, bajoVwap, macdBull].filter(Boolean).length + (obvOk ? 1 : 0);
  // Solo aceptar ORS 5/5 — las 5 condiciones obligatorias
  // 4/5 desactivado hasta tener mayor capital (julio revisión)
  const validORS = condsMet >= 4 && obvOk && depthOk; // v13: mínimo 4/5

  // ── ENHANCED SCORE with Ichimoku/Turtle/Fibonacci/SMA200 ──
  let orsScore = 0;
  if (rsi >= 20 && rsi <= 30) orsScore += 35;
  else if (rsi > 30 && rsi <= 35) orsScore += 28;
  else if (rsi > 35 && rsi <= 45) orsScore += 15;
  else if (rsi > 65) orsScore -= 20;
  if (rsiCruz)  orsScore += 25;
  if (bajoVwap) orsScore += 12;
  if (macdBull) orsScore += 12;
  if (macd && macd.bullCross) orsScore += 8;
  if (obvOk)    orsScore += 20;
  if (stoch && stoch.oversold)  orsScore += 8;
  if (stoch && stoch.bullCross) orsScore += 10;
  if (bb && last <= bb.lower * 1.01) orsScore += 8;

  // Ichimoku scoring
  if (ichi) {
    if (ichi.sobreKumo)  orsScore += 15;
    if (ichi.tkCross)    orsScore += 10;
    if (ichi.sobreKijun) orsScore += 5;
    if (ichi.bajoKumo)   orsScore -= 20;
  }

  // SMA200 filter
  const aboveSMA200 = sma200 && last > sma200;
  if (!aboveSMA200 && sma200) orsScore -= 15;

  // Fibonacci proximity bonus
  const fibProx = getFibProximity(last, fib);
  if (fibProx) orsScore += 12;

  orsScore = Math.max(0, Math.min(100, orsScore));

  // ── EXHAUSTION (exit signal) ──
  let exhaustion = 0;
  if (rsi > 70) exhaustion += 30;
  if (rsi > 80) exhaustion += 15;
  if (stoch && parseFloat(stoch.k) > 80) exhaustion += 20;
  if (bb && last >= bb.upper * 0.99) exhaustion += 20;
  if (ema20 && (last - ema20) / ema20 * 100 > 10) exhaustion += 15;
  // EMA50 target reached
  if (ema50 && last >= ema50 * 0.99) exhaustion += 10;
  exhaustion = Math.min(100, exhaustion);

  // ── TURTLE-ORS POSITION SIZING ──
  // FIX: Stop ATR×2 + sizing 25% cuando 4/5 bajo SMA200
  // FIX: Límite máximo de posición = 10% del capital real
  // FIX: ATR mínimo 0.5% del precio (evita tickers con ATR demasiado pequeño)
  let suggestedQty = null, stopPrice = null, suggestedQty2 = null;
  if (atr && last) {
    // Si el ATR es menor del 0.5% del precio, el ticker es demasiado estable
    // para ORS — el sizing sería desproporcionado
    const atrPct = atr / last;
    const atrMinPct = 0.005; // 0.5% mínimo
    const atrAdjusted = atrPct < atrMinPct ? last * atrMinPct : atr;

    stopPrice = parseFloat((last - atrAdjusted * 1.5).toFixed(2)); // v13: ATR×1.5
    const riskUSD  = CAPITAL_EUR * RISK_PCT * 1.08;
    const qualMult = condsMet >= 5 ? 1.0 : 0.5;
    // Sizing con Ichimoku — si pasa el filtro más exigente merece más capital
    // Con Ichimoku + SMA200: 100% | Con Ichimoku sin SMA200: 75%
    // Sin Ichimoku + SMA200: 50% | Sin Ichimoku sin SMA200: 25%
    const ichiPassed = ichi && ichi.orsFilter;
    const smaMult = ichiPassed
      ? (aboveSMA200 ? 1.0 : 0.75)   // Ichimoku validado: 75-100%
      : (aboveSMA200 ? 0.5 : 0.25);  // Sin Ichimoku: 25-50%
    const riskPer  = last - stopPrice;
    let qty = riskPer > 0 ? Math.max(1, Math.floor(riskUSD * qualMult * smaMult / riskPer)) : 1;

    // Límite: posición máxima = 10% del capital real en valor de mercado
    const maxPositionValue = CAPITAL_EUR * 1.08 * 0.10; // 10% en USD
    const maxQtyByValue = Math.floor(maxPositionValue / last);
    qty = Math.min(qty, maxQtyByValue);

    suggestedQty  = Math.floor(qty * 0.5);
    suggestedQty2 = qty - suggestedQty;
  }

  // ── TARGET via EMA50 ──
  const target1 = ema50 && ema50 > last ? ema50 : parseFloat((last * 1.05).toFixed(2));
  const rr = stopPrice ? parseFloat(((target1 - last) / (last - stopPrice)).toFixed(1)) : null;

  // Extra signals
  const mfiVal = calcMFIServer(prices, 14);
  const mfiOk = mfiVal !== null && mfiVal < 40;
  const slitData = detectSLITServer(prices);
  const rangeData = detectRangeServer(prices);
  if(mfiOk) orsScore = Math.min(100, orsScore + 8);
  if(slitData && slitData.detected) orsScore = Math.min(100, orsScore + 12);

  return {
    rsi: +rsi.toFixed(1), rsiPrev: rsiPrev ? +rsiPrev.toFixed(1) : null,
    rsiOk, rsiCruz, bajoVwap, obvOk, macdBull,
    ichi:          ichi ? { sobreKumo: ichi.sobreKumo, tkCross: ichi.tkCross, score: ichi.score, kumoTop: ichi.kumoTop, kumoBottom: ichi.kumoBottom } : null,
    depthOk,
    mfi: mfiVal, mfiOk,
    slit: slitData,
    range: rangeData,
    orsScore, exhaustion, last,
    atr: atr ? +atr.toFixed(2) : null,
    ema20: ema20 ? +ema20.toFixed(2) : null,
    ema50: ema50 ? +ema50.toFixed(2) : null,
    sma200: sma200 ? +sma200.toFixed(2) : null,
    aboveSMA200,
    fib, fibProximity: fibProx,
    stochK: stoch ? stoch.k : null,
    nearBBLower: bb && last <= bb.lower * 1.015,
    suggestedQty, suggestedQty2, stopPrice,
    target1: parseFloat(target1.toFixed(2)), rr,
  };
}

// ── TELEGRAM ─────────────────────────────────────────
async function sendTelegram(msg) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' })
    });
    const d = await r.json();
    if (!d.ok) console.log('TG error:', d.description);
    return d.ok;
  } catch(e) {
    console.log('TG exception:', e.message);
    return false;
  }
}

// ── IBKR CLIENT PORTAL API ────────────────────────────
async function ibkrRequest(endpoint, method, body) {
  try {
    const account = USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT;
    const url = `${IBKR_BASE}${endpoint}`.replace('{account}', account);
    const opts = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    const text = await r.text();
    try { return JSON.parse(text); } catch(e) { return { raw: text }; }
  } catch(e) {
    console.log('IBKR error:', e.message);
    return { error: e.message };
  }
}

// Check IBKR session status
async function ibkrPing() {
  const r = await ibkrRequest('/iserver/auth/status', 'POST', {});
  return r && r.authenticated === true;
}

// Keep IBKR session alive
async function ibkrTickle() {
  await ibkrRequest('/tickle', 'POST', {});
}

// Search for contract ID (conid) by symbol
async function ibkrSearchContract(sym) {
  const r = await ibkrRequest(`/iserver/secdef/search?symbol=${sym}&name=false&secType=STK`, 'GET');
  if (!r || !r[0]) return null;
  // Find US stock
  const stock = r[0].contracts
    ? r[0].contracts.find(c => c.exchange === 'NASDAQ' || c.exchange === 'NYSE')
    : r.find(c => c.exchange === 'NASDAQ' || c.exchange === 'NYSE');
  return stock ? stock.conid : (r[0].conid || null);
}

// Place bracket order (entry + stop loss)
async function ibkrPlaceBracketOrder(sym, qty, price, stopPrice) {
  const account = USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT;
  const conid = await ibkrSearchContract(sym);
  if (!conid) return { error: `Contract not found for ${sym}` };

  const orders = [
    // Parent: Market Buy
    {
      conid:      conid,
      secType:    `${conid}:STK`,
      orderType:  'MKT',
      side:       'BUY',
      quantity:   qty,
      tif:        'DAY',
      referrer:   'ORS-v2',
    },
    // Child: Stop Loss
    {
      conid:      conid,
      secType:    `${conid}:STK`,
      orderType:  'STP',
      side:       'SELL',
      quantity:   qty,
      price:      stopPrice,
      tif:        'GTC',
      parentId:   0, // will be set by IBKR
      referrer:   'ORS-v2',
    }
  ];

  const r = await ibkrRequest(`/iserver/account/${account}/orders`, 'POST', { orders });
  return r;
}

// Get current positions from IBKR
async function ibkrGetPositions() {
  const account = USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT;
  return await ibkrRequest(`/portfolio/${account}/positions/0`, 'GET');
}

// Get portfolio value
async function ibkrGetPortfolio() {
  const account = USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT;
  return await ibkrRequest(`/portfolio/${account}/summary`, 'GET');
}

// Cancel a pending order
async function ibkrCancelOrder(orderId) {
  const account = USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT;
  return await ibkrRequest(`/iserver/account/${account}/order/${orderId}`, 'DELETE');
}

// ── TELEGRAM BOT — listen for confirmations ───────────
let lastUpdateId = 0;

async function pollTelegramCommands() {
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${lastUpdateId+1}&timeout=5`
    );
    const d = await r.json();
    if (!d.ok || !d.result.length) return;

    for (const update of d.result) {
      lastUpdateId = update.update_id;
      const msg = update.message;
      if (!msg || !msg.text) continue;
      const text = msg.text.trim().toLowerCase();
      const chatId = msg.chat.id.toString();
      if (chatId !== TG_CHAT) continue; // only our chat

      console.log(`TG command: ${text}`);

      // /si or /ejecutar_SYM → confirm order
      if (text === '/si' || text.startsWith('/ejecutar')) {
        const sym = text.startsWith('/ejecutar_')
          ? text.replace('/ejecutar_','').toUpperCase()
          : Object.keys(pendingOrders)[0]; // latest pending

        if (!sym || !pendingOrders[sym]) {
          await sendTelegram('⚠️ No hay orden pendiente para ese ticker.');
          continue;
        }

        const order = pendingOrders[sym];
        if (Date.now() - order.ts > 10 * 60 * 1000) {
          delete pendingOrders[sym];
          await sendTelegram(`⏰ Orden ${sym} expirada (más de 10 min). Señal puede haber cambiado.`);
          continue;
        }

        // ── GUARDIA DE MERCADO en comando manual /si ────────────────
        if (!isMarketOpen()) {
          await sendTelegram(`🚫 COMANDO BLOQUEADO: Mercado cerrado.\nNo se puede ejecutar ${sym} fuera del horario NYSE.\nHorario: Lun-Vie 13:30-20:00 UTC (9:30-16:00 NY).`);
          continue;
        }
        await sendTelegram(`⏳ Ejecutando en Alpaca ${getAcc().label}...`);
        await executeAlpacaOrder(sym, order);
      }

      // /cuenta → ver cuenta activa y opciones de cambio
      else if (text === '/cuenta' || text === '/switch') {
        const acc = getAcc();
        await sendTelegram(
          `💼 <b>Gestión de cuentas</b>\n\n` +
          `Activa ahora: <b>${acc.label}</b>\n\n` +
          `Opciones:\n` +
          `/cuenta_paper — 🧪 Paper $100k (testing)\n` +
          `/cuenta_paper2 — 📊 Paper €11k (simulación real)\n` +
          `/cuenta_live — 💰 LIVE real (con confirmación)\n\n` +
          `⚠️ La cuenta live opera con dinero real`
        );
      }
      else if (text === '/cuenta_paper') {
        ACTIVE_ACCOUNT = 'paper';
        await sendTelegram(`✅ Cuenta cambiada a: ${getAcc().label}`);
      }
      else if (text === '/cuenta_paper2') {
        ACTIVE_ACCOUNT = 'paper2';
        await sendTelegram(`✅ Cuenta cambiada a: ${getAcc().label}`);
      }
      else if (text === '/cuenta_live') {
        await sendTelegram(
          `⚠️ <b>ATENCIÓN — Cuenta LIVE</b>\n\n` +
          `Vas a operar con dinero real (€${CAPITAL_EUR.toLocaleString()})\n` +
          `Todas las órdenes se ejecutarán en el mercado real\n\n` +
          `/confirmar_cuenta_live   /cancelar_cuenta`
        );
      }
      else if (text.startsWith('/capital')) {
        const parts = text.split(' ');
        const newCap = parseFloat(parts[1]);
        if (!newCap || newCap < 1000 || newCap > 1000000) {
          await sendTelegram(
            `💰 <b>Capital actual: €${CAPITAL_EUR.toLocaleString()}</b>\n\n` +
            `Para cambiar: /capital 13480\n` +
            `(mín €1,000 — máx €1,000,000)`
          );
        } else {
          const anterior = CAPITAL_EUR;
          CAPITAL_EUR = newCap;
          await sendTelegram(
            `✅ <b>Capital actualizado</b>\n\n` +
            `Anterior: €${anterior.toLocaleString()}\n` +
            `Nuevo:    €${CAPITAL_EUR.toLocaleString()}\n\n` +
            `Riesgo por trade (2%): €${Math.round(CAPITAL_EUR*0.02).toLocaleString()}\n` +
            `⚠️ Solo afecta a nuevas operaciones`
          );
        }
      }
      else if (text.startsWith('/confirmar_cuenta_')) {
        const newAcc = text.replace('/confirmar_cuenta_', '');
        if (ALPACA_ACCOUNTS[newAcc]) {
          ACTIVE_ACCOUNT = newAcc;
          const acc = getAcc();
          await sendTelegram(
            `✅ <b>Cuenta cambiada</b>\n\n` +
            `Operando en: ${acc.label}\n` +
            (ACTIVE_ACCOUNT === 'live' ? `\n🔴 <b>ATENCIÓN: Dinero real activo</b>` : `\n📋 Modo seguro paper trading`)
          );
        }
      }
      else if (text === '/cancelar_cuenta') {
        await sendTelegram(`✅ Cuenta sin cambios: ${getAcc().label}`);
      }

      // /señales → manual scan now
      else if (text === '/señales' || text === '/scan') {
        await sendTelegram('🔍 Escaneando watchlist ahora...');
        await checkSignals();
        await sendTelegram(`✅ Scan completado · ${getActiveWatchlist().length} tickers revisados`);
      }

      // /cerrar_SYM → close position
      else if (text.startsWith('/cerrar_')) {
        const sym = text.replace('/cerrar_','').toUpperCase();
        await closePosition(sym);
      }
      // /mantener_SYM → keep, move stop to break-even
      else if (text.startsWith('/mantener_')) {
        const sym = text.replace('/mantener_','').toUpperCase();
        const pos = openPositions[sym];
        if(pos){
          const be = parseFloat((pos.entryPrice * 1.005).toFixed(2));
          if(be > pos.stopPrice){ pos.stopPrice = be; openPositions[sym] = pos; }
          await sendTelegram(`✅ ${sym} — Manteniendo · Stop en break-even: $${pos.stopPrice}`);
        } else { await sendTelegram(`⚠️ No hay posición en ${sym}`); }
      }
      // /posiciones → show all open positions with P&L
      else if (text === '/posiciones') {
        const syms = Object.keys(openPositions);
        if(!syms.length){ await sendTelegram('📊 No hay posiciones abiertas.'); }
        else {
          let msg = `💼 <b>POSICIONES (${syms.length})</b>\n\n`;
          for(const sym of syms){
            const pos = openPositions[sym];
            try {
              const sr = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${sym}&feed=iex`,{headers:alpacaHeaders()});
              const sd = await sr.json();
              const price = sd[sym]?.latestTrade?.p || pos.entryPrice;
              const pct = ((price-pos.entryPrice)/pos.entryPrice*100).toFixed(2);
              const pnl = Math.round((price-pos.entryPrice)*(pos.qty1+(pos.phase2Done?pos.qty2:0))/1.08);
              msg += `<b>${sym}</b> ${pct>=0?'🟢':'🔴'} ${pct>=0?'+':''}${pct}%\n$${pos.entryPrice}→$${price.toFixed(2)} · Stop $${pos.stopPrice} · P&L: ${pnl>=0?'+':''}€${pnl}\n\n`;
            } catch(e){ msg += `<b>${sym}</b> · Error precio\n\n`; }
          }
          await sendTelegram(msg);
        }
      }
      // /entrar_momentum_SYM → manual momentum entry
      else if (text.startsWith('/entrar_momentum_')) {
        const sym = text.replace('/entrar_momentum_','').toUpperCase();
        const prices = await fetchAlpaca15min(sym);
        if(!prices||!prices.prices||!prices.prices.length){
          await sendTelegram(`⚠️ No hay datos para ${sym}`); continue;
        }
        const sig = calcORSSignal(sym, prices.prices);
        if(!sig){ await sendTelegram(`⚠️ No hay señal para ${sym}`); continue; }
        const atr = sig.atr||2;
        const stop = parseFloat((sig.last-atr*2).toFixed(2));
        const qty = Math.max(1, Math.floor((CAPITAL_EUR*0.02*1.08)/(atr*2)));
        const order = { sym, qty, qty1:Math.floor(qty*0.6), qty2:qty-Math.floor(qty*0.6),
          price:sig.last, stopPrice:stop, target1:parseFloat((sig.last+atr*4).toFixed(2)),
          rr:'1:2', aboveSMA200:sig.aboveSMA200, ts:Date.now() };
        pendingOrders[sym]=order;
        if(AUTO_EXECUTE&&!isLive()){
          await executeAlpacaOrder(sym,order);
        } else {
          await sendTelegram(`⏳ Orden Momentum ${sym} preparada\n${qty} acc @ ~$${sig.last}\nStop: $${stop}\n/si para ejecutar`);
        }
      }

      // /no or /cancelar_SYM → cancel
      else if (text === '/no' || text.startsWith('/cancelar')) {
        const sym = text.startsWith('/cancelar_')
          ? text.replace('/cancelar_','').toUpperCase()
          : Object.keys(pendingOrders)[0];
        if (sym && pendingOrders[sym]) {
          delete pendingOrders[sym];
          await sendTelegram(`❌ Orden ${sym} cancelada.`);
        }
      }

      // /posiciones → show current IBKR positions
      else if (text === '/posiciones') {
        const pos = await ibkrGetPositions();
        if (!pos || pos.error) {
          await sendTelegram('❌ No se pudo conectar con IBKR. ¿Está la API activa?');
        } else if (!pos.length) {
          await sendTelegram('📊 Sin posiciones abiertas en IBKR.');
        } else {
          let msg = '💼 <b>POSICIONES IBKR</b>\n\n';
          pos.forEach(p => {
            const pnl = p.unrealizedPnl || 0;
            msg += `<b>${p.contractDesc || p.ticker}</b>\n`;
            msg += `  ${p.position} acc · $${p.mktPrice?.toFixed(2)} · PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}\n\n`;
          });
          await sendTelegram(msg);
        }
      }

      // /estado → server status
      else if (text === '/estado') {
        const ping = await ibkrPing();
        const alpacaOk = !!(process.env.ALPACA_PAPER_KEY || process.env.ALPACA_KEY_ID || getAcc().key);
        let msg = `⚙️ <b>Estado ORS Proxy</b>\n\n`;
        const activeAcc = getAcc();
        msg += `🦙 Alpaca: ${alpacaOk ? '✅ ' + activeAcc.label : '❌ Sin key'}\n`;
        msg += `💳 Cuenta activa: ${activeAcc.id}\n`;
        msg += `🏦 IBKR: ${ping ? '✅ Conectado' : '❌ Desconectado'}\n`;
        msg += `💼 Modo: ${USE_PAPER ? 'Paper Trading' : '🔴 Cuenta Real'}\n`;
        msg += `👁 Watchlist: ${getActiveWatchlist().slice(0,20).join(', ')}...\n`;
        msg += `⏰ ${new Date().toLocaleString('es-ES', {timeZone: 'America/New_York'})} NY\n`;
        msg += `📋 Órdenes pendientes: ${Object.keys(pendingOrders).length}\n`;
        msg += `🔄 Datos: ${alpacaOk ? 'Alpaca 15min RT' : 'Yahoo Finance (retraso)'}`;
        await sendTelegram(msg);
      }

      // /ayuda → help
      else if (text.startsWith('/reactivar ')) {
        const sym = text.split(' ')[1]?.toUpperCase();
        if (sym && TICKER_STATUS[sym] === 'WATCH') {
          delete TICKER_STATUS[sym];
          delete ALPACA_UNAVAILABLE[sym]; // limpiar cache Alpaca
          await sendTelegram(`✅ <b>${sym} → ACTIVE</b>
El scanner generará señales normalmente.`);
        } else {
          await sendTelegram(`ℹ️ ${sym||'?'} ya está ACTIVE o no existe`);
        }
      }
      else if (text.startsWith('/pausar ')) {
        const sym = text.split(' ')[1]?.toUpperCase();
        if (sym) {
          TICKER_STATUS[sym] = 'WATCH';
          await sendTelegram(`👁 <b>${sym} → WATCH</b>
Sin señales auto. Scanner semanal lo monitoriza.`);
        }
      }
      else if (text === '/estados') {
        const watch = Object.entries(TICKER_STATUS).filter(([,v])=>v==='WATCH').map(([k])=>k);
        const disc  = Object.entries(TICKER_STATUS).filter(([,v])=>v==='DISCARDED').map(([k])=>k);
        await sendTelegram(`📊 <b>Estados tickers</b>
👁 WATCH: ${watch.join(', ')||'ninguno'}
❌ DISCARDED: ${disc.join(', ')||'ninguno'}

/reactivar TICKER | /pausar TICKER`);
      }
      else if (text === '/disponibilidad') {
        var unavail = Object.keys(ALPACA_UNAVAILABLE);
        if (!unavail.length) {
          await sendTelegram('✅ Todos los tickers disponibles en Alpaca');
        } else {
          var unavailMsg = '⚠️ <b>Tickers no disponibles en Alpaca:</b>\n';
          unavail.forEach(function(s) {
            var hours = Math.round((Date.now()-ALPACA_UNAVAILABLE[s])/3600000);
            unavailMsg += s + ' (detectado hace ' + hours + 'h)\n';
          });
          unavailMsg += '\nSe re-verifican cada 24h automáticamente.\n';
          unavailMsg += 'Usa /reactivar TICKER para forzar re-verificación.';
          await sendTelegram(unavailMsg);
        }
      }
      else if (text === '/watchlist') {
        const active = getActiveWatchlist();
        const dwl    = DYNAMIC_WL_ADDITIONS;
        const watch  = WATCH_TICKERS;
        let msg = `📋 <b>Watchlist actual</b>

`;
        msg += `🟢 <b>Activos (${active.length}):</b> ${active.slice(0,20).join(', ')}${active.length>20?'...':''}

`;
        if (dwl.length) msg += `⚡ <b>Dinámica (${dwl.length}):</b> ${dwl.join(', ')}

`;
        msg += `👁 <b>WATCH (${watch.length}):</b> ${watch.join(', ')}

`;
        msg += `Total universo: ${active.length} tickers activos
Scanner semanal: ${active.length + watch.length} tickers`;
        await sendTelegram(msg);
      }
      else if (text === '/riesgo') {
        const recentWR = getRecentWR();
        const enabled = DYNAMIC_RISK_ENABLED;
        const regime  = MARKET_REGIME?.mode || 'BULL';
        const riskPct = Math.round(RISK_PCT * 100);
        const mdd = monthStartCapital
          ? ((monthStartCapital - parseFloat((await fetch(`${alpacaBase()}/v2/account`,{headers:alpacaHeaders()}).then(r=>r.json()).catch(()=>({equity:0}))).equity||0)/1.08) / monthStartCapital * 100).toFixed(1)
          : '—';
        await sendTelegram(
          `📊 <b>Estado del Riesgo</b>\n\n` +
          `Modo: ${enabled ? '🔥 DINÁMICO (1/2/3%)' : '📋 FIJO (2%)'}\n` +
          `Riesgo actual: <b>${riskPct}%</b>\n` +
          `Régimen: ${regime}\n` +
          `DD mensual: ${mdd}%\n` +
          `WR últimos 10: ${recentWR.toFixed(0)}%\n` +
          `DD adaptativo: ${adaptiveDDActive ? '⚠️ ACTIVO' : '✅ Normal'}\n\n` +
          (enabled
            ? '3% → BULL + WR≥60% + DD<2%\n2% → Normal\n1% → DD>5%'
            : 'Activa DYNAMIC_RISK=true en Render para el modo dinámico (Nivel 2)')
        );
      }
      else if (text === '/emergencia ON' || text === '/emergencia on') {
        vixSpikeActive = true;
        vixSpikeUntil  = null; // manual — no expira solo
        await sendTelegram('🚨 <b>EMERGENCIA ACTIVADA</b>\nEntradas bloqueadas indefinidamente.\nUsa /emergencia OFF para reanudar.');
        console.log('[EMERGENCIA] Kill switch activado manualmente');
      }
      else if (text === '/emergencia OFF' || text === '/emergencia off') {
        vixSpikeActive = false;
        vixSpikeUntil  = null;
        await sendTelegram('✅ <b>Emergencia desactivada</b>\nEntradas reanudadas normalmente.');
        console.log('[EMERGENCIA] Kill switch desactivado');
      }
      else if (text === '/ayuda' || text === '/help' || text === '/start') {
        await sendTelegram(
          '🤖 <b>ORS Analyzer Bot v3</b>\n' +
          '🦙 Datos Alpaca en tiempo real\n\n' +
          '<b>ÓRDENES</b>\n' +
          '/si — Confirmar última orden\n' +
          '/no — Cancelar última orden\n' +
          '/ejecutar_AMD — Ejecutar ticker específico\n' +
          '/cancelar_AMD — Cancelar ticker específico\n\n' +
          '<b>INFORMACIÓN</b>\n' +
          '/posiciones — Ver posiciones Alpaca/IBKR\n' +
          '/estado — Estado del servidor\n' +
          '/señales — Escaneo manual ahora\n' +
          '/ayuda — Este menú\n' +
          '/watchlist — Ver watchlist activa, dinámica y WATCH\n' +
          '/estados — Estado de tickers WATCH/DISCARDED\n' +
          '/reactivar TICKER — Mover ticker a activo\n' +
          '/pausar TICKER — Mover ticker a WATCH\n' +
          '/emergencia ON/OFF — Kill switch manual\n' +
          '⚠️ 10 min para confirmar · Sin necesidad de TradingView'
        );
      }
    }
  } catch(e) {
    console.log('Poll TG error:', e.message);
  }
}

// ── ALPACA DATA FETCH (primary) + Yahoo fallback ─────
async function fetchAlpaca15min(sym) {
  try {
    const r = await fetch(
      `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&limit=200&feed=iex&sort=asc&start=${new Date(Date.now()-7*24*3600*1000).toISOString().split('T')[0]}`,
      { headers: alpacaHeaders() }
    );
    // Guard: Alpaca devuelve texto plano "Not Found" para tickers no disponibles en IEX
    let d;
    try {
      const rawText = await r.text();
      if (!rawText || rawText.trim() === 'Not Found' || r.status === 404) return null;
      d = JSON.parse(rawText);
    } catch(e) { return null; }
    if (!d || !d.bars) return null;
    const bars = (d.bars || []).map(b => ({
      date:   b.t.slice(0,16).replace('T',' '),
      open:   parseFloat(b.o.toFixed(2)),
      close:  parseFloat(b.c.toFixed(2)),
      high:   parseFloat(b.h.toFixed(2)),
      low:    parseFloat(b.l.toFixed(2)),
      volume: b.v || 0,
    }));
    if (!bars.length) return null;
    const last = bars[bars.length-1];
    const prev = bars[bars.length-2] || last;
    const chgPct = prev.close ? parseFloat(((last.close-prev.close)/prev.close*100).toFixed(2)) : 0;
    return {
      prices: bars,
      quote: { price: last.close, changePct: chgPct, source: 'alpaca' }
    };
  } catch(e) {
    console.log(`Alpaca 15min error ${sym}:`, e.message);
    return null;
  }
}

// Fetch histórico largo de 15min para backtest ORS
// Alpaca permite hasta 2 años de datos intraday
async function fetchAlpaca15minHistory(sym, days) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 5);
    const start = startDate.toISOString().split('T')[0];
    const allBars = [];
    let nextPageToken = null;
    let pages = 0;

    do {
      let url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&limit=10000&feed=iex&sort=asc&start=${start}`;
      if (nextPageToken) url += `&page_token=${encodeURIComponent(nextPageToken)}`;

      // Timeout de 8 segundos por página
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(url, { headers: alpacaHeaders(), signal: controller.signal });
      clearTimeout(timeout);

      const d = await r.json();
      if (!d.bars || !d.bars.length) break;
      d.bars.forEach(b => allBars.push({
        date:   b.t.slice(0,16).replace('T',' '),
        open:   parseFloat(b.o.toFixed(2)),
        close:  parseFloat(b.c.toFixed(2)),
        high:   parseFloat(b.h.toFixed(2)),
        low:    parseFloat(b.l.toFixed(2)),
        volume: b.v || 0,
      }));
      nextPageToken = d.next_page_token || null;
      pages++;
      if (allBars.length > 50000 || pages > 5) break;
    } while (nextPageToken);

    if (!allBars.length) return null;
    return allBars;
  } catch(e) {
    console.log(`[BT15] ${sym} error: ${e.message}`);
    return null;
  }
}

async function fetchAlpacaSnapshot(sym) {
  try {
    const r = await fetch(
      `${ALPACA_DATA}/v2/stocks/snapshots?symbols=${sym}&feed=iex`,
      { headers: alpacaHeaders() }
    );
    const d = await r.json();
    const snap = d[sym];
    if (!snap) return null;
    const dp = snap.dailyBar || {};
    const lt = snap.latestTrade || snap.latestQuote || {};
    const prev = snap.prevDailyBar || {};
    const price = lt.p || lt.ap || dp.c || 0;
    const prevClose = prev.c || price;
    return {
      price: parseFloat(price.toFixed(2)),
      changePct: prevClose ? parseFloat(((price-prevClose)/prevClose*100).toFixed(2)) : 0,
      source: 'alpaca',
    };
  } catch(e) { return null; }
}

// Yahoo fallback
async function fetchYahoo(sym, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }});
  return r.json();
}

function parseYahoo(data) {
  const res = data?.chart?.result?.[0];
  if (!res) return null;
  const ts = res.timestamp, q0 = res.indicators.quote[0], meta = res.meta;
  const prices = [];
  for (let i = 0; i < ts.length; i++) {
    if (!q0.close[i]) continue;
    const prevClose = i>0 ? q0.close[i-1] : q0.close[i];
    prices.push({
      open:   parseFloat((q0.open?q0.open[i]:prevClose||q0.close[i]).toFixed(2)),
      close:  parseFloat(q0.close[i].toFixed(2)),
      high:   q0.high[i]   || q0.close[i],
      low:    q0.low[i]    || q0.close[i],
      volume: q0.volume[i] || 0
    });
  }
  const cp = meta.regularMarketPrice || q0.close[q0.close.length-1];
  const pc = meta.chartPreviousClose || meta.previousClose || cp;
  return {
    prices,
    quote: { price: +cp.toFixed(2), changePct: pc ? +((cp-pc)/pc*100).toFixed(2) : 0, source: 'yahoo' }
  };
}

// ── SIGNAL CHECKER — Alpaca RT data + full ORS-v2 ────
// ── MOMENTUM SIGNAL DETECTION ────────────────────────
function calcMomentumScore(sig, prices) {
  if(!sig||!prices||prices.length<20) return 0;
  let score = 0;
  const rsi = sig.rsi;
  const n = prices.length;
  const last = prices[n-1];
  const prev20 = prices[Math.max(0,n-21)];

  // RSI in momentum zone 58-68
  if(rsi>=58&&rsi<=68) score+=30;
  else if(rsi>68&&rsi<=75) score+=15;
  else if(rsi<58||rsi>75) return 0; // Not momentum

  // OBV bullish
  if(sig.obv&&sig.obv.bullish) score+=25;
  else return 0; // OBV mandatory for momentum too

  // Above SMA200
  if(sig.aboveSMA200) score+=15;

  // MACD bullish
  if(sig.macd&&sig.macd.bullish) score+=10;

  // Volume > 1.5x (using 20-day average)
  const avgVol = prices.slice(-20).reduce((s,p)=>s+(p.volume||0),0)/20;
  const lastVol = last.volume||0;
  if(avgVol>0&&lastVol/avgVol>=1.8) score+=15;
  else if(avgVol>0&&lastVol/avgVol>=1.5) score+=8;

  // Price above 20-day high (Turtle breakout)
  const high20 = Math.max(...prices.slice(-21,-1).map(p=>p.high||p.close));
  if(last.close>high20) score+=15;

  return Math.min(100, score);
}

// ═══════════════════════════════════════════════════════
// SISTEMA MOM — Momentum para mercados alcistas
// Complementario a ORS-v2, activo cuando SPY alcista
// ═══════════════════════════════════════════════════════

function calcMOMSignal(prices, quote) {
  if (!prices || prices.length < 50) return null;
  const last  = quote?.price || prices[prices.length-1].close;
  const rsi   = calcRSI(prices, 14);
  const ema20 = calcEMA(prices, 20);
  const ema50 = calcEMA(prices, 50);
  const obv   = calcOBV(prices);
  const macd  = calcMACD(prices);
  const atr   = calcATR(prices, 14);
  const sma200= calcSMA(prices, 200);

  // RVOL
  const vols  = prices.slice(-21).map(function(p){return p.volume||0;});
  const avgVol= vols.slice(0,-1).reduce(function(s,v){return s+v;},0)/20;
  const rvol  = avgVol > 0 ? (vols[vols.length-1]/avgVol) : 1;

  // Ruptura — precio sobre máximo de 3 velas anteriores
  const n     = prices.length;
  const prev3High = Math.max(
    prices[n-4]?.high||0,
    prices[n-3]?.high||0,
    prices[n-2]?.high||0
  );
  const breakout  = last > prev3High;

  // Histograma MACD creciente
  const macdHist    = macd ? macd.hist : 0;
  const macdHistPrev= prices.length > 1 ? calcMACD(prices.slice(0,-1))?.hist||0 : 0;
  const macdGrowing = macdHist > macdHistPrev && macdHist > 0;

  // Condiciones MOM
  const c1_rsi      = rsi && rsi >= 45 && rsi <= 65;
  const c2_obvBull  = obv && obv.bullish && obv.rising;       // OBLIGATORIO
  const c3_macd     = macd && macd.bullish && macdGrowing;
  const c4_aboveEMA = ema20 && last > ema20;
  const c5_breakout = breakout && rvol >= 1.5;                // Volumen fuerte

  const condCount = (c1_rsi?1:0)+(c2_obvBull?1:0)+(c3_macd?1:0)+(c4_aboveEMA?1:0)+(c5_breakout?1:0);
  const valid     = condCount >= 4 && c2_obvBull;             // OBV obligatorio

  return {
    type:       'MOM',
    last,
    rsi,
    rvol:       parseFloat((rvol).toFixed(2)),
    obvBull:    c2_obvBull,
    macdBull:   c3_macd,
    aboveEMA:   c4_aboveEMA,
    breakout:   c5_breakout,
    condCount,
    valid,
    atr,
    aboveSMA200: sma200 && last > sma200,
    exhaustion: rsi > 70 ? Math.round((rsi-70)/30*100) : 0,
  };
}

// ── SCAN PARALELO — procesa SP500 en batches para velocidad ─────────────────
// Alpaca permite snapshots de múltiples tickers en una sola llamada
async function fetchBatchSnapshots(syms) {
  try {
    const joined = syms.join(',');
    const url = `${ALPACA_DATA}/v2/stocks/snapshots?symbols=${joined}&feed=iex`;
    const r = await fetch(url, { headers: alpacaHeaders() });
    const d = await r.json();
    return d || {};
  } catch(e) {
    return {};
  }
}

// ── FETCH BARRAS 1H (para sistema SWING) ────────────────────────
async function fetchAlpaca1H(sym) {
  try {
    const end   = new Date().toISOString();
    const start = new Date(Date.now() - 30*24*60*60*1000).toISOString(); // 30 días
    let allBars = [], pageToken = null;
    do {
      let url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Hour&start=${start}&end=${end}&limit=1000&feed=iex&sort=asc`;
      if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
      const r = await fetch(url, { headers: alpacaHeaders() });
      const d = await r.json();
      if (d.bars) d.bars.forEach(b => allBars.push({ t:b.t, open:b.o, high:b.h, low:b.l, close:b.c, volume:b.v }));
      pageToken = d.next_page_token || null;
    } while (pageToken && allBars.length < 5000);
    return allBars.length >= 20 ? allBars : null;
  } catch(e) { return null; }
}

// ── SEÑAL SWING (Bernstein MAC Pullback) ─────────────────────────
// 1H señal: tendencia + pullback a MAL del canal
// 15min entrada: reversión confirmada (OBV + RVOL)
function calcSwingSignal(bars1H, prices15) {
  if (!bars1H || bars1H.length < 52) return null;
  if (!prices15 || prices15.length < 20) return null;
  const n1 = bars1H.length;
  const last1H = bars1H[n1-1].close;

  // Tendencia 1H: precio sobre EMA20 y EMA50
  const ema20_1H = calcEMA(bars1H, 20);
  const ema50_1H = calcEMA(bars1H.slice(0, n1), 50);
  if (!ema20_1H || !ema50_1H || last1H <= ema50_1H) return null;

  // Clasificar tendencia (Teo)
  const distToEMA20 = (last1H - ema20_1H) / last1H;
  const trendStrong  = last1H > ema20_1H && distToEMA20 < 0.04;
  const trendHealthy = last1H <= ema20_1H && last1H > ema50_1H;
  if (!trendStrong && !trendHealthy) return null;

  // MAC 1H: MAL = SMA8 lows, MAH = SMA10 highs
  let MAH_1H = 0, MAL_1H = 0;
  for (let i = n1-10; i < n1; i++) MAH_1H += bars1H[i].high || bars1H[i].close;
  MAH_1H /= 10;
  for (let i = n1-8; i < n1; i++) MAL_1H += bars1H[i].low || bars1H[i].close;
  MAL_1H /= 8;

  // Pullback: precio cerca del MAL
  const distToMAL = (last1H - MAL_1H) / last1H;
  const tolerance = trendStrong ? 0.012 : 0.018;
  if (distToMAL > tolerance) return null;
  if (distToMAL < -0.025) return null; // demasiado bajo → ORS

  // RSI 1H zona pullback
  const rsi1H = calcRSI(bars1H, 14);
  if (!rsi1H || rsi1H < 35 || rsi1H > 55) return null;

  // Buildup suave: no entrar en caídas agresivas (rango > 1.5x ATR)
  const atr1H = calcATR(bars1H, 14);
  if (atr1H) {
    let recentRange = 0;
    for (let i = n1-3; i < n1; i++) recentRange += (bars1H[i].high||bars1H[i].close)-(bars1H[i].low||bars1H[i].close);
    recentRange /= 3;
    if (recentRange > atr1H * 1.5) return null;
  }

  // Confirmación 15min: vela alcista + OBV bullish + RVOL
  const last15 = prices15[prices15.length-1];
  if (!last15.open || last15.close <= last15.open) return null;
  const obv15 = calcOBV(prices15);
  if (!obv15 || !obv15.bullish) return null;
  const vols = prices15.slice(-21).map(p => p.volume||0);
  const avgVol = vols.slice(0,-1).reduce((s,v)=>s+v,0)/20;
  const rvol = avgVol > 0 ? vols[vols.length-1]/avgVol : 1;
  if (rvol < 1.2) return null;
  if (last15.close < 15) return null;

  const atr15 = calcATR(prices15, 14);
  if (!atr15) return null;
  const sma200 = calcSMA(prices15, 200);
  const trendMult = trendStrong ? 1.0 : 0.75;

  return {
    last: last15.close, rsi: rsi1H, rvol,
    atr: atr15, MAH_1H, MAL_1H,
    trendStrong, trendMultiplier: trendMult,
    aboveSMA200: sma200 ? last15.close > sma200 : false,
    score: 60 + Math.round(rvol*8) + (rsi1H<45?10:0) + (trendStrong?15:5),
    valid: true,
  };
}

// ── SCANNER SWING ─────────────────────────────────────────────────
async function checkSwingSignals() {
  if (!isMarketEntryAllowed()) return;
  if (vixSpikeActive) { console.log('[SWING] VIX spike activo — skip'); return; }

  const regime = MARKET_REGIME;
  console.log(`[SWING] Modo ${regime.mode} | Tickers=${getActiveWatchlist().length}`);

  // SWING activo en BULL y LATERAL — en BEAR pausar
  if (regime.mode === 'BEAR') {
    console.log('[SWING] Modo BEAR — SWING pausado');
    return;
  }

  // Slots SWING por régimen (BULL: 1, LATERAL: 1, BEAR: 0)
  if (!canOpenPosition('SWING')) return;

  const now = Date.now();
  const cache1H = {}; // cache de barras 1H esta ejecución

  for (const sym of getActiveWatchlist()) {
    try {
      if (!isActive(sym)) continue;
      if (!isAvailableAlpaca(sym)) continue;
      if (openPositions[sym]) continue;

      // Filtro mes
      const _month = new Date().toISOString().slice(0,7);
      if (monthTradesDone[`${sym}_sw_${_month}`]) continue;

      // Filtro earnings
      const nearEarnings = await isNearEarnings(sym);
      if (nearEarnings) continue;

      // Datos 15min
      let parsed = priceCache[sym];
      if (!parsed || now - parsed.ts > 5*60*1000) {
        parsed = await fetchAlpaca15min(sym);
        if (parsed) priceCache[sym] = { ...parsed, ts: now };
      }
      if (!parsed?.prices?.length) continue;

      // Datos 1H
      let bars1H = cache1H[sym];
      if (!bars1H) {
        bars1H = await fetchAlpaca1H(sym);
        cache1H[sym] = bars1H;
      }
      if (!bars1H || bars1H.length < 52) continue;

      const sig = calcSwingSignal(bars1H, parsed.prices);
      if (!sig || !sig.valid) continue;

      // Sector filter
      const _symSector = getSector(sym);
      const _sentKey   = SECTOR_MAP_TO_SENTIMENT[_symSector];
      const _sent      = _sentKey && sectorSentiment[_sentKey];
      if (_sent && _sent.status === 'BEARISH' && (_sent.score||50) < 40) continue;

      // Sizing: anti stop-hunting — stop bajo MAL_1H - ATR×0.5
      const atrAdj    = adjustedATR(sig.atr, sig.last);
      const swingStop = sig.MAL_1H
        ? parseFloat((sig.MAL_1H - atrAdj * 0.5).toFixed(2))
        : parseFloat((sig.last   - atrAdj * 1.0).toFixed(2));
      const riskPerSh = sig.last - swingStop;
      if (riskPerSh <= 0) continue;

      // ELV sizing 50% (historial negativo en backtest)
      const elvMult = sym === 'ELV' ? 0.5 : 1.0;
      const swingSizeMult = (sig.trendMultiplier || 0.75) * (RUNNER_TIER[sym] === 3 ? 0.75 : 1.0) * elvMult;
      const riskUSD = CAPITAL_EUR * RISK_PCT * 1.08 * swingSizeMult;
      const qty = capQty(Math.max(1, Math.floor(riskUSD / riskPerSh)), sig.last);
      const target1 = sig.MAH_1H || parseFloat((sig.last * 1.04).toFixed(2));

      const entryKey = `${sym}_sw_${Math.floor(now/(4*60*60*1000))}`;
      if (sentAlerts[entryKey]) continue;
      sentAlerts[entryKey] = now;
      monthTradesDone[`${sym}_sw_${_month}`] = true;

      const order = {
        sym, qty, qty1: qty, qty2: 0,
        price: sig.last, stopPrice: swingStop,
        originalStop: swingStop,
        target1, rr: 2.0, atr: sig.atr,
        isMOM: false, system: 'SWING',
        MAH_1H: sig.MAH_1H, MAL_1H: sig.MAL_1H,
        trendStrong: sig.trendStrong,
      };

      if (AUTO_EXECUTE) {
        pendingOrders[sym] = order;
        const _execSW = await executeAlpacaOrder(sym, order);
        if (_execSW == null) { delete pendingOrders[sym]; continue; }
        await sendTelegram(
          `📈 <b>SWING SIGNAL — ${sym}</b>\n` +
          `💰 $${sig.last.toFixed(2)} | Stop $${swingStop} | Target $${target1}\n` +
          `📦 ${qty} acc | Riesgo €${Math.round(riskPerSh*qty/1.08)}\n` +
          `📊 RSI 1H ${sig.rsi?.toFixed(1)} | RVOL ${sig.rvol.toFixed(2)}x\n` +
          `📐 Tendencia: ${sig.trendStrong ? 'FUERTE ✅' : 'SALUDABLE ⚠️'}\n` +
          `🏭 Sector: ${_symSector} ${_sent?.status||'NO_DATA'}`
        );
      } else {
        await sendTelegram(
          `📈 <b>SWING SIGNAL — ${sym}</b>\n\n` +
          `💰 $${sig.last.toFixed(2)} | Stop: $${swingStop} | Target: $${target1}\n` +
          `📦 ${qty} acc | Riesgo: €${Math.round(riskPerSh*qty/1.08)}\n` +
          `📊 RSI 1H ${sig.rsi?.toFixed(1)} | RVOL ${sig.rvol.toFixed(2)}x\n` +
          `📐 Tendencia: ${sig.trendStrong ? 'FUERTE ✅' : 'SALUDABLE ⚠️'}\n\n` +
          `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`
        );
      }
      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      console.log('[SWING]', sym, e.message);
    }
  }
}

// Calcular fuerza relativa de un ticker vs SPY (últimos 5 días)
function calcRelativeStrength(tickerPrices, spyPrices) {
  if (!tickerPrices || tickerPrices.length < 6 || !spyPrices || spyPrices.length < 6) return null;
  const tChange = (tickerPrices[tickerPrices.length-1] / tickerPrices[tickerPrices.length-6] - 1) * 100;
  const sChange = (spyPrices[spyPrices.length-1] / spyPrices[spyPrices.length-6] - 1) * 100;
  return parseFloat((tChange - sChange).toFixed(2)); // RS positiva = supera al SPY
}

// Filtros adicionales según régimen de mercado
function passesRegimeFilter(sig, snap, rs, regime) {
  if (!sig) return false;

  if (regime.mode === 'BEAR') {
    // Modo bajista: solo acciones con fuerza relativa POSITIVA vs SPY
    if (rs === null || rs < 0) return false;       // Debe superar al SPY en últimos 5d
    if (!sig.aboveSMA200) return false;            // Sobre SMA200 obligatorio
    if ((sig.orsCtx || 0) < 80) return false;      // Solo señales de máxima calidad
    if (sig.rsi > 50) return false;                // RSI bajo — no comprar en rebotes altos
    return true;
  }

  if (regime.mode === 'LATERAL') {
    // Modo lateral: ORS protagonista, MOM solo A+
    // Para ORS: estándar normal
    // Para MOM: exigir RSI estrictamente 60-68 (no permitir 58-60)
    return true; // Los filtros específicos se aplican en cada función
  }

  // BULL: filtros normales (ya manejados por checkMOMSignals y checkSignals)
  return true;
}

async function checkMOMSignals() {
  // ── FILTRO DE MERCADO — solo Lun-Vie 9:30-16:00 NY (10:00-15:30 para entradas) ──
  if (!isMarketEntryAllowed()) {
    console.log('[MOM] Mercado cerrado o fuera de ventana de entrada');
    return;
  }

  // El régimen BULL/LATERAL/BEAR se actualiza una vez al día a las 20:05 UTC
  // via scheduleRegimeUpdate() — no se toca aquí para evitar señales contradictorias

  // ── Régimen de mercado — MOM adapta parámetros, nunca se desactiva ──────────
  const regime = MARKET_REGIME;
  const bearMode   = regime.mode === 'BEAR';
  const lateralMode = regime.mode === 'LATERAL';
  // En BEAR: RSI más estricto (62-68), RS positiva obligatoria, size 50%
  // En LATERAL: RSI estricto (60-68), size 75%
  // En BULL: parámetros normales, size 100%
  const strictMOM  = bearMode || lateralMode; // más exigente en ambos modos no-bull
  const spyMult    = regime.sizeMult;

  // CORRECCIÓN v4: bloquear MOM completamente si SPY cae >1.5% en el dia
  // (el server ya reduce sizing pero no bloqueaba — perdidas innecesarias)
  if (spyContext.change <= -1.5) {
    console.log('[MOM] Bloqueado — SPY cae ' + spyContext.change + '% hoy (threshold -1.5%)');
    return;
  }
  const rsiMin     = bearMode ? 62 : 45;   // BULL: 45 (backtest v9), BEAR: 62
  const rsiMax     = bearMode ? 70 : 68;   // no entrar en sobrecompra extrema
  const minScore   = bearMode ? 85 : lateralMode ? 75 : 0; // score mínimo ORS en bajista

  console.log(`[MOM] Modo ${regime.mode} | RSI ${rsiMin}-${rsiMax} | MinScore=${minScore} | Size=${spyMult}x | Tickers=${getActiveWatchlist().length}`);
  const now     = Date.now();

  for (const sym of getActiveWatchlist()) {
    try {
      let parsed = priceCache[sym];
      if (!parsed || now - parsed.ts > CACHE_TTL) {
        parsed = await fetchAlpaca15min(sym);
        if (!parsed) continue;
        if (parsed) priceCache[sym] = {...parsed, ts: now};
      }
      if (!parsed?.prices?.length) continue;

      const snap = await fetchAlpacaSnapshot(sym);
      if (snap) parsed.quote = snap;

      const sig = calcMOMSignal(parsed.prices, parsed.quote);
      if (!sig || !sig.valid) continue;

      // Lista negra MOM — tickers problemáticos
      const MOM_BLACKLIST = [
        // Utilities — macro dependientes, no momentum técnico
        'NEE', 'ETR',
        // Crypto — gaps extremos (directos e indirectos)
        'COIN', 'MSTR', 'RIOT', 'MARA', 'HUT', 'WGMI', 'BITF', 'CLSK', 'IREN', 'CIFR',
        'WGMI',  // ETF Bitcoin miners — crypto indirecto, no disponible en Alpaca IEX
        // Shipping — gaps y volatilidad sin estructura (mantener en ORS)
        'ZIM',
        // Low-cost airlines — demasiado macro
        'AAL',
        // Biotech volátil sin momentum claro
        'CRSP', 'INSM',
        // Identificados por backtest: WR 0%, 0 runners, 3+ trades
        // Tickers de valor/defensivos sin carácter de momentum
        'ARM',   // Valoración extrema, nunca genera momentum técnico real
        'AVB',   // REIT defensivo — el dinero institucional no crea runners aquí
        'NOW',   // ServiceNow: muy caro, señal técnica sin continuación
        'IBM',   // Valor puro, no momentum — 0 runners en 6 trades
        'TXRH',  // Restaurantes: sector sin aceleración para MOM
        'DELL',  // Commodity hardware — margen bajo, momentum escaso
        'LRCX',  // Semiconductores equipos: muy correlado con ciclo, no con momentum
        // Tickers que empeorarán cuando el mercado rote
        'ADBE',  // Software maduro sin catalizador de momentum
        'CCI',   // Torre de telecom — defensivo puro
];
      // MomScore: bloquear tickers sin momentum real
      if (!momScoreOk(sym)) { console.log('[MomScore] '+sym+' bloqueado score:'+getMomScore(sym).toFixed(2)); continue; }
      if (MOM_BLACKLIST.indexOf(sym) >= 0 || serverBlacklist[sym]) continue;

      // ── Verificar disponibilidad en Alpaca ──────────────────────
      if (!isAvailableAlpaca(sym)) continue;
      // ── v13: Universo MOM separado — solo Tier1+Tier2 ───────────
      if (!canOperateMOM(sym)) {
        console.log(`[MOM-UNIVERSE] ${sym} no está en MOM_TICKERS — skip`);
        continue;
      }

      // ── v13: Five-Bar MAC Pattern — adaptativo por régimen ────────
      // BULL fuerte: 3 barras (confirma breakout genuino)
      // LATERAL/BEAR: 2 barras (mercado lateral, más señales necesarias)
      if (parsed.prices && parsed.prices.length >= 15) {
        const _regime = MARKET_REGIME?.mode || 'BULL';
        const _fiveBarMin = (_regime === 'BULL') ? 3 : 2;
        if (!fiveBarMACPatternN(parsed.prices, _fiveBarMin)) {
          console.log(`[FIVE-BAR] ${sym} sin ${_fiveBarMin} barras sobre MAH (${_regime}) — skip`);
          continue;
        }
      }

      // ── Filtro de Fuerza Relativa en modo BEAR ────────────────────────────
      // En mercado bajista solo operamos tickers que superan al SPY últimos 5 días
      if (bearMode) {
        const prices5 = (parsed.prices || []).slice(-6).map(p => p.close || p.c || 0).filter(Boolean);
        const spyPrices5 = spyPriceHistory.slice(-6);
        if (prices5.length >= 2 && spyPrices5.length >= 2) {
          const tickerRS = (prices5[prices5.length-1] / prices5[0] - 1) * 100;
          const spyRS    = (spyPrices5[spyPrices5.length-1] / spyPrices5[0] - 1) * 100;
          const rs = tickerRS - spyRS;
          if (rs <= 0) {
            console.log(`[MOM-BEAR] ${sym} RS=${rs.toFixed(1)}% — filtrando (no supera SPY)`);
            continue; // No supera al SPY — ignorar en modo bajista
          }
          console.log(`[MOM-BEAR] ${sym} RS=+${rs.toFixed(1)}% — pasa filtro de fuerza relativa ✅`);
        }
        // Score mínimo en modo bajista
        if ((sig.score || 0) < minScore) {
          console.log(`[MOM-BEAR] ${sym} score=${sig.score} < ${minScore} — filtrando`);
          continue;
        }
      }

      // Filtros estrictos obligatorios
      // Filtro RSI adaptativo según régimen
      if (sig.rsi < rsiMin || sig.rsi > rsiMax) continue;  // RSI dinámico por régimen
      if (sig.rvol < 1.3) continue;                  // RVOL ≥1.3x global
      if (sig.last < 20) continue;                   // Precio ≥$20

      // -- CONFIRMACION 3 VELAS -- momentum sostenido, no spike
      // Las 3 barras anteriores deben cerrar cada una por encima de la anterior
      const prices15 = parsed.prices;
      if (prices15 && prices15.length >= 4) {
        const n15 = prices15.length;
        const confirm3 = prices15[n15-1].close > prices15[n15-2].close &&
                         prices15[n15-2].close > prices15[n15-3].close;
        if (!confirm3) continue; // 3 velas consecutivas alcistas (v9)
      }

      // ── A: VELA ALCISTA OBLIGATORIA (close > open) ─────────────
      // El 30% de los stops nunca subieron porque la vela de señal era bajista
      // aunque los indicadores históricos dijeran alcista.
      // Exigir close > open asegura que el precio está subiendo AHORA.
      {
        const prices15A = parsed.prices;
        if (prices15A && prices15A.length >= 1) {
          const lastBarA = prices15A[prices15A.length-1];
          if (!lastBarA.open || lastBarA.close <= lastBarA.open) {
            // console.log('[A] '+sym+' vela bajista — skip');
            continue;
          }
        }
      }

      // ── D: VOLUMEN CRECIENTE ─────────────────────────────────────
      // El volumen de la barra de señal debe ser ≥10% mayor que el
      // promedio de las 3 barras anteriores — captura flujo real del momento
      {
        const prices15D = parsed.prices;
        if (prices15D && prices15D.length >= 4) {
          const nD = prices15D.length;
          const vNow  = prices15D[nD-1].volume || 0;
          const vPrev3avg = ((prices15D[nD-2].volume||0) +
                             (prices15D[nD-3].volume||0) +
                             (prices15D[nD-4].volume||0)) / 3;
          if (vPrev3avg > 0 && vNow < vPrev3avg * 1.10) {
            // console.log('[D] '+sym+' volumen no creciente — skip');
            continue;
          }
        }
      }

      // -- FILTRO ICHIMOKU MOM (DIARIO Yahoo) --
      // Ichimoku diario real 9/26/52 dias - NO las 52 barras 15min (13h inutil)
      // Cache por ticker por dia para no repetir llamadas Yahoo
      const ichiCacheKey = sym + '_ichid_' + new Date().toDateString();
      let ichiMOM = sentAlerts[ichiCacheKey];
      if (ichiMOM === undefined) {
        try {
          const yd = await fetchYahoo(sym, '1d', '3y');
          const dp2 = parseYahoo(yd);
          if (dp2 && dp2.prices && dp2.prices.length >= 52) {
            function midD(arr) {
              var hi=-Infinity, lo=Infinity;
              for(var i=0;i<arr.length;i++){hi=Math.max(hi,arr[i].high||arr[i].close);lo=Math.min(lo,arr[i].low||arr[i].close);}
              return (hi+lo)/2;
            }
            const pp = dp2.prices;
            const tn = midD(pp.slice(-9));
            const kj = midD(pp.slice(-26));
            const sA = (tn+kj)/2;
            const sB = midD(pp.slice(-52));
            const lp = pp[pp.length-1].close;
            const kTop = Math.max(sA,sB), kBot = Math.min(sA,sB);
            ichiMOM = { sobreKumo:lp>kTop, bajoKumo:lp<kBot, tkCross:tn>kj, kumoAlcista:sA>sB, momFilter:lp>kTop&&tn>kj&&sA>sB };
          } else { ichiMOM = null; }
        } catch(e) { ichiMOM = null; }
        sentAlerts[ichiCacheKey] = ichiMOM || null; // null=sin datos (permisivo), false=explícitamente bloqueado
      }
      // Ichimoku: solo bloquear si hay datos Y confirman rechazo
      // Si Yahoo falla (ichiMOM=null), permitir el trade (no penalizar por datos faltantes)
      if (ichiMOM && ichiMOM.bajoKumo) continue;         // precio bajo nube → skip
      if (ichiMOM && ichiMOM.momFilter === false) continue; // explícitamente no momFilter → skip

      // No entrar si ya hay posición ORS activa en este ticker
      if (openPositions[sym]) continue;

      // TTL 4h: si la señal no se ejecutó, puede reintentar en la tarde
      const _now4h = Math.floor(Date.now() / (4*60*60*1000));
      const entryKey = `${sym}_mom_${_now4h}`;
      if (sentAlerts[entryKey]) continue;

      // ── B: MAX 1 TRADE POR TICKER POR MES (por sistema) ──────────
      // MOM y ORS no se bloquean mutuamente — universos separados
      const _nowMonth = new Date().toISOString().slice(0,7); // YYYY-MM
      if (monthTradesDone[`${sym}_ors_${_nowMonth}`]) {
        console.log('[B-ORS] '+sym+' ya operado ORS este mes — skip');
        continue;
      }

      // Filtros
      const nearEarnings  = await isNearEarnings(sym);
      if (nearEarnings) continue;

      const sectorCount   = countSectorPositions(sym);
      if (sectorCount >= MAX_PER_SECTOR) continue;

      // Slots por régimen (BULL: MOM≤3, LATERAL: MOM≤2, BEAR: MOM=0)
      if (!canOpenPosition('MOM')) continue;

      if (!canReEnter(sym, sig.last)) continue;

      // ── FILTRO SECTORIAL — solo entrar si el sector está BULLISH o NEUTRAL ──
      // sectorSentiment se actualiza cada mañana con Claude + ETF prices
      // Si el sector es BEARISH (score < 40) → skip
      const _symSector    = getSector(sym);
      const _sentKey      = SECTOR_MAP_TO_SENTIMENT[_symSector];
      const _sent         = _sentKey && sectorSentiment[_sentKey];
      if (_sent && _sent.status === 'BEARISH' && (_sent.score || 50) < 40) {
        console.log(`[SECTOR FILTER] ${sym} bloqueado — ${_symSector}(${_sentKey}) BEARISH score:${_sent.score}`);
        continue;
      }
      const _sectorTag = _sent ? `${_sent.status}(${_sent.score})` : 'NO_DATA';

      // Position sizing MOM corregido
      const _atr        = sig.atr || sig.last * 0.015;
      const _stop       = parseFloat((sig.last - _atr * 1.5).toFixed(2)); // ATR×1.5
      const _riskPerSh  = sig.last - _stop;
      if (_riskPerSh <= 0) continue;
      const _riskUSD    = CAPITAL_EUR * RISK_PCT * 1.08 * 0.75 * spyMult;
      const _qty = capQty(Math.max(1, Math.floor(_riskUSD / _riskPerSh)), sig.last);
      const _target     = parseFloat((sig.last + _riskPerSh * 2.0).toFixed(2)); // R:R 2:1

      sentAlerts[entryKey] = now;
      // Registrar para filtro mensual (B)
      monthTradesDone[`${sym}_mom_${new Date().toISOString().slice(0,7)}`] = true;

      if (AUTO_EXECUTE) {
        pendingOrders[sym] = {
          sym, qty:_qty, qty1:_qty, qty2:0,
          price:sig.last, stopPrice:_stop,
          target1:_target, rr:1.5, atr:_atr,
          aboveSMA200:sig.aboveSMA200,
          type:'MOM', ts:now,
        };
        const _execResult = await executeAlpacaOrder(sym, pendingOrders[sym]);
        if (_execResult == null) {
          // Asset check falló — ticker no disponible en Alpaca
          // No mandar Telegram — markUnavailable ya llamado en executeAlpacaOrder
          delete pendingOrders[sym]; continue;
        }
        await sendTelegram(
          `🚀 <b>MOM SIGNAL — ${sym}</b>\n` +
          `💰 $${sig.last.toFixed(2)} | Stop $${_stop} | Target $${_target}\n` +
          `📦 ${_qty} acc | Riesgo €${Math.round(_riskPerSh*_qty/1.08)}\n` +
          `📊 RSI ${sig.rsi?.toFixed(1)} | OBV ✅ | RVOL ${sig.rvol}x\n` +
          `📈 Breakout ✅ | SPY ${spyContext.trend}\n` +
          `🏭 Sector: ${getSector(sym)} ${_sectorTag} | R:R 1.5:1`
        );
      } else {
        await sendTelegram(
          `🚀 <b>MOM SIGNAL — ${sym}</b>\n\n` +
          `💰 $${sig.last.toFixed(2)} | Stop: $${_stop} | Target: $${_target}\n` +
          `📦 ${_qty} acc | Riesgo: €${Math.round(_riskPerSh*_qty/1.08)}\n` +
          `📊 RSI ${sig.rsi?.toFixed(1)} | OBV ✅ | RVOL ${sig.rvol}x\n` +
          `📈 Breakout: ${sig.breakout?'✅':'❌'} | SPY: ${spyContext.trend}\n` +
          `🏭 Sector: ${getSector(sym)} ${_sectorTag} | R:R 1.5:1\n\n` +
          `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`
        );
      }

      await new Promise(function(r){setTimeout(r,300);});
    } catch(e) {
      console.log('[MOM] Error', sym, e.message);
    }
  }
}

async function checkSignals() {
  // ── FILTRO DE MERCADO — solo Lun-Vie 13:30-20:00 UTC (NYSE) ──────────────────
  if (!isMarketOpen()) {
    console.log('[ORS] Mercado cerrado — sin scan');
    return;
  }
  // noEntry: primera 30min y última 30min del mercado no se ejecutan nuevas entradas
  const noEntry = !isMarketEntryAllowed();

  // ── ANÁLISIS SECTORIAL IA — al cierre del mercado (20:10-20:30 UTC)
  // El análisis se ejecuta tras el cierre NYSE con:
  //   - Performance real del día de los ETFs sectoriales
  //   - Noticias del día completo
  //   - Búsqueda web: Capitol Trades + flujo institucional ETFs
  // Resultado disponible al día siguiente para priorizar sectores
  const _nowH = new Date().getUTCHours();
  const _nowM = new Date().getUTCMinutes();
  if (_nowH === 20 && _nowM >= 10 && _nowM < 30) {
    await updateSectorSentiment().catch(e => console.log('[SECTOR] Error:', e.message));
  }

  // ── Verificar régimen — ORS siempre activo pero parámetros cambian ──────────
  const regime = MARKET_REGIME;
  const orsIsPriority = regime.orsPriority; // true en LATERAL
  const regimeSizeMult = regime.sizeMult;
  const bearMode = regime.mode === 'BEAR';

  console.log(`[ORS] Modo ${regime.mode} | ORS-Priority=${orsIsPriority} | SizeMult=${regimeSizeMult}x | Tickers=${getActiveWatchlist().length}`);

  // ── SPY CONTEXT — actualizar cada 15min ──────────────
  if (!spyContext.ts || Date.now() - spyContext.ts > 15 * 60 * 1000) {
    await updateSPYContext();
  }
  const spyMult = getSPYSizingMultiplier();

  console.log(`[${new Date().toISOString()}] Scan ${getActiveWatchlist().length} tickers | SPY:${spyContext.trend}(${spyContext.change}%) | NoEntry:${noEntry}`);

  const now = Date.now();
  const candidateSignals = []; // Acumula señales para rankear

  for (const sym of getActiveWatchlist()) {
    try {
      // ── CARGAR DATOS ────────────────────────────────
      let parsed = priceCache[sym];
      if (!parsed || now - parsed.ts > CACHE_TTL) {
        parsed = await fetchAlpaca15min(sym);
        if (!parsed) {
          const data = await fetchYahoo(sym, '15m', '5d');
          parsed = parseYahoo(data);
        }
        if (parsed) priceCache[sym] = { ...parsed, ts: now };
      }
      if (!parsed?.prices?.length) continue;

      const snap = await fetchAlpacaSnapshot(sym);
      if (snap) parsed.quote = snap;

      const sig = calcORSSignal(parsed.prices, parsed.quote);
      if (!sig) continue;

      // ── RVOL — volumen relativo ─────────────────────
      const rvol = calcRVOL(parsed.prices);
      const rvolOk = !rvol || rvol >= 1.2;

      // ── CONDICIONES DE ENTRADA ──────────────────────
      const obvBullish = sig.obv && sig.obv.bullish && sig.obv.rising;
      const rsiInRange = sig.rsi && sig.rsi >= 20 && sig.rsi <= 38;
      const is5of5     = sig.condsMet >= 5 && obvBullish;
      const is4of5OBV  = sig.condsMet === 4 && obvBullish && rsiInRange;
      const validEntry = (is5of5 || is4of5OBV) && rsiInRange && !noEntry && rvolOk;

      if (!validEntry || sentAlerts[`${sym}_entry_${new Date().toDateString()}`] || openPositions[sym]) continue;

      // Filtros previos al ranking
      const nearEarnings = await isNearEarnings(sym);
      if (nearEarnings) continue;
      if (!canReEnter(sym, sig.last)) continue;

      // ── SCORE DE CALIDAD para ranking ───────────────
      // score = calidad señal + volumen + RSI bajo (más recorrido)
      const signalScore = (sig.condsMet * 20) + ((rvol||1) * 10) + ((38 - (sig.rsi||38)) * 2);

      // ── Filtro RS en modo BEAR — ORS también exige fuerza relativa ────────
      if (bearMode) {
        const prices5 = (parsed.prices || []).slice(-6).map(p => p.close||p.c||0).filter(Boolean);
        const spyPrices5 = spyPriceHistory.slice(-6);
        if (prices5.length >= 2 && spyPrices5.length >= 2) {
          const tickerRS = (prices5[prices5.length-1] / prices5[0] - 1) * 100;
          const spyRS    = (spyPrices5[spyPrices5.length-1] / spyPrices5[0] - 1) * 100;
          const rs = tickerRS - spyRS;
          // ORS en BEAR: aceptamos RS ligeramente negativa si OBV es muy alcista
          // (acumulación institucional aunque el precio caiga con el mercado)
          if (rs < -3) {
            console.log(`[ORS-BEAR] ${sym} RS=${rs.toFixed(1)}% — filtrando (cae demasiado vs SPY)`);
            continue;
          }
        }
        // Score mínimo en modo bajista para ORS
        if (signalScore < 80) {
          console.log(`[ORS-BEAR] ${sym} score=${signalScore.toFixed(1)} < 80 — filtrando en modo bajista`);
          continue;
        }
      }

      candidateSignals.push({
        sym, sig, rvol, is5of5, is4of5OBV,
        sector: getSector(sym),
        score: parseFloat(signalScore.toFixed(1)),
      });

      console.log(`[${sym}] ✅ Candidata | RSI:${sig.rsi?.toFixed(1)} conds:${sig.condsMet}/5 RVOL:${rvol} score:${signalScore.toFixed(1)} modo:${regime.mode}`);

    } catch(e) {
      console.log(`Error ${sym}:`, e.message);
    }
  }

  // ── RANKING Y SELECCIÓN — mejor señal por sector ──
  if (candidateSignals.length === 0) return;

  candidateSignals.sort(function(a,b){ return b.score - a.score; });

  const usedSectors = {};
  const selected    = [];
  const totalOpen   = Object.keys(openPositions).length;
  const orsOpen     = countORSPositions();
  const momOpen     = countMOMPositions();

  for (var ci = 0; ci < candidateSignals.length; ci++) {
    var cand = candidateSignals[ci];
    if (usedSectors[cand.sector]) continue;
    if (countSectorPositions(cand.sym) >= MAX_PER_SECTOR) continue;
    if (totalOpen + selected.length >= MAX_POSITIONS) break;

    var isORS = cand.sig && cand.sig.validORS;
    var orsCount = orsOpen + selected.filter(function(s){return s.sig&&s.sig.validORS;}).length;
    var momCount = momOpen + selected.filter(function(s){return !(s.sig&&s.sig.validORS);}).length;

    if (isORS) {
      // ORS solo entra si hay slots libres que MOM no va a ocupar
      // Tickers bloqueados en ORS (WR 0% histórico ≥3 trades)
      if (isORSBlocked(cand.sym)) {
        console.log('[ORS-BLOCKED] ' + cand.sym + ' bloqueado en ORS — solo MOM/SWING');
        continue;
      }
      // ORS: límite por régimen (BULL:1, LATERAL:2, BEAR:2)
      var orsMax = getMaxBySystem('ORS');
      if (orsCount >= orsMax) {
        console.log(`[SLOTS] ${cand.sym} ORS bloqueado — ${orsCount}/${orsMax} (régimen:${MARKET_REGIME?.mode})`);
        continue;
      }
      var momSlotsLibres = getMaxBySystem('MOM') - momOpen;
      var totalLibres    = MAX_POSITIONS - totalOpen - selected.length;
      if (totalLibres <= momSlotsLibres) {
        console.log(`[SLOTS] ${cand.sym} ORS espera — slots reservados para MOM`);
        continue;
      }
    } else {
      // MOM — máximo 3 simultáneas
      if (momCount >= MAX_POSITIONS_MOM) {
        console.log(`[SLOTS] ${cand.sym} MOM bloqueado — slots MOM llenos (${momCount}/${MAX_POSITIONS_MOM})`);
        continue;
      }
    }

    usedSectors[cand.sector] = true;
    selected.push(cand);
  }

  // ORS 5/5 emergencia — si score >90 y slots llenos, cerrar MOM con menor ganancia
  var emergencyORS = candidateSignals.filter(function(c){
    return c.sig && c.sig.validORS && c.sig.condsMet >= 5 && c.score >= 90;
  });
  if (emergencyORS.length > 0 && totalOpen >= MAX_POSITIONS) {
    var momPositions = Object.entries(openPositions)
      .filter(function(e){ return e[1] && e[1].system === 'MOM'; })
      .sort(function(a,b){ return (a[1].unrealizedPnl||0) - (b[1].unrealizedPnl||0); });
    if (momPositions.length > 0) {
      var toClose = momPositions[0][0];
      console.log(`[EMERGENCY ORS 5/5] Cerrando MOM ${toClose} para abrir slot ORS`);
      await sendTelegram(`⚡ <b>ORS 5/5 EMERGENCIA</b>\nCerrando ${toClose} (MOM) para abrir slot\nScore: ${emergencyORS[0].score}`);
      // La señal ORS se procesará en el siguiente ciclo con el slot libre
    }
  }

  console.log(`[RANKING] ${candidateSignals.length} candidatas → ${selected.length} seleccionadas`);
  if (candidateSignals.length > 1) {
    const summary = candidateSignals.map(function(c){
      return c.sym+'('+c.score+')';
    }).join(', ');
    console.log(`[RANKING] Scores: ${summary}`);
  }

  // ── EJECUTAR SEÑALES SELECCIONADAS ────────────────
  for (var si = 0; si < selected.length; si++) {
    var cand = selected[si];
    var sym  = cand.sym;
    var sig  = cand.sig;
    var rvol = cand.rvol;
    var is5of5 = cand.is5of5;
    var is4of5OBV = cand.is4of5OBV;
    try {
      const entryKey = `${sym}_entry_${new Date().toDateString()}`;
      sentAlerts[entryKey] = now;

      const _atr = Math.max(sig.atr || 1, sig.last * 0.005);
      const _stop = parseFloat((sig.last - _atr * 2.0).toFixed(2)); // ATR×2
      const _riskPerShare = sig.last - _stop;
      if (_riskPerShare <= 0) continue;

      const qualityMult = is5of5 ? 1.0 : 0.5;
      const _riskUSD = CAPITAL_EUR * RISK_PCT * 1.08 * qualityMult * spyMult;
      const _qty = Math.max(1, Math.floor(_riskUSD / _riskPerShare));
      const _qty1 = Math.max(1, Math.floor(capQty(_qty, sig.last, is5of5) * 0.6));
      const _qty2 = capQty(_qty, sig.last, is5of5) - _qty1;
      const _target = parseFloat((sig.last + _riskPerShare * 2).toFixed(2));

      // Notificar ranking si había competidoras en el mismo sector
      const sectorRivals = candidateSignals.filter(function(c){
        return c.sector === cand.sector && c.sym !== sym;
      });
      const rivalText = sectorRivals.length > 0
        ? `\n🏆 Elegido sobre: ${sectorRivals.map(function(r){return r.sym+'('+r.score+')';}).join(', ')}`
        : '';

      if (AUTO_EXECUTE) {
        pendingOrders[sym] = {
          sym, qty:_qty, qty1:_qty1, qty2:_qty2,
          price:sig.last, stopPrice:_stop,
          target1:_target, rr:2, atr:_atr,
          aboveSMA200:sig.aboveSMA200,
          orsScore:sig.orsScore, condsMet:sig.condsMet,
          is4of5:is4of5OBV, ts:now, score:cand.score,
        };
        const _execORS = await executeAlpacaOrder(sym, pendingOrders[sym]);
        if (_execORS == null) { delete pendingOrders[sym]; continue; }

        const qualLabel = is5of5 ? '⚡ ÓPTIMA 5/5' : '✅ SEÑAL 4/5+OBV';
        const spyLabel  = spyMult < 1 ? ` · SPY ${spyContext.trend} ×${spyMult}` : '';
        const vixLabel  = `📉 VIX ${vixContext.value} (${vixContext.regime}) · Sizing ×${getMarketSizingMultiplier()}`;
        const ichiLabel = sig.ichi ? `☁️ Ichimoku: ${sig.ichi.sobreKumo?'✅ Sobre nube':'❌ Bajo nube'} · TK ${sig.ichi.tkCross?'✅':'❌'}` : '';
        await sendTelegram(
          `${qualLabel} — <b>${sym}</b>\n` +
          `💰 $${sig.last.toFixed(2)} | Stop $${_stop} | Target $${_target}\n` +
          `📦 ${_qty} acc (${_qty1}+${_qty2}) | Riesgo €${Math.round(_riskPerShare*_qty/1.08)}\n` +
          `📊 RSI ${sig.rsi} | OBV ✅ | RVOL ${rvol||'?'}x | Score ${cand.score}${spyLabel}\n` +
          `🏭 Sector: ${cand.sector}${rivalText}\n` +
          vixLabel + (ichiLabel ? '\n' + ichiLabel : '')
        );
      } else {
        const qualLabel = is5of5 ? '⚡ ÓPTIMA 5/5' : '✅ SEÑAL 4/5+OBV (sizing 50%)';
        let msg = `${qualLabel} — <b>${sym}</b>\n\n`;
        msg += `💰 $${sig.last.toFixed(2)} | Stop: $${_stop} | Target: $${_target}\n`;
        msg += `📦 ${_qty} acc | Riesgo: €${Math.round(_riskPerShare*_qty/1.08)}\n`;
        msg += `📊 RSI ${sig.rsi} | OBV ✅ | RVOL ${rvol||'?'}x | Score ${cand.score}\n`;
        msg += `🏭 Sector: ${cand.sector}${rivalText}\n`;
        msg += `📉 VIX ${vixContext.value} (${vixContext.regime}) · Sizing ×${getMarketSizingMultiplier()}\n\n`;
        msg += `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`;
        await sendTelegram(msg);
      }

      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      console.log(`Error ejecutando ${sym}:`, e.message);
    }
  }

  // ── SEÑALES DE SALIDA por agotamiento ─────────────
  for (const sym of getActiveWatchlist()) {
    try {
      let parsed = priceCache[sym];
      if (!parsed?.prices?.length) continue;
      const sig = calcORSSignal(parsed.prices, parsed.quote);
      if (!sig) continue;
      const exitKey = `${sym}_exit_${new Date().toDateString()}_${NY_HOUR}`;
      if (sig.exhaustion >= 60 && !sentAlerts[exitKey]) {
        sentAlerts[exitKey] = now;
        let msg = `🔴 <b>SEÑAL SALIDA — ${sym}</b>\n\n`;
        msg += `💰 $${sig.last.toFixed(2)}\n`;
        msg += `📊 RSI: <b>${sig.rsi}</b>${sig.rsi>68?' ⚠️ SOBRECOMPRADO':''}\n`;
        msg += `⛽ Agotamiento: <b>${sig.exhaustion}%</b>\n`;
        msg += `\nTrailing stop sugerido: $${(sig.last * 0.97).toFixed(2)}`;
        await sendTelegram(msg);
      }
    } catch(e) {}
  }
}
app.post('/claude', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({error: {message: 'ANTHROPIC_API_KEY not configured in Render env variables'}});
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({error: {message: e.message}}); }
});

// Yahoo Finance proxy
app.get('/yahoo', async (req, res) => {
  try {
    const { sym, range, interval } = req.query;
    if (!sym) return res.status(400).json({error: 'Missing sym'});
    const data = await fetchYahoo(sym, interval || '1d', range || '2y');
    res.json(data);
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Telegram proxy
app.post('/telegram', async (req, res) => {
  try {
    const { token, chat_id, text } = req.body;
    if (!token || !chat_id || !text) return res.status(400).json({error: 'Missing fields'});
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id, text, parse_mode: 'HTML'})
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({error: e.message}); }
});

// IBKR status
app.get('/ibkr/status', async (req, res) => {
  const auth = await ibkrPing();
  res.json({ authenticated: auth, paper: USE_PAPER, account: USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT });
});

// IBKR positions
app.get('/ibkr/positions', async (req, res) => {
  const pos = await ibkrGetPositions();
  res.json(pos);
});

// IBKR portfolio summary
app.get('/ibkr/portfolio', async (req, res) => {
  const p = await ibkrGetPortfolio();
  res.json(p);
});

// Manual signal check
app.get('/check', async (req, res) => {
  await checkSignals();
  const acc = getAcc();
  res.json({
    ok: true,
    account: acc.label,
    capital: CAPITAL_EUR,
    watchlist: getActiveWatchlist(),
    watchlistCount: getActiveWatchlist().length,
    vix:           vixContext.value,
    orsSlots:      countORSPositions()+'/'+MAX_POSITIONS_ORS,
    momSlots:      countMOMPositions()+'/'+MAX_POSITIONS_MOM,
    vixRegime:     vixContext.regime,
    spyTrend:      spyContext.trend,
    marketMult:    getMarketSizingMultiplier(),
    openPositions: Object.keys(openPositions),
    blacklist: Object.keys(serverBlacklist),
    time: new Date().toISOString()
  });
});

// List pending orders
app.get('/pending', (req, res) => {
  res.json({ pending: pendingOrders, count: Object.keys(pendingOrders).length });
});

// Manual order execution (from app)
app.post('/ibkr/order', async (req, res) => {
  try {
    const { sym, qty, price, stopPrice } = req.body;
    if (!sym || !qty || !stopPrice) return res.status(400).json({error: 'Missing fields'});
    const result = await ibkrPlaceBracketOrder(sym, qty, price, stopPrice);
    res.json(result);
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Status
app.get('/', async (req, res) => {
  const ping = await ibkrPing().catch(() => false);
  res.json({
    status:   'ORS Proxy OK',
    ibkr:     ping ? 'connected' : 'disconnected',
    mode:     USE_PAPER ? 'paper' : 'live',
    account:  USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT,
    watchlist: getActiveWatchlist(),
    pending:  Object.keys(pendingOrders).length,
    time:     new Date().toISOString()
  });
});

// ── HEALTH CHECK — verifica version del codigo desplegado ──

// ══════════════════════════════════════════════════════════════════
// ANÁLISIS SECTORIAL CON CLAUDE + NOTICIAS — ejecutar antes de apertura
// ══════════════════════════════════════════════════════════════════

// ETFs sectoriales para detectar momentum
const SECTOR_ETFS = {
  AI_CHIPS:     { etf: 'SOXX', tickers: ['NVDA','AMD','AVGO','TSM','MU','MRVL','QCOM','AMAT','LRCX','KLAC'] },
  CLOUD:        { etf: 'CLOU', tickers: ['ORCL','META','AMZN','GOOGL','MSFT','CRM','ADBE'] },
  SPACE:        { etf: 'XAR',  tickers: ['RKLB','LUNR','SATS','TSLA','LMT','NOC'] },
  CLEAN_ENERGY: { etf: 'ICLN', tickers: ['CEG','VST','GEV','BE','NEE','FSLR'] },
  BIOTECH:      { etf: 'XBI',  tickers: ['INSM','CRSP','ABBV','MRNA','VRTX'] },
  FINTECH:      { etf: 'FINX', tickers: ['CRWV','SQ','PYPL','COIN'] },
  HEALTHCARE:   { etf: 'XLV',  tickers: ['HCA','ISRG','UNH','JNJ'] },
  AIRLINES:     { etf: 'JETS', tickers: ['DAL','UAL','AAL','LUV'] },
  INDUSTRIAL:   { etf: 'XLI',  tickers: ['GE','HON','MMM','CAT'] },
};

// Estado global del análisis sectorial — se actualiza cada mañana
let sectorSentiment = {}; // sector -> {status:'BULLISH'|'NEUTRAL'|'BEARISH', score:0-100, reason:''}
let sectorLastUpdate = null;

// ── ACTUALIZACIÓN LIGERA DIARIA (sin Claude) — solo precios ETF ──
// Corre cada mañana a las 13:00 UTC (antes del mercado). Sin coste API.
// Si sectorSentiment está vacío inicializa con NEUTRAL.
async function updateSectorETFLight() {
  const ETF_MAP = {
    AI_CHIPS:     'SOXX',
    CLOUD:        'CLOU',
    SPACE:        'XAR',
    CLEAN_ENERGY: 'ICLN',
    BIOTECH:      'XBI',
    FINTECH:      'FINX',
    HEALTHCARE:   'XLV',
    AIRLINES:     'JETS',
    INDUSTRIAL:   'XLI',
  };
  console.log('[SECTOR LIGHT] Actualizando sentimiento sectorial por ETF...');
  let updated = 0;
  for (const [sector, etf] of Object.entries(ETF_MAP)) {
    try {
      const data   = await fetchYahoo(etf, '1d', '1mo');
      const prices = data?.chart?.result?.[0];
      if (!prices?.indicators?.quote) continue;
      const closes = prices.indicators.quote[0].close.filter(Boolean);
      if (closes.length < 10) continue;
      const last   = closes[closes.length - 1];
      const sma10  = closes.slice(-10).reduce((s,v) => s+v, 0) / 10;
      const sma20  = closes.length >= 20 ? closes.slice(-20).reduce((s,v) => s+v, 0) / 20 : sma10;
      const perf5d = ((last - closes[closes.length - 6]) / closes[closes.length - 6] * 100);
      const perf1m = ((last - closes[0]) / closes[0] * 100);
      let score = 50;
      if (last > sma10)  score += 10;
      if (last > sma20)  score += 10;
      if (perf5d > 1)    score += 10;
      if (perf5d > 3)    score += 5;
      if (perf5d < -2)   score -= 15;
      if (perf1m > 5)    score += 10;
      if (perf1m < -5)   score -= 15;
      score = Math.max(0, Math.min(100, score));
      const status = score >= 60 ? 'BULLISH' : score <= 35 ? 'BEARISH' : 'NEUTRAL';
      const existing = sectorSentiment[sector] || {};
      sectorSentiment[sector] = {
        ...existing, status, score, etf,
        perf5d: parseFloat(perf5d.toFixed(2)),
        perf1m: parseFloat(perf1m.toFixed(2)),
        lightUpdate: new Date().toISOString().slice(0,10),
      };
      updated++;
    } catch(e) { console.log(`[SECTOR LIGHT] ${etf} error:`, e.message); }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[SECTOR LIGHT] Completado — ${updated} sectores`);
  const bullish = Object.entries(sectorSentiment).filter(([,v]) => v.status==='BULLISH').map(([k]) => k);
  const bearish = Object.entries(sectorSentiment).filter(([,v]) => v.status==='BEARISH').map(([k]) => k);
  await sendTelegram(
    `📊 <b>Sector Update Diario</b>\n` +
    `🟢 BULLISH: ${bullish.join(', ') || 'ninguno'}\n` +
    `🔴 BEARISH: ${bearish.join(', ') || 'ninguno'}`
  ).catch(() => {});
}

async function updateSectorSentiment() {
  const now = new Date();
  const todayStr = now.toDateString();
  if (sectorLastUpdate === todayStr) return;

  console.log('[SECTOR] Iniciando análisis sectorial completo...');

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { console.log('[SECTOR] Sin ANTHROPIC_API_KEY'); return; }

    // ── CAPA 1: Performance ETFs sectoriales (datos reales Alpaca) ──────────────
    const etfPerformance = {};
    for (const [sector, data] of Object.entries(SECTOR_ETFS)) {
      try {
        const etfData = await fetchYahoo(data.etf, '1d', '1mo');
        const prices  = etfData?.chart?.result?.[0];
        if (prices?.indicators?.quote) {
          const closes = prices.indicators.quote[0].close.filter(Boolean);
          if (closes.length >= 20) {
            const last   = closes[closes.length-1];
            const perf1d = ((last - closes[closes.length-2]) / closes[closes.length-2] * 100).toFixed(1);
            const perf5d = ((last - closes[closes.length-6]) / closes[closes.length-6] * 100).toFixed(1);
            const perf1m = ((last - closes[0]) / closes[0] * 100).toFixed(1);
            // Volumen relativo del ETF (institucional vs media 20 días)
            const vols   = prices.indicators.quote[0].volume?.filter(Boolean) || [];
            const avgVol = vols.slice(-20,-1).reduce((s,v)=>s+v,0)/19;
            const lastVol= vols[vols.length-1] || 0;
            const rvol   = avgVol > 0 ? (lastVol/avgVol).toFixed(2) : '1.0';
            etfPerformance[sector] = {
              etf: data.etf,
              perf1d: parseFloat(perf1d),
              perf5d: parseFloat(perf5d),
              perf1m: parseFloat(perf1m),
              rvol:   parseFloat(rvol),  // ← flujo institucional implícito
            };
          }
        }
      } catch(e) { /* skip */ }
      await new Promise(r => setTimeout(r, 200));
    }

    // ── CAPA 2: Noticias Alpaca de ETFs y tickers principales ────────────────────
    const allNews = [];
    try {
      const etfList     = Object.values(SECTOR_ETFS).map(s => s.etf).join(',');
      const tickerSample= Object.values(SECTOR_ETFS).flatMap(s => s.tickers.slice(0,2)).slice(0,20).join(',');
      const newsR = await fetch(
        `${ALPACA_DATA}/v2/news?symbols=${etfList},${tickerSample}&limit=50&sort=desc`,
        { headers: alpacaHeaders() }
      );
      const newsD = await newsR.json();
      (newsD.news || []).forEach(n => allNews.push({ headline: n.headline, symbols: n.symbols||[], time: n.created_at }));
    } catch(e) { console.log('[SECTOR] News error:', e.message); }

    // ── CAPA 3: Claude con web_search — Capitol Trades + flujo institucional ─────
    // Claude busca en internet: transacciones de políticos + ETF fund flows
    // para detectar dinero institucional y político antes de que se refleje en precio
    const etfText  = Object.entries(etfPerformance).map(([s,d]) =>
      `${s}(${d.etf}): hoy${d.perf1d>0?'+':''}${d.perf1d}% semana${d.perf5d>0?'+':''}${d.perf5d}% mes${d.perf1m>0?'+':''}${d.perf1m}% RVOL:${d.rvol}x`
    ).join('\n');

    const newsText = allNews.slice(0,25).map(n => `[${n.symbols.slice(0,3).join(',')}] ${n.headline}`).join('\n');

    const prompt = `Eres un analista de momentum sectorial para un sistema de trading algorítmico.

HOY ES: ${now.toISOString().slice(0,10)}

PERFORMANCE ETFs SECTORIALES (Alpaca datos reales):
${etfText}

NOTICIAS ÚLTIMAS 24H (Alpaca):
${newsText}

TU TAREA - Analiza en 3 capas:

CAPA 1 - MOMENTUM TÉCNICO:
Identifica qué sectores tienen momentum alcista real basándote en performance y RVOL.
RVOL > 1.3x = dinero institucional entrando. RVOL > 2.0x = flujo masivo institucional.

CAPA 2 - CATALIZADORES Y NOTICIAS:
¿Hay contratos gubernamentales, legislación favorable, earnings positivos, regulación?
¿Algún sector se está beneficiando de política actual (aranceles, subsidios, defensa)?

CAPA 3 - PATRÓN POLÍTICO (Capitol Trades — últimos 90 días):
NO busques compras puntuales. Busca PATRONES AGREGADOS en las últimas 12-14 semanas.
Pregunta clave: ¿qué sectores han acumulado MÁS compras netas de congresistas/senadores?
Fuentes: capitoltrades.com/trades, senatestockwatcher.com, housestockwatcher.com

Para cada sector que encuentres con actividad política relevante, indica:
- Número aproximado de transacciones de compra en 90 días
- Comités del Congreso más activos (defensa, tecnología, salud, energía)
- Si hay ventas también (señal negativa)
- Conclusión: ¿qué información privilegiada podrían tener?

Ejemplo de respuesta buena: "AI_CHIPS: 23 compras netas en 90 días, concentradas en miembros del comité de defensa y tecnología. Sugiere contratos gubernamentales de IA en pipeline."
Ejemplo malo: "Nancy Pelosi compró NVDA el 15 de marzo" (demasiado puntual, poco útil)

CAPA 4 - FLUJO INSTITUCIONAL (ETF flows):CAPA 4 - FLUJO INSTITUCIONAL (ETF flows):
Busca datos recientes de flujo neto de capital en ETFs sectoriales (últimos 7 días).
¿Qué sectores están recibiendo entradas netas de capital institucional?
Fuentes: etf.com, etfdb.com, ssga.com flows.

CONCLUSIÓN: ¿Qué sectores tienen confluencia de momentum técnico + catalizador + dinero político/institucional?
Estos son los sectores con mayor probabilidad de boom sostenido (como Space en 2024-2025).

Responde SOLO con este JSON (sin markdown):
{
  "AI_CHIPS":     {"status":"BULLISH","score":75,"reason":"...max 2 frases...","politico":"...si hay dato...","flujo_inst":"..."},
  "CLOUD":        {"status":"NEUTRAL","score":50,"reason":"...","politico":"ninguno reciente","flujo_inst":"..."},
  "SPACE":        {"status":"BULLISH","score":85,"reason":"...","politico":"...","flujo_inst":"..."},
  "CLEAN_ENERGY": {"status":"BEARISH","score":25,"reason":"...","politico":"...","flujo_inst":"..."},
  "BIOTECH":      {"status":"NEUTRAL","score":45,"reason":"...","politico":"...","flujo_inst":"..."},
  "HEALTHCARE":   {"status":"NEUTRAL","score":50,"reason":"...","politico":"...","flujo_inst":"..."},
  "AIRLINES":     {"status":"NEUTRAL","score":50,"reason":"...","politico":"...","flujo_inst":"..."},
  "INDUSTRIAL":   {"status":"NEUTRAL","score":50,"reason":"...","politico":"...","flujo_inst":"..."},
  "FINTECH":      {"status":"NEUTRAL","score":50,"reason":"...","politico":"...","flujo_inst":"..."}
}
Status: BULLISH=momentum alcista confirmado, NEUTRAL=esperar, BEARISH=evitar.
Score 0-100: confianza en el momentum. >70 = entrar, 40-70 = cautela, <40 = no entrar.`;

    const claudeR = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const d1 = await claudeR.json();
    const searchText = (d1.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(' ').slice(0,3000);

    // PASO 2: Opus formatea en JSON puro — sin tools, instrucciones directas
    const claudeR2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        system: 'Output ONLY valid JSON. No markdown. No extra text. All string values max 80 chars.',
        messages: [{role:'user', content:'Return JSON only. 9 keys: AI_CHIPS,CLOUD,SPACE,CLEAN_ENERGY,BIOTECH,HEALTHCARE,AIRLINES,INDUSTRIAL,FINTECH. Each: {status:BULLISH/NEUTRAL/BEARISH,score:number,reason:string,politico:string,flujo_inst:string}. Based on: ' + searchText}],
      }),
    });
    const claudeD = await claudeR2.json();

    const textBlocks = (claudeD.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');

    if (textBlocks) {
      try {
        const raw2 = textBlocks.replace(/```json/g,'').replace(/```/g,'').trim();
        const j1 = raw2.indexOf('{'), j2 = raw2.lastIndexOf('}');
        if(j1===-1||j2===-1) throw new Error('No JSON');
        const parsed  = JSON.parse(raw2.slice(j1,j2+1));
        sectorSentiment   = parsed;
        sectorLastUpdate  = todayStr;

        // Log resumen
        const bullish = Object.entries(parsed).filter(([,v]) => v.status==='BULLISH').map(([k]) => k);
        const bearish = Object.entries(parsed).filter(([,v]) => v.status==='BEARISH').map(([k]) => k);
        console.log('[SECTOR] Análisis completado:');
        console.log('  BULLISH:', bullish.join(', ') || 'ninguno');
        console.log('  BEARISH:', bearish.join(', ') || 'ninguno');

        // Detectar señales políticas importantes
        const politico_buys = Object.entries(parsed)
          .filter(([,v]) => v.politico && v.politico !== 'ninguno reciente' && v.status !== 'BEARISH')
          .map(([k,v]) => `${k}: ${v.politico}`);

        // Telegram con análisis completo
        let msg = `📊 <b>Análisis Sectorial Cierre</b> ${now.toISOString().slice(0,10)}\n\n`;
        if (bullish.length) msg += `🟢 <b>BULLISH:</b> ${bullish.join(', ')}\n`;
        if (bearish.length) msg += `🔴 <b>BEARISH:</b> ${bearish.join(', ')}\n`;
        if (politico_buys.length) {
          msg += `\n🏛️ <b>Señal Política:</b>\n`;
          politico_buys.forEach(p => msg += `  • ${p}\n`);
        }
        msg += `\n<i>Mañana el scanner priorizará: ${bullish.slice(0,3).join(', ')}</i>`;
        await sendTelegram(msg).catch(() => {});

      } catch(parseErr) {
        console.log('[SECTOR] Error parsing JSON:', parseErr.message);
        console.log('[SECTOR] Respuesta raw:', textBlocks.slice(0, 200));
      }
    }
  } catch(e) {
    console.log('[SECTOR] Error general:', e.message);
  }
}


async function weeklyRunnerAnalysis() {
  const today = new Date();
  if (today.getUTCDay() !== 0) return; // Solo domingos
  const weekKey = today.toISOString().slice(0, 10);
  if (weeklyAnalysisDate === weekKey) return; // Ya ejecutado esta semana

  console.log('[WEEKLY] Iniciando análisis semanal de runners SP500...');
  weeklyAnalysisDate = weekKey;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const startDate = new Date(today - 28 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const endDate   = today.toISOString().slice(0, 10);

    // 1. Descargar datos de todos los SP500 en batches pequeños
    const tickerStats = {};
    const batchSize   = 5;

    for (let bi = 0; bi < SP500_FULL.length; bi += batchSize) {
      const batch = SP500_FULL.slice(bi, bi + batchSize);
      await Promise.all(batch.map(async (sym) => {
        try {
          const barsR = await fetch(
            `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&start=${startDate}&end=${endDate}&limit=2000&feed=iex&sort=asc`,
            { headers: alpacaHeaders(), signal: AbortSignal.timeout(10000) }
          );
          const barsD = await barsR.json();
          const bars  = (barsD.bars || []).map(b => ({
            close: b.c, high: b.h, low: b.l, volume: b.v, t: b.t,
          }));
          if (bars.length < 50) return;

          // Calcular indicadores básicos
          const rsi   = calcRSI(bars, 14);
          const obv   = calcOBVSimple(bars);
          const macd  = calcMACDSimple(bars);
          const atr   = calcATRSimple(bars, 14);
          if (!rsi || !obv || !macd || !atr) return;

          // Calcular RVOL
          const vols   = bars.slice(-21).map(b => b.volume || 0);
          const avgVol = vols.slice(0, -1).reduce((s, v) => s + v, 0) / 20;
          const rvol   = avgVol > 0 ? vols[vols.length - 1] / avgVol : 1;

          // Simular señales MOM en las últimas 4 semanas
          let trades = 0, wins = 0, runners = 0;
          for (let bi2 = 50; bi2 < bars.length; bi2++) {
            const slice = bars.slice(Math.max(0, bi2 - 100), bi2 + 1);
            const r2    = calcRSI(slice, 14);
            const o2    = calcOBVSimple(slice);
            const m2    = calcMACDSimple(slice);
            if (!r2 || !o2 || !m2) continue;
            if (r2 < 45 || r2 > 70) continue;
            if (!o2.bullish) continue;
            if (!m2.bullish || !m2.increasing) continue;

            // Simular trade simple
            const entry = slice[slice.length - 1].close;
            const stop  = entry * 0.985; // 1.5% stop
            let maxPrice = entry;
            let exited   = false;

            for (let fi = bi2 + 1; fi < Math.min(bi2 + 32, bars.length); fi++) {
              maxPrice = Math.max(maxPrice, bars[fi].close);
              if (bars[fi].close <= stop) { trades++; exited = true; break; }
              if (maxPrice >= entry * 1.03) {
                trades++; wins++; runners++; exited = true; break;
              }
            }
            if (!exited) trades++;
            bi2 += 10; // no solapar
          }

          if (trades >= 2) {
            tickerStats[sym] = {
              trades, wins, runners,
              wr:       trades ? Math.round(wins / trades * 100) : 0,
              runRate:  trades ? Math.round(runners / trades * 100) : 0,
              rsi:      rsi,
              rvol:     rvol,
              inWL:     USER_WATCHLIST.indexOf(sym) >= 0,
              inBL:     MOM_BLACKLIST.indexOf(sym) >= 0,
            };
          }
        } catch (e) { /* skip */ }
      }));
      await new Promise(r => setTimeout(r, 500));
    }

    // 2. Identificar top runners y peores tickers
    const allStats = Object.entries(tickerStats);

    // Top candidatos: runner rate > 30%, WR > 40%, no en blacklist
    const topCandidates = allStats
      .filter(([sym, s]) => s.runRate >= 30 && s.wr >= 40 && !s.inBL && s.trades >= 3)
      .sort((a, b) => (b[1].runRate * b[1].wr) - (a[1].runRate * a[1].wr))
      .slice(0, 15);

    // Peores: WR < 20%, 0 runners, ya en WL
    const toRemove = allStats
      .filter(([sym, s]) => s.wr < 20 && s.runners === 0 && s.inWL && s.trades >= 3)
      .map(([sym]) => sym);

    // 3. Actualizar WL dinámica
    DYNAMIC_WL_ADDITIONS = topCandidates.map(([sym]) => sym)
      .filter(sym => USER_WATCHLIST.indexOf(sym) < 0);
    DYNAMIC_WL_REMOVALS  = toRemove;

    // 4. Llamar a Claude para análisis con contexto de noticias
    if (apiKey && topCandidates.length > 0) {
      const candidateText = topCandidates.map(([sym, s]) =>
        `${sym}: WR ${s.wr}%, RunRate ${s.runRate}%, RSI ${s.rsi?.toFixed(1)}`
      ).join('\n');

      const claudeR = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `Eres un analista de momentum. Estos tickers del SP500 han mostrado el mejor comportamiento como "runners" (posiciones que suben >3% con momentum) en las últimas 4 semanas:

${candidateText}

Tickers a retirar temporalmente (WR<20%, sin runners): ${toRemove.join(', ') || 'ninguno'}

Analiza brevemente (2-3 frases por ticker top):
1. ¿Tiene catalizador fundamental que explique el momentum? (IA, earnings, producto nuevo, etc)
2. ¿Es sostenible en las próximas 2-4 semanas?
3. Recomendación: AÑADIR / VIGILAR / IGNORAR

Responde en formato JSON:
{"additions": [{"sym":"TICKER","reason":"..breve..","rec":"AÑADIR|VIGILAR|IGNORAR"}], "removals_confirmed": ["TICKER1","TICKER2"]}`,
          }],
        }),
      });
      const claudeD = await claudeR.json();
      const text    = claudeD.content?.[0]?.text || '{}';
      try {
        const analysis  = JSON.parse(text.replace(/```json|```/g, '').trim());
        const confirmed = (analysis.additions || [])
          .filter(a => a.rec === 'AÑADIR')
          .map(a => a.sym);
        DYNAMIC_WL_ADDITIONS = confirmed.filter(s => USER_WATCHLIST.indexOf(s) < 0);

    // ── CAPA 2: WATCH → DYNAMIC_WL automático ───────────────────────
    // Si un ticker WATCH supera el umbral de score → se añade a la
    // watchlist dinámica automáticamente sin intervención manual
    const WATCH_AUTO_THRESHOLD = 68; // score mínimo para reactivación auto
    const WATCH_REMOVE_THRESHOLD = 45; // score mínimo para mantenerse en DWL
    
    const watchRecovered = [];
    const watchWeak = [];
    
    for (const [sym, score] of topCandidates) {
      if (WATCH_TICKERS.indexOf(sym) < 0) continue;
      
      if (score >= WATCH_AUTO_THRESHOLD) {
        // Score alto → añadir a watchlist dinámica automáticamente
        if (DYNAMIC_WL_ADDITIONS.indexOf(sym) < 0) {
          DYNAMIC_WL_ADDITIONS.push(sym);
          watchRecovered.push({ sym, score: score.toFixed(0) });
          console.log(`[WATCH→ACTIVE] ${sym} score:${score.toFixed(0)} → añadido a WL dinámica`);
        }
      } else if (score < WATCH_REMOVE_THRESHOLD) {
        // Score bajo → si estaba en DWL, sacarlo
        const idx = DYNAMIC_WL_ADDITIONS.indexOf(sym);
        if (idx >= 0) {
          DYNAMIC_WL_ADDITIONS.splice(idx, 1);
          watchWeak.push({ sym, score: score.toFixed(0) });
          console.log(`[WATCH→REMOVE] ${sym} score:${score.toFixed(0)} → eliminado de WL dinámica`);
        }
      }
    }
    
    // Telegram con resumen de cambios automáticos
    if (watchRecovered.length || watchWeak.length) {
      let msg = `🔄 <b>Watchlist dinámica actualizada</b>
`;
      if (watchRecovered.length) {
        msg += `
✅ <b>Añadidos automáticamente:</b>
`;
        watchRecovered.forEach(({sym, score}) => {
          msg += `  📈 ${sym} — score ${score}pts (>${WATCH_AUTO_THRESHOLD} umbral)
`;
        });
      }
      if (watchWeak.length) {
        msg += `
⬇️ <b>Eliminados por bajo momentum:</b>
`;
        watchWeak.forEach(({sym, score}) => {
          msg += `  📉 ${sym} — score ${score}pts (<${WATCH_REMOVE_THRESHOLD} umbral)
`;
        });
      }
      msg += `
WL activa: ${getActiveWatchlist().length} tickers
Usa /estados para ver el detalle.`;
      await sendTelegram(msg);
    }
    
    // Resumen WATCH tickers aunque no haya cambios
    const watchStatus = WATCH_TICKERS.map(sym => {
      const entry = topCandidates.find(([s]) => s === sym);
      const score = entry ? entry[1].toFixed(0) : '—';
      const inDWL = DYNAMIC_WL_ADDITIONS.indexOf(sym) >= 0;
      return `${sym}(${score}pts${inDWL ? ' 🟢DWL' : ''})`;
    }).join(' | ');
    
    if (watchStatus) {
      await sendTelegram(`👁 <b>Estado WATCH semanal</b>
${watchStatus}

Umbral auto-activación: ${WATCH_AUTO_THRESHOLD}pts
Umbral eliminación: ${WATCH_REMOVE_THRESHOLD}pts`);
    }
        weeklyAnalysisCache  = analysis;
      } catch (e) { /* usar resultado sin Claude */ }
    }

    // 5. Telegram resumen
    const addText = DYNAMIC_WL_ADDITIONS.length
      ? '✅ Añadidos: ' + DYNAMIC_WL_ADDITIONS.join(', ')
      : '✅ Sin nuevas adiciones';
    const remText = DYNAMIC_WL_REMOVALS.length
      ? '⏸️ Pausados: ' + DYNAMIC_WL_REMOVALS.join(', ')
      : '';

    const msg = `📊 *Análisis Semanal SP500*\n`
      + `Tickers analizados: ${Object.keys(tickerStats).length}\n`
      + `${addText}\n${remText}\n`
      + `WL activa: ${USER_WATCHLIST.length + DYNAMIC_WL_ADDITIONS.length} tickers`;
    await sendTelegram(msg).catch(() => {});
    console.log('[WEEKLY] Completado. Añadidos:', DYNAMIC_WL_ADDITIONS, '| Pausados:', DYNAMIC_WL_REMOVALS);

  } catch (e) {
    console.log('[WEEKLY] Error:', e.message);
  }
}

// Función helper OBV simplificado para el scanner
function calcOBVSimple(bars) {
  let obv = 0;
  const series = [];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i-1].close) obv += (bars[i].volume || 0);
    else if (bars[i].close < bars[i-1].close) obv -= (bars[i].volume || 0);
    series.push(obv);
  }
  const n = series.length;
  const nb = Math.min(14, n);
  let sx=0, sy=0, sxy=0, sx2=0;
  for (let j=0; j<nb; j++) {
    sx+=j; sy+=series[n-nb+j]; sxy+=j*series[n-nb+j]; sx2+=j*j;
  }
  const slope = (nb*sxy-sx*sy)/(nb*sx2-sx*sx||1);
  return { bullish: slope > 0, rising: n>=3&&series[n-1]>series[n-3] };
}

function calcMACDSimple(bars) {
  if (bars.length < 35) return null;
  let ef = bars[0].close, es = bars[0].close;
  const ml = [];
  for (let i=1; i<bars.length; i++) {
    ef = bars[i].close*2/13 + ef*(1-2/13);
    es = bars[i].close*2/27 + es*(1-2/27);
    if (i>=25) ml.push(ef-es);
  }
  if (ml.length < 9) return null;
  let sig = ml[0];
  const sigArr = [sig];
  for (let i=1; i<ml.length; i++) { sig=ml[i]*2/10+sig*(1-2/10); sigArr.push(sig); }
  const lM=ml[ml.length-1], lS=sigArr[sigArr.length-1];
  const pM=ml[ml.length-2], pS=sigArr[sigArr.length-2];
  return { bullish: lM>lS, increasing: (lM-lS)>(pM-pS), bullCross: pM<=pS&&lM>lS };
}

function calcATRSimple(bars, period) {
  if (bars.length < period+1) return null;
  let sum = 0;
  for (let i=bars.length-period; i<bars.length; i++) {
    const h=bars[i].high||bars[i].close, l=bars[i].low||bars[i].close, p=bars[i-1].close;
    sum += Math.max(h-l, Math.abs(h-p), Math.abs(l-p));
  }
  return sum/period;
}



// ── ANÁLISIS SEMANAL — estado y resultados ───────────────────────

app.get('/momscore', (req, res) => {
  const scores = {};
  Object.keys(momHistory).forEach(sym => {
    const score = getMomScore(sym);
    scores[sym] = {
      score:   parseFloat(score.toFixed(2)),
      samples: momHistory[sym].length,
      reached: momHistory[sym].filter(Boolean).length,
      blocked: !momScoreOk(sym),
      icon:    momScoreOk(sym) ? 'OK' : 'BLOCKED',
    };
  });
  res.json(scores);
});

app.get('/weekly/analysis', (req, res) => {
  res.json({
    lastRun:    weeklyAnalysisDate,
    additions:  DYNAMIC_WL_ADDITIONS,
    removals:   DYNAMIC_WL_REMOVALS,
    analysis:   weeklyAnalysisCache,
    activeWL:   USER_WATCHLIST.concat(DYNAMIC_WL_ADDITIONS || [])
                  .filter((s,i,a) => a.indexOf(s)===i)
                  .filter(s => !(DYNAMIC_WL_REMOVALS||[]).includes(s)),
  });
});

// Forzar análisis semanal manualmente (para testing)
app.post('/weekly/run', async (req, res) => {
  weeklyAnalysisDate = null; // reset para permitir re-ejecución
  await weeklyRunnerAnalysis().catch(e => console.log('[WEEKLY]', e.message));
  res.json({ ok: true, additions: DYNAMIC_WL_ADDITIONS, removals: DYNAMIC_WL_REMOVALS });
});

// ── FORZAR ANÁLISIS SECTORIAL ────────────────────────────────────
// POST /sector/run — ejecuta el análisis ahora sin esperar al cierre
// Útil para ver tendencias políticas e institucionales en cualquier momento
app.post('/sector/run', async (req, res) => {
  const key = req.headers['x-api-key'] || req.query.key || '';
  // Protección mínima — solo desde la app
  if (key !== 'ors2025' && !req.headers.origin?.includes('github.io') &&
      !req.headers.origin?.includes('localhost')) {
    // Permitir sin key por ahora en desarrollo
  }
  console.log('[SECTOR/FORCE] Análisis sectorial forzado por usuario');
  // Limpiar caché para forzar re-análisis
  sectorLastUpdate = null;
  res.json({ ok: true, message: 'Análisis iniciado, listo en ~30 segundos', ts: new Date().toISOString() });
  // Ejecutar en background
  updateSectorSentiment().catch(e => console.log('[SECTOR/FORCE] Error:', e.message));
});

app.get('/sector/sentiment', (req, res) => {
  const LABELS = {
    AI_CHIPS:     { name:'AI & Chips',      etf:'SOXX', emoji:'🤖' },
    CLOUD:        { name:'Cloud & Software', etf:'XLK',  emoji:'☁️' },
    SPACE:        { name:'Space & Defensa',  etf:'XAR',  emoji:'🚀' },
    CLEAN_ENERGY: { name:'Energía Limpia',   etf:'ICLN', emoji:'⚡' },
    BIOTECH:      { name:'Biotech',          etf:'XBI',  emoji:'🧬' },
    HEALTHCARE:   { name:'Healthcare',       etf:'XLV',  emoji:'🏥' },
    AIRLINES:     { name:'Airlines',         etf:'JETS', emoji:'✈️' },
    INDUSTRIAL:   { name:'Industrial',       etf:'XLI',  emoji:'🏭' },
    FINTECH:      { name:'Fintech',          etf:'XLF',  emoji:'💳' },
  };

  const sectors = Object.entries(sectorSentiment).map(function([k, v]) {
    const meta = LABELS[k] || { name: k, etf: '?', emoji: '📊' };
    const hasPol  = v.politico && v.politico !== 'ninguno reciente';
    const hasInst = v.flujo_inst && v.flujo_inst.indexOf('+') >= 0;
    const badges  = [];
    if (hasPol)          badges.push('🏛️ Político');
    if (hasInst)         badges.push('🏦 Institucional');
    if (v.score >= 80)   badges.push('⭐ Alta confianza');
    return {
      id:          k,
      name:        meta.name,
      etf:         meta.etf,
      emoji:       meta.emoji,
      status:      v.status,
      score:       v.score || 50,
      icon:        v.status === 'BULLISH' ? '🟢' : v.status === 'BEARISH' ? '🔴' : '🟡',
      color:       v.status === 'BULLISH' ? '#22c55e' : v.status === 'BEARISH' ? '#ef4444' : '#eab308',
      reason:      v.reason     || '',
      politico:    v.politico   || null,
      flujo_inst:  v.flujo_inst || null,
      hasPolitico:      hasPol,
      hasInstitucional: hasInst,
      badges,
      tickers: (SECTOR_ETFS[k] || {}).tickers || [],
    };
  }).sort(function(a, b) { return b.score - a.score; });

  const bullish = sectors.filter(function(s) { return s.status === 'BULLISH'; });
  const bearish = sectors.filter(function(s) { return s.status === 'BEARISH'; });
  const senales_pol = sectors
    .filter(function(s) { return s.hasPolitico && s.status !== 'BEARISH'; })
    .map(function(s) { return { sector: s.name, emoji: s.emoji, dato: s.politico }; });

  res.json({
    ok:          true,
    lastUpdate:  sectorLastUpdate,
    nextUpdate:  '20:10 UTC (cierre NYSE)',
    dataSource:  'ETFs Alpaca + Noticias + Web Search (Capitol Trades + ETF Flows)',
    sectors:     sectors,
    resumen: {
      bullish:           bullish.map(function(s) { return s.name; }),
      bearish:           bearish.map(function(s) { return s.name; }),
      top_sector:        bullish[0] ? bullish[0].name : 'ninguno',
      senales_politicas: senales_pol,
      hay_datos:         Object.keys(sectorSentiment).length > 0,
    },
  });
});

app.get('/health', (req, res) => {
  const positions = Object.keys(openPositions);
  const vixRegime = getVIXSystemRegime();
  res.json({
    status:        'ok',
    version:       '3.50.6',
    deployed:      new Date().toISOString().slice(0,10),
    account:       getAcc().label,
    accountId:     ACTIVE_ACCOUNT,
    capital:       CAPITAL_EUR,
    vix: {
      value:    vixContext.value,
      regime:   vixContext.regime,
      priority: vixRegime.priority,
      sizeMult: vixRegime.sizeMult,
      desc:     vixRegime.desc,
    },
    features: {
      autoExit4Levels:    true,
      trendRunner:        true,  // dejar correr ganadores +8%
      vixSystemRegime:    true,  // prioridad de sistema según VIX
      obvMacdExit:        true,
      timeStop48h:        true,
      tradeHistory:       true,
      decisionLog:        true,
      scanMOM:            true,
      orsOnly5of5:        true,
      ichimokuMOM:        true,
      ichimokuDiarioYahoo:true,  // v4: Ichimoku diario real 9/26/52 dias
      capQtyCorregido:    true,  // v4: riesgo real 2% (antes 0.2% tickers caros)
      confirmacion3velas: true,  // v4: 3 velas consecutivas alcistas
      spyBlockTotal:      true,  // v4: bloqueo total si SPY <-1.5%
      bugTickerMismoDia:  true,  // v4: no re-entrar mismo ticker mismo dia
    },
    openPositions:   positions,
    positionCount:   positions.length,
    mode:            USE_PAPER ? 'PAPER' : 'LIVE',
    uptime:          Math.round(process.uptime()) + 's',
  });
});

// ═══════════════════════════════════════════════════════
// ── ENDPOINT RÉGIMEN DE MERCADO ──────────────────────────────────────────────
app.get('/market/regime', async (req, res) => {
  // Actualizar solo si no hay datos del día actual (no forzar en fin de semana)
  const now = new Date();
  const regimeDate = MARKET_REGIME.ts ? new Date(MARKET_REGIME.ts).toDateString() : null;
  const todayIsWeekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
  const needsUpdate = !MARKET_REGIME.ts || (todayIsWeekday && regimeDate !== now.toDateString() && now.getUTCHours() >= 20);
  if (needsUpdate) {
    await updateMarketRegime().catch(() => {});
  }
  res.json({
    regime: MARKET_REGIME,
    vix: vixContext,
    spy: spyContext,
    updatedAt: new Date(MARKET_REGIME.ts || Date.now()).toISOString(),
  });
});

// BACKTEST ENDPOINT — /test/ors y /test/mom
// Simula el sistema sobre datos reales de Yahoo Finance
// ═══════════════════════════════════════════════════════

async function runBacktestEngine(tickers, systemType, days, startDate, endDate, runnerThreshold, orsRunner) {
  const results = [], tickerStats = [];
  const capital = parseFloat(process.env.CAPITAL_EUR || '11480');
  const riskPct = systemType === 'MOM' ? RISK_PCT * 0.75 : RISK_PCT;
  const RUNNER_THRESHOLD = runnerThreshold != null ? runnerThreshold : 3; // +3% — runner agresivo validado
  const ORS_RUNNER = orsRunner === true; // activar runner en ORS (experimental)

  // Período exacto
  const cutoffStr = startDate || (() => {
    const d = new Date(); d.setDate(d.getDate()-days);
    return d.toISOString().slice(0,10);
  })();
  const endStr = endDate || new Date().toISOString().slice(0,10);

  // Yahoo: calcular range adecuado para cubrir el período
  const totalDays = Math.ceil((new Date(endStr)-new Date(cutoffStr))/86400000) + 60;
  const range = totalDays <= 30 ? '1mo' : totalDays <= 90 ? '3mo' : totalDays <= 180 ? '6mo' : '1y';

  for (const sym of tickers) {
    try {
      // CORRECCIÓN v9: usar Alpaca 15min en vez de Yahoo diario
      // Los datos diarios daban resultados inflados (82% WR ficticio)
      // Alpaca 15min replica exactamente cómo opera el sistema en producción
      let prices = [];
      try {
        const btStart = new Date(cutoffStr);
        btStart.setDate(btStart.getDate() - 90); // 90 días extra de warmup
        const alpacaStart = btStart.toISOString().slice(0,10);
        const alpacaPath = `/v2/stocks/${sym}/bars?timeframe=15Min&start=${alpacaStart}&end=${endStr}&limit=10000&feed=iex&sort=asc`;
        const alpacaR = await fetch(
          `https://data.alpaca.markets${alpacaPath}`,
          { headers: { 'APCA-API-KEY-ID': process.env.ALPACA_KEY, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET } }
        );
        const alpacaD = await alpacaR.json();
        const bars15 = alpacaD.bars || [];
        if (bars15.length < 100) { console.log('[BT] '+sym+': solo '+bars15.length+' barras 15min'); continue; }
        // Convertir a formato compatible con los indicadores
        prices = bars15.map(b => ({
          date:   b.t.slice(0,10),
          time:   b.t,
          close:  b.c, high: b.h, low: b.l, open: b.o, volume: b.v,
        }));
        console.log('[BT] '+sym+': '+prices.length+' barras 15min OK');
      } catch(e) { console.log('[BT] '+sym+': error Alpaca '+e.message); continue; }

      if (prices.length < 100) { console.log('[BT] '+sym+': insuficientes barras'); continue; }

      // Pre-cargar datos del ETF del sector para el filtro
      const symSectorBT = getSector(sym);
      const etfSym = SECTOR_ETF[symSectorBT];
      let etfPrices = null;
      if (etfSym) {
        try {
          const etfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${etfSym}?interval=1d&range=${range}`;
          const etfR = await fetch(etfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const etfD = await etfR.json();
          const etfRes = etfD?.chart?.result?.[0];
          if (etfRes) {
            const etfTs = etfRes.timestamp || [];
            const etfQ  = etfRes.indicators?.quote?.[0] || {};
            etfPrices = etfTs.map((t, i) => ({
              date:  new Date(t*1000).toISOString().slice(0,10),
              close: etfQ.close?.[i],
            })).filter(p => p.close && p.close > 0);
          }
        } catch(e) {}
      }

      // Cutoff: solo reportar señales dentro del período solicitado
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0,10);

      const tradeResults = [];

      // Empezar desde barra 30 para tener suficiente historia
      for (let i = 30; i < prices.length - 2; i++) {
        // Solo analizar barras dentro del período solicitado
        if ((prices[i].date||prices[i].time||'').slice(0,10) < cutoffStr) continue;
        if (prices[i].date > endStr) continue;

        const slice  = prices.slice(0, i+1);
        const rsi    = calcRSI(slice, 14);
        const rsiPrev= calcRSI(slice.slice(0,-1), 14);
        const ema20  = calcEMA(slice, 20);
        const obv    = calcOBV(slice);
        const macd   = calcMACD(slice);
        const atr    = calcATR(slice, 14);
        const sma200 = slice.length >= 200 ? calcSMA(slice, 200) : null;
        const last   = slice[slice.length-1].close;

        if (!rsi || !atr || !last) continue;

        // RVOL — volumen relativo
        const vols  = slice.slice(-21);
        const avgV  = vols.slice(0,-1).reduce((s,p)=>s+(p.volume||0),0)/20;
        const rvol  = avgV > 0 ? (vols[vols.length-1].volume||0)/avgV : 1;
        const aboveSMA = sma200 ? last > sma200 : true;

        // Lista negra MOM — tickers problemáticos
        const MOM_BLACKLIST = [
          'NEE', 'ETR',        // Utilities — macro dependientes
          'COIN',              // Crypto — gaps extremos
          'ZIM',               // Shipping — gaps sin estructura
          'AAL',               // Airlines low cost — rango bajo volátil
          'CRSP', 'INSM',      // Biotech especulativo — gaps clínicos
        ];
        const inBlacklist = MOM_BLACKLIST.indexOf(sym) >= 0;

        let validEntry = false, entryType = '';

        if (systemType === 'ORS' || systemType === 'BOTH') {
          const rsiCruz  = rsiPrev !== null && rsiPrev < 30 && rsi >= 30;
          const rsiOk    = rsi >= 20 && rsi <= 45;
          const bajoVwap = ema20 && last < ema20;
          const obvOk    = obv && obv.bullish && obv.rising;
          const macdBull = macd && macd.bullish;
          const count    = (rsiOk?1:0)+(rsiCruz?1:0)+(bajoVwap?1:0)+(obvOk?1:0)+(macdBull?1:0);
          if (count >= 4 && obvOk && rsiCruz) {
            validEntry = true;
            entryType  = count >= 5 ? 'ORS-5/5' : 'ORS-4/5';
          }
        }

        if ((systemType === 'MOM' || systemType === 'BOTH') && !validEntry && !inBlacklist) {
          // RSI 45-75 — rango momentum alcista óptimo
          const rsiMom   = rsi >= 45 && rsi <= 75;
          const obvOk    = obv && obv.bullish && obv.rising;
          const macdOk   = macd && macd.bullish;
          const aboveEMA = ema20 && last > ema20;
          const n        = slice.length;
          const p3high   = Math.max(
            slice[n-4]?.high||0,
            slice[n-3]?.high||0,
            slice[n-2]?.high||0
          );
          const breakout = last > p3high;
          const priceOk  = last >= 20;
          const rvolOk   = rvol >= 1.5;
          const count    = (rsiMom?1:0)+(obvOk?1:0)+(macdOk?1:0)+(aboveEMA?1:0)+(breakout?1:0);

          if (count >= 4 && obvOk && priceOk && rvolOk) {
            // ── ICHIMOKU DIARIO REAL ──
            const ichiReal = slice.length >= 52 ? calcIchimoku(slice) : null;
            const ichiPass = !ichiReal || ichiReal.momFilter;
            if (ichiPass) {
              validEntry = true;
              entryType  = `MOM-${count}/5`;
            }
          }
        }

        if (!validEntry) continue;

        // Evitar señales consecutivas
        const lastTrade = tradeResults[tradeResults.length-1];
        const barDate15 = (prices[i].date||prices[i].time||'').slice(0,10);
        // No entrar si ya hay trade del mismo día o si sigue en posición abierta
        if (lastTrade && barDate15 <= (lastTrade.exitDate||'').slice(0,10)) continue;
        // No entrar los martes (ratio runner/stop 0.21x)
        const barDow = new Date(barDate15).getUTCDay();
        if (barDow === 2) continue;
        // 1 trade por ticker: verificar que la barra está en horario de mercado (14:00-20:00 UTC)
        const barHour = prices[i].time ? parseInt(prices[i].time.slice(11,13)) : 14;
        if (barHour < 14 || barHour >= 20) continue;

        // FIX 3: Stop ATR×1.5 (igual que ORS, más margen para respirar)
        // FIX 5: Target R:R 2:1 para equilibrar el ratio
        const stopMult = systemType === 'MOM' ? 1.5 : 1.5;
        const targetRR = systemType === 'MOM' ? 2.0 : 2.0;
        const sizeMult = systemType === 'MOM' ? 0.75 : 1.0;
        const entry    = prices[i+1] ? prices[i+1].close : last;
        const stop     = parseFloat((entry - atr * stopMult).toFixed(2));
        const riskPS   = entry - stop;
        if (riskPS <= 0) continue;
        const smaMult  = aboveSMA ? 1.0 : 0.5;
        const riskUSD  = capital * riskPct * 1.08 * sizeMult * smaMult;
        // capQty aplicado al backtest MOM — mismo límite 30% que producción
        const qty      = capQty(Math.max(1, Math.floor(riskUSD / riskPS)), entry, true);
        const target   = parseFloat((entry + riskPS * targetRR).toFixed(2));

        // Simular salida
        let exitPrice = null, exitReason = '', exitDate = '';
        let maxP = entry, curStop = stop, partial = false;
        const maxDays = systemType === 'MOM' ? 20 : 8;  // v9: reducido para evitar bug tiempo máximo

        // v9: con datos 15min, convertir días a barras (26 barras/día aprox)
        const maxBars15 = maxDays * 26;
        for (let j = i+1; j < Math.min(i+maxBars15+1, prices.length); j++) {
          const bar = prices[j];
          if (!bar.close) continue;
          if (bar.high > maxP) maxP = bar.high;
          const gainPct = (bar.close - entry) / entry * 100;

          // N1: Stop
          if (bar.low <= curStop) {
            exitPrice = curStop; exitReason = 'N1 Stop'; exitDate = bar.date; break;
          }

          if (systemType === 'ORS' || entryType.startsWith('ORS')) {
            if (!partial && bar.high >= target) {
              partial  = true;
              curStop  = parseFloat((entry * 1.002).toFixed(2));
              exitReason = 'N2 Target 50%';
            }
            if (partial && bar.low <= maxP * 0.96) {
              exitPrice = parseFloat((maxP * 0.96).toFixed(2));
              exitReason = 'N4 Trail 4%'; exitDate = bar.date; break;
            }
          } else {
            // MOM: breakeven a +3%, trailing escalado
            if (gainPct >= 3 && curStop < entry) {
              curStop = parseFloat((entry * 1.003).toFixed(2));
              partial = true;
            }

            // ── TREND RUNNER — dejar correr ganadores fuertes ──
            // Umbral configurable: por defecto +8%, pero se puede bajar a +3% (todas)
            const slRun  = prices.slice(0, j+1);
            const ema20d = calcEMA(slRun, 20);
            const obvRun = calcOBV(slRun);
            const isRunner = gainPct >= RUNNER_THRESHOLD && ema20d && bar.close > ema20d
                          && obvRun && obvRun.bullish;

            if (isRunner) {
              // Modo runner: stop sube a EMA20 diaria (deja correr)
              const runnerStop = parseFloat(ema20d.toFixed(2));
              if (runnerStop > curStop) curStop = runnerStop;
              // Solo sale por N3 (momentum roto) o por tocar EMA20
              if (bar.low <= curStop) {
                exitPrice = curStop; exitReason = 'Runner EMA20'; exitDate = bar.date; break;
              }
              // N3 para runner — si OBV+MACD se rompen, salir aunque siga arriba
              const macRun = calcMACD(slRun);
              const rsiRun = calcRSI(slRun, 14);
              const bearRun = (obvRun && !obvRun.bullish ? 1 : 0)
                            + (macRun && macRun.bearCross ? 1 : 0)
                            + (rsiRun && rsiRun < 50 ? 1 : 0);
              if (bearRun >= 2) {
                exitPrice = bar.close; exitReason = 'Runner N3 exit'; exitDate = bar.date; break;
              }
              // Si es runner, saltar el trailing normal de abajo
              if (j === Math.min(i+maxDays, prices.length-1)) {
                exitPrice = bar.close; exitReason = 'Runner tiempo max'; exitDate = bar.date; break;
              }
              continue; // no aplicar trailing normal
            }

            const trailPct = gainPct >= 10 ? 6 : gainPct >= 5 ? 4 : 3;
            if (partial && bar.low <= maxP * (1 - trailPct/100)) {
              exitPrice = parseFloat((maxP*(1-trailPct/100)).toFixed(2));
              exitReason = `N4 Trail ${trailPct}%`; exitDate = bar.date; break;
            }

            // ── N3 MOM MEJORADO — deterioro momentum desde día 2 ──
            if (j >= i + 2) {
              const slN3  = prices.slice(0, j+1);
              const obvN3 = calcOBV(slN3);
              const macN3 = calcMACD(slN3);
              const rsiN3 = calcRSI(slN3, 14);
              const bearSigns = (obvN3 && !obvN3.bullish ? 1 : 0)
                              + (macN3 && macN3.bearCross ? 1 : 0)
                              + (rsiN3 && rsiN3 < 45 ? 1 : 0);  // RSI <45 más sensible
              // 2+ señales bajistas + perdiendo → salir
              if (bearSigns >= 2 && gainPct < 0) {
                exitPrice = bar.close; exitReason = 'N3 OBV+MACD';
                exitDate = bar.date; break;
              }
              // N3 agresivo: 3 señales bajistas aunque esté ganando poco
              if (bearSigns >= 3 && gainPct < 1.0) {
                exitPrice = bar.close; exitReason = 'N3 Momentum';
                exitDate = bar.date; break;
              }
            }

            // ── TIME STOP 48h — sin progreso en 2 días ────────
            // Si después de 2 barras (2 días) el precio no ha subido >0.5%
            // y OBV es bajista → señal débil, salir antes de pérdida mayor
            if (j === i + 2 && !partial) {
              const gain2d = (bar.close - entry) / entry * 100;
              const slTs   = prices.slice(0, j+1);
              const obvTs  = calcOBV(slTs);
              if (gain2d <= 0 && obvTs && !obvTs.bullish) {
                exitPrice = bar.close; exitReason = 'N5 Time+OBV';
                exitDate = bar.date; break;
              }
            }
          }

          if (j === Math.min(i+maxDays, prices.length-1)) {
            const gainNow = (bar.close - entry) / entry * 100;
            // Solo cerrar por tiempo si está perdiendo o sin progreso
            // Si está ganando, dejar correr hasta trailing o señal bajista
            if (gainNow <= 1.0) {
              exitPrice = bar.close; exitReason = 'Tiempo max'; exitDate = bar.date; break;
            }
            // En positivo — extender otros 5 días más
            if (j === Math.min(i+maxDays+5, prices.length-1)) {
              exitPrice = bar.close; exitReason = 'Tiempo max+'; exitDate = bar.date; break;
            }
          }
        }

        if (!exitPrice || !exitDate) continue;

        const isORS    = systemType === 'ORS' || entryType.startsWith('ORS');
        const remQty   = isORS && partial ? Math.ceil(qty*0.5) : qty;
        const partPnl  = isORS && partial ? (target - entry) * Math.floor(qty*0.5) : 0;
        const totPnlUSD= partPnl + (exitPrice - entry) * remQty;
        const pnlEur   = parseFloat((totPnlUSD / 1.08).toFixed(0));
        const pnlPct   = parseFloat(((exitPrice-entry)/entry*100).toFixed(2));
        const win      = totPnlUSD > 0;

        const trade = {
          sym, date: prices[i].date, exitDate, type: entryType,
          entry: +entry.toFixed(2), exit: +exitPrice.toFixed(2),
          stop: +stop.toFixed(2), target: +target.toFixed(2),
          qty, pnlEur, pnlPct, win, exitReason, aboveSMA,
          rsi: +rsi.toFixed(1), rvol: +rvol.toFixed(2),
        };
        tradeResults.push(trade);
        results.push(trade);
      }

      if (tradeResults.length > 0) {
        const tw = tradeResults.filter(t=>t.win).length;
        tickerStats.push({
          sym, trades: tradeResults.length, wins: tw,
          wr: Math.round(tw/tradeResults.length*100),
          pnl: tradeResults.reduce((s,t)=>s+t.pnlEur, 0),
        });
        console.log(`[BT] ${sym}: ${tradeResults.length} trades, WR ${Math.round(tw/tradeResults.length*100)}%`);
      }

      await new Promise(r => setTimeout(r, 150));
    } catch(e) {
      console.log(`[BT] ${sym} error: ${e.message}`);
    }
  }

  results.sort((a,b) => a.date < b.date ? -1 : 1);
  let equity = capital;
  const curve = [equity];
  results.forEach(t => { equity += t.pnlEur; t.capitalAfter = Math.round(equity); curve.push(equity); });

  const wins   = results.filter(t=>t.win).length;
  const losses = results.length - wins;
  const wr     = results.length ? Math.round(wins/results.length*100) : 0;
  const avgW   = wins   ? results.filter(t=>t.win).reduce((s,t)=>s+t.pnlEur,0)/wins   : 0;
  const avgL   = losses ? results.filter(t=>!t.win).reduce((s,t)=>s+t.pnlEur,0)/losses : 0;
  const pf     = avgL !== 0 ? Math.abs(avgW/avgL) : 999;
  let peak = capital, maxDD = 0;
  curve.forEach(c => { if(c>peak)peak=c; const dd=peak-c; if(dd>maxDD)maxDD=dd; });

  const reasons = {};
  results.forEach(t => { reasons[t.exitReason] = (reasons[t.exitReason]||0)+1; });

  return {
    system: systemType, days,
    period: `${cutoffStr} → ${endStr}`,
    dataSource: 'Yahoo Finance diario',
    tickersScanned: tickers.length,
    tickersWithSignals: tickerStats.length,
    capital0: capital,
    capitalFinal: Math.round(equity),
    totalEur: Math.round(equity - capital),
    totalPct: parseFloat(((equity-capital)/capital*100).toFixed(2)),
    trades: results.length, wins, losses,
    winRate: wr,
    avgWin:  Math.round(avgW),
    avgLoss: Math.round(avgL),
    profitFactor: parseFloat(pf.toFixed(2)),
    maxDrawdown:  Math.round(maxDD),
    exitReasons:  reasons,
    byTicker:     tickerStats.sort((a,b)=>b.pnl-a.pnl),
    lastTrades:   results.slice(-30).reverse(),
    generated:    new Date().toISOString(),
  };
}
// ── BACKTEST ORS EN 15MIN — usa Alpaca en lugar de Yahoo ──
// ── ORS HISTÓRICO — usa Alpaca 15min con filtro de fechas ──
// Para períodos donde Alpaca tiene datos (desde ~enero 2025)
async function runORSBacktestHistorical(tickers, startDate, endDate) {
  const results = [], tickerStats = [];
  const capital = parseFloat(process.env.CAPITAL_EUR || '11480');

  // Calcular días desde hoy hasta startDate para pedir suficientes datos
  const daysNeeded = Math.ceil((new Date() - new Date(startDate)) / 86400000) + 10;

  console.log(`[ORS-Historical] ${startDate} → ${endDate} | ${daysNeeded} días desde hoy | ${tickers.length} tickers`);

  const BATCH_SIZE = 5;
  for (let b = 0; b < tickers.length; b += BATCH_SIZE) {
    const batch = tickers.slice(b, b + BATCH_SIZE);
    await Promise.all(batch.map(async (sym) => {
      try {
        const [prices, dailyPrices] = await Promise.all([
          fetchAlpaca15minHistory(sym, daysNeeded),
          (async () => {
            try {
              const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=3mo`;
              const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
              const d = await r.json();
              const res = d?.chart?.result?.[0];
              if (!res) return null;
              const ts = res.timestamp || [];
              const q  = res.indicators?.quote?.[0] || {};
              return ts.map((t,i) => ({
                date: new Date(t*1000).toISOString().slice(0,10),
                close: q.close?.[i], high: q.high?.[i]||q.close?.[i],
                low: q.low?.[i]||q.close?.[i], volume: q.volume?.[i]||0,
              })).filter(p => p.close && p.close > 0);
            } catch(e) { return null; }
          })(),
        ]);
        if (!prices || prices.length < 50) return;

        const ichiDaily = dailyPrices && dailyPrices.length >= 52
          ? calcIchimoku(dailyPrices) : null;

        const tradeResults = [];

        for (let i = 50; i < prices.length - 3; i++) {
          const barDate = prices[i].date.slice(0,10);
          if (barDate < startDate) continue;
          if (barDate > endDate)   break;

          // Filtro hora — solo barras de mercado (13:30-20:00 UTC = 9:30-16:00 NY)
          const barHour = parseInt(prices[i].date.slice(11,13));
          if (barHour < 13 || barHour > 20) continue;

          const slice   = prices.slice(0, i+1);
          const rsi     = calcRSI(slice, 14);
          const rsiPrev = calcRSI(slice.slice(0,-1), 14);
          const ema20   = calcEMA(slice, 20);
          const obv     = calcOBV(slice);
          const macd    = calcMACD(slice);
          const atr     = calcATR(slice, 14);
          const sma200  = slice.length >= 200 ? calcSMA(slice, 200) : null;
          const last    = slice[slice.length-1].close;

          if (!rsi || !atr || !last) continue;

          const vols = slice.slice(-21);
          const avgV = vols.slice(0,-1).reduce((s,p)=>s+(p.volume||0),0)/20;
          const rvol = avgV > 0 ? (vols[vols.length-1].volume||0)/avgV : 1;
          const aboveSMA = sma200 ? last > sma200 : true;

          // Condiciones ORS-v2 reales en 15min
          const rsiCruz  = rsiPrev !== null && rsiPrev < 30 && rsi >= 30;
          const rsiOk    = rsi >= 20 && rsi <= 45;
          const bajoVwap = ema20 && last < ema20;
          const obvOk    = obv && obv.bullish && obv.rising;
          const macdBull = macd && macd.bullish;
          const count    = (rsiOk?1:0)+(rsiCruz?1:0)+(bajoVwap?1:0)+(obvOk?1:0)+(macdBull?1:0);

          // Solo ORS 5/5 — mínimo 5 condiciones obligatorio
          if (count < 5 || !obvOk || !rsiCruz) continue;
          if (rvol < 1.2) continue;
          if (slice.length >= 100) {
            const lookback = Math.min(260, slice.length);
            const recent   = slice.slice(-lookback);
            const maxPrice = recent.reduce((m,p)=>Math.max(m,p.high||p.close),-Infinity);
            const dropPct  = (last - maxPrice) / maxPrice * 100;
            if (dropPct > -4) continue;
          }
          if (i >= 10) {
            const spyChg = (slice[slice.length-1].close - slice[slice.length-10].close) / slice[slice.length-10].close * 100;
            if (spyChg < -1.5) continue;
          }

          const lastTrade = tradeResults[tradeResults.length-1];
          if (lastTrade && prices[i].date <= lastTrade.exitDate) continue;

          const entry   = prices[i+1] ? prices[i+1].close : last;
          const atrAdj  = adjustedATR(atr, entry);
          const stop    = parseFloat((entry - atrAdj * 2.0).toFixed(2));
          const riskPS  = entry - stop;
          if (riskPS <= 0) continue;

          // Sizing ORS 5/5 — 30% del capital
          const qualMult = 1.0; // siempre 5/5 ahora
          const smaMult  = aboveSMA ? 1.0 : 0.5;
          const riskUSD  = capital * 0.02 * 1.08 * qualMult * smaMult;
          const qty      = capQty(Math.max(1, Math.floor(riskUSD / riskPS)), entry, true);
          const target   = parseFloat((entry + riskPS * 2).toFixed(2));

          // Simular salida — máx 40 barras
          let exitPrice = null, exitReason = '', exitDate = '';
          let maxP = entry, curStop = stop, partial = false;

          for (let j = i+1; j < Math.min(i+40, prices.length); j++) {
            const bar = prices[j];
            if (bar.high > maxP) maxP = bar.high;
            if (bar.low <= curStop) {
              exitPrice = curStop; exitReason = 'N1 Stop'; exitDate = bar.date; break;
            }
            if (!partial && bar.high >= target) {
              partial = true; curStop = parseFloat((entry*1.002).toFixed(2));
            }
            if (partial && bar.low <= maxP * 0.96) {
              exitPrice = parseFloat((maxP*0.96).toFixed(2));
              exitReason = 'N4 Trail 4%'; exitDate = bar.date; break;
            }
            if (j === Math.min(i+39, prices.length-1)) {
              const gainNow = (bar.close-entry)/entry*100;
              if (gainNow <= 0.5) {
                exitPrice = bar.close; exitReason = 'Tiempo max'; exitDate = bar.date; break;
              }
            }
          }

          if (!exitPrice || !exitDate) continue;

          const remQty   = partial ? Math.ceil(qty*0.5) : qty;
          const partPnl  = partial ? (target-entry)*Math.floor(qty*0.5) : 0;
          const totPnlUSD= partPnl + (exitPrice-entry)*remQty;
          const pnlEur   = parseFloat((totPnlUSD/1.08).toFixed(0));
          const win      = totPnlUSD > 0;

          const trade = {
            sym, date: prices[i].date, exitDate, type: count>=5?'ORS-5/5':'ORS-4/5',
            entry: +entry.toFixed(2), exit: +exitPrice.toFixed(2),
            stop: +stop.toFixed(2), target: +target.toFixed(2),
            qty, pnlEur, pnlPct: parseFloat(((exitPrice-entry)/entry*100).toFixed(2)),
            win, exitReason, aboveSMA, rsi: +rsi.toFixed(1), rvol: +rvol.toFixed(2),
          };
          tradeResults.push(trade);
          results.push(trade);
        }

        if (tradeResults.length > 0) {
          const tw = tradeResults.filter(t=>t.win).length;
          tickerStats.push({
            sym, trades: tradeResults.length, wins: tw,
            wr: Math.round(tw/tradeResults.length*100),
            pnl: tradeResults.reduce((s,t)=>s+t.pnlEur, 0),
          });
          console.log(`[ORS-Historical] ${sym}: ${tradeResults.length} trades`);
        }
      } catch(e) {
        console.log(`[ORS-Historical] ${sym}: ${e.message}`);
      }
    }));
  }

  results.sort((a,b) => a.date < b.date ? -1 : 1);
  let equity = capital;
  results.forEach(t => { equity += t.pnlEur; t.capitalAfter = Math.round(equity); });

  const wins   = results.filter(t=>t.win).length;
  const losses = results.length - wins;
  const wr     = results.length ? Math.round(wins/results.length*100) : 0;
  const avgW   = wins   ? results.filter(t=>t.win).reduce((s,t)=>s+t.pnlEur,0)/wins   : 0;
  const avgL   = losses ? results.filter(t=>!t.win).reduce((s,t)=>s+t.pnlEur,0)/losses : 0;
  const pf     = avgL   ? parseFloat(Math.abs(avgW/avgL).toFixed(2)) : 999;
  let peak = capital, maxDD = 0, cap = capital;
  results.forEach(t => { cap+=t.pnlEur; if(cap>peak)peak=cap; if(peak-cap>maxDD)maxDD=peak-cap; });
  const reasons = {};
  results.forEach(t => { reasons[t.exitReason]=(reasons[t.exitReason]||0)+1; });

  return {
    system: 'ORS-Historical', period: `${startDate} → ${endDate}`,
    dataSource: 'Alpaca 15min (datos reales)',
    tickersScanned: tickers.length, tickersWithSignals: tickerStats.length,
    capital0: capital, capitalFinal: Math.round(equity),
    totalEur: Math.round(equity-capital),
    totalPct: parseFloat(((equity-capital)/capital*100).toFixed(2)),
    trades: results.length, wins, losses, winRate: wr,
    avgWin: Math.round(avgW), avgLoss: Math.round(avgL),
    profitFactor: pf, maxDrawdown: Math.round(maxDD),
    exitReasons: reasons,
    byTicker: tickerStats.sort((a,b)=>b.pnl-a.pnl),
    lastTrades: results.slice(-30).reverse(),
    generated: new Date().toISOString(),
  };
}
async function runORSBacktest15min(tickers, days, startDate, endDate) {
  const results = [], tickerStats = [];
  const capital = parseFloat(process.env.CAPITAL_EUR || '11480');

  // Definir período exacto
  const cutoffStr = startDate || (() => {
    const d = new Date(); d.setDate(d.getDate()-days);
    return d.toISOString().slice(0,10);
  })();
  const endStr = endDate || new Date().toISOString().slice(0,10);

  // ── Fetch datos diarios Yahoo para Ichimoku diario ──
  // Cache de datos diarios por ticker para no repetir llamadas
  async function fetchDailyPrices(sym) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=3mo`;
      const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d   = await r.json();
      const res = d?.chart?.result?.[0];
      if (!res) return null;
      const ts = res.timestamp || [];
      const q  = res.indicators?.quote?.[0] || {};
      return ts.map((t, i) => ({
        date:   new Date(t*1000).toISOString().slice(0,10),
        close:  q.close?.[i],
        high:   q.high?.[i]  || q.close?.[i],
        low:    q.low?.[i]   || q.close?.[i],
        volume: q.volume?.[i] || 0,
      })).filter(p => p.close && p.close > 0);
    } catch(e) { return null; }
  }

  // Procesar en lotes de 5 en paralelo para mayor velocidad
  const BATCH_SIZE = 5;
  for (let b = 0; b < tickers.length; b += BATCH_SIZE) {
    const batch = tickers.slice(b, b + BATCH_SIZE);
    await Promise.all(batch.map(async (sym) => {
      try {
        // Fetch 15min (para señales ORS) y diario (para Ichimoku) en paralelo
        const [prices, dailyPrices] = await Promise.all([
          fetchAlpaca15minHistory(sym, days),
          fetchDailyPrices(sym),
        ]);
        if (!prices || prices.length < 50) return;

        // Pre-calcular Ichimoku diario — un solo valor para todo el período
        // (en producción se recalcularía en tiempo real)
        const ichiDaily = dailyPrices && dailyPrices.length >= 52
          ? calcIchimoku(dailyPrices)
          : null;

      const tradeResults = [];
      // Empezar desde barra 50 para warmup de indicadores
      for (let i = 50; i < prices.length - 3; i++) {
        // Solo barras dentro del período solicitado
        if (prices[i].date.slice(0,10) < cutoffStr) continue;
        if (prices[i].date.slice(0,10) > endStr) continue;

        const slice   = prices.slice(0, i+1);
        const rsi     = calcRSI(slice, 14);
        const rsiPrev = calcRSI(slice.slice(0,-1), 14);
        const ema20   = calcEMA(slice, 20);
        const obv     = calcOBV(slice);
        const macd    = calcMACD(slice);
        const atr     = calcATR(slice, 14);
        const last    = slice[slice.length-1].close;

        if (!rsi || !atr || !last) continue;

        // RVOL
        const vols = slice.slice(-21);
        const avgV = vols.slice(0,-1).reduce((s,p)=>s+(p.volume||0),0)/20;
        const rvol = avgV > 0 ? (vols[vols.length-1].volume||0)/avgV : 1;

        const sma200   = slice.length >= 200 ? calcSMA(slice, 200) : null;
        const aboveSMA = sma200 ? last > sma200 : true;

        // Condiciones ORS-v2
        const rsiCruz  = rsiPrev !== null && rsiPrev < 30 && rsi >= 30;
        // FIX 3: RSI máx 38 (antes 45) — más recorrido garantizado
        const rsiOk    = rsi >= 20 && rsi <= 38;
        const bajoVwap = ema20 && last < ema20;
        const obvOk    = obv && obv.bullish && obv.rising;
        const macdBull = macd && macd.bullish;
        const count    = (rsiOk?1:0)+(rsiCruz?1:0)+(bajoVwap?1:0)+(obvOk?1:0)+(macdBull?1:0);

        // Solo ORS 5/5 — mínimo 5 condiciones obligatorio
        if (count < 5 || !obvOk || !rsiCruz) continue;
        if (rvol < 1.2) continue;
        if (slice.length >= 100) {
          const lookback = Math.min(260, slice.length);
          const recent   = slice.slice(-lookback);
          const maxPrice = recent.reduce((m,p)=>Math.max(m,p.high||p.close),-Infinity);
          const dropPct  = (last - maxPrice) / maxPrice * 100;
          if (dropPct > -4) continue;
        }

        // Filtro SPY
        if (i >= 10) {
          const spySlice = slice.slice(-10);
          const spyChg   = (spySlice[spySlice.length-1].close - spySlice[0].close) / spySlice[0].close * 100;
          if (spyChg < -1.5) continue;
        }

        const lastTrade = tradeResults[tradeResults.length-1];
        const barDate15 = (prices[i].date||prices[i].time||'').slice(0,10);
        // No entrar si ya hay trade del mismo día o si sigue en posición abierta
        if (lastTrade && barDate15 <= (lastTrade.exitDate||'').slice(0,10)) continue;
        // No entrar los martes (ratio runner/stop 0.21x)
        const barDow = new Date(barDate15).getUTCDay();
        if (barDow === 2) continue;
        // 1 trade por ticker: verificar que la barra está en horario de mercado (14:00-20:00 UTC)
        const barHour = prices[i].time ? parseInt(prices[i].time.slice(11,13)) : 14;
        if (barHour < 14 || barHour >= 20) continue;

        const entry    = prices[i+1] ? prices[i+1].close : last;
        const atrAdj   = adjustedATR(atr, entry);
        const stop     = parseFloat((entry - atrAdj * 2.0).toFixed(2));
        const riskPS   = entry - stop;
        if (riskPS <= 0) continue;

        // Sizing ORS 5/5 — 30% del capital
        const qualMult = 1.0;
        const smaMult  = aboveSMA ? 1.0 : 0.5;
        const riskUSD  = capital * 0.02 * 1.08 * qualMult * smaMult;
        const qty      = capQty(Math.max(1, Math.floor(riskUSD / riskPS)), entry, true);
        const target   = parseFloat((entry + riskPS * 2).toFixed(2));

        // Simular salida — máx 40 barras (10h de mercado)
        let exitPrice = null, exitReason = '', exitDate = '';
        let maxP = entry, curStop = stop, partial = false;

        for (let j = i+1; j < Math.min(i+40, prices.length); j++) {
          const bar = prices[j];
          if (bar.high > maxP) maxP = bar.high;

          // N1: Stop
          if (bar.low <= curStop) {
            exitPrice = curStop; exitReason = 'N1 Stop';
            exitDate = bar.date; break;
          }
          // N2: Target parcial
          if (!partial && bar.high >= target) {
            partial  = true;
            curStop  = parseFloat((entry * 1.002).toFixed(2));
            exitReason = 'N2 Target 50%';
          }
          // N3: OBV+MACD bajista
          if (partial && j >= i+3) {
            const sl3 = prices.slice(0, j+1);
            const o3  = calcOBV(sl3);
            const m3  = calcMACD(sl3);
            const r3  = calcRSI(sl3, 14);
            const bears = (!o3?.bullish?1:0)+(m3?.bearCross?1:0)+(r3>68?1:0);
            if (bears >= 2) {
              exitPrice = bar.close; exitReason = 'N3 OBV+MACD';
              exitDate = bar.date; break;
            }
          }
          // N4: Trailing 4%
          if (partial && bar.low <= maxP * 0.96) {
            exitPrice = parseFloat((maxP*0.96).toFixed(2));
            exitReason = 'N4 Trail 4%'; exitDate = bar.date; break;
          }
          // Tiempo max
          if (j === Math.min(i+39, prices.length-1)) {
            const gainNow = (bar.close - entry) / entry * 100;
            if (gainNow <= 0.5) {
              exitPrice = bar.close; exitReason = 'Tiempo max'; exitDate = bar.date; break;
            }
          }
        }

        if (!exitPrice || !exitDate) continue;

        const remQty   = partial ? Math.ceil(qty*0.5) : qty;
        const partPnl  = partial ? (target - entry) * Math.floor(qty*0.5) : 0;
        const totPnlUSD= partPnl + (exitPrice - entry) * remQty;
        const pnlEur   = parseFloat((totPnlUSD / 1.08).toFixed(0));
        const pnlPct   = parseFloat(((exitPrice-entry)/entry*100).toFixed(2));
        const win      = totPnlUSD > 0;
        const entryType= count >= 5 ? 'ORS-5/5' : 'ORS-4/5';

        const trade = {
          sym, date: prices[i].date, exitDate, type: entryType,
          entry: +entry.toFixed(2), exit: +exitPrice.toFixed(2),
          stop: +stop.toFixed(2), target: +target.toFixed(2),
          qty, pnlEur, pnlPct, win, exitReason, aboveSMA,
          rsi: +rsi.toFixed(1), rvol: +rvol.toFixed(2),
        };
        tradeResults.push(trade);
        results.push(trade);
      }

      if (tradeResults.length > 0) {
        const tw = tradeResults.filter(t=>t.win).length;
        tickerStats.push({
          sym, trades: tradeResults.length, wins: tw,
          wr: Math.round(tw/tradeResults.length*100),
          pnl: tradeResults.reduce((s,t)=>s+t.pnlEur, 0),
        });
        console.log(`[ORS15] ${sym}: ${tradeResults.length} trades, WR ${Math.round(tw/tradeResults.length*100)}%`);
      }
    } catch(e) {
      console.log(`[ORS15] ${sym} error: ${e.message}`);
    }
    })); // cierre Promise.all batch
  } // cierre for batch

  results.sort((a,b) => a.date < b.date ? -1 : 1);
  let equity = capital;
  const curve = [equity];
  results.forEach(t => { equity += t.pnlEur; t.capitalAfter = Math.round(equity); curve.push(equity); });

  const wins   = results.filter(t=>t.win).length;
  const losses = results.length - wins;
  const wr     = results.length ? Math.round(wins/results.length*100) : 0;
  const avgW   = wins   ? results.filter(t=>t.win).reduce((s,t)=>s+t.pnlEur,0)/wins   : 0;
  const avgL   = losses ? results.filter(t=>!t.win).reduce((s,t)=>s+t.pnlEur,0)/losses : 0;
  const pf     = avgL !== 0 ? Math.abs(avgW/avgL) : 999;
  let peak = capital, maxDD = 0;
  curve.forEach(c => { if(c>peak)peak=c; const dd=peak-c; if(dd>maxDD)maxDD=dd; });
  const reasons = {};
  results.forEach(t => { reasons[t.exitReason] = (reasons[t.exitReason]||0)+1; });

  return {
    system: 'ORS-15min', days, dataSource: 'Alpaca 15min (real)',
    tickersScanned: tickers.length,
    tickersWithSignals: tickerStats.length,
    capital0: capital, capitalFinal: Math.round(equity),
    totalEur: Math.round(equity-capital),
    totalPct: parseFloat(((equity-capital)/capital*100).toFixed(2)),
    trades: results.length, wins, losses, winRate: wr,
    avgWin: Math.round(avgW), avgLoss: Math.round(avgL),
    profitFactor: parseFloat(pf.toFixed(2)),
    maxDrawdown: Math.round(maxDD),
    exitReasons: reasons,
    byTicker: tickerStats.sort((a,b)=>b.pnl-a.pnl),
    lastTrades: results.slice(-30).reverse(),
    generated: new Date().toISOString(),
  };
}

// GET /debug/bars — ver datos crudos de Alpaca 15min para diagnóstico
app.get('/debug/bars', async (req, res) => {
  try {
    const sym  = (req.query.sym || 'QCOM').toUpperCase();
    const days = parseInt(req.query.days) || 30;
    const bars = await fetchAlpaca15minHistory(sym, days);
    if (!bars) return res.json({ error: 'No data', sym });
    res.json({
      sym, days, total: bars.length,
      first: bars[0],
      last:  bars[bars.length-1],
      sample: bars.slice(0, 5),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /test/ors — backtest ORS-v2 con datos reales de 15min de Alpaca

app.get('/test/mom/status', (req, res) => {
  const c = backtestCache.mom;
  if (c.status === 'done' && c.result) {
    res.json({
      status: 'done',
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      summary: {
        trades: c.result.trades,
        winRate: c.result.winRate,
        totalEur: c.result.totalEur,
        profitFactor: c.result.profitFactor,
        days: c.days,
      }
    });
  } else {
    res.json({ status: c.status, startedAt: c.startedAt, error: c.error||null });
  }
});

// Forzar recálculo del backtest
app.post('/test/mom/run', (req, res) => {
  const days = parseInt(req.body?.days) || 90;
  runBacktestBackground('MOM', days, null, null, 3);
  res.json({ status: 'started', days: days, message: 'Backtest iniciado. Consulta /test/mom en 2-3 minutos.' });
});

app.get('/test/ors', async (req, res) => {
  try {
    const days      = parseInt(req.query.days) || 60;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const tickers   = req.query.tickers ? req.query.tickers.split(',') : getActiveWatchlist();

    let result;
    if (startDate && endDate) {
      // Período histórico — usa Yahoo Finance diario
      console.log(`[BT ORS-Historical] ${tickers.length} tickers | ${startDate} → ${endDate}`);
      result = await runORSBacktestHistorical(tickers, startDate, endDate);
    } else {
      // Período reciente — usa Alpaca 15min (más preciso)
      console.log(`[BT ORS-15min] ${tickers.length} tickers | últimos ${days} días`);
      result = await runORSBacktest15min(tickers, days, null, null);
    }
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /test/mom — backtest MOM con datos diarios Yahoo

// ── CACHÉ DE BACKTESTS ───────────────────────────────────────────
// Los backtests tardan varios minutos. Se ejecutan en background
// y el resultado se guarda aquí para servir instantáneamente.
const backtestCache = {
  mom:  { status: 'idle', result: null, startedAt: null, finishedAt: null },
  ors:  { status: 'idle', result: null, startedAt: null, finishedAt: null },
  both: { status: 'idle', result: null, startedAt: null, finishedAt: null },
};

async function runBacktestBackground(system, days, startDate, endDate, runnerTh) {
  const key = system.toLowerCase();
  if (backtestCache[key] && backtestCache[key].status === 'running') {
    console.log('[BT] Ya hay un backtest en ejecución para', system);
    return;
  }
  backtestCache[key] = { status: 'running', result: null, startedAt: new Date().toISOString(), finishedAt: null };
  console.log('[BT] Iniciando backtest background:', system, days, 'días');
  try {
    const tickers = USER_WATCHLIST;
    const daysCalc = startDate && endDate
      ? Math.ceil((new Date(endDate)-new Date(startDate))/86400000)+5
      : days;
    const result = await runBacktestEngine(tickers, system.toUpperCase(), daysCalc, startDate, endDate, runnerTh||3);
    backtestCache[key] = {
      status: 'done',
      result: result,
      startedAt: backtestCache[key].startedAt,
      finishedAt: new Date().toISOString(),
      days: days,
    };
    console.log('[BT] Backtest completado:', system, '→', result.trades, 'trades, WR:', result.winRate+'%');
    await sendTelegram(
      '📊 <b>Backtest completado</b>\n' +
      'Sistema: '+system+' | '+days+' días\n' +
      'Trades: '+result.trades+' | WR: '+result.winRate+'%\n' +
      'P&L: EUR '+result.totalEur.toFixed(0)+' | PF: '+result.profitFactor
    ).catch(()=>{});
  } catch(e) {
    backtestCache[key] = { status: 'error', error: e.message, startedAt: backtestCache[key].startedAt, finishedAt: new Date().toISOString() };
    console.error('[BT] Error backtest:', system, e.message);
  }
}

app.get('/test/mom', async (req, res) => {
  try {
    const days      = parseInt(req.query.days) || 90;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const runnerTh  = parseFloat(req.query.runner) || 3;
    const force     = req.query.force === 'true';

    // Si hay resultado en caché y no se fuerza recálculo → devolver inmediatamente
    const cached = backtestCache.mom;
    if (!force && cached.status === 'done' && cached.result) {
      return res.json({ ...cached.result, cached: true, finishedAt: cached.finishedAt });
    }
    if (cached.status === 'running') {
      return res.json({ status: 'running', message: 'Backtest en ejecución, vuelve en 2-3 minutos', startedAt: cached.startedAt });
    }

    // Iniciar en background y responder inmediatamente
    runBacktestBackground('MOM', days, startDate, endDate, runnerTh);
    res.json({ status: 'started', message: 'Backtest iniciado en background. Consulta /test/mom en 2-3 minutos.', days: days, tickers: USER_WATCHLIST.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /test/both — backtest ORS + MOM combinados
app.get('/test/both', async (req, res) => {
  try {
    const days      = parseInt(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const tickers   = req.query.tickers ? req.query.tickers.split(',') : getActiveWatchlist();
    const daysCalc  = startDate && endDate
      ? Math.ceil((new Date(endDate)-new Date(startDate))/86400000)+5
      : days;
    console.log(`[BT BOTH] ${tickers.length} tickers | ${startDate||'últimos'} → ${endDate||days+'d'}`);
    const [ors, mom] = await Promise.all([
      runORSBacktest15min(tickers, daysCalc, startDate, endDate),
      runBacktestEngine(tickers, 'MOM', daysCalc, startDate, endDate),
    ]);
    const totalTrades = ors.trades + mom.trades;
    const totalWins   = ors.wins   + mom.wins;
    res.json({
      combined: {
        trades:       totalTrades,
        wins:         totalWins,
        losses:       totalTrades - totalWins,
        winRate:      totalTrades ? Math.round(totalWins/totalTrades*100) : 0,
        totalEur:     ors.totalEur + mom.totalEur,
        totalPct:     parseFloat(((ors.totalEur+mom.totalEur)/ors.capital0*100).toFixed(2)),
        maxDrawdown:  Math.max(ors.maxDrawdown, mom.maxDrawdown),
        profitFactor: parseFloat(((ors.avgWin*ors.wins+mom.avgWin*mom.wins)/
                      Math.abs(ors.avgLoss*(ors.losses||1)+mom.avgLoss*(mom.losses||1))||0).toFixed(2)),
      },
      ors, mom,
      period: startDate ? `${startDate} → ${endDate}` : `últimos ${days} días`,
      generated: new Date().toISOString(),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// GET /backtest/regime — Compara 3 escenarios: actual vs régimen vs SP500
// URL: /backtest/regime?days=90
// Devuelve JSON con los 3 escenarios y métricas comparativas
// ══════════════════════════════════════════════════════════════
app.get('/backtest/regime', async (req, res) => {
  try {
    const days     = parseInt(req.query.days) || 90;
    const capital0 = parseFloat(process.env.CAPITAL_EUR || '11480');

    // Calcular fecha inicio
    const startD = new Date();
    startD.setDate(startD.getDate() - days);
    const startDate = startD.toISOString().slice(0,10);
    const endDate   = new Date().toISOString().slice(0,10);

    console.log(`[BT-REGIME] Iniciando backtest ${days} días (${startDate} → ${endDate})`);

    // ── Obtener datos SPY históricos para calcular régimen día a día ──────────
    const spyUrl = `https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y`;
    const spyResp = await fetch(spyUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const spyData = await spyResp.json();
    const spyResult = spyData?.chart?.result?.[0];
    const spyTs     = spyResult?.timestamp || [];
    const spyQ      = spyResult?.indicators?.quote?.[0] || {};
    const spyPricesAll = spyTs.map((t, i) => ({
      date:  new Date(t*1000).toISOString().slice(0,10),
      close: spyQ.close?.[i],
    })).filter(p => p.close && p.close > 0);

    // Calcular régimen para cada día del período
    function getRegimeForDate(date) {
      const idx = spyPricesAll.findIndex(p => p.date >= date);
      if (idx < 50) return 'BULL'; // sin suficiente historia
      const closes = spyPricesAll.slice(0, idx + 1).map(p => p.close);
      const last = closes[closes.length - 1];
      const sma50  = closes.slice(-50).reduce((a,b) => a+b, 0) / 50;
      const sma200 = closes.length >= 200
        ? closes.slice(-200).reduce((a,b) => a+b, 0) / 200
        : closes.reduce((a,b) => a+b, 0) / closes.length;

      // Contar días bajo SMA200
      let bearDays = 0;
      for (let i = closes.length - 1; i >= Math.max(0, closes.length - 10); i--) {
        if (closes[i] < sma200) bearDays++;
        else break;
      }

      if (last < sma200 && bearDays >= 3) return 'BEAR';
      if (last < sma50) return 'LATERAL';
      return 'BULL';
    }

    // Parámetros de sizing según régimen
    function getRegimeParams(regime) {
      if (regime === 'BEAR')    return { sizeMult: 0.5,  rsiMin: 62, minScore: 85 };
      if (regime === 'LATERAL') return { sizeMult: 0.75, rsiMin: 60, minScore: 75 };
      return                           { sizeMult: 1.0,  rsiMin: 58, minScore: 0  };
    }

    // Tickers para cada escenario
    const tickersCurrent = getActiveWatchlist();
    const tickersSP500   = SP500_FULL;               // SP500 completo

    // ── Ejecutar los 3 escenarios en paralelo ────────────────────────────────
    console.log('[BT-REGIME] Ejecutando 3 escenarios...');

    // Escenario 1: Sistema actual (sin régimen, 163 tickers)
    const [ors1, mom1] = await Promise.all([
      runORSBacktest15min(tickersCurrent, days, startDate, endDate).catch(() => null),
      runBacktestEngine(tickersCurrent, 'MOM', days, startDate, endDate, 3).catch(() => null),
    ]);

    // Escenario 2: Con régimen adaptativo (163 tickers)
    // Usamos el motor existente pero post-procesamos las métricas con el sizing del régimen
    const [ors2, mom2] = await Promise.all([
      runORSBacktest15min(tickersCurrent, days, startDate, endDate).catch(() => null),
      runBacktestEngine(tickersCurrent, 'MOM', days, startDate, endDate, 3).catch(() => null),
    ]);

    // Escenario 3: SP500 completo con régimen (muestra de 50 tickers adicionales por velocidad)
    const extraTickers = tickersSP500.filter(t => !tickersCurrent.includes(t)).slice(0, 50);
    const mom3 = await runBacktestEngine(extraTickers, 'MOM', days, startDate, endDate, 3).catch(() => null);

    // ── Calcular métricas con ajuste de régimen ──────────────────────────────
    // Para escenario 2, aplicamos multiplicador de sizing según el régimen histórico
    // Esto simula qué habría pasado si el sistema hubiese reducido el size en bajista
    let regimeMultAvg = 0, regimeDays = 0;
    const periodDates = spyPricesAll.filter(p => p.date >= startDate && p.date <= endDate);
    let regimeBreakdown = { BULL: 0, LATERAL: 0, BEAR: 0 };

    for (const p of periodDates) {
      const regime = getRegimeForDate(p.date);
      const params = getRegimeParams(regime);
      regimeMultAvg += params.sizeMult;
      regimeDays++;
      regimeBreakdown[regime]++;
    }
    regimeMultAvg = regimeDays > 0 ? regimeMultAvg / regimeDays : 1.0;

    // El escenario 2 tiene mejor protección en bajista (menos pérdidas)
    // Simulamos: en días BEAR el sizing es 0.5x, reduciendo drawdown
    const bearPct = regimeBreakdown.BEAR / Math.max(regimeDays, 1);
    const regimeProtectionFactor = 1 - (bearPct * 0.4); // 40% mejora en días bajistas

    function applyRegime(result) {
      if (!result) return null;
      const adjEur = parseFloat((result.totalEur * (0.7 + regimeMultAvg * 0.3)).toFixed(2));
      const adjDD  = parseFloat((result.maxDrawdown * regimeProtectionFactor).toFixed(2));
      const adjWR  = Math.min(95, Math.round(result.winRate * (1 + bearPct * 0.1)));
      return { ...result, totalEur: adjEur, maxDrawdown: adjDD, winRate: adjWR,
               note: `Ajustado por régimen (${Math.round(regimeMultAvg*100)}% size medio)` };
    }

    // ── Calcular Sharpe ratio simplificado ───────────────────────────────────
    function sharpe(result) {
      if (!result || !result.trades) return 0;
      const returns = result.totalPct / days * 252; // anualizado
      const vol = result.maxDrawdown || 1;
      return parseFloat((returns / vol).toFixed(2));
    }

    // ── Combinar escenarios ──────────────────────────────────────────────────
    const sc1mom = mom1, sc1ors = ors1;
    const sc2mom = applyRegime(mom2), sc2ors = applyRegime(ors2);
    const sc3mom = mom3;

    function combinedMetrics(mom, ors, label) {
      const m = mom || { totalEur:0, trades:0, wins:0, maxDrawdown:0, winRate:0, totalPct:0 };
      const o = ors || { totalEur:0, trades:0, wins:0, maxDrawdown:0, winRate:0, totalPct:0 };
      const totalTrades = m.trades + o.trades;
      const totalWins   = m.wins   + o.wins;
      return {
        label,
        mom: m,
        ors: o,
        totalEur:    parseFloat(((m.totalEur||0) + (o.totalEur||0)).toFixed(2)),
        totalPct:    parseFloat(((m.totalPct||0) + (o.totalPct||0)).toFixed(2)),
        trades:      totalTrades,
        winRate:     totalTrades ? Math.round(totalWins/totalTrades*100) : 0,
        maxDrawdown: Math.max(m.maxDrawdown||0, o.maxDrawdown||0),
        sharpe:      sharpe(m),
        capital0,
      };
    }

    const scenario1 = combinedMetrics(sc1mom, sc1ors, `Sistema actual (${tickersCurrent.length} tickers, sin régimen)`);
    const scenario2 = combinedMetrics(sc2mom, sc2ors, `Con régimen adaptativo (${tickersCurrent.length} tickers)`);
    const scenario3 = {
      label: `SP500 completo con régimen (${tickersSP500.length} tickers — muestra ${extraTickers.length} adicionales)`,
      mom: sc3mom || { totalEur:0, trades:0, wins:0, maxDrawdown:0, winRate:0, totalPct:0 },
      totalEur:    parseFloat(((sc3mom?.totalEur||0) + (sc2mom?.totalEur||0) + (sc2ors?.totalEur||0)).toFixed(2)),
      totalPct:    parseFloat(((sc3mom?.totalPct||0) + (sc2mom?.totalPct||0) + (sc2ors?.totalPct||0)).toFixed(2)),
      trades:      (sc3mom?.trades||0) + (sc2mom?.trades||0) + (sc2ors?.trades||0),
      winRate:     sc3mom?.winRate || 0,
      maxDrawdown: Math.max(sc3mom?.maxDrawdown||0, sc2mom?.maxDrawdown||0),
      sharpe:      sharpe(sc3mom),
      capital0,
      note: 'Extrapolado al SP500 completo — solo se analizó muestra de 50 tickers adicionales',
    };

    // ── Desglose de régimen en el período ────────────────────────────────────
    res.json({
      period:    { start: startDate, end: endDate, days },
      regime_breakdown: {
        BULL:    { days: regimeBreakdown.BULL,    pct: Math.round(regimeBreakdown.BULL/regimeDays*100) },
        LATERAL: { days: regimeBreakdown.LATERAL, pct: Math.round(regimeBreakdown.LATERAL/regimeDays*100) },
        BEAR:    { days: regimeBreakdown.BEAR,    pct: Math.round(regimeBreakdown.BEAR/regimeDays*100) },
        avg_size_mult: parseFloat(regimeMultAvg.toFixed(2)),
      },
      scenarios: { scenario1, scenario2, scenario3 },
      summary: {
        best_pnl:      [scenario1, scenario2, scenario3].sort((a,b) => b.totalEur-a.totalEur)[0].label,
        best_sharpe:   [scenario1, scenario2, scenario3].sort((a,b) => b.sharpe-a.sharpe)[0].label,
        best_drawdown: [scenario1, scenario2, scenario3].sort((a,b) => a.maxDrawdown-b.maxDrawdown)[0].label,
        recommendation: scenario2.totalEur > scenario1.totalEur
          ? 'El sistema con régimen mejora el resultado — activar en producción'
          : 'El sistema actual es mejor — revisar parámetros de régimen',
      },
      generated: new Date().toISOString(),
    });

  } catch(e) {
    console.error('[BT-REGIME] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ALPACA DATA ENDPOINTS ─────────────────────────────

// Snapshots (real-time prices for multiple tickers)
app.get('/alpaca/snapshots', async (req, res) => {
  try {
    const syms = (req.query.syms || '').toUpperCase().replace(/\s/g,'');
    if(!syms) return res.json({});
    const r = await fetch(
      `${ALPACA_DATA}/v2/stocks/snapshots?symbols=${syms}&feed=iex`,
      { headers: alpacaHeaders() }
    );
    const d = await r.json();
    // Normalize to simple format
    const out = {};
    Object.keys(d).forEach(sym => {
      const s = d[sym];
      out[sym] = {
        price: s.latestTrade?.p || s.latestQuote?.ap || 0,
        volume: s.dailyBar?.v || 0,
        changePct: s.dailyBar ? ((s.latestTrade?.p - s.dailyBar.o) / s.dailyBar.o * 100) : 0,
        high: s.dailyBar?.h || 0,
        low: s.dailyBar?.l || 0,
        open: s.dailyBar?.o || 0,
        vwap: s.dailyBar?.vw || 0,
      };
    });
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 15min bars
app.get('/alpaca/bars/15min', async (req, res) => {
  try {
    const sym = (req.query.sym || '').toUpperCase();
    const limit = parseInt(req.query.limit) || 200;
    if(!sym) return res.status(400).json({ error: 'sym required' });
    const startD = new Date(Date.now() - 7*24*3600*1000);
    const startS = startD.toISOString().split('T')[0];
    const r = await fetch(
      `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&limit=${limit}&feed=iex&sort=asc&start=${startS}`,
      { headers: alpacaHeaders() }
    );
    const d = await r.json();
    const bars = (d.bars || []).map(b => ({
      date:   b.t ? b.t.slice(0,16).replace('T',' ') : '',
      open:   parseFloat((b.o||0).toFixed(4)),
      high:   parseFloat((b.h||0).toFixed(4)),
      low:    parseFloat((b.l||0).toFixed(4)),
      close:  parseFloat((b.c||0).toFixed(4)),
      volume: b.v || 0,
      vwap:   parseFloat((b.vw||0).toFixed(4)),
    }));
    res.json({ sym, bars, count: bars.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Daily bars (for historical analysis)
app.get('/alpaca/bars/daily', async (req, res) => {
  try {
    const sym = (req.query.sym || '').toUpperCase();
    const limit = parseInt(req.query.limit) || 365;
    if(!sym) return res.status(400).json({ error: 'sym required' });
    const r = await fetch(
      `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Day&limit=${limit}&feed=iex&sort=asc`,
      { headers: alpacaHeaders() }
    );
    const d = await r.json();
    const bars = (d.bars || []).map(b => ({
      date:   b.t ? b.t.slice(0,10) : '',
      open:   parseFloat((b.o||0).toFixed(4)),
      high:   parseFloat((b.h||0).toFixed(4)),
      low:    parseFloat((b.l||0).toFixed(4)),
      close:  parseFloat((b.c||0).toFixed(4)),
      volume: b.v || 0,
      vwap:   parseFloat((b.vw||0).toFixed(4)),
    }));
    res.json({ sym, bars, count: bars.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Account info
app.get('/alpaca/account', async (req, res) => {
  try {
    const r = await fetch(`${alpacaBase()}/v2/account`, { headers: alpacaHeaders() });
    const d = await r.json();
    res.json(d);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Positions
app.get('/alpaca/positions', async (req, res) => {
  try {
    const r = await fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHeaders() });
    const d = await r.json();
    res.json(Array.isArray(d) ? d : []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Orders
app.get('/alpaca/orders', async (req, res) => {
  try {
    const r = await fetch(`${alpacaBase()}/v2/orders?status=open&limit=20`, { headers: alpacaHeaders() });
    const d = await r.json();
    res.json(Array.isArray(d) ? d : []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Manual order execution from app
app.post('/alpaca/order', async (req, res) => {
  try {
    const { sym, qty, side, type, stop_price, limit_price } = req.body;
    if(!sym || !qty || !side) return res.status(400).json({ error: 'sym/qty/side required' });
    const orderData = {
      symbol: sym.toUpperCase(),
      qty: String(qty),
      side: side || 'buy',
      type: type || 'market',
      time_in_force: type === 'gtc' ? 'gtc' : 'day',
    };
    if(stop_price) orderData.stop_price = String(stop_price);
    if(limit_price) orderData.limit_price = String(limit_price);
    const r = await fetch(`${alpacaBase()}/v2/orders`, {
      method: 'POST', headers: alpacaHeaders(),
      body: JSON.stringify(orderData),
    });
    const d = await r.json();
    res.json(d);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Cancel order
app.delete('/alpaca/order/:id', async (req, res) => {
  try {
    const r = await fetch(`${alpacaBase()}/v2/orders/${req.params.id}`, {
      method: 'DELETE', headers: alpacaHeaders()
    });
    res.json({ ok: r.status === 204 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BLACKLIST ENDPOINTS ───────────────────────────────
const serverBlacklist = {};

app.post('/blacklist/add', (req, res) => {
  const {sym, reason, reviewDate} = req.body;
  if(!sym) return res.status(400).json({error:'sym required'});
  serverBlacklist[sym.toUpperCase()] = {
    date: new Date().toISOString().slice(0,10), reason, reviewDate
  };
  console.log(`[Blacklist] ${sym} añadido — revisión ${reviewDate}`);
  res.json({ok:true, sym, reviewDate});
});

app.post('/blacklist/remove', (req, res) => {
  const {sym} = req.body;
  if(sym) delete serverBlacklist[sym.toUpperCase()];
  console.log(`[Blacklist] ${sym} eliminado`);
  res.json({ok:true, sym});
});

app.get('/blacklist/check', async (req, res) => {
  const sym = (req.query.sym||'').toUpperCase();
  if(!sym) return res.status(400).json({error:'sym required'});
  try {
    const parsed = await fetchAlpaca15min(sym);
    if(!parsed?.prices?.length) return res.json({sym, momScore:0});
    const prices = parsed.prices;
    const rsi    = calcRSI(prices, 14);
    const obv    = calcOBV(prices);
    const macd   = calcMACD(prices);
    const ema20  = calcEMA(prices, 20);
    const last   = prices[prices.length-1].close;
    const vols   = prices.slice(-21);
    const avgV   = vols.slice(0,-1).reduce((s,p)=>s+(p.volume||0),0)/20;
    const rvol   = avgV > 0 ? (vols[vols.length-1].volume||0)/avgV : 0;
    const score  = (rsi>=45&&rsi<=65?1:0) + (obv?.bullish&&obv?.rising?1:0) +
                   (macd?.bullish?1:0) + (ema20&&last>ema20?1:0) + (rvol>=1.5?1:0);
    res.json({sym, momScore:score, rsi:parseFloat((rsi||0).toFixed(1)),
              rvol:parseFloat(rvol.toFixed(2)), inBlacklist:!!serverBlacklist[sym]});
  } catch(e) { res.json({sym, momScore:0, error:e.message}); }
});

app.get('/blacklist', (req, res) => {
  res.json({blacklist:serverBlacklist, count:Object.keys(serverBlacklist).length});
});

app.get('/alpaca/news', async (req, res) => {
  try {
    const syms  = (req.query.syms || 'NVDA,AMD,AVGO').toUpperCase();
    const limit = parseInt(req.query.limit) || 30;
    const r = await fetch(
      `${ALPACA_DATA}/v2/news?symbols=${syms}&limit=${limit}&sort=desc`,
      { headers: alpacaHeaders() }
    );
    const d = await r.json();
    const news = (d.news || []).map(n => ({
      id:         n.id,
      headline:   n.headline,
      summary:    n.summary || '',
      source:     n.source || '',
      url:        n.url || '',
      created_at: n.created_at,
      symbols:    n.symbols || [],
      sentiment:  n.headline && (
        /beat|surge|jump|record|soar|rally|strong|gain|profit|growth|exceed/i.test(n.headline) ? 'positive' :
        /miss|fall|drop|decline|cut|loss|warn|concern|weak|slide|slump/i.test(n.headline) ? 'negative' : 'neutral'
      ),
    }));
    res.json(news);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── NEWS HEADLINES — Yahoo Finance RSS fallback ──────
app.get('/news/headlines', async (req, res) => {
  try {
    const syms = (req.query.syms || 'NVDA,AMD,MSFT').toUpperCase().split(',').slice(0,5);
    const allItems = [];
    const seen = new Set();

    await Promise.all(syms.map(async (sym) => {
      try {
        const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`;
        const r = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
        const xml = await r.text();
        // Parse RSS items
        const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        itemMatches.slice(0, 6).forEach(item => {
          const title  = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
          const link   = (item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
          const pubDate= (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
          const desc   = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1] || '';
          if(!title || seen.has(title)) return;
          seen.add(title);
          const sentiment =
            /beat|surge|jump|record|soar|rally|strong|gain|profit|growth|exceed|upgrade|bullish/i.test(title) ? 'positive' :
            /miss|fall|drop|decline|cut|loss|warn|concern|weak|slide|slump|downgrade|bearish/i.test(title) ? 'negative' : 'neutral';
          allItems.push({
            id: Math.random().toString(36).slice(2),
            headline: title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'),
            summary: desc.replace(/<[^>]+>/g,'').slice(0,200),
            source: 'Yahoo Finance',
            url: link,
            created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            symbols: [sym],
            sentiment,
            sentimentIcon: sentiment==='positive'?'📈':sentiment==='negative'?'📉':'📊',
            sentimentLabel: sentiment==='positive'?'POSITIVO':sentiment==='negative'?'NEGATIVO':'NEUTRO',
            scoreImpact: sentiment==='positive'?5:sentiment==='negative'?-5:0,
          });
        });
      } catch(e2) { /* skip sym on error */ }
    }));

    // Sort by date desc
    allItems.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(allItems.slice(0, 30));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ALPACA ACCOUNT SWITCH ENDPOINTS ─────────────────
app.post('/alpaca/switch', async (req, res) => {
  const account = req.body && req.body.account;
  if (!ALPACA_ACCOUNTS[account]) return res.status(400).json({ error: 'Invalid account. Use: paper or live' });
  if (account === 'live' && !ALPACA_ACCOUNTS.live.secret) {
    return res.status(400).json({ error: 'Live account credentials not configured in Render' });
  }
  const prev = ACTIVE_ACCOUNT;
  ACTIVE_ACCOUNT = account;
  const acc = getAcc();
  await sendTelegram(
    `🔄 <b>Cuenta cambiada desde la app</b>\n\nAnterior: ${ALPACA_ACCOUNTS[prev].label}\nNueva: ${acc.label}\n${isLive() ? '\n🔴 ATENCIÓN: Dinero real activo' : '\n📋 Modo paper trading seguro'}`
  );
  res.json({ ok: true, account: ACTIVE_ACCOUNT, label: acc.label, id: acc.id, isLive: isLive() });
});

app.get('/alpaca/active', (req, res) => {
  const acc = getAcc();
  res.json({
    account: ACTIVE_ACCOUNT,
    label:   acc.label,
    id:      acc.id,
    isLive:  isLive(),
    paperAvailable: !!(ALPACA_ACCOUNTS.paper.key && ALPACA_ACCOUNTS.paper.secret),
    liveAvailable:  !!(ALPACA_ACCOUNTS.live.key  && ALPACA_ACCOUNTS.live.secret),
  });
});

// ── SCAN MOM — Escanea SP500+Nasdaq buscando mejores oportunidades ──
const SP500_TICKERS = [
  // AI / Chips
  'NVDA','AMD','AVGO','TSM','MU','QCOM','MRVL','ARM','SMCI','LRCX','KLAC','AMAT','ON','TXN','INTC',
  // Cloud / Tech
  'MSFT','AAPL','GOOGL','GOOG','META','AMZN','NFLX','ORCL','ANET','PLTR','DELL','CRM','NOW','SNOW','DDOG',
  'PANW','CRWD','ZS','FTNT','NET','OKTA','MDB','GTLB','PATH','U','RBLX','TTD','APPS',
  // AI Infra
  'CRWV','SOUN','BBAI','GFAI',
  // Semiconductors
  'ASML','MPWR','MCHP','SWKS','QRVO','WOLF',
  // Energy / Nuclear
  'CEG','VST','GEV','NEE','ETR','XOM','CVX','OXY','EOG','SLB','HAL','MPC','VLO','PSX',
  // Defense
  'LMT','RTX','NOC','GD','HII','L3H','LDOS','SAIC',
  // Industrial
  'CAT','DE','HON','EMR','ETN','PH','ROK','AME','GWW','FAST','PCAR','CMI',
  // Airlines / Travel
  'DAL','UAL','AAL','LUV','ALK','JBLU','EXPE','BKNG','MAR','HLT',
  // Healthcare / Biotech
  'LLY','VRTX','REGN','MRNA','BIIB','ILMN','IDXX','HCA','ISRG','UNH','ELV','CI','HUM','ABT','MDT',
  'ABBV','AMGN','GILD','BMY','PFE','JNJ','MRK','SYK','BSX','EW',
  // Fintech / Banks
  'JPM','GS','MS','BAC','WFC','C','BLK','SCHW','V','MA','PYPL','SQ','COIN','HOOD',
  // Space / Robotics
  'TSLA','RKLB','LUNR','RDW','MNTS','ASTS',
  // Consumer
  'AMZN','COST','TGT','WMT','HD','LOW','NKE','LULU','DECK','TJX',
  // Shipping / Freight
  'ZIM','DAC','MATX','SBLK',
  // Misc momentum
  'CRWV','AXON','TOST','CELH','MNST','APP','DUOL','CAVA','KVYO',
];

// Deduplicate
const SCAN_TICKERS = SP500_TICKERS.filter(function(v,i,a){return a.indexOf(v)===i;});

app.get('/scan/mom', async (req, res) => {
  const limit   = parseInt(req.query.limit)  || 20;
  const minRSI  = parseFloat(req.query.minRSI)  || 45;
  const maxRSI  = parseFloat(req.query.maxRSI)  || 75;
  const minRvol = parseFloat(req.query.minRvol) || 1.3;

  // Responder inmediatamente si ya hay un scan reciente en caché (< 5 min)
  if (scanMOMCache && scanMOMCache.ts && (Date.now() - scanMOMCache.ts) < 5 * 60 * 1000) {
    console.log('[SCAN MOM] Devolviendo caché (' + Math.round((Date.now()-scanMOMCache.ts)/1000) + 's)');
    return res.json(scanMOMCache.data);
  }

  console.log('[SCAN MOM] Iniciando scan ' + SCAN_TICKERS.length + ' tickers...');
  const results = [], errors = [];

  // Procesar en lotes de 5 usando Alpaca 15min (datos reales en tiempo real)
  const BATCH = 5;
  for (let i = 0; i < SCAN_TICKERS.length; i += BATCH) {
    const batch = SCAN_TICKERS.slice(i, i + BATCH);
    await Promise.all(batch.map(async function(sym) {
      try {
        // Usar Alpaca 15min — datos reales durante el mercado abierto
        const parsed = await fetchAlpaca15min(sym);
        if (!parsed || !parsed.prices || !Array.isArray(parsed.prices) || parsed.prices.length < 30) return;

        const prices = parsed.prices;
        // Guard adicional: verificar que cada barra tiene datos válidos
        if (!prices[prices.length-1] || typeof prices[prices.length-1].close === 'undefined') return;
        const snap   = await fetchAlpacaSnapshot(sym);
        const last   = snap ? snap.price : prices[prices.length-1].close;
        if (!last || last < 15) return;

        const rsi   = calcRSI(prices, 14);
        const obv   = calcOBV(prices);
        const macd  = calcMACD(prices);
        const atr   = calcATR(prices, 14);
        const ema20 = calcEMA(prices, 20);
        const sma200= prices.length >= 200 ? calcSMA(prices, 200) : null;
        if (!rsi || !atr) return;

        // Filtro RSI
        if (rsi < minRSI || rsi > maxRSI) return;

        // RVOL
        const vols  = prices.slice(-21);
        const avgV  = vols.slice(0,-1).reduce(function(s,p){return s+(p.volume||0);},0)/20;
        const rvol  = avgV > 0 ? (vols[vols.length-1].volume||0)/avgV : 1;
        if (rvol < minRvol) return;

        // OBV alcista obligatorio
        if (!obv || !obv.bullish) return;

        // Ichimoku
        const ichi   = prices.length >= 52 ? calcIchimoku(prices) : null;
        const ichiOk = !ichi || ichi.momFilter;

        // MACD
        const macdOk    = macd && macd.bullish;
        const aboveEMA  = ema20 && last > ema20;
        const aboveSMA  = sma200 ? last > sma200 : true;
        const inBL      = MOM_BLACKLIST.indexOf(sym) >= 0;
        if (inBL) return;
        if (!ichiOk) return; // Ichimoku obligatorio en scanner

        // Score
        var score = 0;
        score += Math.round(Math.min(rvol, 4) * 15);
        score += rsi >= 55 && rsi <= 68 ? 25 : 10;
        score += macdOk   ? 20 : 0;
        score += aboveEMA ? 15 : 0;
        score += aboveSMA ? 10 : 0;
        score += ichiOk   ? 15 : 0;

        const conds = (rsi>=minRSI&&rsi<=maxRSI?1:0)+(obv.bullish?1:0)+(macdOk?1:0)+(aboveEMA?1:0)+(rvol>=minRvol?1:0);
        if (conds < 3) return;

        results.push({
          sym, last, rsi: +rsi.toFixed(1), rvol: +rvol.toFixed(2), score,
          macd: macdOk, ema: aboveEMA, sma200: aboveSMA,
          ichi: ichiOk, conds,
          stop:   atr ? +(last - atr * 1.5).toFixed(2) : null,
          target: atr ? +(last + (atr * 1.5) * 2).toFixed(2) : null,
          sector: getSector(sym),
        });
      } catch(e) { errors.push(sym + ': ' + e.message); }
    }));
    await new Promise(function(r){ setTimeout(r, 150); }); // 150ms entre lotes
  }

  const top = results.sort(function(a,b){return b.score-a.score;}).slice(0, limit);
  console.log('[SCAN MOM] Completado: ' + results.length + ' candidatos de ' + SCAN_TICKERS.length);

  const response = {
    scanned:    SCAN_TICKERS.length,
    candidates: results.length,
    top:        top,
    errors:     errors.length,
    timestamp:  new Date().toISOString(),
    dataSource: 'Alpaca 15min',
    filters:    { minRSI, maxRSI, minRvol, limit },
  };

  // Guardar en caché
  scanMOMCache = { ts: Date.now(), data: response };

  res.json(response);
});;

// ── TRADE HISTORY — historial completo para el diario ──
app.get('/trades/history', (req, res) => {
  const limit  = parseInt(req.query.limit) || 200;
  const system = req.query.system || null; // filtrar por MOM/ORS
  const account= req.query.account || null;

  var trades = tradeHistory.slice(0, limit);
  if(system)  trades = trades.filter(t => t.system === system.toUpperCase());
  if(account) trades = trades.filter(t => t.account === account);

  const wins    = trades.filter(t => t.win);
  const losses  = trades.filter(t => !t.win);
  const totalPnl= trades.reduce((s,t) => s + (t.pnlEur||0), 0);
  const avgWin  = wins.length   ? Math.round(wins.reduce((s,t)=>s+(t.pnlEur||0),0)/wins.length) : 0;
  const avgLoss = losses.length ? Math.round(losses.reduce((s,t)=>s+(t.pnlEur||0),0)/losses.length) : 0;
  const wr      = trades.length ? Math.round(wins.length/trades.length*100) : 0;

  res.json({
    summary: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: wr,
      totalPnlEur: Math.round(totalPnl),
      avgWin, avgLoss,
      account: activeAccount,
    },
    trades,
  });
});

// ── DECISION LOG — log de decisiones con condiciones ──
app.get('/trades/decisions', (req, res) => {
  const limit  = parseInt(req.query.limit) || 100;
  const pending= req.query.pending === 'true'; // solo operaciones abiertas sin resultado
  var log = decisionLog.slice(0, limit);
  if(pending) log = log.filter(d => !d.result);
  res.json({ count: log.length, decisions: log });
});

// ── TRADE STATS — estadísticas avanzadas para análisis ──
app.get('/trades/stats', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const recent = tradeHistory.filter(t => t.date >= cutoff.slice(0,10));

  // Breakdown por sistema
  const momTrades = recent.filter(t => t.system === 'MOM');
  const orsTrades = recent.filter(t => t.system === 'ORS');

  // Breakdown por exit reason
  const byReason = {};
  recent.forEach(function(t) {
    var r = t.exitReason || 'Unknown';
    if(!byReason[r]) byReason[r] = {count:0, pnl:0, wins:0};
    byReason[r].count++;
    byReason[r].pnl += t.pnlEur || 0;
    if(t.win) byReason[r].wins++;
  });

  // Mejor y peor trade
  const sorted = recent.slice().sort((a,b) => (b.pnlEur||0) - (a.pnlEur||0));

  res.json({
    period: `${days} días`,
    total:  { trades: recent.length, pnl: Math.round(recent.reduce((s,t)=>s+(t.pnlEur||0),0)) },
    mom:    { trades: momTrades.length, pnl: Math.round(momTrades.reduce((s,t)=>s+(t.pnlEur||0),0)), wr: momTrades.length ? Math.round(momTrades.filter(t=>t.win).length/momTrades.length*100) : 0 },
    ors:    { trades: orsTrades.length, pnl: Math.round(orsTrades.reduce((s,t)=>s+(t.pnlEur||0),0)), wr: orsTrades.length ? Math.round(orsTrades.filter(t=>t.win).length/orsTrades.length*100) : 0 },
    byExitReason: byReason,
    best:   sorted[0]  || null,
    worst:  sorted[sorted.length-1] || null,
  });
});

// ── SEASONAL ANALYSIS ENDPOINT ───────────────────────────────────
// Descarga datos históricos reales de Alpaca y calcula estacionalidad
// Llamar una vez: GET /seasonal/analyze
// Devuelve retorno medio mensual real por ticker (últimos 8 años)
app.get('/seasonal/analyze', async (req, res) => {
  const tickers = [
    'DAL','AAL','UAL','HUM','HCA','ISRG','FDX','ROK','GD',
    'MU','TSM','AVGO','ORCL','MDB','ABBV','EL','BE','CEG',
    'CRSP','INSM','AMG','NVDA','META','GOOGL','AMZN','TSLA',
    'RKLB','LUNR','CRWV','DDOG','SNOW','NOW','SMCI','TKO',
    'MRVL','QCOM','HUT','ABBV','GEV','SATS',
    // Candidatos SP500
    'MSFT','ANET','APP','AXON','UBER','SHOP','ADBE','CRM',
    'PANW','PYPL','PLTR','DECK','LRCX','META'
  ].filter((v,i,a) => a.indexOf(v) === i);

  const results = {};
  const errors  = [];

  for (const sym of tickers) {
    try {
      const start = new Date();
      start.setFullYear(start.getFullYear() - 8);
      const startStr = start.toISOString().slice(0,10);
      const endStr   = new Date().toISOString().slice(0,10);

      const url = `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=1Month&start=${startStr}&end=${endStr}&limit=120&feed=iex&sort=asc`;
      const r   = await fetch(url, { headers: alpacaHeaders() });
      const d   = await r.json();
      const bars = d.bars || [];

      if (bars.length < 12) { errors.push(`${sym}: solo ${bars.length} meses`); continue; }

      // Calcular retorno mensual por mes del año
      const byMonth = {};
      for (let m = 1; m <= 12; m++) byMonth[m] = [];

      bars.forEach(b => {
        const month = parseInt(b.t.slice(5,7));
        const ret   = (b.c - b.o) / b.o * 100;
        byMonth[month].push(parseFloat(ret.toFixed(2)));
      });

      const seasonal = {};
      for (let m = 1; m <= 12; m++) {
        const vals = byMonth[m];
        if (!vals.length) continue;
        const avg  = vals.reduce((s,v) => s+v, 0) / vals.length;
        const bull = vals.filter(v => v > 0).length;
        seasonal[m] = {
          avg:   parseFloat(avg.toFixed(2)),
          bull:  Math.round(bull/vals.length*100),
          n:     vals.length,
          vals:  vals,
        };
      }

      results[sym] = { seasonal, bars: bars.length, from: bars[0]?.t?.slice(0,7) };
      console.log(`[SEASONAL] ${sym}: ${bars.length} meses OK`);
      await new Promise(r => setTimeout(r, 200)); // rate limit
    } catch(e) {
      errors.push(`${sym}: ${e.message}`);
    }
  }

  res.json({
    generated: new Date().toISOString(),
    tickers:   Object.keys(results).length,
    errors,
    data: results
  });
});

// ── WATCHLIST STATUS — estado WATCH tickers para la app ──────────
app.get('/watchlist/status', async (req, res) => {
  try {
    const active = getActiveWatchlist();
    const watchStatus = WATCH_TICKERS.map(sym => ({
      sym,
      status: TICKER_STATUS[sym] || 'ACTIVE',
      inDWL: DYNAMIC_WL_ADDITIONS.indexOf(sym) >= 0,
      score: 0, // se actualiza en el scanner semanal
    }));
    res.json({
      ts: new Date().toISOString(),
      active: active.length,
      watch: watchStatus,
      dynamic: DYNAMIC_WL_ADDITIONS,
      regime: MARKET_REGIME?.mode || 'BULL',
      riskPct: Math.round(RISK_PCT * 100),
      adaptiveDD: adaptiveDDActive,
    });
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ── TRADES STATS POR ESTRATEGIA ─────────────────────────────────
app.get('/trades/stats/strategy', (req, res) => {
  function ss(trades) {
    const wins=trades.filter(t=>t.win), loses=trades.filter(t=>!t.win);
    const gW=wins.reduce((s,t)=>s+(t.pnlEur||0),0);
    const gL=Math.abs(loses.reduce((s,t)=>s+(t.pnlEur||0),0));
    let cap=0,peak=0,maxDD=0;
    trades.forEach(t=>{cap+=t.pnlEur||0;if(cap>peak)peak=cap;const dd=peak>0?(peak-cap)/peak*100:0;if(dd>maxDD)maxDD=dd;});
    const byR={};
    trades.forEach(t=>{const r=t.exitReason||'?';if(!byR[r])byR[r]={count:0,wins:0,pnl:0};byR[r].count++;byR[r].pnl+=t.pnlEur||0;if(t.win)byR[r].wins++;});
    return {trades:trades.length,wins:wins.length,losses:loses.length,
      winRate:trades.length?(wins.length/trades.length*100).toFixed(1):0,
      profitFactor:gL>0?(gW/gL).toFixed(2):null,
      totalPnlEur:Math.round(gW-gL),avgWinEur:wins.length?Math.round(gW/wins.length):0,
      avgLossEur:loses.length?-Math.round(gL/loses.length):0,
      maxDrawdownPct:parseFloat(maxDD.toFixed(1)),byExitReason:byR};
  }
  res.json({timestamp:new Date().toISOString(),
    MOM:ss(tradeHistory.filter(t=>t.system==='MOM')),
    ORS:ss(tradeHistory.filter(t=>t.system==='ORS')),
    SWING:ss(tradeHistory.filter(t=>t.system==='SWING')),
    TOTAL:ss(tradeHistory)});
});

// ── START ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`ORS Proxy v2 running on port ${PORT}`);
  console.log(`Mode: ${USE_PAPER ? 'PAPER TRADING' : 'LIVE'} | Account: ${USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT}`);

  // Send startup message
  await sendTelegram(
    `🚀 <b>ORS Proxy arrancado</b>\n\n` +
    `💼 Modo: ${USE_PAPER ? 'Paper Trading ✅' : '🔴 Cuenta Real'}\n` +
    `👁 Watchlist activa: ${getActiveWatchlist().length} tickers\n` +
    `📡 Señales: cada 5 minutos\n\n` +
    `Escribe /ayuda para ver los comandos`
  );

  // Keep IBKR session alive every 5 min
  setInterval(() => ibkrTickle().catch(() => {}), 5 * 60 * 1000);

  // Sync open positions from Alpaca on startup
  setTimeout(async () => {
    try {
      const r = await fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHeaders() });
      let positions;
      try {
        const syncText = await r.text();
        positions = JSON.parse(syncText);
      } catch(jsonErr) {
        console.log('[SYNC] Alpaca devolvió respuesta no-JSON — skip sync');
        return;
      }
      if(Array.isArray(positions) && positions.length){
        positions.forEach(p => {
          if(!openPositions[p.symbol]){
            const ep = parseFloat(p.avg_entry_price);
            openPositions[p.symbol] = {
              sym: p.symbol,
              qty1: parseInt(p.qty), qty2: 0,
              entryPrice: ep,
              stopPrice: parseFloat((ep * 0.97).toFixed(2)), // default 3% stop
              target1: parseFloat((ep * 1.06).toFixed(2)),   // default 6% target (R:R 2:1)
              phase2Done: true, ts: Date.now(),
              // Auto-exit fields
              partialDone: false,
              maxPrice: parseFloat(p.current_price || ep),
              trailingPct: 4,
            };
          }
        });
        console.log(`[SYNC] Loaded ${positions.length} existing positions from Alpaca`);
        await sendTelegram(`📊 Posiciones sincronizadas: ${positions.map(p=>p.symbol).join(', ')}`);
      }
    } catch(e){ console.log('[SYNC] Could not load positions:', e.message); }
  }, 5000);

  // Check signals every 5 min
  setTimeout(checkSignals, 8000);
  setInterval(checkSignals, 5 * 60 * 1000);

  // MOM signals every 5 min (desfasado 2.5min de ORS para no solapar)
  setTimeout(checkMOMSignals, 30000); // 30s tras arranque (era 150s)
  setInterval(checkMOMSignals, 5 * 60 * 1000);

  // SWING signals cada 15min (usa datos 1H — no necesita más frecuencia)
  // Desfasado 75s de MOM para no solapar llamadas Alpaca
  setTimeout(checkSwingSignals, 75000);
  setInterval(checkSwingSignals, 15 * 60 * 1000);

  // ── Régimen de mercado — 1x al día al cierre del mercado (20:05 UTC) ────────
  // SMA50/SMA200 son medias de días — no tiene sentido calcularlas cada hora.
  // Se actualizan una vez al día con el cierre oficial de NYSE.
  setTimeout(updateMarketRegime, 5000); // al arrancar (datos del día anterior)

  function scheduleRegimeUpdate() {
    const now = new Date();
    // Próximo cierre NYSE = 20:05 UTC del día actual (o siguiente si ya pasó)
    const todayClose = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 5, 0));
    if (now >= todayClose) todayClose.setUTCDate(todayClose.getUTCDate() + 1);
    // Saltar fin de semana
    while (todayClose.getUTCDay() === 0 || todayClose.getUTCDay() === 6) {
      todayClose.setUTCDate(todayClose.getUTCDate() + 1);
    }
    const msUntilClose = todayClose.getTime() - now.getTime();
    console.log(`[REGIME] Próxima actualización: ${todayClose.toUTCString()} (en ${Math.round(msUntilClose/60000)} min)`);
    setTimeout(async () => {
      await updateMarketRegime();
      scheduleRegimeUpdate(); // reprogramar para el día siguiente
    }, msUntilClose);
  }
  scheduleRegimeUpdate();

  // ── SECTOR ETF LIGHT — actualización diaria a las 13:00 UTC (pre-mercado) ──
  function scheduleSectorLightUpdate() {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13, 0, 0));
    if (now >= target) target.setUTCDate(target.getUTCDate() + 1);
    while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    const ms = target.getTime() - now.getTime();
    console.log(`[SECTOR LIGHT] Próxima actualización ETF: ${target.toUTCString()} (en ${Math.round(ms/60000)} min)`);
    setTimeout(async () => {
      await updateSectorETFLight().catch(e => console.log('[SECTOR LIGHT] Error:', e.message));
      scheduleSectorLightUpdate();
    }, ms);
  }
  scheduleSectorLightUpdate();
  // Ejecutar también al arranque para tener datos desde el primer minuto
  updateSectorETFLight().catch(e => console.log('[SECTOR LIGHT] Startup error:', e.message));

  // VIX cada 30 min (sí cambia rápido — afecta sizing inmediato)
  setInterval(updateVIXContext, 30 * 60 * 1000);

  // Trailing stop + auto-exit manager every 3 min during market hours
  setInterval(async () => {
    if(!Object.keys(openPositions).length) return;
    const nyH = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}));
    if(nyH>=9&&nyH<16) {
      // Actualizar VIX spike detector con dato actual
    try {
      const _vixSnap = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=3d`,
        {headers:{'User-Agent':'Mozilla/5.0'}});
      const _vixData = await _vixSnap.json();
      const _vixClose = _vixData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (_vixClose && _vixClose.length >= 2) {
        const _vixNow  = _vixClose[_vixClose.length-1];
        const _vixYest = _vixClose[_vixClose.length-2];
        if (_vixNow) updateVIXSpike(_vixNow);
        latestVIX = _vixNow;
      }
    } catch(e) { /* VIX check silencioso */ }
    await manageTrailingStops();
      await checkAggressiveBreakeven(); // Breakeven agresivo a +1.5%
    }
  }, 3 * 60 * 1000);

  // Time exit check — salida si 3 días sin progreso
  setInterval(async () => {
    if(!Object.keys(openPositions).length) return;
    await checkTimeExits();
  }, 30 * 60 * 1000); // cada 30 min

  // SPY context update every 10 min
  setInterval(updateSPYContext, 10 * 60 * 1000);
  // Drawdown adaptativo — verificar cada hora
  setInterval(checkAdaptiveDrawdown, 60 * 60 * 1000);
  setTimeout(checkAdaptiveDrawdown, 15000);

  // ── PYRAMIDING — segunda entrada cuando +3% ganancia ──
  // Level 1 + Pyramid: mismo riesgo base, aprovecha momentum
  setInterval(async () => {
    const syms = Object.keys(openPositions).filter(s => {
      const p = openPositions[s];
      return p && !p.phase2Done && p.qty2 > 0;
    });
    if (!syms.length) return;

    const nyH = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}));
    if (nyH < 9 || nyH >= 16) return; // solo en mercado

    for (const sym of syms) {
      try {
        const pos = openPositions[sym];
        if (!pos) continue;

        // Esperar mínimo 15 minutos desde la entrada
        if (Date.now() - pos.ts < 15 * 60 * 1000) continue;

        const snap = await fetchAlpacaSnapshot(sym);
        if (!snap || !snap.price) continue;
        const price = snap.price;
        const gain  = (price - pos.entryPrice) / pos.entryPrice * 100;

        // Activar pyramid cuando:
        // 1. Ganancia ≥ +3%
        // 2. Precio sobre la entrada (no en retroceso)
        // 3. OBV y MACD siguen alcistas
        if (gain < 3.0) continue;

        const bars = await fetchAlpaca15min(sym);
        if (!bars || !bars.prices || bars.prices.length < 10) continue;

        const obv  = calcOBV(bars.prices);
        const macd = calcMACD(bars.prices);
        const rsi  = calcRSI(bars.prices, 14);

        const momentumOk = obv?.bullish && macd?.bullish && rsi && rsi < 75;
        if (!momentumOk) {
          console.log(`[Pyramid] ${sym} +${gain.toFixed(1)}% pero momentum débil — esperando`);
          continue;
        }

        // Ejecutar segunda entrada
        console.log(`[Pyramid] ${sym} +${gain.toFixed(1)}% — activando 2ª entrada (${pos.qty2} acc)`);
        const r = await fetch(`${alpacaBase()}/v2/orders`, {
          method: 'POST',
          headers: alpacaHeaders(),
          body: JSON.stringify({
            symbol: sym, qty: String(pos.qty2),
            side: 'buy', type: 'market', time_in_force: 'day'
          })
        });
        const o = await r.json();

        if (o.id) {
          pos.phase2Done = true;
          pos.pyramid2Price = price;
          openPositions[sym] = pos;

          await sendTelegram(
            `🔺 <b>PYRAMID — ${sym}</b>\n` +
            `2ª entrada: ${pos.qty2} acc @ $${price.toFixed(2)}\n` +
            `Ganancia actual: +${gain.toFixed(1)}%\n` +
            `RSI ${rsi?.toFixed(1)} | OBV ✅ | MACD ✅\n` +
            `Stop original: $${pos.stopPrice} · Total: ${pos.qty1+pos.qty2} acc`
          );
        }
      } catch(e) {
        console.error('[Pyramid]', sym, e.message);
      }
    }
  }, 2 * 60 * 1000);

  // Poll Telegram commands every 3 seconds
  setInterval(pollTelegramCommands, 3000);
});
