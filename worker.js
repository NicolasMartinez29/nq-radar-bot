// NQ RADAR V3 PREDATOR — PAPER TRADING ONLY
// Single-file Cloudflare Worker. No broker API. No real orders.

const PAPER_ONLY = true;

const TRADINGVIEW_IPS = new Set([
  "52.89.214.238",
  "34.212.75.30",
  "54.218.53.128",
  "52.32.178.7"
]);

const C = {
  VERSION: "NQ RADAR V3 PREDATOR",
  SYMBOL: "NQ",

  // ==========================================================
  // NQ CONTRACT
  // ==========================================================
  POINT_VALUE: 20,
  TICK: 0.25,
  CONTRACTS: 1,

  // ==========================================================
  // PAPER ACCOUNT
  // ==========================================================
  START_BALANCE: 50000,

  MAX_RISK_USD: 500,
  DAILY_LOSS_LIMIT_USD: 1000,

  MAX_TRADES_DAY: 2,
  MAX_OPEN: 1,

  COOLDOWN_MIN: 20,

  // ==========================================================
  // SIGNAL ENGINE
  // ==========================================================
  PRE_SIGNAL: 66,
  BUILDING: 76,
  SIGNAL: 85,

  PERSIST_BARS: 2,

  // ==========================================================
  // SIMULATION
  // ==========================================================
  ENTRY_SLIPPAGE: 0.25,
  EXIT_SLIPPAGE: 0.25,
  FEES: 6,

  // ==========================================================
  // SESSION — NEW YORK
  // ==========================================================
  RTH_OPEN: 9 * 60 + 30,
  ORB_END: 9 * 60 + 45,

  LUNCH_START: 11 * 60 + 30,
  LUNCH_END: 13 * 60 + 30,

  ENTRY_CUTOFF: 15 * 60 + 30,

  FORCE_EXIT: 15 * 60 + 55,

  RTH_CLOSE: 16 * 60,

  // ==========================================================
  // RISK / TARGET
  // ==========================================================
  MIN_STOP: 7,
  MAX_STOP: 25,

  TP1_R: 1.0,

  MIN_FINAL_R: 1.55,
  MAX_FINAL_R: 2.40,

  LOCK_TRIGGER_R: 1.35,
  LOCK_STOP_R: 0.35,

  TIME_STOP_MIN: 45,

  // ==========================================================
  // STORAGE
  // ==========================================================
  MAX_CANDLES: 900,
  MAX_TRADES: 400,
  MAX_FORECASTS: 800
};


// ============================================================
// CLOUDFLARE WORKER
// ============================================================

export default {

  async fetch(request, env) {

    const u = new URL(request.url);

    try {

      // ======================================================
      // ROOT
      // ======================================================

      if (
        u.pathname === "/" &&
        request.method === "GET"
      ) {

        return out({

          ok: true,

          bot: "NQ RADAR",

          version: C.VERSION,

          mode: "PAPER TRADING ONLY",

          feed: "TradingView CLOSED 1m candles",

          simulatedInstrument: C.SYMBOL,

          pointValue: C.POINT_VALUE

        });

      }


      // ======================================================
      // VERSION
      // ======================================================

      if (
        u.pathname === "/debug/version" &&
        request.method === "GET"
      ) {

        return out({

          ok: true,

          version: C.VERSION,

          paperOnly: PAPER_ONLY,

          feed: "/feed",

          telegram: "/telegram",

          setup: "/setup"

        });

      }


      // ======================================================
      // SETUP TELEGRAM
      // ======================================================

      if (
        u.pathname === "/setup" &&
        request.method === "GET"
      ) {

        return await setupTelegram(
          request,
          env
        );

      }


      // ======================================================
      // TELEGRAM WEBHOOK
      // ======================================================

      if (
        (
          u.pathname === "/telegram" ||
          u.pathname === "/webhook"
        ) &&
        request.method === "POST"
      ) {

        return await telegramInbound(
          request,
          env
        );

      }


      // ======================================================
      // TRADINGVIEW FEED
      // ======================================================

      if (
        u.pathname === "/feed" &&
        request.method === "POST"
      ) {

        return await feed(
          request,
          env
        );

      }


      // ======================================================
      // PUBLIC STATUS
      // ======================================================

      if (
        u.pathname === "/status" &&
        request.method === "GET"
      ) {

        return out(
          publicStatus(
            await load(env)
          )
        );

      }


      return out(
        {
          ok: false,
          error: "Not found"
        },
        404
      );

    }

    catch (e) {

      console.error(e);

      return out(
        {
          ok: false,
          error: String(
            e?.message ||
            e
          ).slice(
            0,
            400
          )
        },
        500
      );

    }

  }

};


// ============================================================
// TELEGRAM SETUP
// ============================================================

async function setupTelegram(
  request,
  env
) {

  need(
    env.TELEGRAM_BOT_TOKEN,
    "TELEGRAM_BOT_TOKEN secret missing"
  );

  const origin =
    new URL(
      request.url
    ).origin;

  const webhook =
    `${origin}/telegram`;

  const api =
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;


  const set =
    await fetch(
      `${api}/setWebhook`,
      {

        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            url: webhook,
            drop_pending_updates: true
          })

      }
    ).then(
      r => r.json()
    );


  const info =
    await fetch(
      `${api}/getWebhookInfo`
    ).then(
      r => r.json()
    );


  return out({

    ok:
      Boolean(
        set?.ok &&
        info?.ok &&
        info?.result?.url ===
          webhook
      ),

    expectedWebhook:
      webhook,

    setWebhook:
      set,

    webhookInfo:
      info?.result ||
      null

  });

}


// ============================================================
// TELEGRAM SEND
// ============================================================

async function sendTelegram(
  env,
  chatId,
  text
) {

  need(
    env.TELEGRAM_BOT_TOKEN,
    "TELEGRAM_BOT_TOKEN secret missing"
  );


  const r =
    await fetch(

      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,

      {

        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({

            chat_id:
              chatId,

            text,

            disable_web_page_preview:
              true

          })

      }

    );


  const j =
    await r.json();


  if (
    !r.ok ||
    !j?.ok
  ) {

    throw new Error(
      `Telegram error: ${
        j?.description ||
        r.status
      }`
    );

  }


  return j;

}


// ============================================================
// TELEGRAM COMMANDS
// ============================================================

async function telegramInbound(
  request,
  env
) {

  const update =
    await request.json();


  const m =
    update.message ||
    update.edited_message;


  if (!m) {

    return out({
      ok: true
    });

  }


  const chatId =
    m.chat.id;


  const cmd =
    String(
      m.text ||
      ""
    )
      .trim()
      .split(/\s+/)[0]
      .toLowerCase()
      .split("@")[0];


  const s =
    await load(env);


  // ==========================================================
  // START
  // ==========================================================

  if (
    cmd === "/start"
  ) {

    s.active =
      true;

    s.chatId =
      chatId;


    await save(
      env,
      s
    );


    await sendTelegram(

      env,

      chatId,

      [

        "👹 NQ RADAR V3 PREDATOR ON 🟢",

        "",

        "PAPER TRADING ONLY",

        "NQ | 1m closed-candle feed",

        "",

        `🧠 PRE-SIGNAL: ${C.PRE_SIGNAL}+`,

        `⚠️ BUILDING: ${C.BUILDING}+`,

        `🚨 CONFIRMED: ${C.SIGNAL}+ + hard gates`,

        "",

        "It sends:",

        "• early prediction",

        "• confirmed entry",

        "• SL",

        "• TP1",

        "• projected final exit zone",

        "• EXIT NOW when the model says the move is done",

        "",

        "/scan /why /status /stats /forecast /last /stop"

      ].join("\n")

    );


    return out({
      ok: true
    });

  }


  // ==========================================================
  // STOP
  // ==========================================================

  if (
    cmd === "/stop"
  ) {

    s.active =
      false;

    s.chatId =
      chatId;


    await save(
      env,
      s
    );


    await sendTelegram(

      env,

      chatId,

      "🛑 NQ RADAR stopped. Feed can keep updating, but no new paper trades open."

    );


    return out({
      ok: true
    });

  }


  // ==========================================================
  // STATUS
  // ==========================================================

  if (
    cmd === "/status"
  ) {

    await sendTelegram(
      env,
      chatId,
      fmtStatus(s)
    );

    return out({
      ok: true
    });

  }


  // ==========================================================
  // SCAN
  // ==========================================================

  if (
    cmd === "/scan"
  ) {

    await sendTelegram(

      env,

      chatId,

      s.analysis
        ? fmtScan(
            s.analysis,
            s
          )
        : "📡 Waiting for TradingView feed."

    );


    return out({
      ok: true
    });

  }


  // ==========================================================
  // WHY
  // ==========================================================

  if (
    cmd === "/why"
  ) {

    await sendTelegram(

      env,

      chatId,

      s.analysis
        ? fmtWhy(
            s.analysis
          )
        : "🧠 No analysis yet."

    );


    return out({
      ok: true
    });

  }


  // ==========================================================
  // STATS
  // ==========================================================

  if (
    cmd === "/stats"
  ) {

    await sendTelegram(
      env,
      chatId,
      fmtStats(s)
    );

    return out({
      ok: true
    });

  }


  // ==========================================================
  // FORECAST
  // ==========================================================

  if (
    cmd === "/forecast"
  ) {

    await sendTelegram(
      env,
      chatId,
      fmtForecast(s)
    );

    return out({
      ok: true
    });

  }


  // ==========================================================
  // LAST SIGNAL
  // ==========================================================

  if (
    cmd === "/last"
  ) {

    await sendTelegram(

      env,

      chatId,

      s.lastSignal
        ? fmtSignal(
            s.lastSignal
          )
        : "📭 No confirmed signal yet."

    );


    return out({
      ok: true
    });

  }


  // ==========================================================
  // TEST
  // ==========================================================

  if (
    cmd === "/testsignal"
  ) {

    await sendTelegram(

      env,

      chatId,

      [

        "🧪 DEMO — NQ PREDATOR",

        "LONG NQ",

        "Entry: 25000.25",

        "SL: 24982.25",

        "TP1: 25018.25",

        "Projected exit zone: 25032.50 → 25038.50",

        "Target center: 25035.50",

        "EXIT NOW when target zone is reached or reversal alert arrives.",

        "DEMO ONLY"

      ].join("\n")

    );


    return out({
      ok: true
    });

  }


  await sendTelegram(

    env,

    chatId,

    "/start /stop /status /scan /why /stats /forecast /last /testsignal"

  );


  return out({
    ok: true
  });

}


