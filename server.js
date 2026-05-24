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
const IBKR_PAPER    = process.env.IBKR_PAPER    || 'DU24668151'; // Paper trading account
const IBKR_BASE     = process.env.IBKR_BASE     || 'https://api.ibkr.com/v1/api'; // Client Portal API
const CAPITAL_EUR   = parseFloat(process.env.CAPITAL_EUR || '11480');
const RISK_PCT      = parseFloat(process.env.RISK_PCT    || '0.02'); // 2% risk per trade
const USE_PAPER     = process.env.USE_PAPER !== 'false'; // Default: paper trading

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
  if (!prices || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i].close - prices[i-1].close;
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + (gains/period) / (losses/period)));
}

function calcMACD(prices) {
  if (!prices || prices.length < 35) return null;
  const k12 = 2/13, k26 = 2/27;
  let e12 = prices[prices.length-26].close;
  let e26 = prices[prices.length-26].close;
  for (let i = prices.length-25; i < prices.length; i++) {
    e12 = prices[i].close * k12 + e12 * (1-k12);
    e26 = prices[i].close * k26 + e26 * (1-k26);
  }
  return { bullish: e12 > e26, value: e12 - e26 };
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

// ── ORS SIGNAL ────────────────────────────────────────
function calcORSSignal(prices, quote) {
  if (!prices || prices.length < 30) return null;
  const last     = quote ? quote.price : prices[prices.length-1].close;
  const rsi      = calcRSI(prices, 14);
  const rsiPrev  = calcRSI(prices.slice(0,-1), 14);
  const ema20    = calcEMA(prices, 20);
  const macd     = calcMACD(prices);
  const stoch    = calcStochRSI(prices);
  const bb       = calcBollinger(prices);
  const atr      = calcATR(prices, 14);
  if (!rsi) return null;

  const rsiCruz  = rsiPrev !== null && rsiPrev < 30 && rsi >= 30;
  const bajoVwap = ema20 && last < ema20;
  const macdBull = macd && macd.bullish;

  let orsScore = 0;
  if (rsi >= 20 && rsi <= 35) orsScore += 35;
  else if (rsi > 35 && rsi <= 45) orsScore += 20;
  else if (rsi > 65) orsScore -= 20;
  if (rsiCruz)  orsScore += 25;
  if (bajoVwap) orsScore += 15;
  if (macdBull) orsScore += 15;
  if (stoch && stoch.oversold)  orsScore += 10;
  if (stoch && stoch.bullCross) orsScore += 15;
  if (bb && last <= bb.lower * 1.01) orsScore += 10;
  orsScore = Math.max(0, Math.min(100, orsScore));

  // Exhaustion (exit signal)
  let exhaustion = 0;
  if (rsi > 70) exhaustion += 30;
  if (rsi > 80) exhaustion += 15;
  if (stoch && parseFloat(stoch.k) > 80) exhaustion += 20;
  if (bb && last >= bb.upper * 0.99) exhaustion += 20;
  if (ema20 && (last - ema20) / ema20 * 100 > 10) exhaustion += 15;
  exhaustion = Math.min(100, exhaustion);

  // Position sizing based on ATR and risk
  let suggestedQty = null, stopPrice = null;
  if (atr && last) {
    stopPrice     = parseFloat((last - atr * 1.5).toFixed(2));
    const riskUSD = CAPITAL_EUR * RISK_PCT / 0.92; // EUR to approx USD
    const riskPer = last - stopPrice;
    suggestedQty  = riskPer > 0 ? Math.max(1, Math.floor(riskUSD / riskPer)) : 1;
  }

  return {
    rsi: rsi ? +rsi.toFixed(1) : null, rsiCruz, bajoVwap, macdBull,
    orsScore, exhaustion, last, atr: atr ? +atr.toFixed(2) : null,
    stochK: stoch ? stoch.k : null,
    nearBBLower: bb && last <= bb.lower * 1.015,
    ema20: ema20 ? +ema20.toFixed(2) : null,
    suggestedQty, stopPrice,
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
        let msg = `⚙️ <b>Estado ORS Proxy</b>\n\n`;
        msg += `📡 IBKR API: ${ping ? '✅ Conectado' : '❌ Desconectado'}\n`;
        msg += `💼 Modo: ${USE_PAPER ? 'Paper Trading' : '🔴 Cuenta Real'}\n`;
        msg += `👁 Watchlist: ${WATCHLIST.join(', ')}\n`;
        msg += `⏰ ${new Date().toLocaleString('es-ES', {timeZone: 'America/New_York'})} NY\n`;
        msg += `📋 Órdenes pendientes: ${Object.keys(pendingOrders).length}`;
        await sendTelegram(msg);
      }

      // /ayuda → help
      else if (text === '/ayuda' || text === '/help' || text === '/start') {
        await sendTelegram(
          '🤖 <b>ORS Analyzer Bot</b>\n\n' +
          '/si — Confirmar última orden pendiente\n' +
          '/no — Cancelar última orden pendiente\n' +
          '/ejecutar_AMD — Ejecutar orden específica\n' +
          '/cancelar_AMD — Cancelar orden específica\n' +
          '/posiciones — Ver posiciones IBKR\n' +
          '/estado — Estado del servidor y IBKR\n' +
          '/ayuda — Este menú\n\n' +
          '⚠️ Tienes 10 min para confirmar cada orden'
        );
      }
    }
  } catch(e) {
    console.log('Poll TG error:', e.message);
  }
}

