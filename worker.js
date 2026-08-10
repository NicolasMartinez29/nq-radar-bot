// FORCE DEPLOY — NQ RADAR V3 PREDATOR CLEAN PACKAGE
// Single canonical deployment package for nq-radar-bot.
// PAPER TRADING ONLY — no broker execution.


// ============================================================================
// 👹 NQ RADAR V3 PREDATOR — PAPER TRADING ONLY
// ============================================================================
// This Worker consumes CLOSED 1-minute NQ candles from TradingView, generates
// an EARLY PREDICTION before confirmation, then opens/manages PAPER NQ trades.
// No broker API. No real orders. Score is model strength, NOT probability.
// ============================================================================

const PAPER_TRADING_ONLY = true;

const CONFIG = {
  VERSION: "NQ RADAR V3 PREDATOR — NO FEED SECRET",
  SYMBOL: "NQ",
  POINT_VALUE: 20,
  CONTRACTS: 1,
  TICK_SIZE: 0.25,

  STARTING_BALANCE: 50000,
  MAX_RISK_USD: 500,
  DAILY_LOSS_LIMIT_USD: 1000,
  MAX_TRADES_PER_SESSION: 2,
  MAX_OPEN_TRADES: 1,
  COOLDOWN_MINUTES: 20,

  ENTRY_SLIPPAGE_POINTS: 0.25,
  EXIT_SLIPPAGE_POINTS: 0.25,
  SIMULATED_ROUND_TURN_FEES_USD: 6,

  FEED_START_MINUTE: 8 * 60,
  RTH_START_MINUTE: 9 * 60 + 30,
  ORB_END_MINUTE: 9 * 60 + 45,
  MORNING_END_MINUTE: 11 * 60 + 30,
  LUNCH_END_MINUTE: 13 * 60 + 30,
  NEW_ENTRY_CUTOFF_MINUTE: 15 * 60 + 30,
  FORCE_EXIT_MINUTE: 15 * 60 + 55,
  RTH_END_MINUTE: 16 * 60,

  WATCH_THRESHOLD: 45,
  PREDICTION_THRESHOLD: 65,
  BUILDING_THRESHOLD: 75,
  SIGNAL_THRESHOLD: 84,
  MIN_SIGNAL_PERSISTENCE_BARS: 2,
  PREDICTION_ALERT_COOLDOWN_MINUTES: 15,

  MIN_STOP_POINTS: 7,
  MAX_STOP_POINTS: 25,
  TP1_R: 1.0,
  TP2_R: 2.0,
  LOCK_TRIGGER_R: 1.50,
  LOCK_STOP_R: 0.50,
  TIME_STOP_MINUTES: 45,

  MAX_CANDLES: 1000,
  MAX_SIGNALS: 500,
  MAX_CLOSED_TRADES: 500,
  MAX_FORECASTS: 1000,
  MAX_EQUITY_POINTS: 1000,
  TOD_VOLUME_ALPHA: 0.10
};

const STAGE_RANK = {
  NORMAL: 0,
  ORB_FORMING: 1,
  WATCH: 2,
  PREDICTION: 3,
  BUILDING: 4,
  SIGNAL: 5
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
          feed: "TradingView CLOSED 1m candles",
          simulatedInstrument: "NQ",
          pointValue: CONFIG.POINT_VALUE,
          predictionThreshold: CONFIG.PREDICTION_THRESHOLD,
          signalThreshold: CONFIG.SIGNAL_THRESHOLD
        });
      }

      if (url.pathname === "/debug/version" && request.method === "GET") {
        return json({
          ok: true,
          version: CONFIG.VERSION,
          build: "V3-CLEAN-2026-08-10",
          paperTradingOnly: PAPER_TRADING_ONLY,
          telegramPath: "/telegram",
          feedPath: "/feed",
          setupPath: "/setup",
          selfTestPath: "/debug/selftest",
          pointValue: CONFIG.POINT_VALUE,
          contracts: CONFIG.CONTRACTS
        });
      }

      if (url.pathname === "/debug/selftest" && request.method === "GET") {
        return json(runSelfTest());
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
        return json(publicStatus(await getState(env)));
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("FETCH ERROR", safeError(error));
      return json({ ok: false, error: safeError(error), version: CONFIG.VERSION }, 500);
    }
  }
};

// ============================================================================
// TELEGRAM SEND
// ============================================================================

