# NQ RADAR V3 PREDATOR — NO FEED SECRET

Clean upload package.

Upload ONLY:
- worker.js
- wrangler.toml
- package.json
- .gitignore
- README.md
- NQ_Radar_V3_Predator_Feed.pine

Cloudflare:
- Worker: nq-radar-bot
- KV binding: NQ_STATE
- KV ID: 22f2eaa05764422fb0fc669c1915f563
- Only required secret: TELEGRAM_BOT_TOKEN
- NQ_FEED_SECRET: NOT USED

/feed accepts only source IPs in the TradingView webhook allowlist inside worker.js.

After deploy:
1. /debug/version
2. /setup
3. Telegram /start
4. Telegram /testsignal
5. Add Pine to 1-minute NQ TradingView chart
6. Alert condition: Any alert() function call
7. Webhook: https://nq-radar-bot.29rkvh42bd.workers.dev/feed

PAPER TRADING ONLY.
