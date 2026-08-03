const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Discord Webhook Dispatcher
async function sendDiscordWebhook(url, payload) {
  if (!url || !url.startsWith('https://discord.com/api/webhooks/')) return false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (err) {
    console.error('Discord Webhook Error:', err.message);
    return false;
  }
}

// Database Initialization
function initDatabase() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const defaultData = {
      status: {
        onlinePlayers: 174,
        maxPlayers: 250,
        whitelistOpen: true,
        discordMembers: '14.8k',
        ip: 'play.donutcityrp.com',
        season: 'Season 04'
      },
      webhooks: {
        whitelistWebhook: '',
        patchNotesWebhook: ''
      },
      updates: [
        {
          id: 'upd-101',
          title: 'Season 04: Retrowave Garage & Economy Overhaul',
          type: 'major',
          typeText: '🚀 Major Content',
          date: 'July 28, 2026',
          author: 'DevTeam (Donut City Admin)',
          bullets: [
            '🚘 Added 15 new imported hypercars with custom RGB retrowave underglows.',
            '🏢 Introduced 8 new player-purchasable mechanic shops and bakeries.',
            '💰 Rebalanced legal job payouts (Mining, Trucking, Garbage Collector +25%).',
            '🏦 Remodeled Pacific Standard Bank interior with new multi-stage hacking minigame.'
          ]
        },
        {
          id: 'upd-102',
          title: 'Patch 4.1.5: LSPD Fleet Refresh & Weapon Balancing',
          type: 'patch',
          typeText: '🛠️ Patch Notes',
          date: 'July 22, 2026',
          author: 'Lead Scripter Viper',
          bullets: [
            '🚓 Upgraded LSPD Pursuit Interceptors with improved acceleration and spike strip gear.',
            '🔫 Adjusted recoil patterns for SMG and Combat Pistol for tactical gunplay.',
            '💊 Increased EMS Medkit healing speed and added stretcher transport animation.',
            '🔧 Fixed vehicle door lock glitch when spawning inside garages.'
          ]
        }
      ],
      whitelistApps: [
        {
          id: 'app-001',
          discordTag: 'Johnny_Viper#1029',
          steamHex: 'steam:11000010a2b3c4',
          age: 22,
          backstory: 'Former street racer seeking to build a legal automotive repair Empire in Donut City.',
          scenario: 'I would comply with the hostage takers to preserve my life and inform police after release.',
          status: 'Approved',
          submittedAt: '2026-07-29T14:30:00.000Z'
        }
      ],
      rules: [
        {
          category: '1. General Roleplay & FailRP',
          content: 'All players must maintain character integrity at all times. FailRP is strictly prohibited.'
        },
        {
          category: '2. FearRP & Hostage Guidelines',
          content: 'When held at gunpoint or outnumbered by armed players, your character must show realistic fear for their life.'
        }
      ]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
  }
}

