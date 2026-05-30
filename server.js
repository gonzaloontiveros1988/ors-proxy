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
const WATCHLIST  = (process.env.WATCHLIST || [
  // AI CHIPS — Motor principal IA
  'NVDA','AMD','AVGO','TSM','MU','QCOM','MRVL','ARM','SMCI',
  // AI INFRASTRUCTURE
  'CRWV','DELL','ANET','PLTR',
  // CLOUD / TECH
  'ORCL','META','AMZN','GOOGL','MSFT','NFLX',
  // ENERGIA TRADICIONAL — Top sector 2026
  'XOM','CVX','OXY','EOG','SLB',
  // NUCLEAR / UTILITIES
  'CEG','VST','GEV','NEE','ETR',
  // DEFENSA — Catalizador Trump 2027
  'LMT','RTX','NOC','GD',
  // INDUSTRIALES
  'CAT','DE','HON','EMR',
  // HEALTHCARE / BIOTECH
  'LLY','VRTX','REGN','UNH','HCA','ISRG','ABBV','INSM','CRSP',
  // FINANCIALS
  'JPM','GS','MS','BLK','COIN',
  // ESPACIO / ROBOTICA
  'TSLA','RKLB','LUNR',
  // AIRLINES
  'DAL','UAL','AAL',
].join(',')).split(',');
const IBKR_ACCOUNT  = process.env.IBKR_ACCOUNT  || 'U24668151';
const IBKR_PAPER    = process.env.IBKR_PAPER    || 'DU24668151';
const IBKR_BASE     = process.env.IBKR_BASE     || 'https://api.ibkr.com/v1/api';
let CAPITAL_EUR   = parseFloat(process.env.CAPITAL_EUR || '11480');
const RISK_PCT      = parseFloat(process.env.RISK_PCT    || '0.02');
const USE_PAPER     = process.env.USE_PAPER !== 'false';

// ── ALPACA 3 CUENTAS ──────────────────────────────────
const ALPACA_DATA = 'https://data.alpaca.markets';
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
const openPositions = {}; // sym → {qty, entryPrice, stopPrice, target, stopOrderId, ts}
const AUTO_EXECUTE = process.env.AUTO_EXECUTE === 'true';
const MAX_POSITIONS     = parseInt(process.env.MAX_POSITIONS || '4');
const MAX_POSITIONS_ORS = parseInt(process.env.MAX_POSITIONS_ORS || '1'); // ORS máximo 1 — oportunista
const MAX_POSITIONS_MOM = parseInt(process.env.MAX_POSITIONS_MOM || '4'); // MOM usa todos los slots

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
  var pct = price < 20  ? 0.05
          : price < 50  ? 0.075
          :               0.30;  // MOM y ORS 5/5 — máximo 30%
  var maxValueUSD = CAPITAL_EUR * 1.08 * pct;
  var maxByValue  = Math.floor(maxValueUSD / price);
  return Math.max(1, Math.min(qty, maxByValue));
}

// ── ATR MÍNIMO — evita sizing desproporcionado en tickers baratos ──
function adjustedATR(atr, price) {
  const minAtrPct = 0.005; // 0.5% mínimo
  return (atr / price) < minAtrPct ? price * minAtrPct : atr;
}

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
      partialDone: false,
      maxPrice: order.price,
      trailingPct: 4,
      system: order.isMOM ? 'MOM' : 'ORS',
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
      if(reason.includes('Stop')) recordStopOut(sym, price);
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
      const isMOM = pos.type === 'MOM';

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

      // ══════════════════════════════════════════════════════
      // NIVEL 1 — Stop loss fijo (igual para ORS y MOM)
      // ══════════════════════════════════════════════════════
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
let spyContext = { trend: 'neutral', change: 0, ts: 0 };
let vixContext = { value: 15, regime: 'normal', ts: 0 };
let breadthContext = { pctAboveSMA200: 70, regime: 'healthy', ts: 0 };

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
const CACHE_TTL     = 4 * 60 * 1000;
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
  const rsiCruz  = rsiPrev !== null && rsiPrev < 30 && rsi >= 30;
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
    depthOk = dropPct <= -4;
  }

  // Ichimoku como contexto de scoring
  const ichi = prices.length >= 30 ? calcIchimoku(prices) : null;

  // Count ORS conditions (OBV mandatory)
  const condsMet = [rsiOk, rsiCruz, bajoVwap, macdBull].filter(Boolean).length + (obvOk ? 1 : 0);
  // Solo aceptar ORS 5/5 — las 5 condiciones obligatorias
  // 4/5 desactivado hasta tener mayor capital (julio revisión)
  const validORS = condsMet >= 5 && obvOk && depthOk;

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

    stopPrice = parseFloat((last - atrAdjusted * 2.0).toFixed(2));
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

