# SETUP FROM ZERO — DO THIS IN ORDER

Do **not** touch the SOL project.

---

## 1. Create a NEW GitHub repository

Name:

`nq-radar-bot`

Upload the **contents of this extracted folder** to that repository.

Do not upload this ZIP as the only file.

---

## 2. Create a NEW Telegram bot

In BotFather:

`/newbot`

Suggested display name:

`NQ Signals`

Suggested username:

`NQ_Radar_Pulse_bot`

Save its token privately.

Do not paste the token into GitHub.

---

## 3. Create a NEW Cloudflare KV namespace

Create a KV namespace named:

`nq-radar-state`

Copy the namespace ID.

Open `wrangler.toml` and replace:

`REPLACE_WITH_YOUR_NEW_NQ_KV_NAMESPACE_ID`

with the new NQ KV namespace ID.

This KV must be separate from SOL.

---

## 4. Create/connect a NEW Cloudflare Worker

Worker name:

`nq-radar-bot1`

Connect it to the new GitHub repository.

Deploy command:

`npx wrangler deploy`

The repository contains `package.json`, so Cloudflare can install Wrangler.

---

## 5. Add TWO Worker secrets

In the NQ Worker settings add:

### Secret 1

Name:

`TELEGRAM_BOT_TOKEN`

Value:

the token of the NEW NQ Telegram bot.

### Secret 2

Name:

`NQ_FEED_SECRET`

Value:

make a long random private string.

Example shape only:

`nq-feed-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

Do not use that literal example.

Do not put either secret in GitHub.

---

## 6. Deploy

After the deployment succeeds, open:

`https://YOUR-NQ-WORKER.workers.dev/debug/version`

You should see:

`NQ RADAR V1 FROM ZERO`

Then open:

`https://YOUR-NQ-WORKER.workers.dev/setup`

Expected important fields:

- `"ok": true`
- webhook URL ends in `/telegram`

---

## 7. Test Telegram

Open the NEW NQ bot and send:

`/start`

Then:

`/testsignal`

The bot should answer.

At this point Telegram + Cloudflare are connected, but NQ market data is not connected yet.

---

## 8. Add the TradingView feed

Open TradingView.

Use a **1-minute NQ chart**.

For a continuous contract, a common TradingView symbol is:

`CME_MINI:NQ1!`

Confirm the symbol/data feed available in your own TradingView account.

Open Pine Editor.

Paste the entire file:

`tradingview/NQ_Radar_Feed_V1.pine`

Add it to chart.

Open the indicator settings and put the SAME private value used in Cloudflare for:

`NQ_FEED_SECRET`

---

## 9. Create the TradingView alert

Create Alert.

Condition:

`NQ RADAR FEED V1 — FROM ZERO`

Select:

`Any alert() function call`

Webhook URL:

`https://YOUR-NQ-WORKER.workers.dev/feed`

The script itself creates the JSON message.

Make sure the chart is 1 minute.

---

## 10. Confirm the feed

Wait for a closed 1-minute candle.

Then send to Telegram:

`/scan`

If everything is working you should see NQ price, ORB state, EMA, VWAP, score and bias.

You can also open:

`https://YOUR-NQ-WORKER.workers.dev/status`

---

# PAPER ENGINE RULES

- simulated instrument: NQ
- point value: $20/point
- contracts: 1
- starting paper balance: $50,000
- max paper risk per trade: $500
- daily paper loss limit: $1,000
- max trades per session: 2
- max open trades: 1
- cooldown: 20 minutes
- Opening Range: 09:30–09:45 ET
- forced paper exit: 15:55 ET
- signal threshold: 75/100

Score:

- close outside ORB: 30
- 1m FVG: 20
- EMA 9/21 trend: 15
- VWAP filter: 15
- volume confirmation: 10
- momentum candle: 10

Total: 100.

---

# TELEGRAM COMMANDS

`/start` — turn paper engine ON

`/stop` — turn paper engine OFF

`/status` — status

`/scan` — latest TradingView analysis

`/why` — score breakdown

`/stats` — paper results

`/last` — last confirmed signal

`/testsignal` — test Telegram pipeline

---

# VERY IMPORTANT

The TradingView alert is the market-data heartbeat.

Cloudflare cannot analyze NQ candles it never receives.

Once the TradingView alert is created on TradingView's servers, your local PC does not need to stay open for the alert itself, subject to TradingView's alert service/account behavior.