// ============================================================
// TRADINGVIEW FEED
// ============================================================

async function feed(
  request,
  env
) {

  need(
    env.NQ_FEED_SECRET,
    "NQ_FEED_SECRET secret missing"
  );


  // TradingView published webhook IP allowlist.

  const sourceIp =
    String(
      request.headers.get(
        "CF-Connecting-IP"
      ) ||
      ""
    )
      .split(",")[0]
      .trim();


  if (
    sourceIp &&
    !TRADINGVIEW_IPS.has(
      sourceIp
    )
  ) {

    return out(
      {
        ok: false,
        error:
          "Feed source IP not allowed"
      },
      403
    );

  }


  const p =
    await request.json();


  if (
    !safeEq(
      String(
        p?.secret ||
        ""
      ),
      String(
        env.NQ_FEED_SECRET ||
        ""
      )
    )
  ) {

    return out(
      {
        ok: false,
        error:
          "Unauthorized feed"
      },
      401
    );

  }


  const c =
    normalizeCandle(p);


  if (!c) {

    return out(
      {
        ok: false,
        error:
          "Invalid candle"
      },
      400
    );

  }


  const s =
    await load(env);


  const result =
    processCandle(
      s,
      c
    );


  await save(
    env,
    s
  );


  if (
    s.active &&
    s.chatId
  ) {

    for (
      const e
      of result.events
    ) {

      await sendEvent(
        env,
        s.chatId,
        e,
        s
      );

    }

  }


  return out({

    ok: true,

    duplicate:
      result.duplicate,

    active:
      s.active,

    stage:
      s.analysis?.stage ||
      "NORMAL",

    bias:
      s.analysis?.bias ||
      "NEUTRAL",

    score:
      s.analysis?.score ||
      0,

    projectedTarget:
      s.openTrades[0]?.targetCenter ||
      null,

    openTrades:
      s.openTrades.length

  });

}


// ============================================================
// NORMALIZE CANDLE
// ============================================================

function normalizeCandle(
  p
) {

  const time =
    Number(
      p?.time
    );

  const open =
    Number(
      p?.open
    );

  const high =
    Number(
      p?.high
    );

  const low =
    Number(
      p?.low
    );

  const close =
    Number(
      p?.close
    );

  const volume =
    Number(
      p?.volume
    );


  if (
    ![
      time,
      open,
      high,
      low,
      close,
      volume
    ].every(
      Number.isFinite
    )
  ) {

    return null;

  }


  if (
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    high < low
  ) {

    return null;

  }


  return {

    time:
      time <
        10_000_000_000
        ? time * 1000
        : time,

    open,

    high,

    low,

    close,

    volume:
      Math.max(
        0,
        volume
      ),

    symbol:
      String(
        p?.symbol ||
        C.SYMBOL
      ),

    timeframe:
      String(
        p?.timeframe ||
        "1"
      )

  };

}


// ============================================================
// CORE CANDLE ENGINE
// ============================================================

function processCandle(
  s,
  c
) {

  const events = [];


  // ==========================================================
  // DEDUPE
  // ==========================================================

  if (
    s.lastCandleTime &&
    c.time <=
      s.lastCandleTime
  ) {

    return {
      events,
      duplicate: true
    };

  }


  s.lastCandleTime =
    c.time;


  const ny =
    nyParts(
      c.time
    );


  const date =
    dateKey(ny);


  const minute =
    ny.hour * 60 +
    ny.minute;


  // ==========================================================
  // NEW SESSION
  // ==========================================================

  if (
    s.sessionDate !==
    date
  ) {

    if (
      s.currentRth?.date &&
      Number.isFinite(
        s.currentRth.high
      )
    ) {

      s.previousRth = {
        ...s.currentRth
      };

    }


    resetDay(
      s,
      date
    );

  }


  // ==========================================================
  // STORE CANDLE
  // ==========================================================

  s.candles.push(c);


  s.candles =
    s.candles.slice(
      -C.MAX_CANDLES
    );


  s.lastFeedAt =
    Date.now();


  // ==========================================================
  // PREMARKET 08:00 → 09:30
  // ==========================================================

  if (
    minute >=
      8 * 60 &&
    minute <
      C.RTH_OPEN
  ) {

    if (
      s.premarket.open ==
      null
    ) {

      s.premarket.open =
        c.open;

    }


    s.premarket.high =
      s.premarket.high ==
      null
        ? c.high
        : Math.max(
            s.premarket.high,
            c.high
          );


    s.premarket.low =
      s.premarket.low ==
      null
        ? c.low
        : Math.min(
            s.premarket.low,
            c.low
          );


    s.premarket.close =
      c.close;

  }


  // ==========================================================
  // CURRENT RTH
  // ==========================================================

  if (
    minute >=
      C.RTH_OPEN &&
    minute <
      C.RTH_CLOSE
  ) {

    if (
      s.currentRth.open ==
      null
    ) {

      s.currentRth.open =
        c.open;

    }


    s.currentRth.high =
      s.currentRth.high ==
      null
        ? c.high
        : Math.max(
            s.currentRth.high,
            c.high
          );


    s.currentRth.low =
      s.currentRth.low ==
      null
        ? c.low
        : Math.min(
            s.currentRth.low,
            c.low
          );


    s.currentRth.close =
      c.close;


    s.currentRth.date =
      date;

  }


  // ==========================================================
  // OPENING RANGE
  // 09:30 → 09:44
  // ==========================================================

  if (
    minute >=
      C.RTH_OPEN &&
    minute <
      C.ORB_END
  ) {

    s.orb.high =
      s.orb.high ==
      null
        ? c.high
        : Math.max(
            s.orb.high,
            c.high
          );


    s.orb.low =
      s.orb.low ==
      null
        ? c.low
        : Math.min(
            s.orb.low,
            c.low
          );


    s.orb.count +=
      1;

  }


  // ==========================================================
  // LOCK ORB
  // ==========================================================

  if (
    minute >=
      C.ORB_END &&
    s.orb.high !=
      null &&
    !s.orb.locked
  ) {

    s.orb.locked =
      true;


    events.push({

      type:
        "ORB",

      high:
        s.orb.high,

      low:
        s.orb.low

    });

  }


  // ==========================================================
  // UPDATE FORECAST VALIDATION
  // ==========================================================

  updateForecasts(
    s,
    c
  );


  const previous =
    s.analysis;


  // ==========================================================
  // ANALYZE MARKET
  // ==========================================================

  const a =
    analyze(
      s,
      c,
      minute
    );


  s.analysis =
    a;


  // ==========================================================
  // MANAGE OPEN PAPER TRADE
  // ==========================================================

  if (
    s.active
  ) {

    events.push(
      ...manageTrade(
        s,
        c,
        a,
        minute
      )
    );

  }


  // ==========================================================
  // PREDICTION
  // ==========================================================

  const pred =
    updatePrediction(
      s,
      a,
      c,
      previous
    );


  if (
    pred.event
  ) {

    events.push(
      pred.event
    );

  }


  // ==========================================================
  // STAGE ALERT
  // ==========================================================

  if (
    a.stage !==
    s.lastStage
  ) {

    if (
      [
        "WATCH",
        "BUILDING"
      ].includes(
        a.stage
      )
    ) {

      events.push({

        type:
          "STAGE",

        analysis:
          a

      });

    }


    s.lastStage =
      a.stage;

  }


  // ==========================================================
  // CONFIRMED SIGNAL
  // ==========================================================

  if (

    s.active &&

    a.stage ===
      "SIGNAL" &&

    pred.confirmed &&

    canOpen(
      s,
      c.time,
      minute
    )

  ) {

    const sig =
      buildSignal(
        s,
        a,
        c
      );


    if (sig) {

      s.lastSignal =
        sig;


      s.signals.push(
        sig
      );


      s.signals =
        s.signals.slice(
          -200
        );


      s.openTrades.push({

        ...sig,

        status:
          "OPEN",

        currentStop:
          sig.stop,

        tp1Hit:
          false,

        lockHit:
          false,

        targetWarned:
          false,

        mfe:
          0,

        mae:
          0,

        best:
          sig.entry,

        worst:
          sig.entry,

        openedAt:
          c.time

      });


      s.sessionTrades +=
        1;


      s.lastTradeAt =
        c.time;


      s.prediction.confirmed =
        true;


      addForecast(

        s,

        "SIGNAL",

        sig.id,

        sig.side,

        sig.rawEntry,

        sig.score,

        c.time

      );


      events.push({

        type:
          "SIGNAL",

        signal:
          sig

      });

    }

  }


  return {

    events,

    duplicate:
      false

  };

}


// ============================================================
// MARKET ANALYSIS
// ============================================================