async function checkMOMSignals() {
  const nyNow  = new Date().toLocaleString('en-US', {timeZone:'America/New_York',hour:'numeric',minute:'numeric',hour12:false});
  const [NH,NM]= nyNow.split(':').map(Number);
  const totalMins = NH*60+NM;
  if (totalMins < 570 || totalMins >= 960) return; // fuera de mercado

  const tooEarly = totalMins < 600; // primera media hora
  const tooLate  = totalMins >= 930; // última media hora
  if (tooEarly || tooLate) return;

  // MOM solo activo cuando SPY está alcista o neutral
  if (spyContext.trend === 'bear') {
    console.log('[MOM] Desactivado — SPY bajista');
    return;
  }

  const spyMult = spyContext.trend === 'bull' ? 1.0 : 0.75;
  const now     = Date.now();

  for (const sym of WATCHLIST) {
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
        'NEE', 'ETR',        // Utilities — macro dependientes, no momentum técnico
        'COIN',              // Crypto — gaps extremos imposibles de gestionar
        'ZIM',               // Shipping — gaps y volatilidad sin estructura
        'AAL',               // Airlines low cost — demasiado volátil en rango bajo
        'CRSP',              // Biotech especulativo — gaps en datos clínicos
        'INSM',              // Biotech especulativo — misma razón
      ];
      if (MOM_BLACKLIST.indexOf(sym) >= 0 || serverBlacklist[sym]) continue;

      // Filtros estrictos obligatorios
      if (sig.rsi < 45 || sig.rsi > 75) continue;  // RSI 45-75
      if (sig.rvol < 1.3) continue;                  // RVOL ≥1.3x global
      if (sig.last < 20) continue;                   // Precio ≥$20

      // ── FILTRO ICHIMOKU MOM ──────────────────────────
      // MOM necesita precio sobre Kumo + TK Cross + nube alcista
      const ichiMOM = sig.prices && sig.prices.length >= 52 ? calcIchimoku(sig.prices) : null;
      if (ichiMOM && !ichiMOM.momFilter) continue;

      // No entrar si ya hay posición ORS activa en este ticker
      if (openPositions[sym]) continue;

      const entryKey = `${sym}_mom_${new Date().toDateString()}`;
      if (sentAlerts[entryKey]) continue;

      // Filtros
      const nearEarnings  = await isNearEarnings(sym);
      if (nearEarnings) continue;

      const sectorCount   = countSectorPositions(sym);
      if (sectorCount >= MAX_PER_SECTOR) continue;

      const openCount     = Object.keys(openPositions).length;
      if (openCount >= MAX_POSITIONS) continue;

      if (!canReEnter(sym, sig.last)) continue;

      // Position sizing MOM corregido
      const _atr        = sig.atr || sig.last * 0.015;
      const _stop       = parseFloat((sig.last - _atr * 1.5).toFixed(2)); // ATR×1.5
      const _riskPerSh  = sig.last - _stop;
      if (_riskPerSh <= 0) continue;
      const _riskUSD    = CAPITAL_EUR * RISK_PCT * 1.08 * 0.75 * spyMult;
      const _qty = capQty(Math.max(1, Math.floor(_riskUSD / _riskPerSh)), sig.last);
      const _target     = parseFloat((sig.last + _riskPerSh * 2.0).toFixed(2)); // R:R 2:1

      sentAlerts[entryKey] = now;

      if (AUTO_EXECUTE) {
        pendingOrders[sym] = {
          sym, qty:_qty, qty1:_qty, qty2:0,
          price:sig.last, stopPrice:_stop,
          target1:_target, rr:1.5, atr:_atr,
          aboveSMA200:sig.aboveSMA200,
          type:'MOM', ts:now,
        };
        await executeAlpacaOrder(sym, pendingOrders[sym]);
        await sendTelegram(
          `🚀 <b>MOM SIGNAL — ${sym}</b>\n` +
          `💰 $${sig.last.toFixed(2)} | Stop $${_stop} | Target $${_target}\n` +
          `📦 ${_qty} acc | Riesgo €${Math.round(_riskPerSh*_qty/1.08)}\n` +
          `📊 RSI ${sig.rsi?.toFixed(1)} | OBV ✅ | RVOL ${sig.rvol}x\n` +
          `📈 Breakout ✅ | SPY ${spyContext.trend}\n` +
          `🏭 Sector: ${getSector(sym)} | R:R 1.5:1`
        );
      } else {
        await sendTelegram(
          `🚀 <b>MOM SIGNAL — ${sym}</b>\n\n` +
          `💰 $${sig.last.toFixed(2)} | Stop: $${_stop} | Target: $${_target}\n` +
          `📦 ${_qty} acc | Riesgo: €${Math.round(_riskPerSh*_qty/1.08)}\n` +
          `📊 RSI ${sig.rsi?.toFixed(1)} | OBV ✅ | RVOL ${sig.rvol}x\n` +
          `📈 Breakout: ${sig.breakout?'✅':'❌'} | SPY: ${spyContext.trend}\n` +
          `🏭 Sector: ${getSector(sym)} | R:R 1.5:1\n\n` +
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
  const nyNow = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour:'numeric', minute:'numeric', hour12:false });
  const [NY_HOUR, NY_MIN] = nyNow.split(':').map(Number);
  const totalMins = NY_HOUR * 60 + NY_MIN;

  // Horario de mercado: 9:30 - 16:00 NY
  if (totalMins < 570 || totalMins >= 960) return; // fuera de mercado

  // ── FILTRO DE HORA — no entrar primera 30min ni última 30min ──
  const tooEarly  = totalMins < 570; // antes de 9:30+30 = 10:00 NY
  const tooLate   = totalMins >= 930; // después de 15:30 NY
  const noEntry   = tooEarly || tooLate;

  // ── SPY CONTEXT — actualizar cada 15min ──────────────
  if (!spyContext.ts || Date.now() - spyContext.ts > 15 * 60 * 1000) {
    await updateSPYContext();
  }
  const spyMult = getSPYSizingMultiplier();

  console.log(`[${new Date().toISOString()}] Scan ${WATCHLIST.length} tickers | SPY:${spyContext.trend}(${spyContext.change}%) | NoEntry:${noEntry}`);

  const now = Date.now();
  const candidateSignals = []; // Acumula señales para rankear

  for (const sym of WATCHLIST) {
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

      candidateSignals.push({
        sym, sig, rvol, is5of5, is4of5OBV,
        sector: getSector(sym),
        score: parseFloat(signalScore.toFixed(1)),
      });

      console.log(`[${sym}] ✅ Candidata | RSI:${sig.rsi?.toFixed(1)} conds:${sig.condsMet}/5 RVOL:${rvol} score:${signalScore.toFixed(1)}`);

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
      // Máximo 1 ORS simultáneo
      if (orsCount >= MAX_POSITIONS_ORS) {
        console.log(`[SLOTS] ${cand.sym} ORS bloqueado — ya hay ${orsCount} ORS activo`);
        continue;
      }
      // ORS no compite con MOM — solo usa slots libres
      // Si MOM puede llegar a MAX_POSITIONS_MOM, reservar esos slots
      var momSlotsLibres = MAX_POSITIONS_MOM - momOpen;
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
        await executeAlpacaOrder(sym, pendingOrders[sym]);

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
  for (const sym of WATCHLIST) {
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
    watchlist: WATCHLIST,
    watchlistCount: WATCHLIST.length,
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
    watchlist: WATCHLIST,
    pending:  Object.keys(pendingOrders).length,
    time:     new Date().toISOString()
  });
});