async function sendTelegram(env, chatId, text) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN secret missing");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        chat_id: chatId,
        text: String(text),
        disable_web_page_preview: true
      })
    }
  );

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      `Telegram sendMessage returned invalid response: HTTP ${response.status}`
    );
  }

  if (!response.ok || !result?.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${
        result?.description ||
        `HTTP ${response.status}`
      }`
    );
  }

  return result;
}
// ============================================================================
// TELEGRAM SETUP
// ============================================================================

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

  const setResult = await safeJson(setResponse);
  const infoResponse = await fetch(`${api}/getWebhookInfo`);
  const infoResult = await safeJson(infoResponse);
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

// ============================================================================
// TRADINGVIEW FEED
// ============================================================================

async function handleFeed(request, env) {
  const connectingIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "";

  const sourceIp = connectingIp.split(",")[0].trim();

  // This build intentionally uses NO NQ_FEED_SECRET.
  // Only TradingView webhook source IPs in the allowlist are accepted.
  if (!sourceIp || !TRADINGVIEW_WEBHOOK_IPS.has(sourceIp)) {
    return json(
      {
        ok: false,
        error: "Feed source IP not allowed"
      },
      403
    );
  }

  const payload = await request.json();

  const candle = normalizeCandle(payload);

  if (!candle) {
    return json(
      {
        ok: false,
        error: "Invalid candle payload"
      },
      400
    );
  }

  const state = await getState(env);
  const result = processCandle(state, candle, state.active);

  state.lastFeedIpRecognized = true;

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
    duplicate: result.duplicate,
    sessionDate: state.sessionDate,
    stage: state.lastAnalysis?.stage || "NORMAL",
    bias: state.lastAnalysis?.bias || "NEUTRAL",
    score: state.lastAnalysis?.score ?? 0,
    candidate: state.currentPrediction
      ? {
          side: state.currentPrediction.side,
          peakScore: state.currentPrediction.peakScore,
          qualifyingBars: state.currentPrediction.qualifyingBars
        }
      : null,
    openTrades: state.openTrades.length,
    tradingViewIpRecognized: true
  });
}

function normalizeCandle(payload) {
  const time = Number(payload?.time);
  const open = Number(payload?.open);
  const high = Number(payload?.high);
  const low = Number(payload?.low);
  const close = Number(payload?.close);
  const volume = Number(payload?.volume);

  if (![time, open, high, low, close, volume].every(Number.isFinite)) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || high < low) return null;

  return {
    time: time < 10_000_000_000 ? time * 1000 : time,
    open,
    high,
    low,
    close,
    volume: Math.max(0, volume),
    symbol: String(payload?.symbol || "NQ"),
    timeframe: String(payload?.timeframe || "1")
  };
}

// ============================================================================
// CORE CANDLE PIPELINE
// ============================================================================

function processCandle(state, candle, allowTrading) {
  const events = [];

  if (state.lastCandleTime && candle.time <= state.lastCandleTime) {
    return { events, duplicate: true };
  }

  state.lastCandleTime = candle.time;

  const et = nyParts(candle.time);
  const sessionDate = dateKey(et);
  const minuteOfDay = et.hour * 60 + et.minute;

  if (state.sessionDate !== sessionDate) {
    finalizePreviousSession(state);
    resetSession(state, sessionDate);
    events.push({ type: "SESSION_RESET", sessionDate });
  }

  state.candles.push(candle);
  state.candles = state.candles.slice(-CONFIG.MAX_CANDLES);

  if (minuteOfDay >= CONFIG.FEED_START_MINUTE && minuteOfDay < CONFIG.RTH_START_MINUTE) {
    if (state.premarket.open == null) state.premarket.open = candle.open;
    state.premarket.high = state.premarket.high == null
      ? candle.high
      : Math.max(state.premarket.high, candle.high);
    state.premarket.low = state.premarket.low == null
      ? candle.low
      : Math.min(state.premarket.low, candle.low);
    state.premarket.close = candle.close;
  }

  if (minuteOfDay >= CONFIG.RTH_START_MINUTE && minuteOfDay < CONFIG.RTH_END_MINUTE) {
    if (state.currentRth.open == null) state.currentRth.open = candle.open;
    state.currentRth.high = state.currentRth.high == null
      ? candle.high
      : Math.max(state.currentRth.high, candle.high);
    state.currentRth.low = state.currentRth.low == null
      ? candle.low
      : Math.min(state.currentRth.low, candle.low);
    state.currentRth.close = candle.close;
    state.currentRth.date = state.sessionDate;
  }

  if (minuteOfDay >= CONFIG.RTH_START_MINUTE && minuteOfDay < CONFIG.ORB_END_MINUTE) {
    state.orb.high = state.orb.high == null ? candle.high : Math.max(state.orb.high, candle.high);
    state.orb.low = state.orb.low == null ? candle.low : Math.min(state.orb.low, candle.low);
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
      low: state.orb.low,
      width: state.orb.high - state.orb.low
    });
  }

  updateForecastTrackers(state, candle);

  const previousAnalysis = state.lastAnalysis;
  const previousStage = state.previousStage || "NORMAL";
  const analysis = analyzeMarket(state, candle, minuteOfDay);

  state.lastAnalysis = analysis;
  state.lastFeedAt = Date.now();

  if (allowTrading) {
    events.push(...manageOpenTrades(state, candle, analysis, minuteOfDay));
  }

  const candidateResult = updatePredictionCandidate(
    state,
    analysis,
    candle,
    previousAnalysis
  );

  if (candidateResult.predictionEvent) {
    events.push(candidateResult.predictionEvent);
  }

  if (analysis.stage !== previousStage) {
    const movedUp = (STAGE_RANK[analysis.stage] ?? 0) > (STAGE_RANK[previousStage] ?? 0);
    state.previousStage = analysis.stage;

    if (movedUp && ["WATCH", "BUILDING"].includes(analysis.stage)) {
      events.push({ type: "STAGE", analysis });
    }
  }

  if (
    allowTrading &&
    analysis.stage === "SIGNAL" &&
    candidateResult.confirmed &&
    canOpenTrade(state, candle.time, minuteOfDay)
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

      state.currentPrediction.confirmedAt = candle.time;
      state.currentPrediction.confirmedSignalId = signal.id;

      addForecastTracker(state, {
        kind: "SIGNAL",
        id: signal.id,
        side: signal.side,
        timestamp: signal.timestamp,
        price: signal.rawEntry,
        score: signal.score
      });

      events.push({ type: "SIGNAL", signal });
    } else {
      events.push({
        type: "RISK_BLOCK",
        analysis,
        reason: "Required structure stop exceeds configured NQ risk window."
      });
    }
  }

  updateTodVolumeProfile(state, minuteOfDay, candle.volume);

  return { events, duplicate: false };
}

// ============================================================================
// ANALYSIS ENGINE
// ============================================================================

function analyzeMarket(state, candle, minuteOfDay) {
  const candles = state.candles;
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const price = candle.close;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const atr14 = atr(candles, 14);
  const atr50 = atr(candles, 50);
  const atrRegime = atr50 > 0 ? atr14 / atr50 : 1;
  const rsi14 = rsi(closes, 14);
  const dmi14 = dmi(candles, 14);
  const vwap = rthVwapForDate(candles, state.sessionDate);
  const vwapDistanceAtr = atr14 > 0 ? (price - vwap) / atr14 : 0;

  const fiveMinute = aggregateCandles(candles, 5);
  const fiveCloses = fiveMinute.map((c) => c.close);
  const ema5m8 = ema(fiveCloses, 8);
  const ema5m21 = ema(fiveCloses, 21);
  const fiveTrend = ema5m8 > ema5m21 ? "BULL" : ema5m8 < ema5m21 ? "BEAR" : "FLAT";

  const recentVolume = average(volumes.slice(-3));
  const baselineVolume = average(volumes.slice(-23, -3));
  const rollingVolumeRatio = baselineVolume > 0 ? recentVolume / baselineVolume : 1;

  const todProfile = state.todVolumeProfile[String(minuteOfDay)];
  const todAvg = Number(todProfile?.avg || 0);
  const todRelativeVolume = todAvg > 0 ? candle.volume / todAvg : rollingVolumeRatio;
  const effectiveVolumeRatio = Math.max(rollingVolumeRatio, todRelativeVolume);

  const candleRange = Math.max(candle.high - candle.low, CONFIG.TICK_SIZE);
  const body = Math.abs(candle.close - candle.open);
  const bodyRatio = body / candleRange;
  const closeLocation = (candle.close - candle.low) / candleRange;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWickRatio = upperWick / candleRange;
  const lowerWickRatio = lowerWick / candleRange;

  const bullishImpulse =
    candle.close > candle.open && bodyRatio >= 0.55 && closeLocation >= 0.72;

  const bearishImpulse =
    candle.close < candle.open && bodyRatio >= 0.55 && closeLocation <= 0.28;

  const bullishFvg = detectBullishFvg(candles);
  const bearishFvg = detectBearishFvg(candles);

  const breakoutBuffer = Math.max(CONFIG.TICK_SIZE * 2, atr14 * 0.08);

  const longCloseOutside = Boolean(
    state.orb.locked && price >= state.orb.high + breakoutBuffer
  );

  const shortCloseOutside = Boolean(
    state.orb.locked && price <= state.orb.low - breakoutBuffer
  );

  const longBreakoutDistanceAtr = state.orb.locked && atr14 > 0
    ? (price - state.orb.high) / atr14
    : 0;

  const shortBreakoutDistanceAtr = state.orb.locked && atr14 > 0
    ? (state.orb.low - price) / atr14
    : 0;

  const retest = detectOrbRetest(state, candles, atr14);

  const longObstacleDistance = nearestAboveDistance(price, [
    state.premarket.high,
    state.previousRth.high
  ]);

  const shortObstacleDistance = nearestBelowDistance(price, [
    state.premarket.low,
    state.previousRth.low
  ]);

  const longObstacleNear =
    Number.isFinite(longObstacleDistance) &&
    atr14 > 0 &&
    longObstacleDistance >= 0 &&
    longObstacleDistance < atr14 * 0.30;

  const shortObstacleNear =
    Number.isFinite(shortObstacleDistance) &&
    atr14 > 0 &&
    shortObstacleDistance >= 0 &&
    shortObstacleDistance < atr14 * 0.30;

  const lunch =
    minuteOfDay >= CONFIG.MORNING_END_MINUTE &&
    minuteOfDay < CONFIG.LUNCH_END_MINUTE;

  const validEntryWindow =
    minuteOfDay >= CONFIG.ORB_END_MINUTE &&
    minuteOfDay < CONFIG.NEW_ENTRY_CUTOFF_MINUTE;

  const lowVolatility = atrRegime < 0.72;
  const explosiveVolatility = atrRegime > 1.65;

  const orbWidth = state.orb.high != null && state.orb.low != null
    ? state.orb.high - state.orb.low
    : 0;

  const orbWidthAtr = atr14 > 0 ? orbWidth / atr14 : 0;
  const orbTooWide = state.orb.locked && orbWidthAtr > 8.5;

  const longOverextended = vwapDistanceAtr > 2.4 || longBreakoutDistanceAtr > 2.0;
  const shortOverextended = vwapDistanceAtr < -2.4 || shortBreakoutDistanceAtr > 2.0;

  // Positive factors sum to 100 before penalties.
  const longRaw = {
    orbClose: longCloseOutside ? 24 : 0,
    breakoutQuality:
      longCloseOutside && bullishImpulse && upperWickRatio <= 0.25
        ? 10
        : longCloseOutside && bodyRatio >= 0.45
        ? 5
        : 0,
    retest: retest.longReclaim ? 12 : 0,
    fiveMinute: fiveTrend === "BULL" ? 12 : 0,
    vwap: price > vwap && vwapDistanceAtr >= 0.05 ? 10 : 0,
    emaStructure:
      ema9 > ema21 && ema21 > ema50 ? 8 : ema9 > ema21 ? 4 : 0,
    trendStrength:
      dmi14.adx >= 20 && dmi14.plusDI > dmi14.minusDI
        ? 8
        : dmi14.adx >= 16 && dmi14.plusDI > dmi14.minusDI
        ? 4
        : 0,
    volume:
      effectiveVolumeRatio >= 1.35 ? 8 : effectiveVolumeRatio >= 1.15 ? 4 : 0,
    momentum:
      bullishImpulse && rsi14 >= 52 && rsi14 <= 78
        ? 5
        : rsi14 >= 52 && rsi14 <= 75
        ? 2
        : 0,
    fvg: bullishFvg ? 3 : 0
  };

  const shortRaw = {
    orbClose: shortCloseOutside ? 24 : 0,
    breakoutQuality:
      shortCloseOutside && bearishImpulse && lowerWickRatio <= 0.25
        ? 10
        : shortCloseOutside && bodyRatio >= 0.45
        ? 5
        : 0,
    retest: retest.shortReclaim ? 12 : 0,
    fiveMinute: fiveTrend === "BEAR" ? 12 : 0,
    vwap: price < vwap && vwapDistanceAtr <= -0.05 ? 10 : 0,
    emaStructure:
      ema9 < ema21 && ema21 < ema50 ? 8 : ema9 < ema21 ? 4 : 0,
    trendStrength:
      dmi14.adx >= 20 && dmi14.minusDI > dmi14.plusDI
        ? 8
        : dmi14.adx >= 16 && dmi14.minusDI > dmi14.plusDI
        ? 4
        : 0,
    volume:
      effectiveVolumeRatio >= 1.35 ? 8 : effectiveVolumeRatio >= 1.15 ? 4 : 0,
    momentum:
      bearishImpulse && rsi14 <= 48 && rsi14 >= 22
        ? 5
        : rsi14 <= 48 && rsi14 >= 25
        ? 2
        : 0,
    fvg: bearishFvg ? 3 : 0
  };

  const longPenalties = {
    outsideWindow: validEntryWindow ? 0 : 100,
    lunch: lunch ? 15 : 0,
    obstacle: longObstacleNear ? 10 : 0,
    overextended: longOverextended ? 12 : 0,
    lowVolatility: lowVolatility ? 8 : 0,
    rejectionWick: upperWickRatio >= 0.42 ? 10 : 0,
    wrongFiveMinute: fiveTrend === "BEAR" ? 15 : 0,
    orbTooWide: orbTooWide ? 8 : 0,
    extremeRsi: rsi14 > 82 ? 8 : 0
  };

  const shortPenalties = {
    outsideWindow: validEntryWindow ? 0 : 100,
    lunch: lunch ? 15 : 0,
    obstacle: shortObstacleNear ? 10 : 0,
    overextended: shortOverextended ? 12 : 0,
    lowVolatility: lowVolatility ? 8 : 0,
    rejectionWick: lowerWickRatio >= 0.42 ? 10 : 0,
    wrongFiveMinute: fiveTrend === "BULL" ? 15 : 0,
    orbTooWide: orbTooWide ? 8 : 0,
    extremeRsi: rsi14 < 18 ? 8 : 0
  };

  const longScore = clamp(sumObject(longRaw) - sumObject(longPenalties), 0, 100);
  const shortScore = clamp(sumObject(shortRaw) - sumObject(shortPenalties), 0, 100);
  const score = Math.max(longScore, shortScore);
  const bias = longScore > shortScore ? "LONG" : shortScore > longScore ? "SHORT" : "NEUTRAL";

  const activeRaw = bias === "SHORT" ? shortRaw : longRaw;
  const activePenalties = bias === "SHORT" ? shortPenalties : longPenalties;

  const hardGate = bias === "LONG"
    ? (
        longCloseOutside &&
        fiveTrend !== "BEAR" &&
        price > vwap &&
        !longOverextended &&
        validEntryWindow
      )
    : bias === "SHORT"
    ? (
        shortCloseOutside &&
        fiveTrend !== "BULL" &&
        price < vwap &&
        !shortOverextended &&
        validEntryWindow
      )
    : false;

  const confirmations = [
    activeRaw.retest > 0,
    activeRaw.trendStrength >= 4,
    activeRaw.volume >= 4,
    activeRaw.momentum >= 2,
    activeRaw.fvg > 0,
    activeRaw.emaStructure >= 4
  ].filter(Boolean).length;

  let stage = "NORMAL";

  if (minuteOfDay >= CONFIG.RTH_START_MINUTE && minuteOfDay < CONFIG.ORB_END_MINUTE) {
    stage = "ORB_FORMING";
  } else if (state.orb.locked) {
    if (score >= CONFIG.SIGNAL_THRESHOLD && hardGate && confirmations >= 4) {
      stage = "SIGNAL";
    } else if (score >= CONFIG.BUILDING_THRESHOLD) {
      stage = "BUILDING";
    } else if (score >= CONFIG.PREDICTION_THRESHOLD) {
      stage = "PREDICTION";
    } else if (score >= CONFIG.WATCH_THRESHOLD) {
      stage = "WATCH";
    }
  }

  const regime = !validEntryWindow
    ? "OUTSIDE_ENTRY_WINDOW"
    : lunch
    ? "LUNCH"
    : dmi14.adx >= 23 && fiveTrend !== "FLAT"
    ? "TRENDING"
    : dmi14.adx < 16
    ? "CHOPPY"
    : explosiveVolatility
    ? "EXPLOSIVE"
    : "MIXED";

  return {
    timestamp: candle.time,
    sessionDate: state.sessionDate,
    minuteOfDay,
    price,
    stage,
    bias,
    score,
    quality: qualitativeScore(score),
    longScore,
    shortScore,
    longRaw,
    shortRaw,
    longPenalties,
    shortPenalties,
    activeRaw,
    activePenalties,
    hardGate,
    confirmations,
    regime,

    orbHigh: state.orb.high,
    orbLow: state.orb.low,
    orbWidth,
    orbWidthAtr,
    orbLocked: state.orb.locked,

    premarketHigh: state.premarket.high,
    premarketLow: state.premarket.low,
    previousRthHigh: state.previousRth.high,
    previousRthLow: state.previousRth.low,
    previousRthClose: state.previousRth.close,

    breakoutBuffer,
    longCloseOutside,
    shortCloseOutside,
    longBreakoutDistanceAtr,
    shortBreakoutDistanceAtr,
    longRetest: retest.longReclaim,
    shortRetest: retest.shortReclaim,
    bullishFvg,
    bearishFvg,

    ema9,
    ema21,
    ema50,
    ema5m8,
    ema5m21,
    fiveTrend,
    atr14,
    atr50,
    atrRegime,
    rsi14,
    adx14: dmi14.adx,
    plusDI: dmi14.plusDI,
    minusDI: dmi14.minusDI,
    vwap,
    vwapDistanceAtr,
    rollingVolumeRatio,
    todRelativeVolume,
    effectiveVolumeRatio,
    bodyRatio,
    closeLocation,
    upperWickRatio,
    lowerWickRatio,
    bullishImpulse,
    bearishImpulse,
    lunch,
    validEntryWindow,
    lowVolatility,
    explosiveVolatility,
    longObstacleNear,
    shortObstacleNear,
    longOverextended,
    shortOverextended,
    orbTooWide
  };
}

// ============================================================================
// PREDICTION STATE MACHINE
// ============================================================================

function updatePredictionCandidate(state, analysis, candle, previousAnalysis) {
  let predictionEvent = null;
  let confirmed = false;

  const side = ["LONG", "SHORT"].includes(analysis.bias) ? analysis.bias : null;

  if (!side || analysis.score < 55 || !analysis.orbLocked) {
    state.currentPrediction = null;
    return { predictionEvent, confirmed };
  }

  if (!state.currentPrediction || state.currentPrediction.side !== side) {
    state.currentPrediction = {
      id: crypto.randomUUID(),
      side,
      startedAt: candle.time,
      startedPrice: candle.close,
      peakScore: analysis.score,
      lastScore: analysis.score,
      qualifyingBars: 0,
      predictionSentAt: null,
      confirmedAt: null,
      confirmedSignalId: null
    };
  }

  const candidate = state.currentPrediction;
  candidate.lastScore = analysis.score;
  candidate.peakScore = Math.max(candidate.peakScore, analysis.score);

  if (analysis.stage === "SIGNAL") {
    candidate.qualifyingBars += 1;
  } else if (analysis.stage !== "BUILDING") {
    candidate.qualifyingBars = 0;
  }

  const crossedPrediction =
    analysis.score >= CONFIG.PREDICTION_THRESHOLD &&
    (
      !previousAnalysis ||
      previousAnalysis.bias !== side ||
      previousAnalysis.score < CONFIG.PREDICTION_THRESHOLD
    );

  const cooldownOk =
    !state.lastPredictionAlertAt ||
    candle.time - state.lastPredictionAlertAt >=
      CONFIG.PREDICTION_ALERT_COOLDOWN_MINUTES * 60 * 1000;

  if (crossedPrediction && cooldownOk) {
    candidate.predictionSentAt = candle.time;
    state.lastPredictionAlertAt = candle.time;

    addForecastTracker(state, {
      kind: "PREDICTION",
      id: `PRED-${candidate.id}`,
      side,
      timestamp: candle.time,
      price: candle.close,
      score: analysis.score
    });

    predictionEvent = {
      type: "PREDICTION",
      analysis,
      candidate: { ...candidate }
    };
  }

  confirmed =
    analysis.stage === "SIGNAL" &&
    analysis.hardGate &&
    analysis.confirmations >= 4 &&
    candidate.qualifyingBars >= CONFIG.MIN_SIGNAL_PERSISTENCE_BARS &&
    !candidate.confirmedSignalId;

  return { predictionEvent, confirmed };
}

// ============================================================================
// SIGNAL / PAPER TRADE
// ============================================================================

function canOpenTrade(state, now, minuteOfDay) {
  if (minuteOfDay < CONFIG.ORB_END_MINUTE || minuteOfDay >= CONFIG.NEW_ENTRY_CUTOFF_MINUTE) {
    return false;
  }

  if (state.openTrades.length >= CONFIG.MAX_OPEN_TRADES) return false;
  if (state.sessionTrades >= CONFIG.MAX_TRADES_PER_SESSION) return false;
  if (state.sessionRealizedPnl <= -CONFIG.DAILY_LOSS_LIMIT_USD) return false;

  if (state.lastTradeOpenedAt) {
    const elapsed = now - state.lastTradeOpenedAt;
    if (elapsed < CONFIG.COOLDOWN_MINUTES * 60 * 1000) return false;
  }

  return true;
}

function buildSignal(state, analysis, candle) {
  const side = analysis.bias;
  if (!["LONG", "SHORT"].includes(side)) return null;

  const rawEntry = candle.close;
  const entry = side === "LONG"
    ? roundToTick(rawEntry + CONFIG.ENTRY_SLIPPAGE_POINTS)
    : roundToTick(rawEntry - CONFIG.ENTRY_SLIPPAGE_POINTS);

  const recent = state.candles.slice(-7);
  const recentSwingLow = Math.min(...recent.map((c) => c.low));
  const recentSwingHigh = Math.max(...recent.map((c) => c.high));
  const buffer = Math.max(CONFIG.TICK_SIZE * 2, analysis.atr14 * 0.10);

  let structureStop;
  if (side === "LONG") {
    const orbStop = analysis.orbHigh != null
      ? analysis.orbHigh - buffer
      : entry - Math.max(CONFIG.MIN_STOP_POINTS, analysis.atr14 * 0.85);
    structureStop = Math.min(recentSwingLow - CONFIG.TICK_SIZE, orbStop);
  } else {
    const orbStop = analysis.orbLow != null
      ? analysis.orbLow + buffer
      : entry + Math.max(CONFIG.MIN_STOP_POINTS, analysis.atr14 * 0.85);
    structureStop = Math.max(recentSwingHigh + CONFIG.TICK_SIZE, orbStop);
  }

  let distance = Math.abs(entry - structureStop);
  distance = Math.max(distance, CONFIG.MIN_STOP_POINTS);

  const maxStopByRisk = CONFIG.MAX_RISK_USD / (CONFIG.POINT_VALUE * CONFIG.CONTRACTS);
  const maxStop = Math.min(CONFIG.MAX_STOP_POINTS, maxStopByRisk);

  // If true structure needs too much risk, skip instead of using a fake tight stop.
  if (!Number.isFinite(distance) || distance > maxStop) return null;

  const stopDistance = roundToTick(distance);
  const stop = side === "LONG"
    ? roundToTick(entry - stopDistance)
    : roundToTick(entry + stopDistance);

  const tp1 = side === "LONG"
    ? roundToTick(entry + stopDistance * CONFIG.TP1_R)
    : roundToTick(entry - stopDistance * CONFIG.TP1_R);

  const tp2 = side === "LONG"
    ? roundToTick(entry + stopDistance * CONFIG.TP2_R)
    : roundToTick(entry - stopDistance * CONFIG.TP2_R);

  const riskUsd = stopDistance * CONFIG.POINT_VALUE * CONFIG.CONTRACTS;

  return {
    id: crypto.randomUUID(),
    timestamp: candle.time,
    sessionDate: state.sessionDate,
    symbol: CONFIG.SYMBOL,
    side,
    score: analysis.score,
    quality: analysis.quality,
    regime: analysis.regime,
    confirmations: analysis.confirmations,

    rawEntry,
    entry,
    stop,
    tp1,
    tp2,
    stopDistance,
    riskUsd,

    contracts: CONFIG.CONTRACTS,
    pointValue: CONFIG.POINT_VALUE,
    entrySlippagePoints: CONFIG.ENTRY_SLIPPAGE_POINTS,
    exitSlippagePoints: CONFIG.EXIT_SLIPPAGE_POINTS,
    modeledFeesUsd: CONFIG.SIMULATED_ROUND_TURN_FEES_USD,

    orbHigh: analysis.orbHigh,
    orbLow: analysis.orbLow,
    premarketHigh: analysis.premarketHigh,
    premarketLow: analysis.premarketLow,
    vwap: analysis.vwap,
    atr14: analysis.atr14,
    adx14: analysis.adx14,
    rsi14: analysis.rsi14,
    fiveTrend: analysis.fiveTrend,
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
    lockedProfit: false,
    bestPrice: signal.entry,
    worstPrice: signal.entry,
    mfePoints: 0,
    maePoints: 0,
    openedAt: signal.timestamp,
    status: "OPEN",
    exitReason: null
  };
}

// Conservative intrabar rule: if stop and target are both inside a 1m candle,
// assume the stop happened first. This deliberately avoids flattering results.
function manageOpenTrades(state, candle, analysis, minuteOfDay) {
  const events = [];

  for (const trade of state.openTrades) {
    if (trade.status !== "OPEN") continue;

    updateTradeExcursions(trade, candle);

    if (minuteOfDay >= CONFIG.FORCE_EXIT_MINUTE) {
      closeTrade(
        state,
        trade,
        adverseExitPrice(trade.side, candle.close),
        "TIME_EXIT",
        candle.time,
        "15:55 ET forced exit"
      );
      events.push({ type: "CLOSED", trade: { ...trade } });
      continue;
    }

    const failedLong =
      trade.side === "LONG" &&
      analysis.orbHigh != null &&
      candle.close < analysis.orbHigh &&
      analysis.shortScore >= 60;

    const failedShort =
      trade.side === "SHORT" &&
      analysis.orbLow != null &&
      candle.close > analysis.orbLow &&
      analysis.longScore >= 60;

    if (failedLong || failedShort) {
      closeTrade(
        state,
        trade,
        adverseExitPrice(trade.side, candle.close),
        "EARLY_EXIT",
        candle.time,
        "ORB failure + opposing model pressure"
      );
      events.push({ type: "CLOSED", trade: { ...trade } });
      continue;
    }

    const elapsedMinutes = (candle.time - trade.openedAt) / 60000;
    if (
      elapsedMinutes >= CONFIG.TIME_STOP_MINUTES &&
      trade.mfePoints < trade.stopDistance * 0.50
    ) {
      closeTrade(
        state,
        trade,
        adverseExitPrice(trade.side, candle.close),
        "TIME_STOP",
        candle.time,
        "No +0.5R progress inside time limit"
      );
      events.push({ type: "CLOSED", trade: { ...trade } });
      continue;
    }

    if (trade.side === "LONG") {
      const stopTouched = candle.low <= trade.currentStop;
      const tp1Touched = candle.high >= trade.tp1;
      const tp2Touched = candle.high >= trade.tp2;

      if (stopTouched) {
        const outcome = trade.currentStop > trade.entry
          ? "PROFIT_STOP"
          : trade.tp1Hit
          ? "BREAKEVEN"
          : "LOSS";

        closeTrade(
          state,
          trade,
          adverseExitPrice(trade.side, trade.currentStop),
          outcome,
          candle.time,
          "Stop touched"
        );
        events.push({ type: "CLOSED", trade: { ...trade } });
        continue;
      }

      if (!trade.tp1Hit && tp1Touched) {
        trade.tp1Hit = true;
        trade.currentStop = roundToTick(trade.entry);
        events.push({ type: "TP1", trade: { ...trade } });
      }

      const lockTrigger = trade.entry + trade.stopDistance * CONFIG.LOCK_TRIGGER_R;
      if (!trade.lockedProfit && candle.high >= lockTrigger) {
        trade.lockedProfit = true;
        trade.currentStop = roundToTick(
          trade.entry + trade.stopDistance * CONFIG.LOCK_STOP_R
        );
        events.push({ type: "LOCK_PROFIT", trade: { ...trade } });
      }

      if (tp2Touched) {
        closeTrade(
          state,
          trade,
          favorableExitPrice(trade.side, trade.tp2),
          "WIN",
          candle.time,
          "TP2 touched"
        );
        events.push({ type: "CLOSED", trade: { ...trade } });
      }
    } else {
      const stopTouched = candle.high >= trade.currentStop;
      const tp1Touched = candle.low <= trade.tp1;
      const tp2Touched = candle.low <= trade.tp2;

      if (stopTouched) {
        const outcome = trade.currentStop < trade.entry
          ? "PROFIT_STOP"
          : trade.tp1Hit
          ? "BREAKEVEN"
          : "LOSS";

        closeTrade(
          state,
          trade,
          adverseExitPrice(trade.side, trade.currentStop),
          outcome,
          candle.time,
          "Stop touched"
        );
        events.push({ type: "CLOSED", trade: { ...trade } });
        continue;
      }

      if (!trade.tp1Hit && tp1Touched) {
        trade.tp1Hit = true;
        trade.currentStop = roundToTick(trade.entry);
        events.push({ type: "TP1", trade: { ...trade } });
      }

      const lockTrigger = trade.entry - trade.stopDistance * CONFIG.LOCK_TRIGGER_R;
      if (!trade.lockedProfit && candle.low <= lockTrigger) {
        trade.lockedProfit = true;
        trade.currentStop = roundToTick(
          trade.entry - trade.stopDistance * CONFIG.LOCK_STOP_R
        );
        events.push({ type: "LOCK_PROFIT", trade: { ...trade } });
      }

      if (tp2Touched) {
        closeTrade(
          state,
          trade,
          favorableExitPrice(trade.side, trade.tp2),
          "WIN",
          candle.time,
          "TP2 touched"
        );
        events.push({ type: "CLOSED", trade: { ...trade } });
      }
    }
  }

  state.openTrades = state.openTrades.filter((t) => t.status === "OPEN");
  return events;
}

function updateTradeExcursions(trade, candle) {
  if (trade.side === "LONG") {
    trade.bestPrice = Math.max(trade.bestPrice, candle.high);
    trade.worstPrice = Math.min(trade.worstPrice, candle.low);
    trade.mfePoints = Math.max(trade.mfePoints, candle.high - trade.entry);
    trade.maePoints = Math.max(trade.maePoints, trade.entry - candle.low);
  } else {
    trade.bestPrice = Math.min(trade.bestPrice, candle.low);
    trade.worstPrice = Math.max(trade.worstPrice, candle.high);
    trade.mfePoints = Math.max(trade.mfePoints, trade.entry - candle.low);
    trade.maePoints = Math.max(trade.maePoints, candle.high - trade.entry);
  }
}

function closeTrade(state, trade, exit, status, closedAt, exitReason) {
  const points = trade.side === "LONG" ? exit - trade.entry : trade.entry - exit;
  const grossPnl = points * CONFIG.POINT_VALUE * CONFIG.CONTRACTS;
  const fees = CONFIG.SIMULATED_ROUND_TURN_FEES_USD;
  const netPnl = grossPnl - fees;

  trade.exit = roundToTick(exit);
  trade.points = points;
  trade.grossPnl = grossPnl;
  trade.fees = fees;
  trade.pnl = netPnl;
  trade.status = status;
  trade.closedAt = closedAt;
  trade.exitReason = exitReason;

  state.balance += netPnl;
  state.sessionRealizedPnl += netPnl;
  state.closedTrades.push({ ...trade });
  state.closedTrades = state.closedTrades.slice(-CONFIG.MAX_CLOSED_TRADES);

  updateEquityMetrics(state, closedAt);
}

function adverseExitPrice(side, reference) {
  return side === "LONG"
    ? roundToTick(reference - CONFIG.EXIT_SLIPPAGE_POINTS)
    : roundToTick(reference + CONFIG.EXIT_SLIPPAGE_POINTS);
}

function favorableExitPrice(side, reference) {
  return side === "LONG"
    ? roundToTick(reference - CONFIG.EXIT_SLIPPAGE_POINTS)
    : roundToTick(reference + CONFIG.EXIT_SLIPPAGE_POINTS);
}

// ============================================================================
// FORWARD PREDICTION VALIDATION
// ============================================================================

function addForecastTracker(state, data) {
  state.forecasts.push({
    kind: data.kind,
    id: data.id,
    side: data.side,
    timestamp: data.timestamp,
    price: data.price,
    score: data.score,
    maxFavorablePoints: 0,
    maxAdversePoints: 0,
    result5m: null,
    result15m: null,
    result30m: null,
    completed: false
  });

  state.forecasts = state.forecasts.slice(-CONFIG.MAX_FORECASTS);
}

function updateForecastTrackers(state, candle) {
  for (const f of state.forecasts) {
    if (f.completed) continue;

    const elapsed = (candle.time - f.timestamp) / 60000;
    if (elapsed < 0) continue;

    const favorable = f.side === "LONG"
      ? candle.high - f.price
      : f.price - candle.low;

    const adverse = f.side === "LONG"
      ? f.price - candle.low
      : candle.high - f.price;

    f.maxFavorablePoints = Math.max(f.maxFavorablePoints, favorable);
    f.maxAdversePoints = Math.max(f.maxAdversePoints, adverse);

    const directionalClose = f.side === "LONG"
      ? candle.close - f.price
      : f.price - candle.close;

    if (elapsed >= 5 && f.result5m == null) f.result5m = directionalClose;
    if (elapsed >= 15 && f.result15m == null) f.result15m = directionalClose;
    if (elapsed >= 30 && f.result30m == null) {
      f.result30m = directionalClose;
      f.completed = true;
    }
  }
}

// ============================================================================
// TELEGRAM COMMANDS
// ============================================================================

async function handleTelegram(request, env) {
  const update = await request.json();
  const message = update.message || update.edited_message;

  if (!message) return json({ ok: true });

  const chatId = message.chat.id;
  const raw = String(message.text || "").trim();
  const command = (raw.split(/\s+/)[0] || "").toLowerCase().split("@")[0];
  const state = await getState(env);

  if (command === "/start") {
    state.active = true;
    state.chatId = chatId;
    await saveState(env, state);

    await sendTelegram(env, chatId, [
      "👹 NQ RADAR V3 PREDATOR ACTIVADO 🟢",
      "",
      "PAPER TRADING ONLY",
      "Feed: TradingView CLOSED 1m candles",
      "Instrument: NQ ($20/point modeled)",
      "",
      `🧠 PRE-SIGNAL: ${CONFIG.PREDICTION_THRESHOLD}+`,
      `⚠️ BUILDING: ${CONFIG.BUILDING_THRESHOLD}+`,
      `🚨 CONFIRMED: ${CONFIG.SIGNAL_THRESHOLD}+ + hard gates`,
      `Persistence: ${CONFIG.MIN_SIGNAL_PERSISTENCE_BARS} strong bars`,
      "",
      "Brain:",
      "ORB + 1m/5m trend + VWAP + EMA + ADX/DMI",
      "+ RSI + ATR regime + FVG + volume + retest",
      "+ fake-breakout / obstacle / extension filters",
      "",
      `Paper balance: $${CONFIG.STARTING_BALANCE.toFixed(0)}`,
      `Max modeled risk: $${CONFIG.MAX_RISK_USD}/trade`,
      `Max trades/session: ${CONFIG.MAX_TRADES_PER_SESSION}`,
      "",
      "/status /scan /why /stats /forecast /last /testsignal /stop"
    ].join("\n"));

    return json({ ok: true });
  }

  if (command === "/stop") {
    state.active = false;
    state.chatId = chatId;
    await saveState(env, state);
    await sendTelegram(env, chatId, "🛑 NQ PREDATOR DETENIDO 🔴\n\nFeed can continue, but no new paper trades open while stopped.");
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
      state.lastAnalysis ? formatScan(state.lastAnalysis, state) : "📡 No TradingView candle received yet."
    );
    return json({ ok: true });
  }

  if (command === "/why") {
    await sendTelegram(
      env,
      chatId,
      state.lastAnalysis ? formatWhy(state.lastAnalysis) : "🧠 No analysis yet."
    );
    return json({ ok: true });
  }

  if (command === "/stats") {
    await sendTelegram(env, chatId, formatStats(state));
    return json({ ok: true });
  }

  if (command === "/forecast") {
    await sendTelegram(env, chatId, formatForecastStats(state));
    return json({ ok: true });
  }

  if (command === "/last") {
    await sendTelegram(
      env,
      chatId,
      state.lastSignal ? formatSignal(state.lastSignal, false) : "📭 No confirmed NQ signal yet."
    );
    return json({ ok: true });
  }

  if (command === "/testsignal") {
    await sendTelegram(env, chatId, [
      "🧪 NQ PREDATOR TEST",
      "━━━━━━━━━━━━━━━━",
      "🧠 EARLY PREDICTION LONG — DEMO",
      "Model score: 72/100",
      "Score is NOT probability.",
      "",
      "🚨 CONFIRMED PAPER SIGNAL — DEMO",
      "Entry: 28000.25",
      "SL: 27982.25",
      "TP1: 28018.25",
      "TP2: 28036.25",
      "",
      "⚠️ DEMO ONLY",
      "✅ Telegram pipeline working."
    ].join("\n"));
    return json({ ok: true });
  }

  await sendTelegram(env, chatId, [
    "👹 NQ RADAR V3 PREDATOR",
    "",
    "/start — activate paper engine",
    "/stop — stop new paper entries",
    "/status — health/state",
    "/scan — latest model state",
    "/why — score breakdown",
    "/stats — paper trade performance",
    "/forecast — 5/15/30m prediction validation",
    "/last — last confirmed signal",
    "/testsignal — Telegram test"
  ].join("\n"));

  return json({ ok: true });
}

// ============================================================================
// TELEGRAM EVENTS
// ============================================================================

async function sendEventToTelegram(env, chatId, event, state) {
  if (event.type === "ORB_LOCKED") {
    await sendTelegram(env, chatId, [
      "📦 NQ PREDATOR — ORB LOCKED",
      "━━━━━━━━━━━━━━━━",
      `OR High: ${formatPrice(event.high)}`,
      `OR Low: ${formatPrice(event.low)}`,
      `Width: ${event.width.toFixed(2)} pts`,
      "",
      "Now hunting breakout + follow-through."
    ].join("\n"));
    return;
  }

  if (event.type === "PREDICTION") {
    const a = event.analysis;
    const icon = a.bias === "LONG" ? "🟢" : "🔴";
    const trigger = a.bias === "LONG" ? a.orbHigh : a.orbLow;
    const invalidation = a.bias === "LONG"
      ? a.orbHigh - a.atr14 * 0.25
      : a.orbLow + a.atr14 * 0.25;

    await sendTelegram(env, chatId, [
      "🧠👹 NQ PREDATOR — EARLY PREDICTION",
      "━━━━━━━━━━━━━━━━",
      `${icon} BIAS: ${a.bias}`,
      `Model score: ${a.score}/100`,
      `Quality: ${a.quality}`,
      `Regime: ${a.regime}`,
      "",
      `Price: ${formatPrice(a.price)}`,
      `ORB trigger: ${formatPrice(trigger)}`,
      `Soft invalidation: ${formatPrice(invalidation)}`,
      "",
      `5m trend: ${a.fiveTrend}`,
      `VWAP: ${formatPrice(a.vwap)}`,
      `ADX: ${a.adx14.toFixed(1)}`,
      `RSI: ${a.rsi14.toFixed(1)}`,
      `Relative volume: ${a.effectiveVolumeRatio.toFixed(2)}x`,
      "",
      "⚠️ NOT AN ENTRY.",
      `Waiting for ${CONFIG.SIGNAL_THRESHOLD}+ + persistence.`,
      "Score is model strength, not win probability."
    ].join("\n"));
    return;
  }

  if (event.type === "STAGE") {
    const a = event.analysis;
    await sendTelegram(env, chatId, [
      `${a.stage === "BUILDING" ? "⚠️" : "👀"} NQ PREDATOR — ${a.stage}`,
      "━━━━━━━━━━━━━━━━",
      `Bias: ${a.bias}`,
      `Score: ${a.score}/100`,
      `Price: ${formatPrice(a.price)}`,
      `Regime: ${a.regime}`,
      "",
      "No confirmed paper entry yet."
    ].join("\n"));
    return;
  }

  if (event.type === "SIGNAL") {
    await sendTelegram(env, chatId, formatSignal(event.signal, true));
    return;
  }

  if (event.type === "RISK_BLOCK") {
    await sendTelegram(env, chatId, [
      "🧱 NQ PREDATOR — SIGNAL BLOCKED",
      "━━━━━━━━━━━━━━━━",
      `Bias: ${event.analysis.bias}`,
      `Score: ${event.analysis.score}/100`,
      `Reason: ${event.reason}`,
      "",
      "No paper trade opened."
    ].join("\n"));
    return;
  }

  if (event.type === "TP1") {
    const t = event.trade;
    await sendTelegram(env, chatId, [
      "🥇 NQ PREDATOR — TP1 HIT",
      "━━━━━━━━━━━━━━━━",
      `${t.side} NQ`,
      `Entry: ${formatPrice(t.entry)}`,
      `TP1: ${formatPrice(t.tp1)}`,
      "",
      "🛡️ Paper stop -> BREAKEVEN",
      `New stop: ${formatPrice(t.currentStop)}`,
      "Holding modeled trade for continuation."
    ].join("\n"));
    return;
  }

  if (event.type === "LOCK_PROFIT") {
    const t = event.trade;
    await sendTelegram(env, chatId, [
      "🔒 NQ PREDATOR — PROFIT LOCKED",
      "━━━━━━━━━━━━━━━━",
      `${t.side} NQ`,
      `Entry: ${formatPrice(t.entry)}`,
      `Protected stop: ${formatPrice(t.currentStop)}`,
      "",
      `Move reached +${CONFIG.LOCK_TRIGGER_R.toFixed(2)}R; modeled stop protects about +${CONFIG.LOCK_STOP_R.toFixed(2)}R.`
    ].join("\n"));
    return;
  }

  if (event.type === "CLOSED") {
    const t = event.trade;
    const icon = t.pnl > 0 ? "✅" : Math.abs(t.pnl) < 0.01 ? "🟨" : "❌";

    await sendTelegram(env, chatId, [
      `${icon} NQ PREDATOR — PAPER TRADE CLOSED`,
      "━━━━━━━━━━━━━━━━",
      `Result: ${t.status}`,
      `Reason: ${t.exitReason}`,
      `Side: ${t.side}`,
      "",
      `Entry: ${formatPrice(t.entry)}`,
      `Exit: ${formatPrice(t.exit)}`,
      `Points: ${signed(t.points)}`,
      `MFE: +${Math.max(0, t.mfePoints).toFixed(2)} pts`,
      `MAE: -${Math.max(0, t.maePoints).toFixed(2)} pts`,
      "",
      `Gross: ${money(t.grossPnl)}`,
      `Modeled fees: -$${Number(t.fees || 0).toFixed(2)}`,
      `Net P&L: ${money(t.pnl)}`,
      "",
      `Balance: ${money(state.balance)}`,
      `Session P&L: ${money(state.sessionRealizedPnl)}`
    ].join("\n"));
  }
}

// ============================================================================
// FORMATTERS
// ============================================================================

function formatScan(a, state) {
  return [
    "👹 NQ PREDATOR — LIVE MODEL",
    "━━━━━━━━━━━━━━━━",
    `Price: ${formatPrice(a.price)}`,
    "",
    `📈 LONG: ${a.longScore}/100`,
    `📉 SHORT: ${a.shortScore}/100`,
    `Strongest: ${a.bias}`,
    "",
    `State: ${stageEmoji(a.stage)} ${a.stage}`,
    `Quality: ${a.quality}`,
    `Regime: ${a.regime}`,
    `Hard gate: ${a.hardGate ? "PASS" : "FAIL"}`,
    `Confirmations: ${a.confirmations}/6`,
    "",
    `ORB H/L: ${formatMaybePrice(a.orbHigh)} / ${formatMaybePrice(a.orbLow)}`,
    `Premarket H/L: ${formatMaybePrice(a.premarketHigh)} / ${formatMaybePrice(a.premarketLow)}`,
    `Prior RTH H/L: ${formatMaybePrice(a.previousRthHigh)} / ${formatMaybePrice(a.previousRthLow)}`,
    "",
    `EMA 9/21/50: ${formatPrice(a.ema9)} / ${formatPrice(a.ema21)} / ${formatPrice(a.ema50)}`,
    `5m trend: ${a.fiveTrend}`,
    `VWAP: ${formatPrice(a.vwap)}`,
    `ADX: ${a.adx14.toFixed(1)}`,
    `RSI: ${a.rsi14.toFixed(1)}`,
    `ATR14: ${a.atr14.toFixed(2)} pts`,
    `Volume: ${a.effectiveVolumeRatio.toFixed(2)}x`,
    `Bull/Bear FVG: ${a.bullishFvg ? "Y" : "N"} / ${a.bearishFvg ? "Y" : "N"}`,
    `Long/Short retest: ${a.longRetest ? "Y" : "N"} / ${a.shortRetest ? "Y" : "N"}`,
    "",
    state.currentPrediction
      ? `Candidate: ${state.currentPrediction.side} | peak ${state.currentPrediction.peakScore}/100 | strong bars ${state.currentPrediction.qualifyingBars}`
      : "Candidate: none",
    "",
    "Score = model strength, NOT win probability."
  ].join("\n");
}

function formatWhy(a) {
  const side = a.bias === "SHORT" ? "SHORT" : "LONG";
  const raw = side === "SHORT" ? a.shortRaw : a.longRaw;
  const p = side === "SHORT" ? a.shortPenalties : a.longPenalties;

  return [
    "🧠 NQ PREDATOR — WHY?",
    "━━━━━━━━━━━━━━━━",
    `${side} MODEL SCORE: ${a.score}/100`,
    "",
    "POSITIVE",
    factor("ORB close", raw.orbClose, 24),
    factor("Breakout quality", raw.breakoutQuality, 10),
    factor("Retest/reclaim", raw.retest, 12),
    factor("5m alignment", raw.fiveMinute, 12),
    factor("VWAP", raw.vwap, 10),
    factor("EMA structure", raw.emaStructure, 8),
    factor("ADX/DMI", raw.trendStrength, 8),
    factor("Relative volume", raw.volume, 8),
    factor("RSI/impulse", raw.momentum, 5),
    factor("1m FVG", raw.fvg, 3),
    "",
    "PENALTIES",
    penaltyLine("Outside window", p.outsideWindow),
    penaltyLine("Lunch", p.lunch),
    penaltyLine("Nearby obstacle", p.obstacle),
    penaltyLine("Overextended", p.overextended),
    penaltyLine("Low volatility", p.lowVolatility),
    penaltyLine("Rejection wick", p.rejectionWick),
    penaltyLine("Wrong 5m trend", p.wrongFiveMinute),
    penaltyLine("Wide ORB", p.orbTooWide),
    penaltyLine("Extreme RSI", p.extremeRsi),
    "",
    `Hard gate: ${a.hardGate ? "✅ PASS" : "❌ FAIL"}`,
    `Confirmations: ${a.confirmations}/6`,
    `Regime: ${a.regime}`,
    "",
    a.stage === "SIGNAL" ? "🚨 Confirmation conditions present." : "Waiting. No confirmed entry.",
    "Score is not probability."
  ].join("\n");
}

function formatSignal(s, opened) {
  const icon = s.side === "LONG" ? "🟢" : "🔴";

  return [
    "🚨👹 NQ PREDATOR — CONFIRMED",
    "━━━━━━━━━━━━━━━━",
    `${icon} ${s.side} NQ`,
    "",
    `Model score: ${s.score}/100`,
    `Quality: ${s.quality}`,
    `Regime: ${s.regime}`,
    `Confirmations: ${s.confirmations}/6`,
    "",
    `Paper entry: ${formatPrice(s.entry)}`,
    `SL: ${formatPrice(s.stop)}`,
    `TP1: ${formatPrice(s.tp1)} (${CONFIG.TP1_R.toFixed(1)}R)`,
    `TP2: ${formatPrice(s.tp2)} (${CONFIG.TP2_R.toFixed(1)}R)`,
    "",
    `Modeled risk: $${s.riskUsd.toFixed(2)}`,
    `Contracts: ${s.contracts} NQ`,
    `Point value: $${s.pointValue}/pt`,
    "",
    `ATR: ${s.atr14.toFixed(2)} | ADX: ${s.adx14.toFixed(1)} | RSI: ${s.rsi14.toFixed(1)}`,
    `5m trend: ${s.fiveTrend}`,
    "",
    opened ? "🧪 PAPER TRADE OPENED AUTOMATICALLY" : "Last stored confirmed signal.",
    "⚠️ Not a guarantee or calibrated win probability."
  ].join("\n");
}

function formatStatus(state) {
  const a = state.lastAnalysis;

  return [
    "👹 NQ PREDATOR STATUS",
    "━━━━━━━━━━━━━━━━",
    `Radar: ${state.active ? "🟢 ON" : "🔴 OFF"}`,
    `Version: ${CONFIG.VERSION}`,
    "Mode: PAPER TRADING ONLY",
    "",
    `Session: ${state.sessionDate || "N/A"}`,
    `Balance: ${money(state.balance)}`,
    `Session P&L: ${money(state.sessionRealizedPnl)}`,
    `Trades: ${state.sessionTrades}/${CONFIG.MAX_TRADES_PER_SESSION}`,
    `Open: ${state.openTrades.length}`,
    `Closed: ${state.closedTrades.length}`,
    "",
    `ORB: ${state.orb.locked ? "LOCKED" : "NOT LOCKED"}`,
    `OR H/L: ${formatMaybePrice(state.orb.high)} / ${formatMaybePrice(state.orb.low)}`,
    a ? `Model: ${a.stage} | ${a.bias} | ${a.score}/100` : "Model: waiting for feed",
    state.currentPrediction
      ? `Prediction: ${state.currentPrediction.side} | peak ${state.currentPrediction.peakScore}/100`
      : "Prediction: none",
    "",
    `Last feed: ${state.lastFeedAt ? new Date(state.lastFeedAt).toISOString() : "Never"}`,
    `Max drawdown: -$${Math.abs(state.maxDrawdownUsd).toFixed(2)}`
  ].join("\n");
}

function formatStats(state) {
  const trades = state.closedTrades;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl < 0).length;
  const nearBe = trades.filter((t) => Math.abs(t.pnl) < 10).length;
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const totalNet = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const decisive = wins + losses;
  const winRate = decisive > 0 ? (wins / decisive) * 100 : 0;
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = trades.length ? totalNet / trades.length : 0;
  const avgWin = wins ? grossProfit / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;

  return [
    "📊👹 NQ PREDATOR PAPER STATS",
    "━━━━━━━━━━━━━━━━",
    `Closed trades: ${trades.length}`,
    `Wins: ${wins}`,
    `Losses: ${losses}`,
    `Near-BE (|P&L|<$10): ${nearBe}`,
    `Win rate (W/L): ${winRate.toFixed(1)}%`,
    `Profit factor: ${Number.isFinite(pf) ? pf.toFixed(2) : "∞"}`,
    "",
    `Avg win: ${money(avgWin)}`,
    `Avg loss: -$${avgLoss.toFixed(2)}`,
    `Expectancy/trade: ${money(expectancy)}`,
    "",
    `Total net P&L: ${money(totalNet)}`,
    `Balance: ${money(state.balance)}`,
    `Max drawdown: -$${Math.abs(state.maxDrawdownUsd).toFixed(2)}`,
    "",
    "Simulation includes modeled slippage + fees.",
    "⚠️ Paper performance does not guarantee live performance."
  ].join("\n");
}

function formatForecastStats(state) {
  const predictions = state.forecasts.filter((f) => f.kind === "PREDICTION");
  const signals = state.forecasts.filter((f) => f.kind === "SIGNAL");
  const p = summarizeForecastSet(predictions);
  const s = summarizeForecastSet(signals);

  return [
    "🔬 NQ PREDATOR — FORECAST VALIDATION",
    "━━━━━━━━━━━━━━━━",
    "",
    "EARLY PREDICTIONS",
    `Samples: ${predictions.length}`,
    `5m direction hit: ${percentOrNA(p.hit5, p.n5)}`,
    `15m direction hit: ${percentOrNA(p.hit15, p.n15)}`,
    `30m direction hit: ${percentOrNA(p.hit30, p.n30)}`,
    `Avg MFE: ${p.avgMfe.toFixed(2)} pts`,
    `Avg MAE: ${p.avgMae.toFixed(2)} pts`,
    "",
    "CONFIRMED SIGNALS",
    `Samples: ${signals.length}`,
    `5m direction hit: ${percentOrNA(s.hit5, s.n5)}`,
    `15m direction hit: ${percentOrNA(s.hit15, s.n15)}`,
    `30m direction hit: ${percentOrNA(s.hit30, s.n30)}`,
    `Avg MFE: ${s.avgMfe.toFixed(2)} pts`,
    `Avg MAE: ${s.avgMae.toFixed(2)} pts`,
    "",
    "This forward test tells us whether the 'prediction' actually has edge."
  ].join("\n");
}

function summarizeForecastSet(items) {
  let n5 = 0, n15 = 0, n30 = 0;
  let hit5 = 0, hit15 = 0, hit30 = 0;
  let mfe = 0, mae = 0;

  for (const f of items) {
    if (f.result5m != null) { n5 += 1; if (f.result5m > 0) hit5 += 1; }
    if (f.result15m != null) { n15 += 1; if (f.result15m > 0) hit15 += 1; }
    if (f.result30m != null) { n30 += 1; if (f.result30m > 0) hit30 += 1; }
    mfe += Number(f.maxFavorablePoints || 0);
    mae += Number(f.maxAdversePoints || 0);
  }

  return {
    n5, n15, n30, hit5, hit15, hit30,
    avgMfe: items.length ? mfe / items.length : 0,
    avgMae: items.length ? mae / items.length : 0
  };
}

// ============================================================================
// MARKET STRUCTURE HELPERS
// ============================================================================

function detectOrbRetest(state, candles, atr14) {
  if (!state.orb.locked || candles.length < 5) {
    return { longReclaim: false, shortReclaim: false };
  }

  const recent = candles.slice(-5);
  const tolerance = Math.max(CONFIG.TICK_SIZE * 2, atr14 * 0.12);
  let longReclaim = false;
  let shortReclaim = false;

  for (let i = 1; i < recent.length; i++) {
    const c = recent[i];

    if (
      c.low <= state.orb.high + tolerance &&
      c.close > state.orb.high &&
      c.close > c.open
    ) {
      longReclaim = true;
    }

    if (
      c.high >= state.orb.low - tolerance &&
      c.close < state.orb.low &&
      c.close < c.open
    ) {
      shortReclaim = true;
    }
  }

  return { longReclaim, shortReclaim };
}

function nearestAboveDistance(price, levels) {
  const distances = levels
    .filter((x) => Number.isFinite(Number(x)) && Number(x) > price)
    .map((x) => Number(x) - price);
  return distances.length ? Math.min(...distances) : Infinity;
}

function nearestBelowDistance(price, levels) {
  const distances = levels
    .filter((x) => Number.isFinite(Number(x)) && Number(x) < price)
    .map((x) => price - Number(x));
  return distances.length ? Math.min(...distances) : Infinity;
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

// ============================================================================
// INDICATORS
// ============================================================================

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
    const p = candles[i - 1];
    trs.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    ));
  }

  return average(trs.slice(-length)) || 10;
}

function rsi(closes, length) {
  if (closes.length < length + 1) return 50;
  const slice = closes.slice(-(length + 1));
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < slice.length; i++) {
    const change = slice[i] - slice[i - 1];
    if (change >= 0) gains += change;
    else losses += -change;
  }

  const avgGain = gains / length;
  const avgLoss = losses / length;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function dmi(candles, length) {
  if (candles.length < length + 2) {
    return { adx: 15, plusDI: 0, minusDI: 0 };
  }

  const tr = [];
  const plus = [];
  const minus = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;

    plus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }

  const trSum = sumArray(tr.slice(-length));
  const plusDI = trSum > 0 ? 100 * sumArray(plus.slice(-length)) / trSum : 0;
  const minusDI = trSum > 0 ? 100 * sumArray(minus.slice(-length)) / trSum : 0;

  const dx = [];
  const start = Math.max(length, tr.length - length * 2);

  for (let end = start; end <= tr.length; end++) {
    const t = sumArray(tr.slice(Math.max(0, end - length), end));
    if (t <= 0) continue;
    const pdi = 100 * sumArray(plus.slice(Math.max(0, end - length), end)) / t;
    const mdi = 100 * sumArray(minus.slice(Math.max(0, end - length), end)) / t;
    const denom = pdi + mdi;
    if (denom > 0) dx.push(100 * Math.abs(pdi - mdi) / denom);
  }

  return {
    adx: dx.length ? average(dx.slice(-length)) : 15,
    plusDI,
    minusDI
  };
}

function rthVwapForDate(candles, sessionDate) {
  let pv = 0;
  let vol = 0;

  for (const c of candles) {
    const p = nyParts(c.time);
    const minute = p.hour * 60 + p.minute;
    if (
      dateKey(p) !== sessionDate ||
      minute < CONFIG.RTH_START_MINUTE ||
      minute >= CONFIG.RTH_END_MINUTE
    ) continue;

    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }

  return vol > 0 ? pv / vol : candles.at(-1)?.close || 0;
}

function aggregateCandles(candles, minutes) {
  const buckets = new Map();

  for (const c of candles) {
    const p = nyParts(c.time);
    const totalMinute = p.hour * 60 + p.minute;
    const bucketMinute = Math.floor(totalMinute / minutes) * minutes;
    const key = `${dateKey(p)}-${bucketMinute}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      });
    } else {
      const b = buckets.get(key);
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume += c.volume;
    }
  }

  return Array.from(buckets.values());
}