function analyze(
  s,
  c,
  minute
) {

  const cs =
    s.candles;


  const closes =
    cs.map(
      x => x.close
    );


  const vols =
    cs.map(
      x => x.volume
    );


  // ==========================================================
  // INDICATORS
  // ==========================================================

  const e9 =
    ema(
      closes,
      9
    );


  const e21 =
    ema(
      closes,
      21
    );


  const e50 =
    ema(
      closes,
      50
    );


  const a14 =
    atr(
      cs,
      14
    );


  const a50 =
    atr(
      cs,
      50
    );


  const r14 =
    rsi(
      closes,
      14
    );


  const d =
    dmi(
      cs,
      14
    );


  const vwap =
    rthVwap(
      cs,
      s.sessionDate
    );


  // ==========================================================
  // SYNTHETIC 5 MINUTE TREND
  // ==========================================================

  const five =
    aggregate(
      cs,
      5
    );


  const fiveCloses =
    five.map(
      x => x.close
    );


  const fiveFast =
    ema(
      fiveCloses,
      8
    );


  const fiveSlow =
    ema(
      fiveCloses,
      21
    );


  const fiveTrend =
    fiveFast >
      fiveSlow
      ? "BULL"
      : fiveFast <
        fiveSlow
      ? "BEAR"
      : "FLAT";


  // ==========================================================
  // VOLUME
  // ==========================================================

  const recentVol =
    avg(
      vols.slice(
        -3
      )
    );


  const baseVol =
    avg(
      vols.slice(
        -23,
        -3
      )
    );


  const relVol =
    baseVol > 0
      ? recentVol /
        baseVol
      : 1;


  // ==========================================================
  // CANDLE QUALITY
  // ==========================================================

  const range =
    Math.max(
      c.high -
      c.low,
      C.TICK
    );


  const body =
    Math.abs(
      c.close -
      c.open
    ) /
    range;


  const closeLoc =
    (
      c.close -
      c.low
    ) /
    range;


  const bullImpulse =

    c.close >
      c.open &&

    body >=
      0.52 &&

    closeLoc >=
      0.68;


  const bearImpulse =

    c.close <
      c.open &&

    body >=
      0.52 &&

    closeLoc <=
      0.32;


  // ==========================================================
  // FVG
  // ==========================================================

  const bullFvg =

    cs.length >=
      3 &&

    cs.at(-1).low >
      cs.at(-3).high;


  const bearFvg =

    cs.length >=
      3 &&

    cs.at(-1).high <
      cs.at(-3).low;


  // ==========================================================
  // ORB BREAK
  // ==========================================================

  const buffer =
    Math.max(
      C.TICK * 2,
      a14 * 0.06
    );


  const longBreak =

    s.orb.locked &&

    c.close >=
      s.orb.high +
      buffer;


  const shortBreak =

    s.orb.locked &&

    c.close <=
      s.orb.low -
      buffer;


  const retest =
    orbRetest(
      s,
      cs,
      a14
    );


  // ==========================================================
  // VWAP DISTANCE
  // ==========================================================

  const vwapAtr =
    a14 > 0
      ? (
          c.close -
          vwap
        ) /
        a14
      : 0;


  // ==========================================================
  // SESSION FILTER
  // ==========================================================

  const lunch =

    minute >=
      C.LUNCH_START &&

    minute <
      C.LUNCH_END;


  const validWindow =

    minute >=
      C.ORB_END &&

    minute <
      C.ENTRY_CUTOFF;


  // ==========================================================
  // VOLATILITY REGIME
  // ==========================================================

  const volRegime =
    a50 > 0
      ? a14 /
        a50
      : 1;


  // ==========================================================
  // LONG SCORE
  // ==========================================================

  const longPos = {

    orb:
      longBreak
        ? 24
        : 0,

    quality:
      longBreak &&
      bullImpulse
        ? 10
        : longBreak &&
          body >= 0.4
        ? 5
        : 0,

    retest:
      retest.long
        ? 12
        : 0,

    five:
      fiveTrend ===
        "BULL"
        ? 12
        : 0,

    vwap:
      c.close >
        vwap
        ? 10
        : 0,

    ema:
      e9 >
        e21 &&
      e21 >
        e50
        ? 8
        : e9 >
          e21
        ? 4
        : 0,

    adx:
      d.adx >=
        20 &&
      d.plus >
        d.minus
        ? 8
        : d.adx >=
          16 &&
          d.plus >
            d.minus
        ? 4
        : 0,

    volume:
      relVol >=
        1.35
        ? 8
        : relVol >=
          1.15
        ? 4
        : 0,

    momentum:
      bullImpulse &&
      r14 >=
        52 &&
      r14 <=
        78
        ? 5
        : r14 >=
          52 &&
          r14 <=
            75
        ? 2
        : 0,

    fvg:
      bullFvg
        ? 3
        : 0

  };


  // ==========================================================
  // SHORT SCORE
  // ==========================================================

  const shortPos = {

    orb:
      shortBreak
        ? 24
        : 0,

    quality:
      shortBreak &&
      bearImpulse
        ? 10
        : shortBreak &&
          body >=
            0.4
        ? 5
        : 0,

    retest:
      retest.short
        ? 12
        : 0,

    five:
      fiveTrend ===
        "BEAR"
        ? 12
        : 0,

    vwap:
      c.close <
        vwap
        ? 10
        : 0,

    ema:
      e9 <
        e21 &&
      e21 <
        e50
        ? 8
        : e9 <
          e21
        ? 4
        : 0,

    adx:
      d.adx >=
        20 &&
      d.minus >
        d.plus
        ? 8
        : d.adx >=
          16 &&
          d.minus >
            d.plus
        ? 4
        : 0,

    volume:
      relVol >=
        1.35
        ? 8
        : relVol >=
          1.15
        ? 4
        : 0,

    momentum:
      bearImpulse &&
      r14 <=
        48 &&
      r14 >=
        22
        ? 5
        : r14 <=
          48 &&
          r14 >=
            25
        ? 2
        : 0,

    fvg:
      bearFvg
        ? 3
        : 0

  };


  // ==========================================================
  // PENALTIES
  // ==========================================================

  const longPenalty =

    (
      !validWindow
        ? 100
        : 0
    ) +

    (
      lunch
        ? 12
        : 0
    ) +

    (
      fiveTrend ===
        "BEAR"
        ? 15
        : 0
    ) +

    (
      vwapAtr >
        2.4
        ? 12
        : 0
    ) +

    (
      volRegime <
        0.72
        ? 8
        : 0
    ) +

    (
      r14 >
        82
        ? 8
        : 0
    );


  const shortPenalty =

    (
      !validWindow
        ? 100
        : 0
    ) +

    (
      lunch
        ? 12
        : 0
    ) +

    (
      fiveTrend ===
        "BULL"
        ? 15
        : 0
    ) +

    (
      vwapAtr <
        -2.4
        ? 12
        : 0
    ) +

    (
      volRegime <
        0.72
        ? 8
        : 0
    ) +

    (
      r14 <
        18
        ? 8
        : 0
    );


  const longScore =
    clamp(
      sumObj(
        longPos
      ) -
      longPenalty,
      0,
      100
    );


  const shortScore =
    clamp(
      sumObj(
        shortPos
      ) -
      shortPenalty,
      0,
      100
    );


  const bias =
    longScore >
      shortScore
      ? "LONG"
      : shortScore >
        longScore
      ? "SHORT"
      : "NEUTRAL";


  const score =
    Math.max(
      longScore,
      shortScore
    );


  const pos =
    bias ===
      "SHORT"
      ? shortPos
      : longPos;


  const confirmations =
    [

      pos.retest >
        0,

      pos.five >
        0,

      pos.ema >=
        4,

      pos.adx >=
        4,

      pos.volume >=
        4,

      pos.momentum >=
        2

    ].filter(Boolean).length;


  // ==========================================================
  // HARD GATE
  // ==========================================================

  const hardGate =

    bias ===
      "LONG"

      ? (

          longBreak &&

          c.close >
            vwap &&

          fiveTrend !==
            "BEAR" &&

          vwapAtr <
            2.4 &&

          validWindow

        )

      : bias ===
        "SHORT"

      ? (

          shortBreak &&

          c.close <
            vwap &&

          fiveTrend !==
            "BULL" &&

          vwapAtr >
            -2.4 &&

          validWindow

        )

      : false;


  // ==========================================================
  // STAGE
  // ==========================================================

  let stage =
    "NORMAL";


  if (
    minute >=
      C.RTH_OPEN &&
    minute <
      C.ORB_END
  ) {

    stage =
      "ORB_FORMING";

  }

  else if (
    s.orb.locked
  ) {

    if (
      score >=
        C.SIGNAL &&
      hardGate &&
      confirmations >=
        4
    ) {

      stage =
        "SIGNAL";

    }

    else if (
      score >=
        C.BUILDING
    ) {

      stage =
        "BUILDING";

    }

    else if (
      score >=
        C.PRE_SIGNAL
    ) {

      stage =
        "PREDICTION";

    }

    else if (
      score >=
        45
    ) {

      stage =
        "WATCH";

    }

  }


  // ==========================================================
  // MARKET REGIME
  // ==========================================================

  const regime =

    !validWindow

      ? "OUTSIDE_WINDOW"

      : lunch

      ? "LUNCH"

      : d.adx >=
          23 &&
        fiveTrend !==
          "FLAT"

      ? "TRENDING"

      : d.adx <
          16

      ? "CHOPPY"

      : volRegime >
          1.5

      ? "EXPLOSIVE"

      : "MIXED";


  // ==========================================================
  // RETURN ANALYSIS
  // ==========================================================

  return {

    time:
      c.time,

    price:
      c.close,

    minute,

    bias,

    score,

    longScore,

    shortScore,

    stage,

    longPos,

    shortPos,

    hardGate,

    confirmations,

    regime,

    orbHigh:
      s.orb.high,

    orbLow:
      s.orb.low,

    premarketHigh:
      s.premarket.high,

    premarketLow:
      s.premarket.low,

    prevHigh:
      s.previousRth.high,

    prevLow:
      s.previousRth.low,

    ema9:
      e9,

    ema21:
      e21,

    ema50:
      e50,

    fiveTrend,

    vwap,

    atr14:
      a14,

    atr50:
      a50,

    rsi14:
      r14,

    adx14:
      d.adx,

    plusDI:
      d.plus,

    minusDI:
      d.minus,

    relVol,

    bullFvg,

    bearFvg,

    longRetest:
      retest.long,

    shortRetest:
      retest.short,

    quality:
      score >=
        90
        ? "A+"
        : score >=
          C.SIGNAL
        ? "A"
        : score >=
          C.BUILDING
        ? "B+"
        : score >=
          C.PRE_SIGNAL
        ? "B"
        : "WATCH"

  };

}


// ============================================================
// ORB RETEST
// ============================================================