// ── YAHOO FETCH ───────────────────────────────────────
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
    prices.push({
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
    quote: { price: +cp.toFixed(2), changePct: pc ? +((cp-pc)/pc*100).toFixed(2) : 0 }
  };
}

// ── SIGNAL CHECKER ────────────────────────────────────
async function checkSignals() {
  const NY_HOUR = parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }));
  if (NY_HOUR < 9 || NY_HOUR >= 16) return; // Market closed

  console.log(`[${new Date().toISOString()}] Checking ${WATCHLIST.length} tickers...`);
  const now = Date.now();

  for (const sym of WATCHLIST) {
    try {
      // Cache check
      let parsed = priceCache[sym];
      if (!parsed || now - parsed.ts > CACHE_TTL) {
        const data = await fetchYahoo(sym, '15m', '5d');
        parsed = parseYahoo(data);
        if (parsed) priceCache[sym] = { ...parsed, ts: now };
      }
      if (!parsed?.prices?.length) continue;

      const sig = calcORSSignal(parsed.prices, parsed.quote);
      if (!sig) continue;

      // ── ENTRY SIGNAL ─────────────────────────────────
      const entryKey = `${sym}_entry_${new Date().toDateString()}`;
      if (sig.orsScore >= 65 && (sig.rsiCruz || parseFloat(sig.rsi) <= 32) && !sentAlerts[entryKey]) {
        sentAlerts[entryKey] = now;

        // Store pending order (awaiting confirmation)
        pendingOrders[sym] = {
          sym, qty: sig.suggestedQty || 1,
          price: sig.last, stopPrice: sig.stopPrice,
          orsScore: sig.orsScore, ts: now,
        };

        const stars = sig.orsScore >= 85 ? '⭐⭐⭐' : sig.orsScore >= 75 ? '⭐⭐' : '⭐';
        const accountLabel = USE_PAPER ? '📋 PAPER' : '🔴 REAL';
        let msg = `⚡ <b>SEÑAL ORS-v2 — ${sym}</b> ${stars}\n\n`;
        msg += `💰 Precio: <b>$${sig.last.toFixed(2)}</b> (${parsed.quote.changePct >= 0 ? '+' : ''}${parsed.quote.changePct}%)\n`;
        msg += `📊 RSI: <b>${sig.rsi}</b>${sig.rsiCruz ? ' ✅ Cruzó 30' : ''}\n`;
        if (sig.stochK) msg += `📈 StochRSI: <b>${sig.stochK}</b>\n`;
        msg += `🎯 Score ORS: <b>${sig.orsScore}/100</b>\n\n`;
        msg += `📤 <b>ORDEN PROPUESTA (${accountLabel})</b>\n`;
        msg += `  Comprar: <b>${sig.suggestedQty} acciones</b>\n`;
        msg += `  Stop loss: <b>$${sig.stopPrice}</b>\n`;
        msg += `  Riesgo: ~€${Math.round((sig.last - sig.stopPrice) * sig.suggestedQty * 0.92)}\n\n`;
        msg += `⏰ Tienes <b>10 minutos</b> para confirmar\n\n`;
        msg += `✅ /ejecutar_${sym}   ❌ /cancelar_${sym}`;

        await sendTelegram(msg);
        console.log(`📱 Entry alert sent: ${sym} (ORS:${sig.orsScore})`);
      }

      // ── EXIT SIGNAL ───────────────────────────────────
      const exitKey = `${sym}_exit_${new Date().toDateString()}`;
      if (sig.exhaustion >= 65 && !sentAlerts[exitKey]) {
        sentAlerts[exitKey] = now;
        let msg = `🔴 <b>SEÑAL SALIDA — ${sym}</b>\n\n`;
        msg += `💰 Precio: <b>$${sig.last.toFixed(2)}</b>\n`;
        msg += `⛽ Combustible: <b>${100 - sig.exhaustion}%</b> restante\n`;
        msg += `📊 RSI: <b>${sig.rsi}</b>${parseFloat(sig.rsi) > 70 ? ' ⚠️ SOBRECOMPRADO' : ''}\n`;
        msg += `\n→ Considera ajustar stop o cerrar posición`;
        await sendTelegram(msg);
        console.log(`🔴 Exit alert sent: ${sym}`);
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
