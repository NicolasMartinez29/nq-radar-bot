import { sendTelegram } from "./telegram.js";

// ============================================================
// 👹 NQ RADAR V1 — FROM ZERO
// PAPER TRADING ONLY
// Data source: TradingView 1m webhook feed
// Instrument simulated: NQ (E-mini Nasdaq-100)
// ============================================================

const PAPER_TRADING_ONLY = true;

const CONFIG = {
  VERSION: "NQ RADAR V1 FROM ZERO",
  SYMBOL: "NQ",
  POINT_VALUE: 20,
  CONTRACTS: 1,

  STARTING_BALANCE: 50000,
  MAX_RISK_USD: 500,
  DAILY_LOSS_LIMIT_USD: 1000,
  MAX_TRADES_PER_SESSION: 2,
  MAX_OPEN_TRADES: 1,
  COOLDOWN_MINUTES: 20,

  SIGNAL_THRESHOLD: 75,

  ORB_START_MINUTE: 9 * 60 + 30,   // 09:30 ET
  ORB_END_MINUTE: 9 * 60 + 45,     // lock at 09:45 ET
  FORCE_EXIT_MINUTE: 15 * 60 + 55, // 15:55 ET

  MAX_CANDLES: 700,
  MAX_CLOSED_TRADES: 500,
  MAX_SIGNALS: 500
};

const STAGE_RANK = {
  NORMAL: 0,
  ORB_FORMING: 1,
  WATCH: 2,
  BUILDING: 3,
  SIGNAL: 4
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/" && request.method === "GET") {
        return json({
          bot: "NQ RADAR",
          version: CONFIG.VERSION,
          status: "online",
          mode: "PAPER TRADING ONLY",
          feed: "TradingView 1m webhook",
          simulatedInstrument: "NQ",
          pointValue: CONFIG.POINT_VALUE
        });
      }

      if (url.pathname === "/debug/version" && request.method === "GET") {
        return json({
          ok: true,
          bot: "NQ RADAR",
          version: CONFIG.VERSION,
          paperTradingOnly: PAPER_TRADING_ONLY,
          telegramPath: "/telegram",
          feedPath: "/feed",
          simulatedInstrument: CONFIG.SYMBOL,
          pointValue: CONFIG.POINT_VALUE,
          contracts: CONFIG.CONTRACTS
        });
      }

      if (url.pathname === "/setup" && request.method === "GET") {
        return await setupTelegramWebhook(request, env);
      }

      if (
        (url.pathname === "/telegram" || url.pathname === "/webhook") &&
        request.method === "POST"
      ) {
        return await handleTelegram(request, env);
      }

      if (url.pathname === "/feed" && request.method === "POST") {
        return await handleFeed(request, env);
      }

      if (url.pathname === "/status" && request.method === "GET") {
        const state = await getState(env);
        return json(publicStatus(state));
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("FETCH ERROR", safeError(error));
      return json({ ok: false, error: safeError(error) }, 500);
    }
  }
};

// ============================================================
// TELEGRAM WEBHOOK SETUP
// ============================================================