function updateTodVolumeProfile(state, minuteOfDay, volume) {
  const key = String(minuteOfDay);
  const old = state.todVolumeProfile[key];

  if (!old) {
    state.todVolumeProfile[key] = { avg: volume, count: 1 };
    return;
  }

  old.avg = old.avg * (1 - CONFIG.TOD_VOLUME_ALPHA) + volume * CONFIG.TOD_VOLUME_ALPHA;
  old.count = Math.min(10000, Number(old.count || 0) + 1);
}

// ============================================================================
// STATE / KV
// ============================================================================

function defaultState() {
  return {
    active: false,
    chatId: null,

    balance: CONFIG.STARTING_BALANCE,
    highWaterBalance: CONFIG.STARTING_BALANCE,
    maxDrawdownUsd: 0,
    equityCurve: [],

    sessionDate: null,
    sessionTrades: 0,
    sessionRealizedPnl: 0,

    previousRth: { date: null, open: null, high: null, low: null, close: null },
    currentRth: { date: null, open: null, high: null, low: null, close: null },
    premarket: { open: null, high: null, low: null, close: null },
    orb: { high: null, low: null, candles: 0, locked: false, lockedAt: null },

    candles: [],
    todVolumeProfile: {},

    previousStage: "NORMAL",
    lastAnalysis: null,
    currentPrediction: null,
    lastPredictionAlertAt: null,

    lastSignal: null,
    signals: [],
    openTrades: [],
    closedTrades: [],
    forecasts: [],

    lastTradeOpenedAt: null,
    lastCandleTime: null,
    lastFeedAt: null
  };
}