function readDB() {
  initDatabase();
  const raw = fs.readFileSync(DB_FILE);
  const data = JSON.parse(raw);
  if (!data.webhooks) {
    data.webhooks = { whitelistWebhook: '', patchNotesWebhook: '' };
  }
  return data;
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// REST API ENDPOINTS

// Admin Auth
app.post('/api/admin/login', (req, res) => {
  const { passcode } = req.body;
  if (passcode === 'donutadmin2026') {
    return res.json({ success: true, token: 'donut-admin-session-8839' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid admin passcode' });
  }
});

// Server Status API
app.get('/api/status', (req, res) => res.json(readDB().status));
app.put('/api/status', (req, res) => {
  const db = readDB();
  db.status = { ...db.status, ...req.body };
  writeDB(db);
  res.json({ success: true, status: db.status });
});

// Webhook Config API
app.get('/api/webhooks', (req, res) => res.json(readDB().webhooks));
app.put('/api/webhooks', (req, res) => {
  const db = readDB();
  db.webhooks = { ...db.webhooks, ...req.body };
  writeDB(db);
  res.json({ success: true, webhooks: db.webhooks });
});

app.post('/api/webhooks/test', async (req, res) => {
  const { type, url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'Missing Webhook URL' });

  const testPayload = {
    username: "Donut City RP Bot",
    embeds: [{
      title: "🍩 DONUT CITY DISCORD WEBHOOK TEST",
      description: `Successfully connected ${type === 'whitelist' ? 'Whitelist Logs' : 'Patch Notes'} channel webhook!`,
      color: 0x00f0ff,
      fields: [
        { name: "Server IP", value: "play.donutcityrp.com", inline: true },
        { name: "Status", value: "Online & Ready", inline: true }
      ],
      footer: { text: "Donut City RP Web Portal Admin Console" },
      timestamp: new Date().toISOString()
    }]
  };

  const sent = await sendDiscordWebhook(url, testPayload);
  res.json({ success: sent });
});

// Whitelist Applications CRUD
app.get('/api/whitelist', (req, res) => res.json(readDB().whitelistApps));

app.post('/api/whitelist', async (req, res) => {
  const db = readDB();
  const { discordTag, steamHex, age, backstory, scenario } = req.body;

  if (!discordTag || !steamHex || !backstory) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const newApp = {
    id: `app-${Date.now()}`,
    discordTag,
    steamHex,
    age: parseInt(age) || 18,
    backstory,
    scenario: scenario || 'N/A',
    status: 'Pending',
    submittedAt: new Date().toISOString()
  };

  db.whitelistApps.unshift(newApp);
  writeDB(db);

  if (db.webhooks.whitelistWebhook) {
    const embedPayload = {
      username: "Donut City Whitelist Bot",
      embeds: [{
        title: "📄 NEW WHITELIST APPLICATION SUBMITTED",
        color: 0xff007f,
        fields: [
          { name: "Discord Tag", value: `\`${discordTag}\``, inline: true },
          { name: "Steam / CFX Hex", value: `\`${steamHex}\``, inline: true },
          { name: "Age", value: `${age} years old`, inline: true },
          { name: "RP Character Backstory", value: backstory },
          { name: "Scenario Response", value: scenario }
        ],
        footer: { text: `App ID: ${newApp.id} • Review in Admin Panel (/admin)` },
        timestamp: newApp.submittedAt
      }]
    };
    sendDiscordWebhook(db.webhooks.whitelistWebhook, embedPayload);
  }

  res.json({ success: true, application: newApp });
});

app.put('/api/whitelist/:id/status', async (req, res) => {
  const db = readDB();
  const { status } = req.body;
  const appItem = db.whitelistApps.find(a => a.id === req.params.id);

  if (!appItem) return res.status(404).json({ success: false, message: 'App not found' });

  appItem.status = status;
  writeDB(db);

  if (db.webhooks.whitelistWebhook) {
    const isApproved = status === 'Approved';
    const statusEmbed = {
      username: "Donut City Whitelist Bot",
      embeds: [{
        title: isApproved ? "✅ WHITELIST APPLICATION APPROVED" : "❌ WHITELIST APPLICATION REJECTED",
        color: isApproved ? 0x00ff88 : 0xff0055,
        fields: [
          { name: "Applicant", value: `\`${appItem.discordTag}\``, inline: true },
          { name: "Steam Hex", value: `\`${appItem.steamHex}\``, inline: true },
          { name: "New Status", value: `**${status.toUpperCase()}**`, inline: true }
        ],
        footer: { text: "Donut City Staff Management Console" },
        timestamp: new Date().toISOString()
      }]
    };
    sendDiscordWebhook(db.webhooks.whitelistWebhook, statusEmbed);
  }

  res.json({ success: true, application: appItem });
});

// DELETE Whitelist Application
app.delete('/api/whitelist/:id', (req, res) => {
  const db = readDB();
  const initialLength = db.whitelistApps.length;
  db.whitelistApps = db.whitelistApps.filter(a => a.id !== req.params.id);

  if (db.whitelistApps.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Application not found' });
  }

  writeDB(db);
  res.json({ success: true });
});

// Server Patch Notes / Updates CRUD
app.get('/api/updates', (req, res) => res.json(readDB().updates));

app.post('/api/updates', async (req, res) => {
  const db = readDB();
  const { title, type, author, bullets } = req.body;

  const newUpdate = {
    id: `upd-${Date.now()}`,
    title: title || 'Untitled Update',
    type: type || 'patch',
    typeText: type === 'major' ? '🚀 Major Content' : type === 'event' ? '🎉 Community Event' : '🛠️ Patch Notes',
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    author: author || 'Donut City Admin',
    bullets: Array.isArray(bullets) ? bullets : [bullets]
  };

  db.updates.unshift(newUpdate);
  writeDB(db);

  if (db.webhooks.patchNotesWebhook) {
    const patchEmbed = {
      username: "Donut City Update Announcer",
      embeds: [{
        title: `📢 ${newUpdate.title}`,
        color: type === 'major' ? 0xff007f : type === 'event' ? 0xffb700 : 0x00f0ff,
        description: newUpdate.bullets.map(b => `• ${b}`).join('\n'),
        fields: [
          { name: "Category", value: newUpdate.typeText, inline: true },
          { name: "Posted By", value: newUpdate.author, inline: true }
        ],
        footer: { text: "Donut City Next Gen Roleplay • Web Portal" },
        timestamp: new Date().toISOString()
      }]
    };
    sendDiscordWebhook(db.webhooks.patchNotesWebhook, patchEmbed);
  }

  res.json({ success: true, update: newUpdate });
});

// DELETE Patch Note / Update Entry
app.delete('/api/updates/:id', (req, res) => {
  const db = readDB();
  const initialLength = db.updates.length;
  db.updates = db.updates.filter(u => u.id !== req.params.id);

  if (db.updates.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Update not found' });
  }

  writeDB(db);
  res.json({ success: true });
});

// Server Rules CRUD
app.get('/api/rules', (req, res) => res.json(readDB().rules));

app.post('/api/rules', (req, res) => {
  const db = readDB();
  const { category, content } = req.body;

  if (!category || !content) {
    return res.status(400).json({ success: false, message: 'Category and Content required' });
  }

  db.rules.push({ category, content });
  writeDB(db);
  res.json({ success: true, rules: db.rules });
});

app.delete('/api/rules/:index', (req, res) => {
  const db = readDB();
  const index = parseInt(req.params.index);

  if (isNaN(index) || index < 0 || index >= db.rules.length) {
    return res.status(404).json({ success: false, message: 'Invalid rule index' });
  }

  db.rules.splice(index, 1);
  writeDB(db);
  res.json({ success: true, rules: db.rules });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

initDatabase();
app.listen(PORT, () => {
  console.log(`🍩 DONUT CITY FULL CRUD BACKEND RUNNING AT http://localhost:${PORT}`);
});