function orbRetest(
  s,
  cs,
  a14
) {

  if (
    !s.orb.locked ||
    cs.length <
      5
  ) {

    return {
      long: false,
      short: false
    };

  }


  const tol =
    Math.max(
      C.TICK * 2,
      a14 * 0.12
    );


  let long =
    false;


  let short =
    false;


  for (
    const x
    of cs.slice(-5)
  ) {

    if (

      x.low <=
        s.orb.high +
        tol &&

      x.close >
        s.orb.high &&

      x.close >
        x.open

    ) {

      long =
        true;

    }


    if (

      x.high >=
        s.orb.low -
        tol &&

      x.close <
        s.orb.low &&

      x.close <
        x.open

    ) {

      short =
        true;

    }

  }


  return {
    long,
    short
  };

}


// ============================================================
// PREDICTION ENGINE
// ============================================================

function updatePrediction(
  s,
  a,
  c,
  previous
) {

  let event =
    null;


  let confirmed =
    false;


  if (

    ![
      "LONG",
      "SHORT"
    ].includes(
      a.bias
    ) ||

    a.score <
      55 ||

    !s.orb.locked

  ) {

    s.prediction =
      null;


    return {
      event,
      confirmed
    };

  }


  // ==========================================================
  // NEW PREDICTION
  // ==========================================================

  if (

    !s.prediction ||

    s.prediction.side !==
      a.bias

  ) {

    s.prediction = {

      id:
        crypto.randomUUID(),

      side:
        a.bias,

      startedAt:
        c.time,

      startPrice:
        c.close,

      peak:
        a.score,

      strongBars:
        0,

      sent:
        false,

      confirmed:
        false

    };

  }


  s.prediction.peak =
    Math.max(
      s.prediction.peak,
      a.score
    );


  s.prediction.strongBars =

    a.stage ===
      "SIGNAL"

      ? s.prediction.strongBars +
        1

      : 0;


  const crossed =

    a.score >=
      C.PRE_SIGNAL &&

    (
      !previous ||

      previous.bias !==
        a.bias ||

      previous.score <
        C.PRE_SIGNAL
    );


  // ==========================================================
  // EARLY PRE-SIGNAL
  // ==========================================================

  if (
    crossed &&
    !s.prediction.sent
  ) {

    s.prediction.sent =
      true;


    const preview =
      previewTargets(
        a,
        c.close
      );


    addForecast(

      s,

      "PREDICTION",

      `P-${s.prediction.id}`,

      a.bias,

      c.close,

      a.score,

      c.time

    );


    event = {

      type:
        "PREDICTION",

      analysis:
        a,

      preview

    };

  }


  // ==========================================================
  // CONFIRM
  // ==========================================================

  confirmed =

    a.stage ===
      "SIGNAL" &&

    a.hardGate &&

    a.confirmations >=
      4 &&

    s.prediction.strongBars >=
      C.PERSIST_BARS &&

    !s.prediction.confirmed;


  return {
    event,
    confirmed
  };

}


// ============================================================
// PRE-SIGNAL TARGET PREVIEW
// ============================================================

function previewTargets(
  a,
  price
) {

  const risk =
    clamp(
      a.atr14 *
        0.8,
      C.MIN_STOP,
      C.MAX_STOP
    );


  const strength =
    clamp(
      (
        a.score -
        C.PRE_SIGNAL
      ) /
      (
        100 -
        C.PRE_SIGNAL
      ),
      0,
      1
    );


  const finalR =
    C.MIN_FINAL_R +
    strength *
    (
      C.MAX_FINAL_R -
      C.MIN_FINAL_R
    );


  const center =

    a.bias ===
      "LONG"

      ? price +
        risk *
        finalR

      : price -
        risk *
        finalR;


  const half =
    Math.max(
      2,
      a.atr14 *
        0.18
    );


  return {

    stopApprox:
      roundTick(

        a.bias ===
          "LONG"

          ? price -
            risk

          : price +
            risk

      ),

    targetCenter:
      roundTick(
        center
      ),

    zoneA:
      roundTick(

        a.bias ===
          "LONG"

          ? center -
            half

          : center +
            half

      ),

    zoneB:
      roundTick(

        a.bias ===
          "LONG"

          ? center +
            half

          : center -
            half

      )

  };

}


// ============================================================
// CAN OPEN TRADE
// ============================================================

function canOpen(
  s,
  now,
  minute
) {

  if (
    minute <
      C.ORB_END ||
    minute >=
      C.ENTRY_CUTOFF
  ) {

    return false;

  }


  if (
    s.openTrades.length >=
      C.MAX_OPEN
  ) {

    return false;

  }


  if (
    s.sessionTrades >=
      C.MAX_TRADES_DAY
  ) {

    return false;

  }


  if (
    s.sessionPnl <=
      -C.DAILY_LOSS_LIMIT_USD
  ) {

    return false;

  }


  if (

    s.lastTradeAt &&

    now -
      s.lastTradeAt <
      C.COOLDOWN_MIN *
      60000

  ) {

    return false;

  }


  return true;

}


// ============================================================
// BUILD CONFIRMED SIGNAL
// ============================================================

function buildSignal(
  s,
  a,
  c
) {

  if (
    !PAPER_ONLY
  ) {

    throw new Error(
      "REAL TRADING DISABLED"
    );

  }


  const side =
    a.bias;


  const rawEntry =
    c.close;


  // ==========================================================
  // SIMULATED ENTRY SLIPPAGE
  // ==========================================================

  const entry =
    roundTick(

      side ===
        "LONG"

        ? rawEntry +
          C.ENTRY_SLIPPAGE

        : rawEntry -
          C.ENTRY_SLIPPAGE

    );


  // ==========================================================
  // STRUCTURE STOP
  // ==========================================================

  const recent =
    s.candles.slice(
      -7
    );


  const swingLow =
    Math.min(
      ...recent.map(
        x => x.low
      )
    );


  const swingHigh =
    Math.max(
      ...recent.map(
        x => x.high
      )
    );


  const buffer =
    Math.max(
      C.TICK * 2,
      a.atr14 * 0.10
    );


  let structuralStop =

    side ===
      "LONG"

      ? Math.min(

          swingLow -
            C.TICK,

          a.orbHigh -
            buffer

        )

      : Math.max(

          swingHigh +
            C.TICK,

          a.orbLow +
            buffer

        );


  let stopDistance =
    Math.max(

      C.MIN_STOP,

      Math.abs(
        entry -
        structuralStop
      )

    );


  const maxByUsd =
    C.MAX_RISK_USD /
    (
      C.POINT_VALUE *
      C.CONTRACTS
    );


  const maxStop =
    Math.min(
      C.MAX_STOP,
      maxByUsd
    );


  // ==========================================================
  // BLOCK IF REAL STRUCTURE NEEDS TOO MUCH RISK
  // ==========================================================

  if (

    !Number.isFinite(
      stopDistance
    ) ||

    stopDistance >
      maxStop

  ) {

    return null;

  }


  stopDistance =
    roundTick(
      stopDistance
    );


  // ==========================================================
  // STOP
  // ==========================================================

  const stop =
    roundTick(

      side ===
        "LONG"

        ? entry -
          stopDistance

        : entry +
          stopDistance

    );


  // ==========================================================
  // TP1
  // ==========================================================

  const tp1 =
    roundTick(

      side ===
        "LONG"

        ? entry +
          stopDistance *
          C.TP1_R

        : entry -
          stopDistance *
          C.TP1_R

    );


  // ==========================================================
  // DYNAMIC PROJECTED FINAL TARGET
  // ==========================================================
  //
  // This does NOT "know the future".
  //
  // It estimates the likely continuation distance using:
  //
  // - current model score
  // - market regime
  // - ATR
  // - stop / structure distance
  //
  // ==========================================================

  const strength =
    clamp(

      (
        a.score -
        C.PRE_SIGNAL
      ) /
      (
        100 -
        C.PRE_SIGNAL
      ),

      0,

      1

    );


  const trendBonus =

    a.regime ===
      "TRENDING"

      ? 0.20

      : a.regime ===
        "EXPLOSIVE"

      ? 0.30

      : 0;


  const finalR =
    clamp(

      C.MIN_FINAL_R +

      strength *
      0.65 +

      trendBonus,

      C.MIN_FINAL_R,

      C.MAX_FINAL_R

    );


  // ==========================================================
  // ATR TARGET DISTANCE
  // ==========================================================

  const atrDistance =
    Math.max(

      stopDistance *
      finalR,

      a.atr14 *
      (
        1.45 +
        strength *
        0.65
      )

    );


  const cappedDistance =
    Math.min(

      atrDistance,

      stopDistance *
      C.MAX_FINAL_R

    );


  // ==========================================================
  // TARGET CENTER
  // ==========================================================

  const targetCenter =
    roundTick(

      side ===
        "LONG"

        ? entry +
          cappedDistance

        : entry -
          cappedDistance

    );


  // ==========================================================
  // TARGET EXIT ZONE
  // ==========================================================

  const halfZone =
    Math.max(

      2,

      a.atr14 *
      0.18

    );


  const targetZoneNear =
    roundTick(

      side ===
        "LONG"

        ? targetCenter -
          halfZone

        : targetCenter +
          halfZone

    );


  const targetZoneFar =
    roundTick(

      side ===
        "LONG"

        ? targetCenter +
          halfZone

        : targetCenter -
          halfZone

    );


  // ==========================================================
  // MONEY PROJECTION
  // ==========================================================

  const riskUsd =
    stopDistance *
    C.POINT_VALUE *
    C.CONTRACTS;


  const projectedGross =
    Math.abs(
      targetCenter -
      entry
    ) *
    C.POINT_VALUE *
    C.CONTRACTS;


  // ==========================================================
  // RETURN SIGNAL
  // ==========================================================

  return {

    id:
      crypto.randomUUID(),

    timestamp:
      c.time,

    sessionDate:
      s.sessionDate,

    side,

    score:
      a.score,

    quality:
      a.quality,

    regime:
      a.regime,

    confirmations:
      a.confirmations,

    rawEntry,

    entry,

    stop,

    stopDistance,

    tp1,

    targetCenter,

    targetZoneNear,

    targetZoneFar,

    projectedR:
      Math.abs(
        targetCenter -
        entry
      ) /
      stopDistance,

    riskUsd,

    projectedGross,

    atr14:
      a.atr14,

    adx14:
      a.adx14,

    rsi14:
      a.rsi14,

    fiveTrend:
      a.fiveTrend,

    pointValue:
      C.POINT_VALUE,

    contracts:
      C.CONTRACTS

  };

}


