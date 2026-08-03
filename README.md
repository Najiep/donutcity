# Donut City Portal v2

Production-ready FiveM community portal with:

- MySQL/MariaDB persistence
- Secure admin username/password login and logout
- HttpOnly server-side sessions and CSRF protection
- Role-based permissions
- Admin audit logs
- Whitelist, patch note, rule, settings, webhook, and admin-user management
- Encrypted Discord webhook storage
- Live FiveM player counts using standard server endpoints
- Optional `dex_webbridge` for routing-bucket and multi-server counts
- Server-Sent Events for automatic live status updates

## Requirements

- Node.js 20.6+
- MySQL 8+ or MariaDB 10.6+
- HTTPS reverse proxy for production

## 1. Create the database

```sql
CREATE DATABASE donutcity_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'donutcity'@'localhost' IDENTIFIED BY 'replace_this_password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
ON donutcity_portal.* TO 'donutcity'@'localhost';
FLUSH PRIVILEGES;
```

The application creates and upgrades its own tables at startup. Existing `data/db.json` content is imported once into MySQL.

## 2. Configure the environment

```bash
cp .env.example .env
```

Fill in the database credentials, bootstrap admin password, encryption key, FiveM URL, and bridge secret.

- Local development: `npm run dev` loads `.env` through Node's built-in `--env-file` support.
- Production: supply the same variables through your process manager or hosting provider and run `npm start`.

Generate strong secrets, for example:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 3. Install and run

```bash
npm install
npm run check
npm run dev
```

For production:

```bash
npm start
```

Open:

- Portal: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin`
- Health check: `http://localhost:3000/api/health`

On the first startup, the account from `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` is created as a superadmin. The bootstrap values no longer overwrite the account after it exists.

## Live player count

### Standard FiveM endpoint fallback

Set:

```env
FIVEM_SERVER_URL=http://127.0.0.1:30120
```

The backend polls `players.json` and `dynamic.json`. The browser never connects directly to port `30120`.

### Routing-bucket counts

Install `fivem/dex_webbridge` on the FiveM server and configure the convars shown in its README. This becomes the preferred source and provides counts per routing bucket.

For a single FXServer process, `onlinePlayers / maxPlayers` represents the full process while `instances` shows the routing-bucket distribution. For several FXServer processes, use a unique bridge server ID on each server; the portal aggregates active heartbeats.

## Admin roles

- `superadmin`: complete access, including account management
- `admin`: whitelist, content, public settings, webhooks, and audit logs
- `moderator`: whitelist review
- `content`: patch notes and rules

## Production deployment

Use a process manager such as systemd or PM2 and put Nginx, Caddy, or another HTTPS reverse proxy in front of Node. Set `NODE_ENV=production` and `TRUST_PROXY=true` when the reverse proxy correctly forwards the client IP and protocol.

Do not expose the MySQL port, FiveM bridge secret, encryption key, or Discord webhook URLs publicly. Back up the database regularly.
