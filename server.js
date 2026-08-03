'use strict';

const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const ROOT = __dirname;
const isProduction = process.env.NODE_ENV === 'production';

const config = {
  port: Number(process.env.PORT || 3000),
  trustProxy: process.env.TRUST_PROXY === 'true',
  databaseUrl: process.env.DATABASE_URL || '',
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'donutcity',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'donutcity_portal'
  },
  sessionHours: Math.max(1, Number(process.env.SESSION_HOURS || 12)),
  encryptionKey: process.env.APP_ENCRYPTION_KEY || process.env.SESSION_SECRET || '',
  fivemUrl: (process.env.FIVEM_SERVER_URL || '').replace(/\/$/, ''),
  fivemPollMs: Math.max(5000, Number(process.env.FIVEM_POLL_INTERVAL_MS || 10000)),
  fivemTimeoutMs: Math.max(1000, Number(process.env.FIVEM_TIMEOUT_MS || 3000)),
  heartbeatStaleMs: Math.max(15000, Number(process.env.FIVEM_HEARTBEAT_STALE_MS || 45000)),
  bridgeSecret: process.env.FIVEM_BRIDGE_SECRET || '',
  bootstrapUsername: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin',
  bootstrapEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || null,
  bootstrapPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || ''
};

if (config.trustProxy) app.set('trust proxy', 1);

const pool = config.databaseUrl
  ? mysql.createPool({ uri: config.databaseUrl, waitForConnections: true, connectionLimit: 10, namedPlaceholders: true })
  : mysql.createPool({ ...config.database, waitForConnections: true, connectionLimit: 10, namedPlaceholders: true });

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '128kb' }));

const SESSION_COOKIE = 'donut_admin_session';
const ROLE_PERMISSIONS = {
  superadmin: ['*'],
  admin: ['dashboard:read', 'whitelist:read', 'whitelist:write', 'content:read', 'content:write', 'settings:read', 'settings:write', 'webhooks:read', 'webhooks:write', 'audit:read'],
  moderator: ['dashboard:read', 'whitelist:read', 'whitelist:write'],
  content: ['dashboard:read', 'content:read', 'content:write']
};

const sseClients = new Set();
const bridgeStates = new Map();
let liveStatus = {
  online: false,
  players: 0,
  maxPlayers: 0,
  instances: {},
  servers: {},
  source: 'not-configured',
  stale: true,
  updatedAt: null,
  failures: 0
};

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(req) {
  const result = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function setSessionCookie(res, token, expiresAt) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${expiresAt.toUTCString()}`
  ];
  if (isProduction) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res) {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isProduction) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function scrypt(password, salt, keyLength = 64) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt);
  return `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  try {
    const [algorithm, , , , salt, expectedHex] = String(encoded).split('$');
    if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
    const derived = await scrypt(password, salt, Buffer.from(expectedHex, 'hex').length);
    return safeEqual(derived.toString('hex'), expectedHex);
  } catch {
    return false;
  }
}

function encryptionKey() {
  if (!config.encryptionKey) {
    if (isProduction) throw new Error('APP_ENCRYPTION_KEY is required in production');
    return crypto.createHash('sha256').update('donutcity-development-only-key').digest();
  }
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  const [ivHex, tagHex, dataHex] = String(value).split('.');
  if (!ivHex || !tagHex || !dataHex) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

function maskWebhook(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[2] || '';
    return `${url.origin}/api/webhooks/${id.slice(0, 4)}********/********`;
  } catch {
    return 'Configured';
  }
}

function isDiscordWebhook(value) {
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === 'discord.com' || url.hostname === 'discordapp.com';
    return url.protocol === 'https:' && allowedHost && url.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

function createRateLimiter({ windowMs, max, prefix }) {
  const entries = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of entries) if (value.resetAt <= now) entries.delete(key);
  }, Math.min(windowMs, 60000));
  timer.unref();

  return (req, res, next) => {
    const key = `${prefix}:${req.ip}`;
    const now = Date.now();
    let item = entries.get(key);
    if (!item || item.resetAt <= now) item = { count: 0, resetAt: now + windowMs };
    item.count += 1;
    entries.set(key, item);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - item.count)));
    if (item.count > max) return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    next();
  };
}

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, prefix: 'login' });
const whitelistLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5, prefix: 'whitelist' });

