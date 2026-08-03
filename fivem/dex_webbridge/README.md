# dex_webbridge

Server-only FiveM resource that sends the real player count, `sv_maxClients`, and player totals per routing bucket to the Donut City website.

## Installation

1. Copy `dex_webbridge` into your FiveM resources folder.
2. Add the following to `server.cfg` before `ensure dex_webbridge`:

```cfg
set donut_webbridge_url "https://your-domain.example/api/internal/fivem/heartbeat"
set donut_webbridge_secret "USE_THE_SAME_LONG_SECRET_AS_FIVEM_BRIDGE_SECRET"
set donut_webbridge_server_id "main"
set donut_webbridge_interval_ms "10000"

ensure dex_webbridge
```

The secret must match `FIVEM_BRIDGE_SECRET` in the website backend environment. Use HTTPS in production. Never commit the real secret.

## Counts

- `totalPlayers`: all connected players in this FXServer process.
- `maxPlayers`: value from `sv_maxClients`.
- `instances`: player count grouped by routing bucket (`0`, `1`, `2`, and so on).

For several separate FXServer processes, install the resource on each and use a unique `donut_webbridge_server_id`. The website aggregates all active heartbeats.
