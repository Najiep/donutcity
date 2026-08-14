# Vercel setup

Required environment variables in the Vercel project:

- `NEXT_PUBLIC_FIVEM_JOIN_CODE=alq4yz`
- `NEXT_PUBLIC_DISCORD_URL=https://discord.gg/pv8FUfdqXz`
- `ADMIN_PASSWORD=<choose-a-strong-password>`
- `ADMIN_SESSION_SECRET=<long-random-secret>`
- `FIVEM_SERVER_BASE_URL=<publicly reachable FXServer base URL>`

`127.0.0.1:30120` is only for local development and must be replaced for the deployed live player count.

The current file-based admin update storage should be migrated to persistent storage before relying on admin saves in production.
