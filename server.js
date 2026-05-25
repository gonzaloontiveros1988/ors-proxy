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
const WATCHLIST  = (process.env.WATCHLIST || 'NVDA,AMD,TSLA,AAPL,HCA,RKLB,LUNR,CRWV,TSM,INSM').split(',');
const IBKR_ACCOUNT  = process.env.IBKR_ACCOUNT  || 'U24668151';
const IBKR_PAPER    = process.env.IBKR_PAPER    || 'DU24668151';
const IBKR_BASE     = process.env.IBKR_BASE     || 'https://api.ibkr.com/v1/api';
const CAPITAL_EUR   = parseFloat(process.env.CAPITAL_EUR || '11480');
const RISK_PCT      = parseFloat(process.env.RISK_PCT    || '0.02');
const USE_PAPER     = process.env.USE_PAPER !== 'false';

// ── ALPACA DUAL ACCOUNT ───────────────────────────────
const ALPACA_DATA = 'https://data.alpaca.markets';
const ALPACA_ACCOUNTS = {
  paper: {
    key:    process.env.ALPACA_PAPER_KEY    || 'PK5JTGMESYNYM7VDDPO352Q6JQ',
    secret: process.env.ALPACA_PAPER_SECRET || '2ugX7LPeLcdGNiv4dSL7q6tchEb4ztbBeF6y5rxYPdyc',
    base:   'https://paper-api.alpaca.markets',
    label:  '📋 PAPER — Claude practice',
    id:     'PA3PYDHW3QQY',
  },
  live: {
    key:    process.env.ALPACA_LIVE_KEY    || 'AKD6YNJVJAEIILNNK7UIGNACPY',
    secret: process.env.ALPACA_LIVE_SECRET || '8145VgBNw8HWtmcbYAbRUDCsqKn4sz7qmVE99ABdquLa',
    base:   'https://api.alpaca.markets',
    label:  '🔴 LIVE — Gonzo (251322106)',
    id:     '251322106',
  },
};

// Active account state — persists in memory, switchable via Telegram or API
let ACTIVE_ACCOUNT = process.env.ALPACA_DEFAULT_ACCOUNT || 'paper';

function getAcc()        { return ALPACA_ACCOUNTS[ACTIVE_ACCOUNT] || ALPACA_ACCOUNTS.paper; }
function alpacaBase()    { return getAcc().base; }
function alpacaHeaders() {
  const acc = getAcc();
  return { 'APCA-API-KEY-ID': acc.key, 'APCA-API-SECRET-KEY': acc.secret, 'Content-Type': 'application/json' };
}
function isLive()        { return ACTIVE_ACCOUNT === 'live'; }

// ── STATE ─────────────────────────────────────────────
const sentAlerts    = {};   // avoid duplicate alerts
const priceCache    = {};   // yahoo cache
const CACHE_TTL     = 4 * 60 * 1000;
const pendingOrders = {};   // awaiting Telegram confirmation
const ibkrSession   = { token: null, expires: 0 };