// ============================================================
// TRADE MANAGEMENT
// ============================================================

function manageTrade(
  s,
  c,
  a,
  minute
) {

  const events = [];


  for (
    const t
    of s.openTrades
  ) {

    if (
      t.status !==
        "OPEN"
    ) {

      continue;

    }


    // ========================================================
    // UPDATE MFE / MAE
    // ========================================================

    if (
      t.side ===
        "LONG"
    ) {

      t.best =
        Math.max(
          t.best,
          c.high
        );


      t.worst =
        Math.min(
          t.worst,
          c.low
        );


      t.mfe =
        Math.max(
          t.mfe,
          c.high -
          t.entry
        );


      t.mae =
        Math.max(
          t.mae,
          t.entry -
          c.low
        );

    }

    else {

      t.best =
        Math.min(
          t.best,
          c.low
        );


      t.worst =
        Math.max(
          t.worst,
          c.high
        );


      t.mfe =
        Math.max(
          t.mfe,
          t.entry -
          c.low
        );


      t.mae =
        Math.max(
          t.mae,
          c.high -
          t.entry
        );

    }


    // ========================================================
    // FORCE EXIT 15:55
    // ========================================================

    if (
      minute >=
        C.FORCE_EXIT
    ) {

      closePaper(

        s,

        t,

        adverseExit(
          t.side,
          c.close
        ),

        "TIME_EXIT",

        "15:55 ET forced exit",

        c.time

      );


      events.push({

        type:
          "EXIT_NOW",

        trade: {
          ...t
        }

      });


      continue;

    }


    // ========================================================
    // STOP FIRST
    // ========================================================
    //
    // Conservative simulation:
    //
    // If stop AND target are both inside the same 1m candle,
    // stop is assumed to happen first.
    //
    // ========================================================

    const stopTouched =

      t.side ===
        "LONG"

        ? c.low <=
          t.currentStop

        : c.high >=
          t.currentStop;


    if (
      stopTouched
    ) {

      const status =

        t.currentStop ===
          t.entry

          ? "BREAKEVEN"

          : favorablePoints(
              t.side,
              t.entry,
              t.currentStop
            ) >
            0

          ? "PROFIT_STOP"

          : "LOSS";


      closePaper(

        s,

        t,

        adverseExit(
          t.side,
          t.currentStop
        ),

        status,

        "Stop touched",

        c.time

      );


      events.push({

        type:
          "EXIT_NOW",

        trade: {
          ...t
        }

      });


      continue;

    }


    // ========================================================
    // TP1
    // ========================================================

    const tp1Touched =

      t.side ===
        "LONG"

        ? c.high >=
          t.tp1

        : c.low <=
          t.tp1;


    if (
      !t.tp1Hit &&
      tp1Touched
    ) {

      t.tp1Hit =
        true;


      t.currentStop =
        t.entry;


      events.push({

        type:
          "TP1",

        trade: {
          ...t
        }

      });

    }


    // ========================================================
    // PROFIT LOCK
    // ========================================================

    const lockTrigger =

      t.side ===
        "LONG"

        ? t.entry +
          t.stopDistance *
          C.LOCK_TRIGGER_R

        : t.entry -
          t.stopDistance *
          C.LOCK_TRIGGER_R;


    const lockTouched =

      t.side ===
        "LONG"

        ? c.high >=
          lockTrigger

        : c.low <=
          lockTrigger;


    if (
      !t.lockHit &&
      lockTouched
    ) {

      t.lockHit =
        true;


      t.currentStop =
        roundTick(

          t.side ===
            "LONG"

            ? t.entry +
              t.stopDistance *
              C.LOCK_STOP_R

            : t.entry -
              t.stopDistance *
              C.LOCK_STOP_R

        );


      events.push({

        type:
          "LOCK",

        trade: {
          ...t
        }

      });

    }


    // ========================================================
    // PROJECTED TARGET ZONE WARNING
    // ========================================================

    const zoneTouched =

      t.side ===
        "LONG"

        ? c.high >=
          t.targetZoneNear

        : c.low <=
          t.targetZoneNear;


    if (
      !t.targetWarned &&
      zoneTouched
    ) {

      t.targetWarned =
        true;


      events.push({

        type:
          "TARGET_ZONE",

        trade: {
          ...t
        }

      });

    }


    // ========================================================
    // FINAL TARGET HIT
    // ========================================================

    const targetHit =

      t.side ===
        "LONG"

        ? c.high >=
          t.targetCenter

        : c.low <=
          t.targetCenter;


    if (
      targetHit
    ) {

      closePaper(

        s,

        t,

        favorableExit(
          t.side,
          t.targetCenter
        ),

        "TARGET_EXIT",

        "Projected target center reached",

        c.time

      );


      events.push({

        type:
          "EXIT_NOW",

        trade: {
          ...t
        }

      });


      continue;

    }


    // ========================================================
    // MODEL REVERSAL EXIT
    // ========================================================

    const favorable =

      t.side ===
        "LONG"

        ? c.close -
          t.entry

        : t.entry -
          c.close;


    const currentR =
      favorable /
      t.stopDistance;


    const ownScore =

      t.side ===
        "LONG"

        ? a.longScore

        : a.shortScore;


    const oppScore =

      t.side ===
        "LONG"

        ? a.shortScore

        : a.longScore;


    const lostVwap =

      t.side ===
        "LONG"

        ? c.close <
          a.vwap

        : c.close >
          a.vwap;


    // ========================================================
    // TAKE PROFIT IF MOMENTUM DIES
    // ========================================================

    if (

      currentR >=
        0.65 &&

      (

        (
          ownScore <
            50 &&

          oppScore >=
            65
        )

        ||

        (
          lostVwap &&

          oppScore >=
            58
        )

      )

    ) {

      closePaper(

        s,

        t,

        adverseExit(
          t.side,
          c.close
        ),

        "MODEL_EXIT",

        "Momentum/model reversal — take profit",

        c.time

      );


      events.push({

        type:
          "EXIT_NOW",

        trade: {
          ...t
        }

      });


      continue;

    }


    // ========================================================
    // FAILED ORB
    // ========================================================

    const failed =

      t.side ===
        "LONG"

        ? (

            c.close <
              a.orbHigh &&

            a.shortScore >=
              60

          )

        : (

            c.close >
              a.orbLow &&

            a.longScore >=
              60

          );


    if (
      failed
    ) {

      closePaper(

        s,

        t,

        adverseExit(
          t.side,
          c.close
        ),

        "EARLY_EXIT",

        "ORB failure",

        c.time

      );


      events.push({

        type:
          "EXIT_NOW",

        trade: {
          ...t
        }

      });


      continue;

    }


    // ========================================================
    // TIME STOP
    // ========================================================

    const mins =
      (
        c.time -
        t.openedAt
      ) /
      60000;


    if (

      mins >=
        C.TIME_STOP_MIN &&

      t.mfe <
        t.stopDistance *
        0.5

    ) {

      closePaper(

        s,

        t,

        adverseExit(
          t.side,
          c.close
        ),

        "TIME_STOP",

        "No +0.5R progress",

        c.time

      );


      events.push({

        type:
          "EXIT_NOW",

        trade: {
          ...t
        }

      });

    }

  }


  s.openTrades =
    s.openTrades.filter(
      x =>
        x.status ===
        "OPEN"
    );


  return events;

}


// ============================================================
// CLOSE PAPER TRADE
// ============================================================

function closePaper(
  s,
  t,
  exit,
  status,
  reason,
  time
) {

  const pts =

    t.side ===
      "LONG"

      ? exit -
        t.entry

      : t.entry -
        exit;


  const gross =
    pts *
    C.POINT_VALUE *
    C.CONTRACTS;


  const net =
    gross -
    C.FEES;


  t.exit =
    roundTick(
      exit
    );


  t.points =
    pts;


  t.grossPnl =
    gross;


  t.pnl =
    net;


  t.fees =
    C.FEES;


  t.status =
    status;


  t.exitReason =
    reason;


  t.closedAt =
    time;


  s.balance +=
    net;


  s.sessionPnl +=
    net;


  s.closedTrades.push({
    ...t
  });


  s.closedTrades =
    s.closedTrades.slice(
      -C.MAX_TRADES
    );


  s.highWater =
    Math.max(
      s.highWater,
      s.balance
    );


  s.maxDrawdown =
    Math.min(

      s.maxDrawdown,

      s.balance -
      s.highWater

    );

}


// ============================================================
// SIMULATED EXIT SLIPPAGE
// ============================================================

function adverseExit(
  side,
  price
) {

  return roundTick(

    side ===
      "LONG"

      ? price -
        C.EXIT_SLIPPAGE

      : price +
        C.EXIT_SLIPPAGE

  );

}


function favorableExit(
  side,
  price
) {

  return roundTick(

    side ===
      "LONG"

      ? price -
        C.EXIT_SLIPPAGE

      : price +
        C.EXIT_SLIPPAGE

  );

}


function favorablePoints(
  side,
  entry,
  price
) {

  return side ===
    "LONG"

    ? price -
      entry

    : entry -
      price;

}


// ============================================================
// TELEGRAM EVENT ALERTS
// ============================================================

