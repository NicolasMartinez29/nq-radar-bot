# 👹 NQ RADAR V1 — FROM ZERO

A completely separate project from SOL RADAR.

**Nothing in this repo should point to the SOL Worker, SOL KV namespace, or SOL Telegram bot.**

## What it does

TradingView sends **closed 1-minute NQ candles** to a Cloudflare Worker.

The Worker:

- builds the 09:30–09:45 ET Opening Range;
- requires a candle **close** outside the OR;
- evaluates 1m FVG, EMA 9/21, VWAP, volume and momentum;
- assigns LONG and SHORT scores;
- can open a **PAPER NQ trade automatically** when the score reaches the configured threshold;
- uses NQ paper value of **$20 per point per contract**;
- manages SL / TP1 / TP2 using each 1-minute candle's high and low;
- moves the paper stop to breakeven after TP1;
- sends Telegram alerts automatically;
- records paper stats in its own Cloudflare KV namespace.

## Important

This is **paper trading only**.

There is no broker API, no exchange credential, no live order endpoint and no function for real order execution.

Paper performance is not evidence that the strategy will be profitable live.

## Files

- `worker.js` — NQ brain + paper engine + webhooks
- `telegram.js` — Telegram sender
- `wrangler.toml` — Cloudflare config
- `tradingview/NQ_Radar_Feed_V1.pine` — TradingView 1m candle feed
- `SETUP_FROM_ZERO.md` — exact setup order
- `.gitignore`

## Secrets

Never commit these:

- `TELEGRAM_BOT_TOKEN`
- `NQ_FEED_SECRET`

They belong in Cloudflare Worker **Secrets**.