// ── TECHNICAL INDICATORS ──────────────────────────────
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
  const obvArr = [0];
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i].close - prices[i-1].close;
    obv += d > 0 ? (prices[i].volume||0) : d < 0 ? -(prices[i].volume||0) : 0;
    obvArr.push(obv);
  }
  const n = obvArr.length;
  const recent = obvArr.slice(-5);
  const older  = obvArr.slice(-10, -5);
  const avgRecent = recent.reduce((a,b)=>a+b,0)/5;
  const avgOlder  = older.reduce((a,b)=>a+b,0)/5;
  return { bullish: avgRecent > avgOlder, rising: obv > obvArr[n-3], value: obv };
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
  const rsiOk    = rsi >= 20 && rsi <= 45;
  const rsiCruz  = rsiPrev !== null && rsiPrev < 30 && rsi >= 30;
  const bajoVwap = ema20 && last < ema20;
  const obvOk    = obv && obv.bullish && obv.rising;  // MANDATORY
  const macdBull = macd && macd.bullish;

  // Count ORS conditions (OBV mandatory)
  const condsMet = [rsiOk, rsiCruz, bajoVwap, macdBull].filter(Boolean).length + (obvOk ? 1 : 0);
  const validORS = condsMet >= 4 && obvOk;  // OBV always required

  // ── ENHANCED SCORE with Turtle/Fibonacci/SMA200 ──
  let orsScore = 0;
  if (rsi >= 20 && rsi <= 30) orsScore += 35;
  else if (rsi > 30 && rsi <= 35) orsScore += 28;
  else if (rsi > 35 && rsi <= 45) orsScore += 15;
  else if (rsi > 65) orsScore -= 20;
  if (rsiCruz)  orsScore += 25;
  if (bajoVwap) orsScore += 12;
  if (macdBull) orsScore += 12;
  if (macd && macd.bullCross) orsScore += 8;  // bonus cruce exacto
  if (obvOk)    orsScore += 20;               // OBV alcista — clave
  if (stoch && stoch.oversold)  orsScore += 8;
  if (stoch && stoch.bullCross) orsScore += 10;
  if (bb && last <= bb.lower * 1.01) orsScore += 8;

  // SMA200 filter — reduces score if below macro trend
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
  let suggestedQty = null, stopPrice = null, suggestedQty2 = null;
  if (atr && last) {
    stopPrice = parseFloat((last - atr * 1.5).toFixed(2));
    const riskUSD = CAPITAL_EUR * RISK_PCT * 1.08;
    const riskPer = last - stopPrice;
    let qty = riskPer > 0 ? Math.max(1, Math.floor(riskUSD / riskPer)) : 1;
    // Reduce 50% if below SMA200
    if (!aboveSMA200) qty = Math.max(1, Math.floor(qty * 0.5));
    suggestedQty  = Math.floor(qty * 0.5);  // first half (scalping entry)
    suggestedQty2 = qty - suggestedQty;     // second half (confirmation)
  }

  // ── TARGET via EMA50 ──
  const target1 = ema50 && ema50 > last ? ema50 : parseFloat((last * 1.05).toFixed(2));
  const rr = stopPrice ? parseFloat(((target1 - last) / (last - stopPrice)).toFixed(1)) : null;

  return {
    rsi: +rsi.toFixed(1), rsiPrev: rsiPrev ? +rsiPrev.toFixed(1) : null,
    rsiOk, rsiCruz, bajoVwap, obvOk, macdBull,
    condsMet, validORS,
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

        await sendTelegram(`⏳ Ejecutando orden ${sym}...`);
        const result = await ibkrPlaceBracketOrder(sym, order.qty, order.price, order.stopPrice);

        if (result && !result.error) {
          delete pendingOrders[sym];
          let msg = `✅ <b>ORDEN EJECUTADA — ${sym}</b>\n\n`;
          msg += `📊 ${USE_PAPER ? 'PAPER TRADING' : '🔴 CUENTA REAL'}\n`;
          msg += `💰 Compra: ${order.qty} acciones\n`;
          msg += `🛑 Stop loss: $${order.stopPrice}\n`;
          msg += `⚠️ Riesgo: ~€${Math.round((order.price - order.stopPrice) * order.qty * 0.92)}\n`;
          msg += `\nRegistra la operación en ORS Analyzer`;
          await sendTelegram(msg);
        } else {
          await sendTelegram(`❌ Error al ejecutar ${sym}: ${result?.error || JSON.stringify(result)}\n\nVerifica que IBKR Client Portal API está activa.`);
        }
      }

      // /cuenta → switch between paper and live
      else if (text === '/cuenta' || text === '/switch') {
        const other = ACTIVE_ACCOUNT === 'paper' ? 'live' : 'paper';
        const otherAcc = ALPACA_ACCOUNTS[other];
        if (!otherAcc.secret) {
          await sendTelegram(`❌ No se puede cambiar a ${otherAcc.label}\nFaltan credenciales en Render.`);
        } else {
          await sendTelegram(
            `⚠️ <b>Cambio de cuenta</b>\n\n` +
            `Actual: ${getAcc().label}\n` +
            `Nueva:  ${otherAcc.label}\n\n` +
            `⚠️ Si cambias a LIVE operarás con dinero real\n\n` +
            `/confirmar_cuenta_${other}   /cancelar_cuenta`
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
            `ID: ${acc.id}\n` +
            (isLive() ? `\n🔴 <b>ATENCIÓN: Dinero real activo</b>` : `\n📋 Modo seguro paper trading`)
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
        await sendTelegram(`✅ Scan completado · ${WATCHLIST.length} tickers revisados`);
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
        const alpacaOk = !!process.env.ALPACA_KEY_ID;
        let msg = `⚙️ <b>Estado ORS Proxy</b>\n\n`;
        const activeAcc = getAcc();
        msg += `🦙 Alpaca: ${alpacaOk ? '✅ ' + activeAcc.label : '❌ Sin key'}\n`;
        msg += `💳 Cuenta activa: ${activeAcc.id}\n`;
        msg += `🏦 IBKR: ${ping ? '✅ Conectado' : '❌ Desconectado'}\n`;
        msg += `💼 Modo: ${USE_PAPER ? 'Paper Trading' : '🔴 Cuenta Real'}\n`;
        msg += `👁 Watchlist: ${WATCHLIST.join(', ')}\n`;
        msg += `⏰ ${new Date().toLocaleString('es-ES', {timeZone: 'America/New_York'})} NY\n`;
        msg += `📋 Órdenes pendientes: ${Object.keys(pendingOrders).length}\n`;
        msg += `🔄 Datos: ${alpacaOk ? 'Alpaca 15min RT' : 'Yahoo Finance (retraso)'}`;
        await sendTelegram(msg);
      }

      // /ayuda → help
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
          '/ayuda — Este menú\n\n' +
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
      `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&limit=140&feed=iex`,
      { headers: alpacaHeaders() }
    );
    const d = await r.json();
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
async function checkSignals() {
  const NY_HOUR = parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }));
  const NY_MIN = parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', minute: 'numeric',
  }));
  // 30min rule: no entries before 10:00 NY
  const tooEarly = NY_HOUR < 10 || (NY_HOUR === 10 && NY_MIN < 0);
  if (NY_HOUR < 9 || NY_HOUR >= 16) return;

  console.log(`[${new Date().toISOString()}] Checking ${WATCHLIST.length} tickers (Alpaca RT)...`);
  const now = Date.now();

  for (const sym of WATCHLIST) {
    try {
      // Use Alpaca 15min bars (RT) with Yahoo fallback
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

      // Get real-time snapshot for current price
      const snap = await fetchAlpacaSnapshot(sym);
      if (snap) parsed.quote = snap;

      const sig = calcORSSignal(parsed.prices, parsed.quote);
      if (!sig) continue;

      const dataSource = parsed.quote?.source === 'alpaca' ? '🟢 Alpaca RT' : '🟡 Yahoo';

      // ── ENTRY SIGNAL — ORS-v2 completo ───────────────
      const entryKey = `${sym}_entry_${new Date().toDateString()}`;
      const validEntry = sig.validORS && sig.orsScore >= 60 && !tooEarly;

      if (validEntry && !sentAlerts[entryKey]) {
        sentAlerts[entryKey] = now;

        pendingOrders[sym] = {
          sym, qty: (sig.suggestedQty || 1) + (sig.suggestedQty2 || 0),
          qty1: sig.suggestedQty || 1,
          qty2: sig.suggestedQty2 || 0,
          price: sig.last, stopPrice: sig.stopPrice,
          target1: sig.target1, rr: sig.rr,
          orsScore: sig.orsScore, condsMet: sig.condsMet,
          aboveSMA200: sig.aboveSMA200, fibProximity: sig.fibProximity,
          ts: now,
        };

        const stars = sig.orsScore >= 85 ? '⭐⭐⭐' : sig.orsScore >= 75 ? '⭐⭐' : '⭐';
        const modeLabel = getAcc().label;
        const sma200txt = sig.aboveSMA200 ? '✅ Sobre SMA200' : '⚠️ Bajo SMA200 (tamaño reducido)';
        const fibTxt = sig.fibProximity ? `\n📐 Fibonacci ${sig.fibProximity.level} ✅ (+convicción)` : '';
        const totalQty = (sig.suggestedQty||1) + (sig.suggestedQty2||0);
        const riskEur = Math.round((sig.last - sig.stopPrice) * totalQty / 1.08);

        let msg = `⚡ <b>SEÑAL ORS-v2 — ${sym}</b> ${stars}\n`;
        msg += `${dataSource} · ${sig.condsMet}/5 condiciones\n\n`;
        msg += `💰 Precio: <b>$${sig.last.toFixed(2)}</b> (${parsed.quote.changePct >= 0?'+':''}${parsed.quote.changePct}%)\n`;
        msg += `📊 RSI: <b>${sig.rsi}</b>${sig.rsiCruz ? ' ✅ Cruzó 30' : ''}`;
        msg += ` · OBV: ${sig.obvOk ? '✅' : '❌'} · MACD: ${sig.macdBull ? '✅' : '❌'}\n`;
        msg += `🎯 Score: <b>${sig.orsScore}/100</b> · ATR: $${sig.atr}\n`;
        msg += `${sma200txt}${fibTxt}\n\n`;
        msg += `📐 <b>POSITION SIZING TURTLE-ORS</b>\n`;
        msg += `  1ª entrada: <b>${sig.suggestedQty} acc</b> ahora\n`;
        msg += `  2ª entrada: <b>${sig.suggestedQty2} acc</b> en confirmación\n`;
        msg += `  Stop auto: <b>$${sig.stopPrice}</b> (ATR×1.5)\n`;
        msg += `  Target T1: <b>$${sig.target1}</b> (EMA50)\n`;
        msg += `  R:R: <b>1:${sig.rr||'?'}</b> · Riesgo: ~€${riskEur}\n\n`;
        msg += `⏰ <b>10 min</b> para confirmar (${modeLabel})\n`;
        msg += `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`;

        await sendTelegram(msg);
        console.log(`📱 ORS signal: ${sym} (${sig.condsMet}/5, score:${sig.orsScore}, src:${parsed.quote?.source})`);
      }

      // ── EXIT SIGNAL ───────────────────────────────────
      const exitKey = `${sym}_exit_${new Date().toDateString()}`;
      if (sig.exhaustion >= 60 && !sentAlerts[exitKey]) {
        sentAlerts[exitKey] = now;
        let msg = `🔴 <b>SEÑAL SALIDA — ${sym}</b>\n\n`;
        msg += `💰 Precio: <b>$${sig.last.toFixed(2)}</b>\n`;
        msg += `📊 RSI: <b>${sig.rsi}</b>${parseFloat(sig.rsi) > 70 ? ' ⚠️ SOBRECOMPRADO' : ''}\n`;
        msg += `⛽ Agotamiento: <b>${sig.exhaustion}%</b>\n`;
        if (sig.ema50 && sig.last >= sig.ema50 * 0.99) msg += `🎯 EMA50 alcanzada — considera cerrar\n`;
        msg += `\n→ Ajusta stop o cierra posición`;
        await sendTelegram(msg);
        console.log(`🔴 Exit signal: ${sym} (exhaustion:${sig.exhaustion})`);
      }

      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      console.log(`Error ${sym}:`, e.message);
    }
  }
}