async function initializeDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS admin_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL,
      email VARCHAR(190) NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('superadmin','admin','moderator','content') NOT NULL DEFAULT 'moderator',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
      locked_until DATETIME NULL,
      last_login_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_admin_users_username (username),
      UNIQUE KEY uq_admin_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      id CHAR(36) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      csrf_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      last_seen_at DATETIME NOT NULL,
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_admin_sessions_token (token_hash),
      KEY idx_admin_sessions_user_expiry (user_id, expires_at),
      CONSTRAINT fk_admin_sessions_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(60) NULL,
      target_id VARCHAR(80) NULL,
      metadata JSON NULL,
      ip_address VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_audit_created (created_at),
      KEY idx_audit_user (user_id),
      CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS site_settings (
      id TINYINT UNSIGNED NOT NULL DEFAULT 1,
      whitelist_open TINYINT(1) NOT NULL DEFAULT 1,
      discord_members VARCHAR(30) NOT NULL DEFAULT '0',
      server_ip VARCHAR(190) NOT NULL DEFAULT 'play.donutcityrp.com',
      season VARCHAR(80) NOT NULL DEFAULT 'Season 04',
      max_players_fallback INT UNSIGNED NOT NULL DEFAULT 250,
      maintenance_mode TINYINT(1) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS discord_webhooks (
      id TINYINT UNSIGNED NOT NULL DEFAULT 1,
      whitelist_webhook TEXT NULL,
      patch_notes_webhook TEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS whitelist_applications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      discord_tag VARCHAR(100) NOT NULL,
      steam_hex VARCHAR(100) NOT NULL,
      age TINYINT UNSIGNED NOT NULL,
      backstory TEXT NOT NULL,
      scenario TEXT NOT NULL,
      status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
      review_note TEXT NULL,
      reviewed_by BIGINT UNSIGNED NULL,
      reviewed_at DATETIME NULL,
      submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_whitelist_status_date (status, submitted_at),
      KEY idx_whitelist_identity (discord_tag, steam_hex),
      CONSTRAINT fk_whitelist_reviewer FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS portal_updates (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(180) NOT NULL,
      type ENUM('patch','major','event') NOT NULL DEFAULT 'patch',
      author VARCHAR(100) NOT NULL,
      bullets JSON NOT NULL,
      is_published TINYINT(1) NOT NULL DEFAULT 1,
      published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_updates_published (is_published, published_at),
      CONSTRAINT fk_updates_creator FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS server_rules (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      category VARCHAR(180) NOT NULL,
      content TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_published TINYINT(1) NOT NULL DEFAULT 1,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_rules_order (is_published, sort_order, id),
      CONSTRAINT fk_rules_creator FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS fivem_heartbeats (
      server_id VARCHAR(60) NOT NULL,
      payload JSON NOT NULL,
      received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (server_id),
      KEY idx_heartbeats_received (received_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS app_migrations (
      name VARCHAR(120) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  for (const sql of statements) await pool.query(sql);
  await pool.query(`INSERT IGNORE INTO site_settings (id) VALUES (1)`);
  await pool.query(`INSERT IGNORE INTO discord_webhooks (id) VALUES (1)`);
}

async function migrateLegacyJson() {
  const migrationName = 'legacy-db-json-v1';
  const [applied] = await pool.query('SELECT name FROM app_migrations WHERE name = ?', [migrationName]);
  if (applied.length) return;

  const legacyPath = path.join(ROOT, 'data', 'db.json');
  if (!fs.existsSync(legacyPath)) {
    await pool.query('INSERT INTO app_migrations (name) VALUES (?)', [migrationName]);
    return;
  }

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch (error) {
    console.warn('Legacy db.json was not imported:', error.message);
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const status = legacy.status || {};
    await connection.query(
      `UPDATE site_settings SET whitelist_open=?, discord_members=?, server_ip=?, season=?, max_players_fallback=? WHERE id=1`,
      [status.whitelistOpen !== false, String(status.discordMembers || '0'), String(status.ip || 'play.donutcityrp.com'), String(status.season || 'Season 04'), Number(status.maxPlayers || 250)]
    );

    const [updateCount] = await connection.query('SELECT COUNT(*) AS total FROM portal_updates');
    if (Number(updateCount[0].total) === 0) {
      for (const item of legacy.updates || []) {
        await connection.query(
          `INSERT INTO portal_updates (title, type, author, bullets, published_at) VALUES (?, ?, ?, ?, ?)`,
          [String(item.title || 'Untitled Update'), ['patch', 'major', 'event'].includes(item.type) ? item.type : 'patch', String(item.author || 'Donut City Admin'), JSON.stringify(Array.isArray(item.bullets) ? item.bullets : []), item.date ? new Date(item.date) : new Date()]
        );
      }
    }

    const [appCount] = await connection.query('SELECT COUNT(*) AS total FROM whitelist_applications');
    if (Number(appCount[0].total) === 0) {
      for (const item of legacy.whitelistApps || []) {
        await connection.query(
          `INSERT INTO whitelist_applications (discord_tag, steam_hex, age, backstory, scenario, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [String(item.discordTag || ''), String(item.steamHex || ''), Number(item.age || 18), String(item.backstory || ''), String(item.scenario || ''), ['Pending', 'Approved', 'Rejected'].includes(item.status) ? item.status : 'Pending', item.submittedAt ? new Date(item.submittedAt) : new Date()]
        );
      }
    }

    const [ruleCount] = await connection.query('SELECT COUNT(*) AS total FROM server_rules');
    if (Number(ruleCount[0].total) === 0) {
      let order = 0;
      for (const item of legacy.rules || []) {
        await connection.query('INSERT INTO server_rules (category, content, sort_order) VALUES (?, ?, ?)', [String(item.category || ''), String(item.content || ''), order++]);
      }
    }

    await connection.query('INSERT INTO app_migrations (name) VALUES (?)', [migrationName]);
    await connection.commit();
    console.log('Imported legacy data/db.json into MySQL.');
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function bootstrapAdmin() {
  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM admin_users');
  if (Number(rows[0].total) > 0) return;

  let password = config.bootstrapPassword;
  if (!password) {
    if (isProduction) throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required for the first production startup');
    password = crypto.randomBytes(15).toString('base64url');
    console.warn(`Generated development admin password for ${config.bootstrapUsername}: ${password}`);
  }
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters');

  const passwordHash = await hashPassword(password);
  await pool.query(
    'INSERT INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [config.bootstrapUsername.trim(), config.bootstrapEmail, passwordHash, 'superadmin']
  );
  console.log(`Created bootstrap superadmin account: ${config.bootstrapUsername}`);
}

async function loadRecentHeartbeats() {
  const [rows] = await pool.query('SELECT server_id, payload, received_at FROM fivem_heartbeats WHERE received_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE)');
  for (const row of rows) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    bridgeStates.set(row.server_id, { ...payload, receivedAt: new Date(row.received_at).getTime() });
  }
  aggregateBridgeStatus();
}

function userPayload(row) {
  return { id: Number(row.id), username: row.username, email: row.email, role: row.role };
}

async function requireAuth(req, res, next) {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return res.status(401).json({ success: false, message: 'Authentication required' });
    const tokenHash = sha256(token);
    const [rows] = await pool.query(
      `SELECT s.id AS session_id, s.csrf_hash, s.expires_at, u.id, u.username, u.email, u.role
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = 1
       LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length) {
      clearSessionCookie(res);
      return res.status(401).json({ success: false, message: 'Session expired' });
    }
    req.auth = { sessionId: rows[0].session_id, csrfHash: rows[0].csrf_hash, user: userPayload(rows[0]) };
    pool.query('UPDATE admin_sessions SET last_seen_at = NOW() WHERE id = ?', [rows[0].session_id]).catch(() => {});
    next();
  } catch (error) {
    next(error);
  }
}

function requireCsrf(req, res, next) {
  const token = req.get('x-csrf-token') || '';
  if (!token || !safeEqual(sha256(token), req.auth.csrfHash)) {
    return res.status(403).json({ success: false, message: 'Invalid CSRF token' });
  }
  next();
}

function hasPermission(user, permission) {
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.auth.user, permission)) return res.status(403).json({ success: false, message: 'Insufficient permission' });
    next();
  };
}

async function audit(req, action, targetType = null, targetId = null, metadata = null) {
  try {
    await pool.query(
      'INSERT INTO admin_audit_logs (user_id, action, target_type, target_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.auth?.user?.id || null, action, targetType, targetId ? String(targetId) : null, metadata ? JSON.stringify(metadata) : null, req.ip]
    );
  } catch (error) {
    console.error('Audit log failure:', error.message);
  }
}

async function getSettings() {
  const [rows] = await pool.query('SELECT * FROM site_settings WHERE id = 1');
  return rows[0];
}

async function getPublicStatus() {
  const settings = await getSettings();
  return {
    online: Boolean(liveStatus.online) && !Boolean(settings.maintenance_mode),
    onlinePlayers: Number(liveStatus.players || 0),
    maxPlayers: Number(liveStatus.maxPlayers || settings.max_players_fallback || 250),
    instances: liveStatus.instances || {},
    servers: liveStatus.servers || {},
    source: liveStatus.source,
    stale: Boolean(liveStatus.stale),
    updatedAt: liveStatus.updatedAt,
    whitelistOpen: Boolean(settings.whitelist_open),
    discordMembers: settings.discord_members,
    ip: settings.server_ip,
    season: settings.season,
    maintenanceMode: Boolean(settings.maintenance_mode)
  };
}

async function broadcastStatus() {
  if (!sseClients.size) return;
  try {
    const payload = `data: ${JSON.stringify(await getPublicStatus())}\n\n`;
    for (const client of sseClients) client.write(payload);
  } catch (error) {
    console.error('Status broadcast failure:', error.message);
  }
}

function aggregateBridgeStatus() {
  const now = Date.now();
  const active = [...bridgeStates.entries()].filter(([, state]) => now - state.receivedAt <= config.heartbeatStaleMs);
  if (!active.length) return false;

  let players = 0;
  let maxPlayers = 0;
  const servers = {};
  for (const [serverId, state] of active) {
    const total = Math.max(0, Number(state.totalPlayers || 0));
    const max = Math.max(total, Number(state.maxPlayers || 0));
    players += total;
    maxPlayers += max;
    servers[serverId] = { players: total, maxPlayers: max, instances: state.instances || {} };
  }

  const instances = active.length === 1 ? active[0][1].instances || {} : Object.fromEntries(active.map(([serverId, state]) => [serverId, Number(state.totalPlayers || 0)]));
  liveStatus = {
    online: true,
    players,
    maxPlayers,
    instances,
    servers,
    source: 'fivem-bridge',
    stale: false,
    updatedAt: new Date(Math.max(...active.map(([, state]) => state.receivedAt))).toISOString(),
    failures: 0
  };
  broadcastStatus();
  return true;
}

function extractMaxPlayers(dynamic, fallback) {
  const candidates = [dynamic?.sv_maxclients, dynamic?.svMaxclients, dynamic?.maxClients, dynamic?.vars?.sv_maxClients, fallback];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 250;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fivemTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function pollFiveM() {
  if (aggregateBridgeStatus()) return;
  if (!config.fivemUrl) {
    liveStatus = { ...liveStatus, online: false, stale: true, source: 'not-configured' };
    broadcastStatus();
    return;
  }

  try {
    const settings = await getSettings();
    const [playersPayload, dynamicPayload] = await Promise.all([
      fetchJson(`${config.fivemUrl}/players.json`),
      fetchJson(`${config.fivemUrl}/dynamic.json`).catch(() => ({}))
    ]);
    const players = Array.isArray(playersPayload) ? playersPayload.length : Math.max(0, Number(dynamicPayload.clients || 0));
    liveStatus = {
      online: true,
      players,
      maxPlayers: extractMaxPlayers(dynamicPayload, settings.max_players_fallback),
      instances: {},
      servers: {},
      source: 'fivem-endpoint',
      stale: false,
      updatedAt: new Date().toISOString(),
      failures: 0
    };
  } catch (error) {
    const failures = Number(liveStatus.failures || 0) + 1;
    liveStatus = { ...liveStatus, failures, stale: true, online: failures < 3 && liveStatus.online, source: 'fivem-endpoint' };
    if (failures === 1 || failures % 10 === 0) console.warn('FiveM status poll failed:', error.message);
  }
  broadcastStatus();
}

async function getWebhook(kind) {
  const [rows] = await pool.query('SELECT whitelist_webhook, patch_notes_webhook FROM discord_webhooks WHERE id = 1');
  const encrypted = kind === 'whitelist' ? rows[0]?.whitelist_webhook : rows[0]?.patch_notes_webhook;
  return decryptSecret(encrypted);
}

async function sendDiscordWebhook(kind, payload) {
  const webhook = await getWebhook(kind);
  if (!webhook || !isDiscordWebhook(webhook)) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);
    return response.ok;
  } catch (error) {
    console.error(`Discord ${kind} webhook failed:`, error.message);
    return false;
  }
}

function parseJsonColumn(value, fallback = []) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapApplication(row) {
  return {
    id: String(row.id),
    discordTag: row.discord_tag,
    steamHex: row.steam_hex,
    age: Number(row.age),
    backstory: row.backstory,
    scenario: row.scenario,
    status: row.status,
    reviewNote: row.review_note,
    submittedAt: new Date(row.submitted_at).toISOString(),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null
  };
}

function mapUpdate(row) {
  return {
    id: String(row.id),
    title: row.title,
    type: row.type,
    typeText: row.type === 'major' ? '🚀 Major Content' : row.type === 'event' ? '🎉 Community Event' : '🛠️ Patch Notes',
    date: new Date(row.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    author: row.author,
    bullets: parseJsonColumn(row.bullets, []),
    isPublished: Boolean(row.is_published)
  };
}

function mapRule(row) {
  return { id: String(row.id), category: row.category, content: row.content, sortOrder: Number(row.sort_order), isPublished: Boolean(row.is_published) };
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected', uptime: process.uptime() });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.get('/api/status', async (req, res, next) => {
  try { res.json(await getPublicStatus()); } catch (error) { next(error); }
});

app.get('/api/status/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  sseClients.add(res);
  res.write(`data: ${JSON.stringify(await getPublicStatus())}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/updates', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM portal_updates WHERE is_published = 1 ORDER BY published_at DESC, id DESC LIMIT 100');
    res.json(rows.map(mapUpdate));
  } catch (error) { next(error); }
});

app.get('/api/rules', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM server_rules WHERE is_published = 1 ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(mapRule));
  } catch (error) { next(error); }
});

app.post('/api/whitelist', whitelistLimiter, async (req, res, next) => {
  try {
    const discordTag = String(req.body.discordTag || '').trim();
    const steamHex = String(req.body.steamHex || '').trim();
    const age = Number(req.body.age);
    const backstory = String(req.body.backstory || '').trim();
    const scenario = String(req.body.scenario || '').trim();
    if (discordTag.length < 2 || discordTag.length > 100 || steamHex.length < 4 || steamHex.length > 100 || !Number.isInteger(age) || age < 16 || age > 99 || backstory.length < 30 || backstory.length > 5000 || scenario.length < 20 || scenario.length > 3000) {
      return res.status(400).json({ success: false, message: 'Please complete all fields using valid information.' });
    }
    const [duplicates] = await pool.query(
      `SELECT id FROM whitelist_applications WHERE deleted_at IS NULL AND status='Pending' AND (LOWER(discord_tag)=LOWER(?) OR LOWER(steam_hex)=LOWER(?)) LIMIT 1`,
      [discordTag, steamHex]
    );
    if (duplicates.length) return res.status(409).json({ success: false, message: 'A pending application already exists for this Discord or FiveM identifier.' });

    const [result] = await pool.query(
      'INSERT INTO whitelist_applications (discord_tag, steam_hex, age, backstory, scenario) VALUES (?, ?, ?, ?, ?)',
      [discordTag, steamHex, age, backstory, scenario]
    );
    const application = { id: String(result.insertId), discordTag, steamHex, age, backstory, scenario, status: 'Pending', submittedAt: new Date().toISOString() };
    sendDiscordWebhook('whitelist', {
      username: 'Donut City Whitelist Bot',
      embeds: [{ title: '📄 NEW WHITELIST APPLICATION', color: 0xff007f, fields: [
        { name: 'Discord', value: discordTag, inline: true },
        { name: 'FiveM / Steam', value: steamHex, inline: true },
        { name: 'Age', value: String(age), inline: true },
        { name: 'Backstory', value: backstory.slice(0, 1024) },
        { name: 'Scenario', value: scenario.slice(0, 1024) }
      ], footer: { text: `Application #${result.insertId}` }, timestamp: new Date().toISOString() }]
    }).catch(() => {});
    res.status(201).json({ success: true, application });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const login = String(req.body.login || '').trim();
    const password = String(req.body.password || '');
    if (!login || !password) return res.status(400).json({ success: false, message: 'Username/email and password are required.' });

    const [rows] = await pool.query('SELECT * FROM admin_users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?) LIMIT 1', [login, login]);
    const user = rows[0];
    const locked = user?.locked_until && new Date(user.locked_until).getTime() > Date.now();
    const valid = user && user.is_active && !locked && await verifyPassword(password, user.password_hash);
    if (!valid) {
      if (user && !locked) {
        const attempts = Number(user.failed_attempts || 0) + 1;
        const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await pool.query('UPDATE admin_users SET failed_attempts=?, locked_until=? WHERE id=?', [attempts >= 5 ? 0 : attempts, lockUntil, user.id]);
      }
      return res.status(401).json({ success: false, message: locked ? 'Account temporarily locked. Try again later.' : 'Invalid login credentials.' });
    }

    const token = crypto.randomBytes(48).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
    const sessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO admin_sessions (id, user_id, token_hash, csrf_hash, expires_at, last_seen_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [sessionId, user.id, sha256(token), sha256(csrfToken), expiresAt, req.ip, String(req.get('user-agent') || '').slice(0, 255)]
    );
    await pool.query('UPDATE admin_users SET failed_attempts=0, locked_until=NULL, last_login_at=NOW() WHERE id=?', [user.id]);
    setSessionCookie(res, token, expiresAt);
    req.auth = { user: userPayload(user) };
    await audit(req, 'auth.login', 'admin_user', user.id);
    res.json({ success: true, user: userPayload(user), csrfToken });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    await pool.query('UPDATE admin_sessions SET csrf_hash=? WHERE id=?', [sha256(csrfToken), req.auth.sessionId]);
    req.auth.csrfHash = sha256(csrfToken);
    res.json({ success: true, user: req.auth.user, csrfToken });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', requireAuth, requireCsrf, async (req, res, next) => {
  try {
    await audit(req, 'auth.logout', 'admin_session', req.auth.sessionId);
    await pool.query('DELETE FROM admin_sessions WHERE id=?', [req.auth.sessionId]);
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.post('/api/auth/change-password', requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 12) return res.status(400).json({ success: false, message: 'New password must contain at least 12 characters.' });
    const [rows] = await pool.query('SELECT password_hash FROM admin_users WHERE id=?', [req.auth.user.id]);
    if (!rows.length || !await verifyPassword(currentPassword, rows[0].password_hash)) return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    await pool.query('UPDATE admin_users SET password_hash=? WHERE id=?', [await hashPassword(newPassword), req.auth.user.id]);
    await pool.query('DELETE FROM admin_sessions WHERE user_id=? AND id<>?', [req.auth.user.id, req.auth.sessionId]);
    await audit(req, 'auth.password_changed', 'admin_user', req.auth.user.id);
    res.json({ success: true });
  } catch (error) { next(error); }
});

const adminRouter = express.Router();
adminRouter.use(requireAuth);

adminRouter.get('/dashboard', requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const [[apps], [updates], [users], [audits], status] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, SUM(status='Pending') AS pending FROM whitelist_applications WHERE deleted_at IS NULL`),
      pool.query('SELECT COUNT(*) AS total FROM portal_updates WHERE is_published=1'),
      pool.query('SELECT COUNT(*) AS total FROM admin_users WHERE is_active=1'),
      pool.query('SELECT COUNT(*) AS total FROM admin_audit_logs WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)'),
      getPublicStatus()
    ]);
    res.json({ applications: Number(apps[0].total), pendingApplications: Number(apps[0].pending || 0), publishedUpdates: Number(updates[0].total), activeAdmins: Number(users[0].total), auditEvents24h: Number(audits[0].total), status });
  } catch (error) { next(error); }
});

adminRouter.get('/whitelist', requirePermission('whitelist:read'), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM whitelist_applications WHERE deleted_at IS NULL ORDER BY submitted_at DESC LIMIT 500');
    res.json(rows.map(mapApplication));
  } catch (error) { next(error); }
});

adminRouter.put('/whitelist/:id/status', requireCsrf, requirePermission('whitelist:write'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '');
    const reviewNote = String(req.body.reviewNote || '').trim().slice(0, 3000) || null;
    if (!['Pending', 'Approved', 'Rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
    const [result] = await pool.query(
      `UPDATE whitelist_applications SET status=?, review_note=?, reviewed_by=?, reviewed_at=NOW() WHERE id=? AND deleted_at IS NULL`,
      [status, reviewNote, req.auth.user.id, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Application not found.' });
    await audit(req, 'whitelist.status_updated', 'whitelist_application', req.params.id, { status });
    const [rows] = await pool.query('SELECT * FROM whitelist_applications WHERE id=?', [req.params.id]);
    const application = mapApplication(rows[0]);
    sendDiscordWebhook('whitelist', {
      username: 'Donut City Whitelist Bot',
      embeds: [{ title: status === 'Approved' ? '✅ WHITELIST APPROVED' : status === 'Rejected' ? '❌ WHITELIST REJECTED' : '↩️ WHITELIST RESET', color: status === 'Approved' ? 0x00ff88 : status === 'Rejected' ? 0xff0055 : 0xffb700, fields: [{ name: 'Applicant', value: application.discordTag, inline: true }, { name: 'Status', value: status, inline: true }], footer: { text: `Reviewed by ${req.auth.user.username}` }, timestamp: new Date().toISOString() }]
    }).catch(() => {});
    res.json({ success: true, application });
  } catch (error) { next(error); }
});

adminRouter.delete('/whitelist/:id', requireCsrf, requirePermission('whitelist:write'), async (req, res, next) => {
  try {
    const [result] = await pool.query('UPDATE whitelist_applications SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Application not found.' });
    await audit(req, 'whitelist.deleted', 'whitelist_application', req.params.id);
    res.json({ success: true });
  } catch (error) { next(error); }
});

adminRouter.get('/updates', requirePermission('content:read'), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM portal_updates ORDER BY published_at DESC, id DESC LIMIT 500');
    res.json(rows.map(mapUpdate));
  } catch (error) { next(error); }
});

adminRouter.post('/updates', requireCsrf, requirePermission('content:write'), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const type = ['patch', 'major', 'event'].includes(req.body.type) ? req.body.type : 'patch';
    const author = String(req.body.author || req.auth.user.username).trim();
    const bullets = Array.isArray(req.body.bullets) ? req.body.bullets.map(value => String(value).trim()).filter(Boolean).slice(0, 30) : [];
    if (title.length < 3 || title.length > 180 || author.length < 2 || author.length > 100 || !bullets.length || bullets.some(value => value.length > 1000)) return res.status(400).json({ success: false, message: 'Invalid patch note content.' });
    const [result] = await pool.query('INSERT INTO portal_updates (title, type, author, bullets, created_by) VALUES (?, ?, ?, ?, ?)', [title, type, author, JSON.stringify(bullets), req.auth.user.id]);
    await audit(req, 'update.created', 'portal_update', result.insertId, { title, type });
    const [rows] = await pool.query('SELECT * FROM portal_updates WHERE id=?', [result.insertId]);
    const update = mapUpdate(rows[0]);
    sendDiscordWebhook('patchnotes', { username: 'Donut City Update Announcer', embeds: [{ title: `📢 ${title}`, description: bullets.map(item => `• ${item}`).join('\n').slice(0, 4000), color: type === 'major' ? 0xff007f : type === 'event' ? 0xffb700 : 0x00f0ff, fields: [{ name: 'Posted by', value: author, inline: true }], timestamp: new Date().toISOString() }] }).catch(() => {});
    res.status(201).json({ success: true, update });
  } catch (error) { next(error); }
});

adminRouter.delete('/updates/:id', requireCsrf, requirePermission('content:write'), async (req, res, next) => {
  try {
    const [result] = await pool.query('DELETE FROM portal_updates WHERE id=?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Update not found.' });
    await audit(req, 'update.deleted', 'portal_update', req.params.id);
    res.json({ success: true });
  } catch (error) { next(error); }
});

adminRouter.get('/rules', requirePermission('content:read'), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM server_rules ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(mapRule));
  } catch (error) { next(error); }
});

adminRouter.post('/rules', requireCsrf, requirePermission('content:write'), async (req, res, next) => {
  try {
    const category = String(req.body.category || '').trim();
    const content = String(req.body.content || '').trim();
    if (category.length < 2 || category.length > 180 || content.length < 10 || content.length > 10000) return res.status(400).json({ success: false, message: 'Invalid rule content.' });
    const [orderRows] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM server_rules');
    const [result] = await pool.query('INSERT INTO server_rules (category, content, sort_order, created_by) VALUES (?, ?, ?, ?)', [category, content, Number(orderRows[0].next_order), req.auth.user.id]);
    await audit(req, 'rule.created', 'server_rule', result.insertId, { category });
    res.status(201).json({ success: true });
  } catch (error) { next(error); }
});

adminRouter.delete('/rules/:id', requireCsrf, requirePermission('content:write'), async (req, res, next) => {
  try {
    const [result] = await pool.query('DELETE FROM server_rules WHERE id=?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Rule not found.' });
    await audit(req, 'rule.deleted', 'server_rule', req.params.id);
    res.json({ success: true });
  } catch (error) { next(error); }
});

adminRouter.get('/settings', requirePermission('settings:read'), async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({ whitelistOpen: Boolean(settings.whitelist_open), discordMembers: settings.discord_members, serverIp: settings.server_ip, season: settings.season, maxPlayersFallback: Number(settings.max_players_fallback), maintenanceMode: Boolean(settings.maintenance_mode), live: await getPublicStatus() });
  } catch (error) { next(error); }
});

adminRouter.put('/settings', requireCsrf, requirePermission('settings:write'), async (req, res, next) => {
  try {
    const whitelistOpen = Boolean(req.body.whitelistOpen);
    const discordMembers = String(req.body.discordMembers || '0').trim().slice(0, 30);
    const serverIp = String(req.body.serverIp || '').trim().slice(0, 190);
    const season = String(req.body.season || '').trim().slice(0, 80);
    const maxPlayersFallback = Math.min(5000, Math.max(1, Number(req.body.maxPlayersFallback || 250)));
    const maintenanceMode = Boolean(req.body.maintenanceMode);
    if (!serverIp || !season) return res.status(400).json({ success: false, message: 'Server IP and season are required.' });
    await pool.query('UPDATE site_settings SET whitelist_open=?, discord_members=?, server_ip=?, season=?, max_players_fallback=?, maintenance_mode=? WHERE id=1', [whitelistOpen, discordMembers, serverIp, season, maxPlayersFallback, maintenanceMode]);
    await audit(req, 'settings.updated', 'site_settings', 1);
    await broadcastStatus();
    res.json({ success: true });
  } catch (error) { next(error); }
});

adminRouter.get('/webhooks', requirePermission('webhooks:read'), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT whitelist_webhook, patch_notes_webhook FROM discord_webhooks WHERE id=1');
    const whitelist = decryptSecret(rows[0]?.whitelist_webhook);
    const patchnotes = decryptSecret(rows[0]?.patch_notes_webhook);
    res.json({ whitelistConfigured: Boolean(whitelist), whitelistMasked: maskWebhook(whitelist), patchNotesConfigured: Boolean(patchnotes), patchNotesMasked: maskWebhook(patchnotes) });
  } catch (error) { next(error); }
});

adminRouter.put('/webhooks', requireCsrf, requirePermission('webhooks:write'), async (req, res, next) => {
  try {
    const kind = req.body.kind === 'patchnotes' ? 'patchnotes' : 'whitelist';
    const value = String(req.body.url || '').trim();
    if (value && !isDiscordWebhook(value)) return res.status(400).json({ success: false, message: 'A valid Discord webhook URL is required.' });
    const column = kind === 'patchnotes' ? 'patch_notes_webhook' : 'whitelist_webhook';
    await pool.query(`UPDATE discord_webhooks SET ${column}=? WHERE id=1`, [value ? encryptSecret(value) : null]);
    await audit(req, 'webhook.updated', 'discord_webhook', kind, { configured: Boolean(value) });
    res.json({ success: true });
  } catch (error) { next(error); }
});

adminRouter.post('/webhooks/test', requireCsrf, requirePermission('webhooks:write'), async (req, res, next) => {
  try {
    const kind = req.body.kind === 'patchnotes' ? 'patchnotes' : 'whitelist';
    const sent = await sendDiscordWebhook(kind, { username: 'Donut City Portal', embeds: [{ title: '✅ Webhook test successful', description: `The ${kind} webhook is connected to the secured admin portal.`, color: 0x00f0ff, timestamp: new Date().toISOString() }] });
    await audit(req, 'webhook.tested', 'discord_webhook', kind, { sent });
    res.status(sent ? 200 : 400).json({ success: sent, message: sent ? 'Webhook sent.' : 'Webhook is not configured or Discord rejected it.' });
  } catch (error) { next(error); }
});

adminRouter.get('/users', requirePermission('*'), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, username, email, role, is_active, last_login_at, created_at FROM admin_users ORDER BY created_at DESC');
    res.json(rows.map(row => ({ id: String(row.id), username: row.username, email: row.email, role: row.role, isActive: Boolean(row.is_active), lastLoginAt: row.last_login_at, createdAt: row.created_at })));
  } catch (error) { next(error); }
});

adminRouter.post('/users', requireCsrf, requirePermission('*'), async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim() || null;
    const password = String(req.body.password || '');
    const role = ['superadmin', 'admin', 'moderator', 'content'].includes(req.body.role) ? req.body.role : 'moderator';
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username) || password.length < 12) return res.status(400).json({ success: false, message: 'Username must be 3-50 characters and password must be at least 12 characters.' });
    const [result] = await pool.query('INSERT INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [username, email, await hashPassword(password), role]);
    await audit(req, 'admin_user.created', 'admin_user', result.insertId, { username, role });
    res.status(201).json({ success: true });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Username or email already exists.' });
    next(error);
  }
});

adminRouter.patch('/users/:id', requireCsrf, requirePermission('*'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId < 1) return res.status(400).json({ success: false, message: 'Invalid user.' });
    const updates = [];
    const values = [];
    if (typeof req.body.isActive === 'boolean') {
      if (targetId === req.auth.user.id && req.body.isActive === false) return res.status(400).json({ success: false, message: 'You cannot disable your own account.' });
      updates.push('is_active=?'); values.push(req.body.isActive);
    }
    if (req.body.role !== undefined) {
      if (!['superadmin', 'admin', 'moderator', 'content'].includes(req.body.role)) return res.status(400).json({ success: false, message: 'Invalid role.' });
      updates.push('role=?'); values.push(req.body.role);
    }
    if (req.body.password) {
      if (String(req.body.password).length < 12) return res.status(400).json({ success: false, message: 'Password must be at least 12 characters.' });
      updates.push('password_hash=?'); values.push(await hashPassword(String(req.body.password)));
    }
    if (!updates.length) return res.status(400).json({ success: false, message: 'No changes supplied.' });
    values.push(targetId);
    const [result] = await pool.query(`UPDATE admin_users SET ${updates.join(', ')} WHERE id=?`, values);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Admin user not found.' });
    if (req.body.isActive === false || req.body.password) await pool.query('DELETE FROM admin_sessions WHERE user_id=?', [targetId]);
    await audit(req, 'admin_user.updated', 'admin_user', targetId, { fields: updates.map(value => value.split('=')[0]) });
    res.json({ success: true });
  } catch (error) { next(error); }
});

adminRouter.get('/audit', requirePermission('audit:read'), async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const [rows] = await pool.query(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.ip_address, a.created_at, u.username
       FROM admin_audit_logs a LEFT JOIN admin_users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ?`,
      [limit]
    );
    res.json(rows.map(row => ({ id: String(row.id), action: row.action, targetType: row.target_type, targetId: row.target_id, metadata: parseJsonColumn(row.metadata, {}), ipAddress: row.ip_address, createdAt: row.created_at, username: row.username || 'System' })));
  } catch (error) { next(error); }
});