async function setupTelegramWebhook(request, env) {
  requireTelegramToken(env);

  const origin = new URL(request.url).origin;
  const webhookUrl = `${origin}/telegram`;
  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

  const setResponse = await fetch(`${api}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      drop_pending_updates: true,
      allowed_updates: ["message", "edited_message"]
    })
  });

  const setResult = await setResponse.json();

  const infoResponse = await fetch(`${api}/getWebhookInfo`);
  const infoResult = await infoResponse.json();
  const info = infoResult?.result || {};

  return json({
    ok: Boolean(setResult?.ok && infoResult?.ok && info.url === webhookUrl),
    worker: CONFIG.VERSION,
    expectedWebhook: webhookUrl,
    setWebhook: {
      ok: Boolean(setResult?.ok),
      description: setResult?.description || null
    },
    webhookInfo: {
      url: info.url || null,
      pendingUpdateCount: info.pending_update_count ?? null,
      lastErrorMessage: info.last_error_message || null
    }
  });
}

// ============================================================
// TRADINGVIEW FEED
// ============================================================

async function handleFeed(request, env) {
  requireFeedSecret(env);

  const payload = await request.json();

  if (!secureEqual(String(payload?.secret || ""), String(env.NQ_FEED_SECRET))) {
    return json({ ok: false, error: "Unauthorized feed" }, 401);
  }

  const candle = normalizeCandle(payload);

  if (!candle) {
    return json({ ok: false, error: "Invalid candle payload" }, 400);
  }

  const state = await getState(env);

  // We still store feed while inactive so /scan can show data,
  // but we DO NOT open/manage paper trades unless /start is active.
  const result = processCandle(state, candle, state.active);

  await saveState(env, state);

  if (state.active && state.chatId) {
    for (const event of result.events) {
      await sendEventToTelegram(env, state.chatId, event, state);
    }
  }

  return json({
    ok: true,
    version: CONFIG.VERSION,
    active: state.active,
    sessionDate: state.sessionDate,
    stage: state.lastAnalysis?.stage || "NORMAL",
    score: state.lastAnalysis?.score ?? 0,
    bias: state.lastAnalysis?.bias || "NEUTRAL",
    openTrades: state.openTrades.length
  });
}

function normalizeCandle(payload) {
  const time = Number(payload?.time);
  const open = Number(payload?.open);
  const high = Number(payload?.high);
  const low = Number(payload?.low);
  const close = Number(payload?.close);
  const volume = Number(payload?.volume);

  if (![time, open, high, low, close, volume].every(Number.isFinite)) {
    return null;
  }

  if (high < low || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    return null;
  }

  // Accept TradingView Unix seconds or milliseconds.
  const normalizedTime = time < 10_000_000_000 ? time * 1000 : time;

  return {
    time: normalizedTime,
    open,
    high,
    low,
    close,
    volume: Math.max(volume, 0),
    symbol: String(payload?.symbol || "NQ"),
    timeframe: String(payload?.timeframe || "1")
  };
}

// ============================================================
// CORE ENGINE
// ============================================================

function processCandle(state, candle, allowTrading) {
  const events = [];

  if (state.lastCandleTime && candle.time <= state.lastCandleTime) {
    return { events, duplicate: true };
  }

  state.lastCandleTime = candle.time;

  const et = nyParts(candle.time);
  const sessionDate = `${et.year}-${pad2(et.month)}-${pad2(et.day)}`;
  const minuteOfDay = et.hour * 60 + et.minute;

  if (state.sessionDate !== sessionDate) {
    resetSession(state, sessionDate);
    events.push({
      type: "SESSION_RESET",
      sessionDate
    });
  }

  state.candles.push(candle);
  state.candles = state.candles.slice(-CONFIG.MAX_CANDLES);

  // Build 09:30-09:44 opening range.
  if (
    minuteOfDay >= CONFIG.ORB_START_MINUTE &&
    minuteOfDay < CONFIG.ORB_END_MINUTE
  ) {
    state.orb.high =
      state.orb.high == null ? candle.high : Math.max(state.orb.high, candle.high);

    state.orb.low =
      state.orb.low == null ? candle.low : Math.min(state.orb.low, candle.low);

    state.orb.candles += 1;
    state.orb.locked = false;
  }

  if (
    minuteOfDay >= CONFIG.ORB_END_MINUTE &&
    state.orb.high != null &&
    state.orb.low != null &&
    !state.orb.locked
  ) {
    state.orb.locked = true;
    state.orb.lockedAt = candle.time;

    events.push({
      type: "ORB_LOCKED",
      high: state.orb.high,
      low: state.orb.low
    });
  }

  const analysis = analyze(state, candle, minuteOfDay);
  const previousStage = state.previousStage || "NORMAL";

  state.lastAnalysis = analysis;
  state.lastFeedAt = Date.now();

  // Always manage a paper trade from candle high/low if active.
  if (allowTrading) {
    const managementEvents = manageOpenTrades(state, candle, minuteOfDay);
    events.push(...managementEvents);
  }

  if (analysis.stage !== previousStage) {
    const movedUp =
      (STAGE_RANK[analysis.stage] ?? 0) >
      (STAGE_RANK[previousStage] ?? 0);

    state.previousStage = analysis.stage;

    if (
      movedUp &&
      ["WATCH", "BUILDING"].includes(analysis.stage)
    ) {
      events.push({
        type: "STAGE",
        analysis
      });
    }
  }

  if (
    allowTrading &&
    analysis.stage === "SIGNAL" &&
    previousStage !== "SIGNAL" &&
    canOpenTrade(state, candle.time)
  ) {
    const signal = buildSignal(state, analysis, candle);

    if (signal) {
      state.signals.push(signal);
      state.signals = state.signals.slice(-CONFIG.MAX_SIGNALS);
      state.lastSignal = signal;

      const trade = createPaperTrade(signal);
      state.openTrades.push(trade);

      state.sessionTrades += 1;
      state.lastTradeOpenedAt = candle.time;

      events.push({
        type: "SIGNAL",
        signal
      });
    }
  }

  return { events, duplicate: false };
}

function analyze(state, candle, minuteOfDay) {
  const candles = state.candles;
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const atr14 = atr(candles, 14);
  const vwap = sessionVwap(candles, state.sessionDate);

  const recentVol = average(volumes.slice(-5));
  const priorVol = average(volumes.slice(-25, -5));
  const volumeRatio = priorVol > 0 ? recentVol / priorVol : 1;

  const bullishBreakout =
    state.orb.locked &&
    candle.close > state.orb.high;

  const bearishBreakout =
    state.orb.locked &&
    candle.close < state.orb.low;

  const bullishFvg = detectBullishFvg(candles);
  const bearishFvg = detectBearishFvg(candles);

  const candleRange = Math.max(candle.high - candle.low, 0.25);
  const body = Math.abs(candle.close - candle.open);
  const bodyRatio = body / candleRange;

  const bullishBody =
    candle.close > candle.open &&
    bodyRatio >= 0.55;

  const bearishBody =
    candle.close < candle.open &&
    bodyRatio >= 0.55;

  const longBreakdown = {
    orbClose: bullishBreakout ? 30 : 0,
    fvg: bullishFvg ? 20 : 0,
    trend: ema9 > ema21 ? 15 : 0,
    vwap: candle.close > vwap ? 15 : 0,
    volume: volumeRatio >= 1.20 ? 10 : 0,
    momentum: bullishBody ? 10 : 0
  };

  const shortBreakdown = {
    orbClose: bearishBreakout ? 30 : 0,
    fvg: bearishFvg ? 20 : 0,
    trend: ema9 < ema21 ? 15 : 0,
    vwap: candle.close < vwap ? 15 : 0,
    volume: volumeRatio >= 1.20 ? 10 : 0,
    momentum: bearishBody ? 10 : 0
  };

  const longScore = sumBreakdown(longBreakdown);
  const shortScore = sumBreakdown(shortBreakdown);

  const score = Math.max(longScore, shortScore);

  const bias =
    longScore > shortScore
      ? "LONG"
      : shortScore > longScore
      ? "SHORT"
      : "NEUTRAL";

  let stage = "NORMAL";

  if (
    minuteOfDay >= CONFIG.ORB_START_MINUTE &&
    minuteOfDay < CONFIG.ORB_END_MINUTE
  ) {
    stage = "ORB_FORMING";
  } else if (state.orb.locked) {
    if (score >= CONFIG.SIGNAL_THRESHOLD) {
      stage = "SIGNAL";
    } else if (score >= 60) {
      stage = "BUILDING";
    } else if (score >= 40) {
      stage = "WATCH";
    }
  }

  return {
    timestamp: candle.time,
    sessionDate: state.sessionDate,
    price: candle.close,
    stage,
    bias,
    score,
    longScore,
    shortScore,
    longBreakdown,
    shortBreakdown,

    orbHigh: state.orb.high,
    orbLow: state.orb.low,
    orbLocked: state.orb.locked,

    bullishBreakout,
    bearishBreakout,
    bullishFvg,
    bearishFvg,

    ema9,
    ema21,
    vwap,
    atr14,
    volumeRatio,
    bodyRatio
  };
}

function canOpenTrade(state, now) {
  if (state.openTrades.length >= CONFIG.MAX_OPEN_TRADES) {
    return false;
  }

  if (state.sessionTrades >= CONFIG.MAX_TRADES_PER_SESSION) {
    return false;
  }

  if (state.sessionRealizedPnl <= -CONFIG.DAILY_LOSS_LIMIT_USD) {
    return false;
  }

  if (state.lastTradeOpenedAt) {
    const elapsed = now - state.lastTradeOpenedAt;
    if (elapsed < CONFIG.COOLDOWN_MINUTES * 60 * 1000) {
      return false;
    }
  }

  return true;
}

function buildSignal(state, analysis, candle) {
  if (!["LONG", "SHORT"].includes(analysis.bias)) {
    return null;
  }

  // 1 contract NQ = $20/point.
  // Risk cap $500 => stop distance cannot exceed 25 points.
  const maxStopPoints =
    CONFIG.MAX_RISK_USD /
    (CONFIG.POINT_VALUE * CONFIG.CONTRACTS);

  const atrBased = Math.max(8, analysis.atr14 * 0.80);
  const stopDistance = Math.min(maxStopPoints, atrBased);

  if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
    return null;
  }

  const entry = candle.close;
  const side = analysis.bias;

  const stop =
    side === "LONG"
      ? entry - stopDistance
      : entry + stopDistance;

  const tp1 =
    side === "LONG"
      ? entry + stopDistance
      : entry - stopDistance;

  const tp2 =
    side === "LONG"
      ? entry + stopDistance * 2
      : entry - stopDistance * 2;

  const riskUsd =
    stopDistance *
    CONFIG.POINT_VALUE *
    CONFIG.CONTRACTS;

  return {
    id: crypto.randomUUID(),
    createdAt: candle.time,
    sessionDate: state.sessionDate,
    symbol: CONFIG.SYMBOL,
    side,
    score: analysis.score,
    entry,
    stop,
    tp1,
    tp2,
    stopDistance,
    riskUsd,
    pointValue: CONFIG.POINT_VALUE,
    contracts: CONFIG.CONTRACTS,
    orbHigh: analysis.orbHigh,
    orbLow: analysis.orbLow,
    atr14: analysis.atr14,
    vwap: analysis.vwap,
    ema9: analysis.ema9,
    ema21: analysis.ema21,
    result: "OPEN"
  };
}

function createPaperTrade(signal) {
  assertPaperOnly();

  return {
    ...signal,
    initialStop: signal.stop,
    currentStop: signal.stop,
    tp1Hit: false,
    breakevenActivated: false,
    status: "OPEN",
    openedAt: signal.createdAt
  };
}

// ============================================================
// PAPER TRADE MANAGEMENT USING CANDLE HIGH/LOW
// Conservative rule: if stop and target are both touched in one
// candle and order cannot be known, assume STOP occurred first.
// ============================================================

function manageOpenTrades(state, candle, minuteOfDay) {
  const events = [];

  for (const trade of state.openTrades) {
    if (trade.status !== "OPEN") {
      continue;
    }

    // Forced end-of-day exit.
    if (minuteOfDay >= CONFIG.FORCE_EXIT_MINUTE) {
      closeTrade(state, trade, candle.close, "TIME_EXIT", candle.time);
      events.push({ type: "CLOSED", trade: { ...trade } });
      continue;
    }

    if (trade.side === "LONG") {
      const stopTouched = candle.low <= trade.currentStop;
      const tp1Touched = candle.high >= trade.tp1;
      const tp2Touched = candle.high >= trade.tp2;

      // Conservative ambiguity handling.
      if (stopTouched) {
        const outcome = trade.breakevenActivated ? "BREAKEVEN" : "LOSS";
        closeTrade(state, trade, trade.currentStop, outcome, candle.time);
        events.push({ type: "CLOSED", trade: { ...trade } });
        continue;
      }

      if (!trade.tp1Hit && tp1Touched) {
        trade.tp1Hit = true;
        trade.breakevenActivated = true;
        trade.currentStop = trade.entry;
        events.push({ type: "TP1", trade: { ...trade } });
      }

      if (tp2Touched) {
        closeTrade(state, trade, trade.tp2, "WIN", candle.time);
        events.push({ type: "CLOSED", trade: { ...trade } });
      }
    } else {
      const stopTouched = candle.high >= trade.currentStop;
      const tp1Touched = candle.low <= trade.tp1;
      const tp2Touched = candle.low <= trade.tp2;

      if (stopTouched) {
        const outcome = trade.breakevenActivated ? "BREAKEVEN" : "LOSS";
        closeTrade(state, trade, trade.currentStop, outcome, candle.time);
        events.push({ type: "CLOSED", trade: { ...trade } });
        continue;
      }

      if (!trade.tp1Hit && tp1Touched) {
        trade.tp1Hit = true;
        trade.breakevenActivated = true;
        trade.currentStop = trade.entry;
        events.push({ type: "TP1", trade: { ...trade } });
      }

      if (tp2Touched) {
        closeTrade(state, trade, trade.tp2, "WIN", candle.time);
        events.push({ type: "CLOSED", trade: { ...trade } });
      }
    }
  }

  state.openTrades = state.openTrades.filter((t) => t.status === "OPEN");
  return events;
}

function closeTrade(state, trade, exit, outcome, closedAt) {
  const points =
    trade.side === "LONG"
      ? exit - trade.entry
      : trade.entry - exit;

  const pnl =
    points *
    CONFIG.POINT_VALUE *
    CONFIG.CONTRACTS;

  trade.exit = exit;
  trade.points = points;
  trade.pnl = pnl;
  trade.status = outcome;
  trade.closedAt = closedAt;

  state.balance += pnl;
  state.sessionRealizedPnl += pnl;

  state.closedTrades.push({ ...trade });
  state.closedTrades = state.closedTrades.slice(-CONFIG.MAX_CLOSED_TRADES);
}

// ============================================================
// TELEGRAM
// ============================================================

async function handleTelegram(request, env) {
  const update = await request.json();
  const message = update.message || update.edited_message;

  if (!message) {
    return json({ ok: true });
  }

  const chatId = message.chat.id;
  const raw = String(message.text || "").trim();
  const command = (raw.split(/\s+/)[0] || "").toLowerCase().split("@")[0];

  const state = await getState(env);

  if (command === "/start") {
    state.active = true;
    state.chatId = chatId;
    await saveState(env, state);

    await sendTelegram(
      env,
      chatId,
      [
        "👹 NQ RADAR V1 ACTIVADO 🟢",
        "",
        "Modo: PAPER TRADING ONLY",
        "Instrumento simulado: NQ",
        "NQ: $20 por punto / contrato",
        "Fuente: TradingView 1m",
        "ORB: 09:30–09:45 ET",
        "Máx trades/sesión: 2",
        "Máx riesgo/trade: $500",
        "",
        "El radar NO necesita que Telegram ni tu PC estén abiertos una vez que TradingView Alert + Worker estén activos.",
        "",
        "Comandos:",
        "/status",
        "/scan",
        "/why",
        "/stats",
        "/last",
        "/testsignal",
        "/stop"
      ].join("\n")
    );

    return json({ ok: true });
  }

  if (command === "/stop") {
    state.active = false;
    state.chatId = chatId;
    await saveState(env, state);

    await sendTelegram(
      env,
      chatId,
      "🛑 NQ RADAR DETENIDO 🔴\n\nEl feed puede seguir llegando, pero no abrirá ni gestionará nuevos paper trades hasta /start."
    );

    return json({ ok: true });
  }

  if (command === "/status") {
    await sendTelegram(env, chatId, formatStatus(state));
    return json({ ok: true });
  }

  if (command === "/scan") {
    await sendTelegram(
      env,
      chatId,
      state.lastAnalysis
        ? formatScan(state.lastAnalysis)
        : "📡 Todavía no he recibido ninguna vela de TradingView."
    );

    return json({ ok: true });
  }

  if (command === "/why") {
    await sendTelegram(
      env,
      chatId,
      state.lastAnalysis
        ? formatWhy(state.lastAnalysis)
        : "🧠 Todavía no hay análisis. Primero debe llegar el feed de TradingView."
    );

    return json({ ok: true });
  }

  if (command === "/stats") {
    await sendTelegram(env, chatId, formatStats(state));
    return json({ ok: true });
  }

  if (command === "/last") {
    await sendTelegram(
      env,
      chatId,
      state.lastSignal
        ? formatSignal(state.lastSignal, false)
        : "📭 Todavía no hay señal NQ confirmada."
    );

    return json({ ok: true });
  }

  if (command === "/testsignal") {
    await sendTelegram(
      env,
      chatId,
      [
        "🧪 NQ RADAR — TEST SIGNAL",
        "━━━━━━━━━━━━━━━━",
        "🚨 LONG NQ — DEMO ONLY",
        "",
        "Entry: 28000.00",
        "SL: 27980.00",
        "TP1: 28020.00",
        "TP2: 28040.00",
        "",
        "⚠️ DEMO — NO CUENTA EN STATS",
        "✅ Telegram pipeline funcionando."
      ].join("\n")
    );

    return json({ ok: true });
  }

  await sendTelegram(
    env,
    chatId,
    [
      "👹 NQ RADAR V1",
      "",
      "/start — activar paper engine",
      "/stop — detener paper engine",
      "/status — estado general",
      "/scan — último análisis recibido",
      "/why — desglose del score",
      "/stats — resultados paper",
      "/last — última señal",
      "/testsignal — probar Telegram"
    ].join("\n")
  );

  return json({ ok: true });
}

async function sendEventToTelegram(env, chatId, event, state) {
  if (event.type === "ORB_LOCKED") {
    await sendTelegram(
      env,
      chatId,
      [
        "📦 NQ RADAR — OPENING RANGE LOCKED",
        "━━━━━━━━━━━━━━━━",
        `OR High: ${formatPrice(event.high)}`,
        `OR Low: ${formatPrice(event.low)}`,
        "",
        "Ahora el radar espera ruptura + confirmaciones."
      ].join("\n")
    );
    return;
  }

  if (event.type === "STAGE") {
    const a = event.analysis;

    await sendTelegram(
      env,
      chatId,
      [
        `${a.stage === "BUILDING" ? "⚠️" : "👀"} NQ RADAR — ${a.stage}`,
        "━━━━━━━━━━━━━━━━",
        `Price: ${formatPrice(a.price)}`,
        `Bias: ${a.bias}`,
        `Score: ${a.score}/100`,
        `OR High: ${formatMaybePrice(a.orbHigh)}`,
        `OR Low: ${formatMaybePrice(a.orbLow)}`,
        "",
        "No paper entry todavía."
      ].join("\n")
    );
    return;
  }

  if (event.type === "SIGNAL") {
    await sendTelegram(env, chatId, formatSignal(event.signal, true));
    return;
  }

  if (event.type === "TP1") {
    const t = event.trade;

    await sendTelegram(
      env,
      chatId,
      [
        "🥇 NQ RADAR — TP1 HIT",
        "━━━━━━━━━━━━━━━━",
        `${t.side} NQ`,
        `Entry: ${formatPrice(t.entry)}`,
        `TP1: ${formatPrice(t.tp1)}`,
        "",
        "🛡️ Paper stop movido a BREAKEVEN.",
        `Nuevo stop: ${formatPrice(t.currentStop)}`,
        "Se mantiene buscando TP2."
      ].join("\n")
    );
    return;
  }

  if (event.type === "CLOSED") {
    const t = event.trade;
    const icon =
      t.status === "WIN"
        ? "✅"
        : t.status === "BREAKEVEN"
        ? "🟨"
        : t.pnl >= 0
        ? "✅"
        : "❌";

    await sendTelegram(
      env,
      chatId,
      [
        `${icon} NQ RADAR — PAPER TRADE CLOSED`,
        "━━━━━━━━━━━━━━━━",
        `Result: ${t.status}`,
        `Side: ${t.side}`,
        `Entry: ${formatPrice(t.entry)}`,
        `Exit: ${formatPrice(t.exit)}`,
        `Points: ${signed(t.points)}`,
        `P&L: ${money(t.pnl)}`,
        "",
        `Balance: ${money(state.balance)}`,
        `Session P&L: ${money(state.sessionRealizedPnl)}`
      ].join("\n")
    );
  }
}

// ============================================================
// FORMATTERS
// ============================================================

function formatScan(a) {
  return [
    "👹 NQ RADAR — LIVE STATE",
    "━━━━━━━━━━━━━━━━",
    `Price: ${formatPrice(a.price)}`,
    "",
    `📈 Long: ${a.longScore}/100`,
    `📉 Short: ${a.shortScore}/100`,
    "",
    `State: ${stageEmoji(a.stage)} ${a.stage}`,
    `Bias: ${a.bias}`,
    `ORB locked: ${a.orbLocked ? "YES" : "NO"}`,
    `OR High: ${formatMaybePrice(a.orbHigh)}`,
    `OR Low: ${formatMaybePrice(a.orbLow)}`,
    "",
    `EMA9: ${formatPrice(a.ema9)}`,
    `EMA21: ${formatPrice(a.ema21)}`,
    `VWAP: ${formatPrice(a.vwap)}`,
    `ATR14: ${a.atr14.toFixed(2)} pts`,
    `Volume ratio: ${a.volumeRatio.toFixed(2)}x`,
    `Bull FVG: ${a.bullishFvg ? "YES" : "NO"}`,
    `Bear FVG: ${a.bearishFvg ? "YES" : "NO"}`
  ].join("\n");
}

function formatWhy(a) {
  const side = a.bias === "SHORT" ? "SHORT" : "LONG";
  const b = side === "SHORT" ? a.shortBreakdown : a.longBreakdown;

  return [
    "🧠 NQ RADAR — WHY?",
    "━━━━━━━━━━━━━━━━",
    `${side} SCORE: ${a.score}/100`,
    "",
    factor("ORB close breakout", b.orbClose, 30),
    factor("1m FVG", b.fvg, 20),
    factor("EMA trend", b.trend, 15),
    factor("VWAP", b.vwap, 15),
    factor("Volume", b.volume, 10),
    factor("Momentum candle", b.momentum, 10),
    "",
    `${stageEmoji(a.stage)} State: ${a.stage}`,
    `Bias: ${a.bias}`,
    "",
    a.stage === "SIGNAL"
      ? "🚨 Signal threshold reached."
      : "No confirmed NQ entry yet."
  ].join("\n");
}

function formatSignal(signal, opened) {
  const icon = signal.side === "LONG" ? "🟢" : "🔴";

  return [
    "🚨 NQ RADAR — CONFIRMED SIGNAL",
    "━━━━━━━━━━━━━━━━",
    `${icon} ${signal.side} NQ`,
    "",
    `Score: ${signal.score}/100`,
    `Entry: ${formatPrice(signal.entry)}`,
    `SL: ${formatPrice(signal.stop)}`,
    `TP1: ${formatPrice(signal.tp1)}`,
    `TP2: ${formatPrice(signal.tp2)}`,
    "",
    `Risk: ${money(signal.riskUsd)}`,
    `Contracts: ${signal.contracts}`,
    `Value: $${signal.pointValue}/point`,
    "",
    opened ? "🧪 NQ PAPER TRADE OPENED AUTOMATICALLY" : "Última señal guardada."
  ].join("\n");
}

function formatStatus(state) {
  return [
    "👹 NQ RADAR STATUS",
    "━━━━━━━━━━━━━━━━",
    `Radar: ${state.active ? "🟢 ON" : "🔴 OFF"}`,
    `Version: ${CONFIG.VERSION}`,
    `Mode: PAPER TRADING ONLY`,
    "",
    `Session: ${state.sessionDate || "N/A"}`,
    `Balance: ${money(state.balance)}`,
    `Session P&L: ${money(state.sessionRealizedPnl)}`,
    `Trades this session: ${state.sessionTrades}/${CONFIG.MAX_TRADES_PER_SESSION}`,
    `Open trades: ${state.openTrades.length}`,
    `Closed trades: ${state.closedTrades.length}`,
    "",
    `ORB: ${state.orb.locked ? "LOCKED" : "NOT LOCKED"}`,
    `OR High: ${formatMaybePrice(state.orb.high)}`,
    `OR Low: ${formatMaybePrice(state.orb.low)}`,
    "",
    `Last feed: ${
      state.lastFeedAt ? new Date(state.lastFeedAt).toISOString() : "Never"
    }`,
    state.lastAnalysis
      ? `Current: ${state.lastAnalysis.stage} / ${state.lastAnalysis.bias} / ${state.lastAnalysis.score}`
      : "Current: waiting for TradingView feed"
  ].join("\n");
}

function formatStats(state) {
  const trades = state.closedTrades;

  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl < 0).length;
  const breakevens = trades.filter((t) => Math.abs(t.pnl) < 0.0001).length;

  const grossProfit = trades
    .filter((t) => t.pnl > 0)
    .reduce((sum, t) => sum + t.pnl, 0);

  const grossLoss = Math.abs(
    trades
      .filter((t) => t.pnl < 0)
      .reduce((sum, t) => sum + t.pnl, 0)
  );

  const pnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  const decisive = wins + losses;
  const winRate = decisive > 0 ? (wins / decisive) * 100 : 0;
  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
      ? Infinity
      : 0;

  return [
    "📊 NQ RADAR PAPER STATS",
    "━━━━━━━━━━━━━━━━",
    `Closed trades: ${trades.length}`,
    `Wins: ${wins}`,
    `Losses: ${losses}`,
    `Breakeven: ${breakevens}`,
    `Win rate (ex-BE): ${winRate.toFixed(1)}%`,
    `Profit factor: ${
      Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"
    }`,
    "",
    `Total P&L: ${money(pnl)}`,
    `Balance: ${money(state.balance)}`,
    `Session P&L: ${money(state.sessionRealizedPnl)}`,
    "",
    "⚠️ Paper results do not guarantee live performance."
  ].join("\n");
}

// ============================================================
// STATE
// ============================================================

function defaultState() {
  return {
    active: false,
    chatId: null,

    balance: CONFIG.STARTING_BALANCE,

    sessionDate: null,
    sessionTrades: 0,
    sessionRealizedPnl: 0,

    candles: [],

    orb: {
      high: null,
      low: null,
      candles: 0,
      locked: false,
      lockedAt: null
    },

    previousStage: "NORMAL",
    lastAnalysis: null,
    lastSignal: null,

    signals: [],
    openTrades: [],
    closedTrades: [],

    lastTradeOpenedAt: null,
    lastCandleTime: null,
    lastFeedAt: null
  };
}

function hydrateState(saved) {
  const state = {
    ...defaultState(),
    ...(saved || {})
  };

  state.orb = {
    ...defaultState().orb,
    ...(saved?.orb || {})
  };

  state.candles = Array.isArray(state.candles) ? state.candles : [];
  state.signals = Array.isArray(state.signals) ? state.signals : [];
  state.openTrades = Array.isArray(state.openTrades) ? state.openTrades : [];
  state.closedTrades = Array.isArray(state.closedTrades) ? state.closedTrades : [];

  if (!Number.isFinite(state.balance)) {
    state.balance = CONFIG.STARTING_BALANCE;
  }

  if (!(state.previousStage in STAGE_RANK)) {
    state.previousStage = "NORMAL";
  }

  return state;
}

function resetSession(state, sessionDate) {
  state.sessionDate = sessionDate;
  state.sessionTrades = 0;
  state.sessionRealizedPnl = 0;
  state.orb = {
    high: null,
    low: null,
    candles: 0,
    locked: false,
    lockedAt: null
  };
  state.previousStage = "NORMAL";
  state.lastAnalysis = null;
  state.lastTradeOpenedAt = null;

  // Safety: a new session should not inherit an old open paper position.
  if (state.openTrades.length) {
    state.openTrades = [];
  }
}

async function getState(env) {
  if (!env.NQ_STATE) {
    throw new Error("NQ_STATE KV binding missing");
  }

  const saved = await env.NQ_STATE.get("state", "json");
  return hydrateState(saved);
}

async function saveState(env, state) {
  if (!env.NQ_STATE) {
    throw new Error("NQ_STATE KV binding missing");
  }

  state.candles = state.candles.slice(-CONFIG.MAX_CANDLES);
  state.signals = state.signals.slice(-CONFIG.MAX_SIGNALS);
  state.closedTrades = state.closedTrades.slice(-CONFIG.MAX_CLOSED_TRADES);

  await env.NQ_STATE.put("state", JSON.stringify(state));
}

function publicStatus(state) {
  return {
    bot: "NQ RADAR",
    version: CONFIG.VERSION,
    active: state.active,
    mode: "PAPER TRADING ONLY",
    simulatedInstrument: CONFIG.SYMBOL,
    pointValue: CONFIG.POINT_VALUE,
    balance: state.balance,
    sessionDate: state.sessionDate,
    sessionPnl: state.sessionRealizedPnl,
    sessionTrades: state.sessionTrades,
    orb: state.orb,
    currentAnalysis: state.lastAnalysis,
    openTrades: state.openTrades.length,
    closedTrades: state.closedTrades.length,
    lastFeedAt: state.lastFeedAt
  };
}

// ============================================================
// INDICATORS
// ============================================================

function ema(values, length) {
  if (!values.length) return 0;

  const k = 2 / (length + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
}

function atr(candles, length) {
  if (candles.length < 2) return 10;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );

    trs.push(tr);
  }

  return average(trs.slice(-length)) || 10;
}

function sessionVwap(candles, sessionDate) {
  let pv = 0;
  let vol = 0;

  for (const c of candles) {
    const p = nyParts(c.time);
    const d = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;

    if (d !== sessionDate) continue;

    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }

  if (vol <= 0) {
    return candles.at(-1)?.close || 0;
  }

  return pv / vol;
}

function detectBullishFvg(candles) {
  if (candles.length < 3) return false;

  const a = candles[candles.length - 3];
  const c = candles[candles.length - 1];

  return c.low > a.high;
}

function detectBearishFvg(candles) {
  if (candles.length < 3) return false;

  const a = candles[candles.length - 3];
  const c = candles[candles.length - 1];

  return c.high < a.low;
}

function sumBreakdown(b) {
  return Object.values(b).reduce((sum, value) => sum + Number(value || 0), 0);
}

// ============================================================
// TIME — NEW YORK
// ============================================================

function nyParts(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

// ============================================================
// SECURITY / HELPERS
// ============================================================

function requireTelegramToken(env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN secret missing");
  }
}

function requireFeedSecret(env) {
  if (!env.NQ_FEED_SECRET) {
    throw new Error("NQ_FEED_SECRET secret missing");
  }
}

function secureEqual(a, b) {
  if (a.length !== b.length) return false;

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

function assertPaperOnly() {
  if (PAPER_TRADING_ONLY !== true) {
    throw new Error("REAL TRADING DISABLED — PAPER ONLY");
  }
}

function factor(name, points, max) {
  return `${points > 0 ? "✅" : "❌"} ${name}: +${points}/${max}`;
}

function stageEmoji(stage) {
  if (stage === "SIGNAL") return "🚨";
  if (stage === "BUILDING") return "⚠️";
  if (stage === "WATCH") return "👀";
  if (stage === "ORB_FORMING") return "📦";
  return "🟢";
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "N/A";
}

function formatMaybePrice(value) {
  return value == null ? "N/A" : formatPrice(value);
}

function signed(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

function money(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function safeError(error) {
  return String(error?.message || error || "Unknown error").slice(0, 300);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