async function sendEvent(
  env,
  chatId,
  e,
  s
) {

  // ==========================================================
  // ORB
  // ==========================================================

  if (
    e.type ===
      "ORB"
  ) {

    await sendTelegram(

      env,

      chatId,

      [

        "📦 NQ PREDATOR — ORB LOCKED",

        "",

        `High: ${px(e.high)}`,

        `Low: ${px(e.low)}`,

        "",

        "Hunting breakout + confirmation."

      ].join("\n")

    );


    return;

  }


  // ==========================================================
  // PREDICTION
  // ==========================================================

  if (
    e.type ===
      "PREDICTION"
  ) {

    const a =
      e.analysis;


    const p =
      e.preview;


    await sendTelegram(

      env,

      chatId,

      [

        "🧠👹 NQ PREDATOR — EARLY PREDICTION",

        "━━━━━━━━━━━━━━━━",

        `${a.bias === "LONG" ? "🟢" : "🔴"} ${a.bias}`,

        `Score: ${a.score}/100 | ${a.quality}`,

        `Regime: ${a.regime}`,

        `Price: ${px(a.price)}`,

        "",

        `Approx stop: ${px(p.stopApprox)}`,

        `Projected move target: ${px(p.targetCenter)}`,

        `Projected exit zone: ${px(p.zoneA)} → ${px(p.zoneB)}`,

        "",

        `5m: ${a.fiveTrend}`,

        `VWAP: ${px(a.vwap)}`,

        `ADX: ${a.adx14.toFixed(1)}`,

        `RSI: ${a.rsi14.toFixed(1)}`,

        `Volume: ${a.relVol.toFixed(2)}x`,

        "",

        "⚠️ PRE-SIGNAL ONLY",

        "WAIT FOR CONFIRMED."

      ].join("\n")

    );


    return;

  }


  // ==========================================================
  // STAGE
  // ==========================================================

  if (
    e.type ===
      "STAGE"
  ) {

    await sendTelegram(

      env,

      chatId,

      [

        e.analysis.stage ===
          "BUILDING"
          ? "⚠️ NQ BUILDING"
          : "👀 NQ WATCH",

        "",

        `${e.analysis.bias} ${e.analysis.score}/100`,

        "",

        "No entry yet."

      ].join("\n")

    );


    return;

  }


  // ==========================================================
  // SIGNAL
  // ==========================================================

  if (
    e.type ===
      "SIGNAL"
  ) {

    await sendTelegram(
      env,
      chatId,
      fmtSignal(
        e.signal
      )
    );


    return;

  }


  // ==========================================================
  // TP1
  // ==========================================================

  if (
    e.type ===
      "TP1"
  ) {

    const t =
      e.trade;


    await sendTelegram(

      env,

      chatId,

      [

        "🥇 NQ PREDATOR — TP1 HIT",

        "━━━━━━━━━━━━━━━━",

        `${t.side} NQ`,

        "",

        `Entry: ${px(t.entry)}`,

        `TP1: ${px(t.tp1)}`,

        "",

        `🛡️ Stop → BREAKEVEN`,

        `New stop: ${px(t.currentStop)}`,

        "",

        `🎯 Still aiming: ${px(t.targetCenter)}`

      ].join("\n")

    );


    return;

  }


  // ==========================================================
  // LOCK PROFIT
  // ==========================================================

  if (
    e.type ===
      "LOCK"
  ) {

    const t =
      e.trade;


    await sendTelegram(

      env,

      chatId,

      [

        "🔒👹 PROFIT LOCKED",

        "━━━━━━━━━━━━━━━━",

        `${t.side} NQ`,

        "",

        `Protected stop: ${px(t.currentStop)}`,

        "",

        `Projected final target: ${px(t.targetCenter)}`

      ].join("\n")

    );


    return;

  }


  // ==========================================================
  // TARGET ZONE
  // ==========================================================

  if (
    e.type ===
      "TARGET_ZONE"
  ) {

    const t =
      e.trade;


    await sendTelegram(

      env,

      chatId,

      [

        "💰👹 NQ TARGET ZONE REACHED",

        "━━━━━━━━━━━━━━━━",

        `${t.side} NQ`,

        "",

        `Projected zone:`,

        `${px(t.targetZoneNear)} → ${px(t.targetZoneFar)}`,

        "",

        `Target center: ${px(t.targetCenter)}`,

        "",

        "⚠️ PROFIT AREA",

        "Paper model is preparing to exit.",

        "It exits at target center unless momentum reverses first."

      ].join("\n")

    );


    return;

  }


  // ==========================================================
  // EXIT NOW
  // ==========================================================

  if (
    e.type ===
      "EXIT_NOW"
  ) {

    const t =
      e.trade;


    await sendTelegram(

      env,

      chatId,

      [

        "🏁💵👹 NQ PREDATOR — EXIT NOW",

        "━━━━━━━━━━━━━━━━",

        `Result: ${t.status}`,

        `Reason: ${t.exitReason}`,

        "",

        `Side: ${t.side}`,

        "",

        `Entry: ${px(t.entry)}`,

        `Exit: ${px(t.exit)}`,

        "",

        `Points: ${signed(t.points)}`,

        `Net paper P&L: ${money(t.pnl)}`,

        "",

        `MFE: +${Number(t.mfe || 0).toFixed(2)} pts`,

        `MAE: -${Number(t.mae || 0).toFixed(2)} pts`,

        "",

        `Balance: ${money(s.balance)}`

      ].join("\n")

    );

  }

}


// ============================================================
// FORMAT CONFIRMED SIGNAL
// ============================================================

function fmtSignal(
  x
) {

  return [

    "🚨👹 NQ PREDATOR — CONFIRMED",

    "━━━━━━━━━━━━━━━━",

    `${x.side === "LONG" ? "🟢" : "🔴"} ${x.side} NQ`,

    "",

    `Score: ${x.score}/100 | ${x.quality}`,

    `Confirmations: ${x.confirmations}/6`,

    `Regime: ${x.regime}`,

    "",

    `🔥 ENTRY: ${px(x.entry)}`,

    `🛑 STOP: ${px(x.stop)}`,

    `🥇 TP1: ${px(x.tp1)}`,

    "",

    `🎯 PROJECTED FINAL TARGET: ${px(x.targetCenter)}`,

    "",

    `💰 EXIT ZONE:`,

    `${px(x.targetZoneNear)} → ${px(x.targetZoneFar)}`,

    "",

    `Projected R: ${x.projectedR.toFixed(2)}R`,

    `Projected gross if center hits: $${x.projectedGross.toFixed(2)}`,

    "",

    `Modeled risk: $${x.riskUsd.toFixed(2)}`,

    "",

    `ATR: ${x.atr14.toFixed(2)}`,

    `ADX: ${x.adx14.toFixed(1)}`,

    `RSI: ${x.rsi14.toFixed(1)}`,

    `5m trend: ${x.fiveTrend}`,

    "",

    "🧪 PAPER TRADE OPENED",

    "",

    "The bot will send:",

    "🏁 EXIT NOW",

    "when projected target is reached",

    "OR earlier if momentum/model fails."

  ].join("\n");

}


// ============================================================
// FORMAT SCAN
// ============================================================

function fmtScan(
  a,
  s
) {

  const t =
    s.openTrades[0];


  return [

    "👹 NQ PREDATOR LIVE",

    "━━━━━━━━━━━━━━━━",

    `Price: ${px(a.price)}`,

    "",

    `📈 LONG: ${a.longScore}/100`,

    `📉 SHORT: ${a.shortScore}/100`,

    "",

    `Bias: ${a.bias}`,

    `Stage: ${a.stage}`,

    `Quality: ${a.quality}`,

    "",

    `Hard gate: ${a.hardGate ? "PASS" : "FAIL"}`,

    `Confirmations: ${a.confirmations}/6`,

    `Regime: ${a.regime}`,

    "",

    `ORB H/L:`,

    `${px(a.orbHigh)} / ${px(a.orbLow)}`,

    "",

    `VWAP: ${px(a.vwap)}`,

    `5m trend: ${a.fiveTrend}`,

    "",

    `EMA 9: ${px(a.ema9)}`,

    `EMA 21: ${px(a.ema21)}`,

    `EMA 50: ${px(a.ema50)}`,

    "",

    `ADX: ${a.adx14.toFixed(1)}`,

    `RSI: ${a.rsi14.toFixed(1)}`,

    `ATR: ${a.atr14.toFixed(2)}`,

    `Volume: ${a.relVol.toFixed(2)}x`,

    "",

    t

      ? [

          `OPEN PAPER TRADE: ${t.side}`,

          `Entry: ${px(t.entry)}`,

          `Stop: ${px(t.currentStop)}`,

          `TP1: ${px(t.tp1)}`,

          `Projected target: ${px(t.targetCenter)}`,

          `Exit zone: ${px(t.targetZoneNear)} → ${px(t.targetZoneFar)}`

        ].join("\n")

      : "No open paper trade.",

    "",

    "Score = model strength, NOT probability."

  ].join("\n");

}


// ============================================================
// WHY
// ============================================================

function fmtWhy(
  a
) {

  const p =
    a.bias ===
      "SHORT"

      ? a.shortPos

      : a.longPos;


  return [

    "🧠👹 NQ PREDATOR — WHY?",

    "━━━━━━━━━━━━━━━━",

    `${a.bias} ${a.score}/100`,

    "",

    `ORB: +${p.orb}/24`,

    `Breakout quality: +${p.quality}/10`,

    `Retest: +${p.retest}/12`,

    `5m trend: +${p.five}/12`,

    `VWAP: +${p.vwap}/10`,

    `EMA: +${p.ema}/8`,

    `ADX: +${p.adx}/8`,

    `Volume: +${p.volume}/8`,

    `Momentum: +${p.momentum}/5`,

    `FVG: +${p.fvg}/3`,

    "",

    `Hard gate: ${a.hardGate ? "PASS" : "FAIL"}`,

    `Confirmations: ${a.confirmations}/6`

  ].join("\n");

}


// ============================================================
// STATUS
// ============================================================

