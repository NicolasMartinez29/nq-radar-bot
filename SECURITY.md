# Security

This repo is intentionally paper-only.

Never commit:

- Telegram bot tokens
- `NQ_FEED_SECRET`
- broker credentials
- exchange credentials

The Worker accepts market-feed POSTs only when the JSON `secret` matches the Cloudflare secret `NQ_FEED_SECRET`.

There is no live-order endpoint in this project.
