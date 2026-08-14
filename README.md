# Donut City FiveM Website

Configured for local development.

## Current setup

- Website: `http://localhost:3000`
- Local FXServer API: `http://127.0.0.1:30120`
- FiveM join code: `alq4yz`
- Discord: `https://discord.gg/pv8FUfdqXz`

The website reads:

- `/dynamic.json` for server status/counts
- `/players.json` for live players
- `/info.json` for server information

## Run

Start your FiveM/FXServer first, then run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

You can also test the FiveM HTTP endpoint directly:

```text
http://127.0.0.1:30120/info.json
http://127.0.0.1:30120/dynamic.json
http://127.0.0.1:30120/players.json
```

## When you deploy the website later

Change:

```env
FIVEM_SERVER_BASE_URL=http://127.0.0.1:30120
```

to the public IP/domain and FiveM HTTP port that your hosted website can reach.

Do not put your Cfx.re license key in the website.

## Player count privacy

The website displays only the total online player count and max server slots. Individual player names and IDs are not rendered on the website.

## Admin Dashboard

Open locally at:

```text
http://localhost:3000/admin
```

Set the admin credentials through environment variables:

```env
ADMIN_PASSWORD=your-new-password
ADMIN_SESSION_SECRET=your-long-random-secret
```

The admin dashboard lets you create, edit, feature, and delete patch notes.

Patch notes currently use `data/updates.json`. For Vercel production, migrate admin saves to persistent storage before relying on writes.