app.use('/api/admin', adminRouter);

app.post('/api/internal/fivem/heartbeat', async (req, res, next) => {
  try {
    if (!config.bridgeSecret) return res.status(503).json({ success: false, message: 'Bridge is not configured.' });
    const authorization = req.get('authorization') || '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!safeEqual(supplied, config.bridgeSecret)) return res.status(401).json({ success: false, message: 'Invalid bridge secret.' });

    const serverId = String(req.body.serverId || '').trim().slice(0, 60);
    const timestamp = Number(req.body.timestamp);
    const totalPlayers = Math.max(0, Number(req.body.totalPlayers || 0));
    const maxPlayers = Math.max(totalPlayers, Number(req.body.maxPlayers || 0));
    const incomingInstances = req.body.instances && typeof req.body.instances === 'object' ? req.body.instances : {};
    if (!serverId || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60000 || !Number.isFinite(totalPlayers) || !Number.isFinite(maxPlayers)) return res.status(400).json({ success: false, message: 'Invalid or stale heartbeat.' });

    const instances = {};
    for (const [key, value] of Object.entries(incomingInstances).slice(0, 100)) {
      const count = Math.max(0, Number(value || 0));
      if (Number.isFinite(count)) instances[String(key).slice(0, 60)] = count;
    }
    const payload = { serverId, timestamp, totalPlayers, maxPlayers, instances };
    bridgeStates.set(serverId, { ...payload, receivedAt: Date.now() });
    await pool.query(
      `INSERT INTO fivem_heartbeats (server_id, payload, received_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE payload=VALUES(payload), received_at=NOW()`,
      [serverId, JSON.stringify(payload)]
    );
    aggregateBridgeStatus();
    res.json({ success: true, receivedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

function sendFile(name, cacheControl = 'no-cache') {
  return (req, res) => {
    res.setHeader('Cache-Control', cacheControl);
    res.sendFile(path.join(ROOT, name));
  };
}

app.get(['/', '/index.html'], sendFile('index.html'));
app.get(['/admin', '/admin.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, 'admin.html'));
});
app.get('/styles.css', sendFile('styles.css', 'public, max-age=3600'));
app.get('/app.js', sendFile('app.js', 'no-cache'));
app.get('/admin.js', sendFile('admin.js', 'no-store'));
app.use('/assets', express.static(path.join(ROOT, 'assets'), { dotfiles: 'deny', fallthrough: false, maxAge: '1d' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, message: 'API route not found.' });
  res.status(404).send('Not found');
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ success: false, message: isProduction ? 'Internal server error.' : error.message });
});

async function start() {
  await initializeDatabase();
  await migrateLegacyJson();
  await bootstrapAdmin();
  await loadRecentHeartbeats();
  await pollFiveM();

  const server = app.listen(config.port, () => {
    console.log(`🍩 Donut City portal running on http://localhost:${config.port}`);
  });

  const pollTimer = setInterval(pollFiveM, config.fivemPollMs);
  const sessionTimer = setInterval(() => pool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW()').catch(() => {}), 60 * 60 * 1000);
  const sseTimer = setInterval(() => {
    for (const client of sseClients) client.write(': keepalive\n\n');
  }, 25000);
  pollTimer.unref();
  sessionTimer.unref();
  sseTimer.unref();

  const shutdown = async signal => {
    console.log(`${signal} received; shutting down.`);
    clearInterval(pollTimer);
    clearInterval(sessionTimer);
    clearInterval(sseTimer);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(error => {
  console.error('Portal startup failed:', error);
  process.exit(1);
});