// ── API ENDPOINTS ─────────────────────────────────────

// Claude proxy — key stored securely in env variable
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
  res.json({ ok: true, checked: WATCHLIST, time: new Date().toISOString() });
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
    watchlist: WATCHLIST,
    pending:  Object.keys(pendingOrders).length,
    time:     new Date().toISOString()
  });
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

// ── START ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`ORS Proxy v2 running on port ${PORT}`);
  console.log(`Mode: ${USE_PAPER ? 'PAPER TRADING' : 'LIVE'} | Account: ${USE_PAPER ? IBKR_PAPER : IBKR_ACCOUNT}`);

  // Send startup message
  await sendTelegram(
    `🚀 <b>ORS Proxy arrancado</b>\n\n` +
    `💼 Modo: ${USE_PAPER ? 'Paper Trading ✅' : '🔴 Cuenta Real'}\n` +
    `👁 Watchlist: ${WATCHLIST.join(', ')}\n` +
    `📡 Señales: cada 5 minutos\n\n` +
    `Escribe /ayuda para ver los comandos`
  );

  // Keep IBKR session alive every 5 min
  setInterval(() => ibkrTickle().catch(() => {}), 5 * 60 * 1000);

  // Check signals every 5 min
  setTimeout(checkSignals, 8000);
  setInterval(checkSignals, 5 * 60 * 1000);

  // Poll Telegram commands every 3 seconds
  setInterval(pollTelegramCommands, 3000);
});