function fmtStatus(
  s
) {

  return [

    "👹 NQ RADAR STATUS",

    "━━━━━━━━━━━━━━━━",

    `Radar: ${s.active ? "🟢 ON" : "🔴 OFF"}`,

    `Version: ${C.VERSION}`,

    "",

    `Balance: ${money(s.balance)}`,

    `Session P&L: ${money(s.sessionPnl)}`,

    `Trades today: ${s.sessionTrades}/${C.MAX_TRADES_DAY}`,

    `Open trades: ${s.openTrades.length}`,

    `Closed trades: ${s.closedTrades.length}`,

    "",

    `Max drawdown: -$${Math.abs(s.maxDrawdown).toFixed(2)}`,

    "",

    `Last feed:`,

    s.lastFeedAt

      ? new Date(
          s.lastFeedAt
        ).toISOString()

      : "never",

    "",

    s.analysis

      ? `Model: ${s.analysis.stage} ${s.analysis.bias} ${s.analysis.score}/100`

      : "Model: waiting"

  ].join("\n");

}


// ============================================================
// STATS
// ============================================================

function fmtStats(
  s
) {

  const ts =
    s.closedTrades;


  const wins =
    ts.filter(
      x =>
        x.pnl >
        0
    ).length;


  const losses =
    ts.filter(
      x =>
        x.pnl <
        0
    ).length;


  const grossProfit =
    ts
      .filter(
        x =>
          x.pnl >
          0
      )
      .reduce(
        (
          z,
          x
        ) =>
          z +
          x.pnl,
        0
      );


  const grossLoss =
    Math.abs(

      ts
        .filter(
          x =>
            x.pnl <
            0
        )
        .reduce(
          (
            z,
            x
          ) =>
            z +
            x.pnl,
          0
        )

    );


  const net =
    ts.reduce(
      (
        z,
        x
      ) =>
        z +
        (
          x.pnl ||
          0
        ),
      0
    );


  const wr =
    wins +
      losses
      ? wins /
        (
          wins +
          losses
        ) *
        100
      : 0;


  const pf =
    grossLoss >
      0

      ? grossProfit /
        grossLoss

      : grossProfit >
        0

      ? Infinity

      : 0;


  const expectancy =
    ts.length
      ? net /
        ts.length
      : 0;


  return [

    "📊👹 NQ PAPER STATS",

    "━━━━━━━━━━━━━━━━",

    `Trades: ${ts.length}`,

    `Wins: ${wins}`,

    `Losses: ${losses}`,

    "",

    `Win rate: ${wr.toFixed(1)}%`,

    `Profit factor: ${Number.isFinite(pf) ? pf.toFixed(2) : "∞"}`,

    `Expectancy/trade: ${money(expectancy)}`,

    "",

    `Net P&L: ${money(net)}`,

    `Balance: ${money(s.balance)}`,

    `Max DD: -$${Math.abs(s.maxDrawdown).toFixed(2)}`

  ].join("\n");

}


// ============================================================
// FORECAST VALIDATION
// ============================================================

function addForecast(
  s,
  kind,
  id,
  side,
  price,
  score,
  time
) {

  s.forecasts.push({

    kind,

    id,

    side,

    price,

    score,

    time,

    r5:
      null,

    r15:
      null,

    r30:
      null,

    mfe:
      0,

    mae:
      0,

    done:
      false

  });


  s.forecasts =
    s.forecasts.slice(
      -C.MAX_FORECASTS
    );

}


// ============================================================
// UPDATE FORECASTS
// ============================================================

function updateForecasts(
  s,
  c
) {

  for (
    const f
    of s.forecasts
  ) {

    if (
      f.done
    ) {

      continue;

    }


    const mins =
      (
        c.time -
        f.time
      ) /
      60000;


    if (
      mins <
        0
    ) {

      continue;

    }


    const fav =

      f.side ===
        "LONG"

        ? c.high -
          f.price

        : f.price -
          c.low;


    const adv =

      f.side ===
        "LONG"

        ? f.price -
          c.low

        : c.high -
          f.price;


    f.mfe =
      Math.max(
        f.mfe,
        fav
      );


    f.mae =
      Math.max(
        f.mae,
        adv
      );


    const dir =

      f.side ===
        "LONG"

        ? c.close -
          f.price

        : f.price -
          c.close;


    if (
      mins >=
        5 &&
      f.r5 ==
        null
    ) {

      f.r5 =
        dir;

    }


    if (
      mins >=
        15 &&
      f.r15 ==
        null
    ) {

      f.r15 =
        dir;

    }


    if (
      mins >=
        30 &&
      f.r30 ==
        null
    ) {

      f.r30 =
        dir;


      f.done =
        true;

    }

  }

}


// ============================================================
// FORECAST STATS
// ============================================================

function fmtForecast(
  s
) {

  const p =
    forecastStats(

      s.forecasts.filter(
        x =>
          x.kind ===
          "PREDICTION"
      )

    );


  const q =
    forecastStats(

      s.forecasts.filter(
        x =>
          x.kind ===
          "SIGNAL"
      )

    );


  return [

    "🔬👹 NQ FORECAST VALIDATION",

    "━━━━━━━━━━━━━━━━",

    "",

    "EARLY PREDICTIONS",

    `Samples: ${p.n}`,

    `5m direction hit: ${pct(p.h5, p.n5)}`,

    `15m direction hit: ${pct(p.h15, p.n15)}`,

    `30m direction hit: ${pct(p.h30, p.n30)}`,

    `Avg MFE: ${p.mfe.toFixed(2)} pts`,

    `Avg MAE: ${p.mae.toFixed(2)} pts`,

    "",

    "CONFIRMED SIGNALS",

    `Samples: ${q.n}`,

    `5m direction hit: ${pct(q.h5, q.n5)}`,

    `15m direction hit: ${pct(q.h15, q.n15)}`,

    `30m direction hit: ${pct(q.h30, q.n30)}`,

    `Avg MFE: ${q.mfe.toFixed(2)} pts`,

    `Avg MAE: ${q.mae.toFixed(2)} pts`

  ].join("\n");

}


// ============================================================
// FORECAST STAT CALC
// ============================================================

function forecastStats(
  xs
) {

  let n5 =
    0;

  let n15 =
    0;

  let n30 =
    0;

  let h5 =
    0;

  let h15 =
    0;

  let h30 =
    0;

  let mfe =
    0;

  let mae =
    0;


  for (
    const x
    of xs
  ) {

    if (
      x.r5 !=
      null
    ) {

      n5++;

      if (
        x.r5 >
        0
      ) {

        h5++;

      }

    }


    if (
      x.r15 !=
      null
    ) {

      n15++;

      if (
        x.r15 >
        0
      ) {

        h15++;

      }

    }


    if (
      x.r30 !=
      null
    ) {

      n30++;

      if (
        x.r30 >
        0
      ) {

        h30++;

      }

    }


    mfe +=
      x.mfe ||
      0;


    mae +=
      x.mae ||
      0;

  }


  return {

    n:
      xs.length,

    n5,

    n15,

    n30,

    h5,

    h15,

    h30,

    mfe:
      xs.length

        ? mfe /
          xs.length

        : 0,

    mae:
      xs.length

        ? mae /
          xs.length

        : 0

  };

}


// ============================================================
// DEFAULT STATE
// ============================================================

function fresh() {

  return {

    active:
      false,

    chatId:
      null,

    balance:
      C.START_BALANCE,

    highWater:
      C.START_BALANCE,

    maxDrawdown:
      0,

    sessionDate:
      null,

    sessionTrades:
      0,

    sessionPnl:
      0,

    previousRth: {

      date:
        null,

      open:
        null,

      high:
        null,

      low:
        null,

      close:
        null

    },

    currentRth: {

      date:
        null,

      open:
        null,

      high:
        null,

      low:
        null,

      close:
        null

    },

    premarket: {

      open:
        null,

      high:
        null,

      low:
        null,

      close:
        null

    },

    orb: {

      high:
        null,

      low:
        null,

      count:
        0,

      locked:
        false

    },

    candles:
      [],

    analysis:
      null,

    lastStage:
      "NORMAL",

    prediction:
      null,

    signals:
      [],

    lastSignal:
      null,

    openTrades:
      [],

    closedTrades:
      [],

    forecasts:
      [],

    lastTradeAt:
      null,

    lastCandleTime:
      null,

    lastFeedAt:
      null

  };

}


// ============================================================
// HYDRATE STATE
// ============================================================

function hydrate(
  x
) {

  const b =
    fresh();


  const s = {

    ...b,

    ...(x || {})

  };


  s.previousRth = {

    ...b.previousRth,

    ...(x?.previousRth || {})

  };


  s.currentRth = {

    ...b.currentRth,

    ...(x?.currentRth || {})

  };


  s.premarket = {

    ...b.premarket,

    ...(x?.premarket || {})

  };


  s.orb = {

    ...b.orb,

    ...(x?.orb || {})

  };


  for (
    const k
    of [
      "candles",
      "signals",
      "openTrades",
      "closedTrades",
      "forecasts"
    ]
  ) {

    if (
      !Array.isArray(
        s[k]
      )
    ) {

      s[k] =
        [];

    }

  }


  return s;

}


// ============================================================
// NEW DAY RESET
// ============================================================

function resetDay(
  s,
  date
) {

  s.sessionDate =
    date;


  s.sessionTrades =
    0;


  s.sessionPnl =
    0;


  s.currentRth = {

    date,

    open:
      null,

    high:
      null,

    low:
      null,

    close:
      null

  };


  s.premarket = {

    open:
      null,

    high:
      null,

    low:
      null,

    close:
      null

  };


  s.orb = {

    high:
      null,

    low:
      null,

    count:
      0,

    locked:
      false

  };


  s.analysis =
    null;


  s.lastStage =
    "NORMAL";


  s.prediction =
    null;


  s.lastTradeAt =
    null;


  // Safety:
  // do not carry modeled trades overnight.

  s.openTrades =
    [];

}


// ============================================================
// KV LOAD
// ============================================================

async function load(
  env
) {

  need(
    env.NQ_STATE,
    "NQ_STATE KV binding missing"
  );


  return hydrate(

    await env.NQ_STATE.get(
      "state",
      "json"
    )

  );

}


// ============================================================
// KV SAVE
// ============================================================