function hydrateState(saved) {
  const base = defaultState();
  const state = {
    ...base,
    ...(saved || {}),
    previousRth: { ...base.previousRth, ...(saved?.previousRth || {}) },
    currentRth: { ...base.currentRth, ...(saved?.currentRth || {}) },
    premarket: { ...base.premarket, ...(saved?.premarket || {}) },
    orb: { ...base.orb, ...(saved?.orb || {}) }
  };

  for (const key of ["candles", "signals", "openTrades", "closedTrades", "forecasts", "equityCurve"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }

  if (!state.todVolumeProfile || typeof state.todVolumeProfile !== "object") {
    state.todVolumeProfile = {};
  }

  if (!Number.isFinite(state.balance)) state.balance = CONFIG.STARTING_BALANCE;
  if (!Number.isFinite(state.highWaterBalance)) state.highWaterBalance = state.balance;
  if (!Number.isFinite(state.maxDrawdownUsd)) state.maxDrawdownUsd = 0;
  if (!(state.previousStage in STAGE_RANK)) state.previousStage = "NORMAL";

  return state;
}

function finalizePreviousSession(state) {
  if (
    state.currentRth?.date &&
    Number.isFinite(state.currentRth.high) &&
    Number.isFinite(state.currentRth.low)
  ) {
    state.previousRth = { ...state.currentRth };
  }
}

function resetSession(state, sessionDate) {
  // Do not carry a paper position into a new date in this model.
  state.openTrades = [];
  state.sessionDate = sessionDate;
  state.sessionTrades = 0;
  state.sessionRealizedPnl = 0;
  state.currentRth = { date: sessionDate, open: null, high: null, low: null, close: null };
  state.premarket = { open: null, high: null, low: null, close: null };
  state.orb = { high: null, low: null, candles: 0, locked: false, lockedAt: null };
  state.previousStage = "NORMAL";
  state.lastAnalysis = null;
  state.currentPrediction = null;
  state.lastPredictionAlertAt = null;
  state.lastTradeOpenedAt = null;
}

async function getState(env) {
  if (!env.NQ_STATE) throw new Error("NQ_STATE KV binding missing");
  return hydrateState(await env.NQ_STATE.get("state", "json"));
}

async function saveState(env, state) {
  if (!env.NQ_STATE) throw new Error("NQ_STATE KV binding missing");

  state.candles = state.candles.slice(-CONFIG.MAX_CANDLES);
  state.signals = state.signals.slice(-CONFIG.MAX_SIGNALS);
  state.closedTrades = state.closedTrades.slice(-CONFIG.MAX_CLOSED_TRADES);
  state.forecasts = state.forecasts.slice(-CONFIG.MAX_FORECASTS);
  state.equityCurve = state.equityCurve.slice(-CONFIG.MAX_EQUITY_POINTS);

  await env.NQ_STATE.put("state", JSON.stringify(state));
}

function updateEquityMetrics(state, timestamp) {
  state.highWaterBalance = Math.max(state.highWaterBalance, state.balance);
  const drawdown = state.balance - state.highWaterBalance;
  state.maxDrawdownUsd = Math.min(state.maxDrawdownUsd, drawdown);
  state.equityCurve.push({ timestamp, balance: state.balance, drawdown });
}

function publicStatus(state) {
  return {
    bot: "NQ RADAR",
    version: CONFIG.VERSION,
    active: state.active,
    mode: "PAPER TRADING ONLY",
    balance: state.balance,
    maxDrawdownUsd: state.maxDrawdownUsd,
    sessionDate: state.sessionDate,
    sessionPnl: state.sessionRealizedPnl,
    sessionTrades: state.sessionTrades,
    orb: state.orb,
    premarket: state.premarket,
    previousRth: state.previousRth,
    currentAnalysis: state.lastAnalysis,
    currentPrediction: state.currentPrediction,
    openTrades: state.openTrades.length,
    closedTrades: state.closedTrades.length,
    forecasts: state.forecasts.length,
    lastFeedAt: state.lastFeedAt
  };
}

// ============================================================================
// SELF-TEST — plumbing only, NOT a backtest
// ============================================================================

function runSelfTest() {
  const state = defaultState();
  state.active = true;
  const events = [];
  const date = "2026-08-10";
  let price = 28000;

  // Premarket history so indicators/volume context have enough samples.
  for (let i = 0; i < 80; i++) {
    const hour = 8 + Math.floor(i / 60);
    const minute = i % 60;
    const drift = Math.sin(i / 7) * 0.75;
    const open = price;
    const close = price + drift;
    const c = {
      time: nyTimestamp(date, hour, minute),
      open,
      high: Math.max(open, close) + 1.25,
      low: Math.min(open, close) - 1.25,
      close,
      volume: 500 + (i % 10) * 20,
      symbol: "NQ",
      timeframe: "1"
    };
    const r = processCandle(state, c, true);
    events.push(...r.events.map((e) => e.type));
    price = close;
  }

  // Fill 09:20-09:29.
  for (let i = 0; i < 10; i++) {
    const open = price;
    const close = price + (i % 2 === 0 ? 0.5 : -0.25);
    const c = {
      time: nyTimestamp(date, 9, 20 + i),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 700 + i * 10,
      symbol: "NQ",
      timeframe: "1"
    };
    const r = processCandle(state, c, true);
    events.push(...r.events.map((e) => e.type));
    price = close;
  }

  // 15-minute opening range.
  for (let i = 0; i < 15; i++) {
    const open = price;
    const center = 28002 + Math.sin(i / 2) * 3.5;
    const close = center;
    const c = {
      time: nyTimestamp(date, 9, 30 + i),
      open,
      high: Math.max(open, close) + 1.5,
      low: Math.min(open, close) - 1.5,
      close,
      volume: 1500 + i * 35,
      symbol: "NQ",
      timeframe: "1"
    };
    const r = processCandle(state, c, true);
    events.push(...r.events.map((e) => e.type));
    price = close;
  }

  // Strong post-ORB push; includes one retest-ish candle then continuation.
  for (let i = 0; i < 18; i++) {
    const open = price;
    let close;
    let low;
    let high;

    if (i === 2 && state.orb.high != null) {
      close = state.orb.high + 2.5;
      low = state.orb.high - 0.5;
      high = close + 2;
    } else {
      close = price + 4.25;
      low = open - 0.75;
      high = close + 1.5;
    }

    const c = {
      time: nyTimestamp(date, 9, 45 + i),
      open,
      high,
      low,
      close,
      volume: 2600 + i * 180,
      symbol: "NQ",
      timeframe: "1"
    };

    const r = processCandle(state, c, true);
    events.push(...r.events.map((e) => e.type));
    price = close;
  }

  return {
    ok: true,
    note: "Synthetic state-machine test only; not profitability evidence.",
    version: CONFIG.VERSION,
    orb: state.orb,
    lastAnalysis: state.lastAnalysis
      ? {
          stage: state.lastAnalysis.stage,
          bias: state.lastAnalysis.bias,
          score: state.lastAnalysis.score,
          hardGate: state.lastAnalysis.hardGate,
          confirmations: state.lastAnalysis.confirmations
        }
      : null,
    currentPrediction: state.currentPrediction,
    openTrades: state.openTrades.length,
    closedTrades: state.closedTrades.length,
    events
  };
}

// ============================================================================
// GENERIC HELPERS
// ============================================================================

function requireTelegramToken(env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN secret missing");
}



function assertPaperOnly() {
  if (PAPER_TRADING_ONLY !== true) {
    throw new Error("REAL TRADING DISABLED — PAPER TRADING ONLY");
  }
}

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

function nyTimestamp(dateString, hour, minute) {
  const [year, month, day] = dateString.split("-").map(Number);
  // The self-test date is in US daylight saving time (UTC-4).
  return Date.UTC(year, month - 1, day, hour + 4, minute, 0, 0);
}

function dateKey(p) {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function average(values) {
  return values.length ? sumArray(values) / values.length : 0;
}

function sumArray(values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0);
}

function sumObject(object) {
  return sumArray(Object.values(object));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundToTick(value) {
  return Math.round(value / CONFIG.TICK_SIZE) * CONFIG.TICK_SIZE;
}

function factor(name, points, maxPoints) {
  return `${points > 0 ? "✅" : "❌"} ${name}: +${points}/${maxPoints}`;
}

function penaltyLine(name, points) {
  return `${points > 0 ? "⚠️" : "✅"} ${name}: ${points > 0 ? "-" : ""}${points}`;
}

function qualitativeScore(score) {
  if (score >= 90) return "A+ / EXTREME CONFLUENCE";
  if (score >= 84) return "A / CONFIRMED";
  if (score >= 75) return "B+ / BUILDING";
  if (score >= 65) return "B / EARLY PREDICTION";
  if (score >= 45) return "C / WATCH";
  return "NO SETUP";
}

function stageEmoji(stage) {
  if (stage === "SIGNAL") return "🚨";
  if (stage === "BUILDING") return "⚠️";
  if (stage === "PREDICTION") return "🧠";
  if (stage === "WATCH") return "👀";
  if (stage === "ORB_FORMING") return "📦";
  return "🟢";
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

function percentOrNA(hits, count) {
  return count > 0 ? `${((hits / count) * 100).toFixed(1)}% (${hits}/${count})` : "N/A";
}

function safeError(error) {
  return String(error?.message || error || "Unknown error").slice(0, 400);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { ok: false, description: `HTTP ${response.status}` };
  }
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