// ── HEALTH CHECK — verifica version del codigo desplegado ──
app.get('/health', (req, res) => {
  const positions = Object.keys(openPositions);
  const vixRegime = getVIXSystemRegime();
  res.json({
    status:        'ok',
    version:       '3.41.0',
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
    },
    openPositions:   positions,
    positionCount:   positions.length,
    mode:            USE_PAPER ? 'PAPER' : 'LIVE',
    uptime:          Math.round(process.uptime()) + 's',
  });
});

// ═══════════════════════════════════════════════════════
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
      // Siempre descargar suficiente historia para indicadores
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=${range}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (!result) { console.log(`[BT] ${sym}: no data`); continue; }

      const ts     = result.timestamp || [];
      const quotes = result.indicators?.quote?.[0] || {};
      const prices = ts.map((t, i) => ({
        date:   new Date(t*1000).toISOString().slice(0,10),
        close:  quotes.close?.[i],
        high:   quotes.high?.[i]  || quotes.close?.[i],
        low:    quotes.low?.[i]   || quotes.close?.[i],
        open:   quotes.open?.[i]  || quotes.close?.[i],
        volume: quotes.volume?.[i] || 1000000,
      })).filter(p => p.close && p.close > 0);

      if (prices.length < 30) { console.log(`[BT] ${sym}: solo ${prices.length} barras`); continue; }

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
        if (prices[i].date < cutoffStr) continue;
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
        if (lastTrade && prices[i].date <= lastTrade.exitDate) continue;

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
        const maxDays = systemType === 'MOM' ? 30 : 10;  // MOM 30d para permitir runners

        for (let j = i+1; j < Math.min(i+maxDays+1, prices.length); j++) {
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
        if (lastTrade && prices[i].date <= lastTrade.exitDate) continue;

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
app.get('/test/ors', async (req, res) => {
  try {
    const days      = parseInt(req.query.days) || 60;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const tickers   = req.query.tickers ? req.query.tickers.split(',') : WATCHLIST;

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
app.get('/test/mom', async (req, res) => {
  try {
    const days      = parseInt(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const tickers   = req.query.tickers ? req.query.tickers.split(',') : WATCHLIST;
    const runnerTh  = req.query.runner != null ? parseFloat(req.query.runner) : 3;
    const daysCalc  = startDate && endDate
      ? Math.ceil((new Date(endDate)-new Date(startDate))/86400000)+5
      : days;
    console.log(`[BT MOM] ${tickers.length} tickers | runner +${runnerTh}% | ${startDate||'últimos'} → ${endDate||days+'d'}`);
    const result = await runBacktestEngine(tickers, 'MOM', daysCalc, startDate, endDate, runnerTh);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /test/both — backtest ORS + MOM combinados
app.get('/test/both', async (req, res) => {
  try {
    const days      = parseInt(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const tickers   = req.query.tickers ? req.query.tickers.split(',') : WATCHLIST;
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
  const limit   = parseInt(req.query.limit) || 20;
  const minRSI  = parseFloat(req.query.minRSI) || 45;
  const maxRSI  = parseFloat(req.query.maxRSI) || 75;
  const minRvol = parseFloat(req.query.minRvol) || 1.3;

  console.log(`[SCAN MOM] Iniciando scan de ${SCAN_TICKERS.length} tickers...`);
  const results = [];
  const errors  = [];

  // Procesar en lotes de 10 para no saturar Yahoo Finance
  const BATCH = 10;
  for(let i = 0; i < SCAN_TICKERS.length; i += BATCH) {
    const batch = SCAN_TICKERS.slice(i, i + BATCH);
    await Promise.all(batch.map(async function(sym) {
      try {
        // Fetch datos diarios Yahoo — últimos 90 días
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=90d`;
        const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const d   = await r.json();
        const res0 = d?.chart?.result?.[0];
        if(!res0) return;

        const ts     = res0.timestamp || [];
        const quotes = res0.indicators?.quote?.[0] || {};
        const prices = ts.map(function(t, idx) {
          return {
            date:   new Date(t*1000).toISOString().slice(0,10),
            open:   quotes.open?.[idx],
            high:   quotes.high?.[idx],
            low:    quotes.low?.[idx],
            close:  quotes.close?.[idx],
            volume: quotes.volume?.[idx] || 0,
          };
        }).filter(function(p){ return p.close && p.close > 0; });

        if(prices.length < 30) return;

        const last   = prices[prices.length-1].close;
        if(last < 15) return; // excluir penny stocks

        const slice  = prices;
        const rsi    = calcRSI(slice, 14);
        const obv    = calcOBV(slice);
        const macd   = calcMACD(slice);
        const atr    = calcATR(slice, 14);
        const ema20  = calcEMA(slice, 20);
        const sma200 = slice.length >= 200 ? calcSMA(slice, 200) : null;

        if(!rsi || !atr) return;

        // Filtros MOM
        if(rsi < minRSI || rsi > maxRSI) return;

        // RVOL
        const vols  = slice.slice(-21);
        const avgV  = vols.slice(0,-1).reduce(function(s,p){return s+(p.volume||0);},0)/20;
        const rvol  = avgV > 0 ? (vols[vols.length-1].volume||0)/avgV : 1;
        if(rvol < minRvol) return;

        // OBV alcista obligatorio
        const obvOk = obv && obv.bullish;
        if(!obvOk) return;

        // Sobre EMA20
        const aboveEMA = ema20 && last > ema20;

        // MACD
        const macdOk = macd && macd.bullish;

        // Sobre SMA200
        const aboveSMA = sma200 ? last > sma200 : true;

        // Ichimoku
        const ichi = slice.length >= 52 ? calcIchimoku(slice) : null;
        const ichiOk = !ichi || ichi.momFilter;

        // Score MOM
        var score = 0;
        score += Math.round(rvol * 15);                         // RVOL
        score += rsi >= 55 && rsi <= 70 ? 25 : 10;             // RSI zona óptima
        score += macdOk ? 20 : 0;                              // MACD
        score += aboveEMA ? 15 : 0;                            // EMA20
        score += aboveSMA ? 10 : 0;                            // SMA200
        score += ichiOk ? 15 : 0;                              // Ichimoku

        // Condiciones cumplidas
        const conds = (rsi>=minRSI&&rsi<=maxRSI?1:0) + (obvOk?1:0) + (macdOk?1:0) + (aboveEMA?1:0) + (rvol>=minRvol?1:0);
        if(conds < 3) return; // mínimo 3 condiciones

        results.push({
          sym,
          score:    Math.min(100, score),
          rsi:      parseFloat(rsi.toFixed(1)),
          rvol:     parseFloat(rvol.toFixed(2)),
          price:    parseFloat(last.toFixed(2)),
          atr:      parseFloat(atr.toFixed(2)),
          macd:     macdOk,
          obv:      obvOk,
          aboveSMA,
          aboveEMA,
          ichimoku: ichiOk,
          conds,
          phase:    conds >= 5 ? 'ÓPTIMA' : conds >= 4 ? 'SEÑAL' : 'WATCH',
        });
      } catch(e) {
        errors.push(sym);
      }
    }));
    // Pequeña pausa entre lotes
    await new Promise(function(r){ setTimeout(r, 200); });
  }

  // Ordenar por score
  results.sort(function(a,b){ return b.score - a.score; });
  const top = results.slice(0, limit);

  console.log(`[SCAN MOM] Completado: ${results.length} candidatos de ${SCAN_TICKERS.length} tickers`);

  res.json({
    scanned:    SCAN_TICKERS.length,
    candidates: results.length,
    top:        top,
    errors:     errors.length,
    timestamp:  new Date().toISOString(),
    filters:    { minRSI, maxRSI, minRvol },
  });
});

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

  // MOM signals every 5 min (desfasado 2.5min de ORS para no solapar)
  setTimeout(checkMOMSignals, 150000);
  setInterval(checkMOMSignals, 5 * 60 * 1000);

  // Trailing stop + auto-exit manager every 3 min during market hours
  setInterval(async () => {
    if(!Object.keys(openPositions).length) return;
    const nyH = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}));
    if(nyH>=9&&nyH<16) {
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