async function save(
  env,
  s
) {

  need(
    env.NQ_STATE,
    "NQ_STATE KV binding missing"
  );


  s.candles =
    s.candles.slice(
      -C.MAX_CANDLES
    );


  s.closedTrades =
    s.closedTrades.slice(
      -C.MAX_TRADES
    );


  s.forecasts =
    s.forecasts.slice(
      -C.MAX_FORECASTS
    );


  await env.NQ_STATE.put(

    "state",

    JSON.stringify(s)

  );

}


// ============================================================
// PUBLIC STATUS
// ============================================================

function publicStatus(
  s
) {

  return {

    version:
      C.VERSION,

    active:
      s.active,

    mode:
      "PAPER TRADING ONLY",

    balance:
      s.balance,

    sessionDate:
      s.sessionDate,

    sessionPnl:
      s.sessionPnl,

    tradesToday:
      s.sessionTrades,

    orb:
      s.orb,

    analysis:
      s.analysis,

    openTrades:
      s.openTrades,

    closedTrades:
      s.closedTrades.length,

    lastFeedAt:
      s.lastFeedAt

  };

}


// ============================================================
// EMA
// ============================================================

function ema(
  xs,
  len
) {

  if (
    !xs.length
  ) {

    return 0;

  }


  const k =
    2 /
    (
      len +
      1
    );


  let v =
    xs[0];


  for (
    let i = 1;
    i < xs.length;
    i++
  ) {

    v =
      xs[i] *
      k +

      v *
      (
        1 -
        k
      );

  }


  return v;

}


// ============================================================
// ATR
// ============================================================

function atr(
  cs,
  len
) {

  if (
    cs.length <
      2
  ) {

    return 10;

  }


  const tr =
    [];


  for (
    let i = 1;
    i < cs.length;
    i++
  ) {

    const c =
      cs[i];


    const p =
      cs[
        i - 1
      ];


    tr.push(

      Math.max(

        c.high -
        c.low,

        Math.abs(
          c.high -
          p.close
        ),

        Math.abs(
          c.low -
          p.close
        )

      )

    );

  }


  return (
    avg(
      tr.slice(
        -len
      )
    ) ||
    10
  );

}


// ============================================================
// RSI
// ============================================================

function rsi(
  xs,
  len
) {

  if (
    xs.length <
      len +
      1
  ) {

    return 50;

  }


  const a =
    xs.slice(
      -(
        len +
        1
      )
    );


  let g =
    0;


  let l =
    0;


  for (
    let i = 1;
    i < a.length;
    i++
  ) {

    const d =
      a[i] -
      a[
        i - 1
      ];


    if (
      d >=
      0
    ) {

      g +=
        d;

    }

    else {

      l -=
        d;

    }

  }


  const ag =
    g /
    len;


  const al =
    l /
    len;


  if (
    al ===
    0
  ) {

    return 100;

  }


  const rs =
    ag /
    al;


  return (
    100 -
    100 /
    (
      1 +
      rs
    )
  );

}


// ============================================================
// ADX / DMI
// ============================================================

function dmi(
  cs,
  len
) {

  if (
    cs.length <
      len +
      2
  ) {

    return {

      adx:
        15,

      plus:
        0,

      minus:
        0

    };

  }


  const tr =
    [];


  const pdm =
    [];


  const mdm =
    [];


  for (
    let i = 1;
    i < cs.length;
    i++
  ) {

    const c =
      cs[i];


    const p =
      cs[
        i - 1
      ];


    const up =
      c.high -
      p.high;


    const dn =
      p.low -
      c.low;


    pdm.push(

      up >
        dn &&
      up >
        0

        ? up

        : 0

    );


    mdm.push(

      dn >
        up &&
      dn >
        0

        ? dn

        : 0

    );


    tr.push(

      Math.max(

        c.high -
        c.low,

        Math.abs(
          c.high -
          p.close
        ),

        Math.abs(
          c.low -
          p.close
        )

      )

    );

  }


  const T =
    sum(
      tr.slice(
        -len
      )
    );


  const P =
    sum(
      pdm.slice(
        -len
      )
    );


  const M =
    sum(
      mdm.slice(
        -len
      )
    );


  const plus =
    T >
      0
      ? 100 *
        P /
        T
      : 0;


  const minus =
    T >
      0
      ? 100 *
        M /
        T
      : 0;


  const dx =
    [];


  for (

    let end =
      Math.max(
        len,
        tr.length -
        len *
        2
      );

    end <=
      tr.length;

    end++

  ) {

    const tt =
      sum(
        tr.slice(
          Math.max(
            0,
            end -
            len
          ),
          end
        )
      );


    const pp =
      sum(
        pdm.slice(
          Math.max(
            0,
            end -
            len
          ),
          end
        )
      );


    const mm =
      sum(
        mdm.slice(
          Math.max(
            0,
            end -
            len
          ),
          end
        )
      );


    if (
      tt <=
        0
    ) {

      continue;

    }


    const pdi =
      100 *
      pp /
      tt;


    const mdi =
      100 *
      mm /
      tt;


    const den =
      pdi +
      mdi;


    if (
      den >
        0
    ) {

      dx.push(

        100 *
        Math.abs(
          pdi -
          mdi
        ) /
        den

      );

    }

  }


  return {

    adx:
      avg(
        dx.slice(
          -len
        )
      ) ||
      15,

    plus,

    minus

  };

}


// ============================================================
// RTH VWAP
// ============================================================

function rthVwap(
  cs,
  date
) {

  let pv =
    0;


  let v =
    0;


  for (
    const c
    of cs
  ) {

    const n =
      nyParts(
        c.time
      );


    const d =
      dateKey(n);


    const m =
      n.hour *
      60 +
      n.minute;


    if (

      d !==
        date ||

      m <
        C.RTH_OPEN ||

      m >=
        C.RTH_CLOSE

    ) {

      continue;

    }


    const typical =
      (
        c.high +
        c.low +
        c.close
      ) /
      3;


    pv +=
      typical *
      c.volume;


    v +=
      c.volume;

  }


  return v >
    0

    ? pv /
      v

    : cs.at(-1)?.close ||
      0;

}


// ============================================================
// AGGREGATE 1M → 5M
// ============================================================

function aggregate(
  cs,
  mins
) {

  const map =
    new Map();


  for (
    const c
    of cs
  ) {

    const n =
      nyParts(
        c.time
      );


    const d =
      dateKey(n);


    const m =
      n.hour *
      60 +
      n.minute;


    const b =
      Math.floor(
        m /
        mins
      ) *
      mins;


    const key =
      `${d}-${b}`;


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        {

          open:
            c.open,

          high:
            c.high,

          low:
            c.low,

          close:
            c.close,

          volume:
            c.volume

        }
      );

    }

    else {

      const x =
        map.get(
          key
        );


      x.high =
        Math.max(
          x.high,
          c.high
        );


      x.low =
        Math.min(
          x.low,
          c.low
        );


      x.close =
        c.close;


      x.volume +=
        c.volume;

    }

  }


  return [
    ...map.values()
  ];

}


// ============================================================
// TIME NEW YORK
// ============================================================

function nyParts(
  t
) {

  const ps =
    new Intl.DateTimeFormat(

      "en-US",

      {

        timeZone:
          "America/New_York",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        hourCycle:
          "h23"

      }

    ).formatToParts(
      new Date(t)
    );


  const m =
    Object.fromEntries(

      ps.map(
        x => [
          x.type,
          x.value
        ]
      )

    );


  return {

    year:
      +m.year,

    month:
      +m.month,

    day:
      +m.day,

    hour:
      +m.hour,

    minute:
      +m.minute

  };

}


// ============================================================
// DATE KEY
// ============================================================

function dateKey(
  n
) {

  return (
    `${n.year}-` +
    `${String(n.month).padStart(2, "0")}-` +
    `${String(n.day).padStart(2, "0")}`
  );

}


// ============================================================
// BASIC MATH
// ============================================================

function avg(
  xs
) {

  return xs.length

    ? sum(xs) /
      xs.length

    : 0;

}


function sum(
  xs
) {

  return xs.reduce(

    (
      a,
      b
    ) =>
      a +
      Number(
        b ||
        0
      ),

    0

  );

}


function sumObj(
  o
) {

  return sum(
    Object.values(o)
  );

}


function clamp(
  x,
  a,
  b
) {

  return Math.max(
    a,
    Math.min(
      b,
      x
    )
  );

}


// ============================================================
// NQ TICK ROUNDING
// ============================================================

function roundTick(
  x
) {

  return (
    Math.round(
      x /
      C.TICK
    ) *
    C.TICK
  );

}


// ============================================================
// FORMAT PRICE
// ============================================================

function px(
  x
) {

  return Number.isFinite(
    Number(x)
  )

    ? Number(x).toFixed(2)

    : "N/A";

}


// ============================================================
// FORMAT SIGNED
// ============================================================

function signed(
  x
) {

  x =
    Number(
      x ||
      0
    );


  return (
    `${x >= 0 ? "+" : ""}` +
    x.toFixed(2)
  );

}


// ============================================================
// MONEY
// ============================================================

function money(
  x
) {

  x =
    Number(
      x ||
      0
    );


  return (
    `${x >= 0 ? "+" : "-"}$` +
    Math.abs(x).toFixed(2)
  );

}


// ============================================================
// PERCENT
// ============================================================

function pct(
  h,
  n
) {

  return n

    ? `${
        (
          100 *
          h /
          n
        ).toFixed(1)
      }% (${h}/${n})`

    : "N/A";

}


// ============================================================
// REQUIRE
// ============================================================

function need(
  x,
  msg
) {

  if (!x) {

    throw new Error(
      msg
    );

  }

}


// ============================================================
// CONSTANT-TIME-ish SECRET COMPARE
// ============================================================

function safeEq(
  a,
  b
) {

  if (
    a.length !==
    b.length
  ) {

    return false;

  }


  let d =
    0;


  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    d |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);

  }


  return d ===
    0;

}


// ============================================================
// JSON RESPONSE
// ============================================================

function out(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {

      status,

      headers: {

        "Content-Type":
          "application/json",

        "Cache-Control":
          "no-store"

      }

    }

  );

}
