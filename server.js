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

// ═══════════════════════════════════════════════════════
// ALPACA EXECUTION ENGINE
// ═══════════════════════════════════════════════════════
const openPositions = {}; // sym → {qty, entryPrice, stopPrice, target, stopOrderId, ts}
const AUTO_EXECUTE = process.env.AUTO_EXECUTE === 'true';
const MAX_POSITIONS = parseInt(process.env.MAX_POSITIONS || '4'); // max simultaneous positions

async function executeAlpacaOrder(sym, order) {
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
    const buyOrder = await buyResp.json();
    if (!buyOrder.id) {
      await sendTelegram(`❌ Error Alpaca ${sym}: ${buyOrder.message || JSON.stringify(buyOrder).slice(0,100)}`);
      return;
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
    openPositions[sym] = {
      sym, qty1, qty2, qty: qty1 + qty2,
      entryPrice: order.price, stopPrice: order.stopPrice,
      originalStop: order.stopPrice,
      target1: order.target1, rr: order.rr,
      stopOrderId: stopOrder.id,
      buyOrderId: buyOrder.id,
      phase2Done: false, ts: Date.now(),
      // Auto-exit fields
      partialDone: false,
      maxPrice: order.price,
      trailingPct: 4,  // 4% trailing por defecto
    };
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

async function executeSell(sym, qty, reason, price) {
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

      // Obtener precio actual
      const sr = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${sym}&feed=iex`,{headers:alpacaHeaders()});
      const sd = await sr.json();
      const price = sd[sym]?.latestTrade?.p || pos.entryPrice;
      const totalQty = pos.qty1 + (pos.phase2Done ? pos.qty2 : 0);
      const remainQty = pos.partialDone ? Math.max(1, Math.ceil(totalQty * 0.5)) : totalQty;
      const gain = (price - pos.entryPrice) / pos.entryPrice * 100;

      // Actualizar precio máximo para trailing
      if(!pos.maxPrice || price > pos.maxPrice) {
        pos.maxPrice = price;
        openPositions[sym] = pos;
      }

      // ── NIVEL 1: Stop loss fijo ──────────────────────────
      if(pos.stopPrice && price <= pos.stopPrice * 0.999){
        const sold = await executeSell(sym, totalQty, `Stop loss $${pos.stopPrice}`, price);
        if(sold) { delete openPositions[sym]; continue; }
      }

      // Obtener datos 15min para análisis técnico
      const bars15 = await fetchAlpaca15min(sym);
      const prices15 = bars15 && bars15.prices && bars15.prices.length >= 30 ? bars15.prices : null;

      // ── NIVEL 2: Venta parcial en target ────────────────
      if(pos.target1 && price >= pos.target1 * 0.998 && !pos.partialDone){

        // FILTRO MOMENTUM: si el movimiento sigue fuerte, dejar correr
        let momentumStrong = false;
        if(prices15 && prices15.length >= 30){
          const obv2  = calcOBV(prices15);
          const macd2 = calcMACD(prices15);
          const rsi2  = calcRSI(prices15, 14);
          const obvOk   = obv2 && obv2.bullish && obv2.rising;
          const macdOk  = macd2 && macd2.bullish && !macd2.bearCross;
          const rsiOk   = rsi2 && rsi2 < 72;
          momentumStrong = obvOk && macdOk && rsiOk;
        }

        if(momentumStrong){
          // Momentum sigue fuerte — subir stop a breakeven y dejar correr
          const newStop = parseFloat((pos.entryPrice * 1.002).toFixed(2));
          if(!pos.stopPrice || newStop > pos.stopPrice){
            if(pos.stopOrderId){
              await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
                {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
            }
            await placeNewStop(sym, totalQty, newStop);
            pos.stopPrice = newStop;
            openPositions[sym] = pos;
          }
          // Subir target un 50% más para capturar más movimiento
          const oldTarget = pos.target1;
          const riskPS = pos.entryPrice - (pos.originalStop || pos.stopPrice);
          pos.target1 = parseFloat((price + Math.abs(riskPS) * 1.5).toFixed(2));
          openPositions[sym] = pos;
          const keyMom = `${sym}_momentum_${new Date().toDateString()}_${new Date().getHours()}`;
          if(!sentAlerts[keyMom]){
            sentAlerts[keyMom] = Date.now();
            await sendTelegram(
              `🚀 <b>MOMENTUM FUERTE — ${sym}</b>\n` +
              `💪 OBV ✅ MACD ✅ RSI OK — dejando correr\n` +
              `📍 Precio: $${price.toFixed(2)} (target original $${oldTarget})\n` +
              `🎯 Nuevo target: $${pos.target1}\n` +
              `🛡 Stop movido a breakeven $${newStop}`
            );
          }
        } else {
          // Momentum agotado — ejecutar venta parcial 50%
          const partialQty = Math.floor(totalQty * 0.5);
          if(partialQty >= 1){
            const sold = await executeSell(sym, partialQty, `Target T1 $${pos.target1} — venta 50%`, price);
            if(sold){
              pos.partialDone = true;
              const be = parseFloat((pos.entryPrice * 1.002).toFixed(2));
              if(pos.stopOrderId){
                await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
                  {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
              }
              await placeNewStop(sym, Math.ceil(totalQty*0.5), be);
              pos.stopPrice = be;
              openPositions[sym] = pos;
              await sendTelegram(
                `🛡 <b>Stop → Breakeven ${sym}</b>\n` +
                `Stop movido a $${be} (entrada +0.2%)\n` +
                `50% restante protegido · Dejando correr`
              );
            }
          }
        }
        continue;
      }

      // ── NIVEL 3: Salida por señal ORS inversa ───────────
      // Solo cuando ya hicimos venta parcial (50% restante en juego)
      if(pos.partialDone && prices15){
        const obv15   = calcOBV(prices15);
        const macd15  = calcMACD(prices15);
        const rsi15   = calcRSI(prices15, 14);
        const n       = prices15.length;
        const lastBar = prices15[n-1];

        const obvBear   = obv15 && !obv15.bullish;
        const macdBear  = macd15 && macd15.bearCross;
        const rsiBear   = rsi15 && rsi15 > 68;
        const shootStar = lastBar &&
          (lastBar.high - Math.max(lastBar.open||lastBar.close, lastBar.close)) >
          (Math.abs((lastBar.close-(lastBar.open||lastBar.close)))*2) &&
          lastBar.close < (lastBar.open||lastBar.close);

        const bearCount = (obvBear?1:0) + (macdBear?1:0) + (rsiBear?1:0) + (shootStar?1:0);

        if(bearCount >= 2){
          const exitKey = `${sym}_ors_exit_${new Date().toDateString()}_${new Date().getHours()}`;
          if(!sentAlerts[exitKey]){
            sentAlerts[exitKey] = Date.now();
            const reasons = [];
            if(obvBear)  reasons.push('OBV bajista');
            if(macdBear) reasons.push('MACD cruce bajista');
            if(rsiBear)  reasons.push(`RSI ${rsi15?.toFixed(1)} sobrecompra`);
            if(shootStar) reasons.push('Shooting Star');
            const sold = await executeSell(sym, remainQty, reasons.join(' + '), price);
            if(sold) { delete openPositions[sym]; continue; }
          }
        }
      }

      // ── NIVEL 4: Trailing stop desde máximo ─────────────
      // Activo solo después de venta parcial
      if(pos.partialDone && pos.maxPrice){
        const trailPct  = pos.trailingPct || 4;
        const trailStop = parseFloat((pos.maxPrice * (1 - trailPct/100)).toFixed(2));
        if(price <= trailStop){
          const sold = await executeSell(sym, remainQty,
            `Trailing stop ${trailPct}% desde máximo $${pos.maxPrice.toFixed(2)}`, price);
          if(sold) { delete openPositions[sym]; continue; }
        }
        // Actualizar stop en Alpaca si el trailing subió significativamente
        if(trailStop > pos.stopPrice + 0.30){
          if(pos.stopOrderId){
            await fetch(`${alpacaBase()}/v2/orders/${pos.stopOrderId}`,
              {method:'DELETE',headers:alpacaHeaders()}).catch(()=>{});
          }
          await placeNewStop(sym, remainQty, trailStop);
          const prev = pos.stopPrice;
          await sendTelegram(`🔼 <b>Trailing actualizado ${sym}</b>\n$${prev} → $${trailStop} (máx $${pos.maxPrice.toFixed(2)})`);
        }
      }

      // ── ALERTAS DE HITOS (sin ejecutar) ─────────────────
      const milestones = [2, 5, 10, 15, 20];
      for(const m of milestones){
        const mKey = `${sym}_hito_${m}`;
        if(gain >= m && !sentAlerts[mKey]){
          sentAlerts[mKey] = Date.now();
          const pnl = Math.round((price-pos.entryPrice)*totalQty/1.08);
          await sendTelegram(
            `📈 <b>${sym} +${gain.toFixed(1)}%</b> · $${price.toFixed(2)}\n` +
            `P&L: +€${pnl} · Stop: $${pos.stopPrice}\n` +
            `${pos.partialDone?'50% restante corriendo':'Target pendiente: $'+(pos.target1||'—')}`
          );
        }
      }

    } catch(e){ console.error('[AutoExit] Error', sym, e.message); }
  }
}

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
    condsMet, validORS,
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

        await sendTelegram(`⏳ Ejecutando en Alpaca ${getAcc().label}...`);
        await executeAlpacaOrder(sym, order);
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
      `${ALPACA_DATA}/v2/stocks/${sym}/bars?timeframe=15Min&limit=200&feed=iex&sort=asc&start=${new Date(Date.now()-7*24*3600*1000).toISOString().split('T')[0]}`,
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
      // validORS = 4/5+ with OBV mandatory. orsScore threshold lowered to 50
      // STRICT: must have OBV bullish (mandatory) + 4/5 conditions + RSI in range
      const obvBullish = sig.obv && sig.obv.bullish;
      const rsiInRange = sig.rsi && sig.rsi >= 20 && sig.rsi <= 45;
      const condsMet4 = sig.condsMet >= 4;
      const validEntry = obvBullish && condsMet4 && rsiInRange && !tooEarly;
      console.log(`[${sym}] RSI:${sig.rsi?.toFixed(1)} condsMet:${sig.condsMet}/5 OBV:${obvBullish} validEntry:${validEntry}`);

      // Check momentum signal too
      const momScore = calcMomentumScore(sig, parsed.prices);
      const validMomentum = momScore >= 70 && !tooEarly;
      const momKey = sym + '_mom_' + new Date().toDateString();
      if(validMomentum && !sentAlerts[momKey]) {
        sentAlerts[momKey] = Date.now();
        let momMsg = `🚀 <b>MOMENTUM — ${sym}</b>\n\n`;
        momMsg += `💰 Precio: <b>$${sig.last}</b>\n`;
        momMsg += `📊 RSI: ${sig.rsi} (zona momentum)\n`;
        momMsg += `🎯 Score Momentum: <b>${momScore}/100</b>\n`;
        momMsg += sig.aboveSMA200 ? `✅ Sobre SMA200\n` : '';
        momMsg += `\n⚠️ NO ejecución automática — señal de tendencia\n`;
        momMsg += `Stop sugerido: $${(sig.last*(1-0.03)).toFixed(2)} (ATR×2)\n\n`;
        momMsg += `/entrar_momentum_${sym}   /ignorar_${sym}`;
        await sendTelegram(momMsg);
      }

      if (validEntry && !sentAlerts[entryKey]) {
        // AUTO EXECUTE if enabled
        if (AUTO_EXECUTE && !isLive()) {
          // Position sizing — ALWAYS use ATR×1.5 for stop, never tighter
          const _atr = Math.max(sig.atr || 1, sig.last * 0.005); // min 0.5% of price
          const _stopATR = parseFloat((sig.last - _atr * 1.5).toFixed(2));
          // Use signal's stopPrice only if it's >= ATR×1.5 distance
          const _stopSig = sig.stopPrice || 0;
          const _stopFinal = (_stopSig > 0 && (sig.last - _stopSig) >= _atr * 1.5)
            ? _stopSig : _stopATR;
          const _riskUSD = (CAPITAL_EUR * 0.02 * 1.08);
          const _riskPerShare = sig.last - _stopFinal;
          const _qty = Math.max(1, Math.floor(_riskUSD / _riskPerShare));
          const _qty1 = Math.max(1, Math.floor(_qty * 0.5));
          const _qty2 = _qty - _qty1;
          console.log(`[${sym}] ATR:${_atr.toFixed(2)} stop:${_stopFinal} qty:${_qty} risk:$${(_riskPerShare*_qty).toFixed(0)}`);
          // ── MAX POSITIONS CHECK ──────────────────────────
          const openCount = Object.keys(openPositions).length;
          if(openCount >= MAX_POSITIONS){
            console.log(`[${sym}] SKIP — max positions reached (${openCount}/${MAX_POSITIONS})`);
            await sendTelegram(`⚠️ <b>SEÑAL ${sym}</b> detectada pero ya tienes ${openCount}/${MAX_POSITIONS} posiciones abiertas.\nCierra alguna con /posiciones para liberar espacio.`);
            continue;
          }
          // Also skip if already have open position in this ticker
          if(openPositions[sym]){
            console.log(`[${sym}] SKIP — already have open position`);
            continue;
          }

          // ── MAX POSITIONS CHECK ──────────────────────────
          const _openCount = Object.keys(openPositions).length;
          if(_openCount >= MAX_POSITIONS){
            console.log(`[${sym}] SKIP — max positions (_openCount/${MAX_POSITIONS})`);
            if(!sentAlerts[sym+'_maxpos_'+new Date().toDateString()]){
              sentAlerts[sym+'_maxpos_'+new Date().toDateString()] = Date.now();
              await sendTelegram(`⚠️ Señal <b>${sym}</b> detectada pero ${_openCount}/${MAX_POSITIONS} posiciones abiertas.\n/posiciones para ver el estado.`);
            }
            continue;
          }
          if(openPositions[sym]){
            console.log(`[${sym}] SKIP — ya tiene posición abierta`);
            continue;
          }

          pendingOrders[sym] = {
            sym,
            qty: _qty,
            qty1: _qty1,
            qty2: _qty2,
            price: sig.last,
            stopPrice: _stopFinal,
            target1: sig.target1, rr: sig.rr,
            aboveSMA200: sig.aboveSMA200,
            orsScore: sig.orsScore, condsMet: sig.condsMet, ts: Date.now(),
          };
          await executeAlpacaOrder(sym, pendingOrders[sym]);
          sentAlerts[entryKey] = Date.now();
          continue; // skip Telegram confirmation message
        }
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
        if(sig.mfiOk) msg += `💧 MFI: ${sig.mfi} ✅ Acumulación confirmada\n`;
        if(sig.slit && sig.slit.detected) msg += `⚡ SLIT Tipo ${sig.slit.type} detectado — stops cazados\n`;
        if(sig.range && sig.range.isRange) msg += `↔️ Mercado en rango ${sig.range.rangePct}% · Target techo $${sig.range.hi}\n`;
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

// ── ALPACA NEWS ───────────────────────────────────────
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

  // Sync open positions from Alpaca on startup
  setTimeout(async () => {
    try {
      const r = await fetch(`${alpacaBase()}/v2/positions`, { headers: alpacaHeaders() });
      const positions = await r.json();
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

  // Trailing stop manager every 3 min during market hours
  setInterval(async () => {
    if(!Object.keys(openPositions).length) return;
    const nyH = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}));
    if(nyH>=9&&nyH<16) await manageTrailingStops();
  }, 3 * 60 * 1000);

  // Second entry check every 2 min
  setInterval(async () => {
    const syms = Object.keys(openPositions).filter(s=>!openPositions[s].phase2Done&&openPositions[s].qty2>0);
    if(!syms.length) return;
    for(const sym of syms){
      const pos = openPositions[sym];
      if(Date.now()-pos.ts > 15*60*1000){
        const data = await fetchAlpaca15min(sym).catch(()=>null);
        if(data&&data.prices&&data.prices.length>=2){
          const last2 = data.prices.slice(-2);
          if(last2[1].close > last2[0].close && last2[1].close > pos.entryPrice){
            // Confirm and buy second half
            const r = await fetch(`${alpacaBase()}/v2/orders`,{
              method:'POST',headers:alpacaHeaders(),
              body:JSON.stringify({symbol:sym,qty:String(pos.qty2),side:'buy',type:'market',time_in_force:'day'})
            });
            const o = await r.json();
            if(o.id){
              pos.phase2Done=true; openPositions[sym]=pos;
              await sendTelegram(`✅ <b>2ª entrada ${sym}</b> — ${pos.qty2} acc adicionales`);
            }
          }
        }
      }
    }
  }, 2 * 60 * 1000);

  // Poll Telegram commands every 3 seconds
  setInterval(pollTelegramCommands, 3000);
});
