'use strict';

const { spawn } = require('child_process');

const baseUrl = `http://127.0.0.1:${process.env.PORT || 3100}`;
const timeoutAt = Date.now() + 45000;
let output = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function waitForHealth() {
  while (Date.now() < timeoutAt) {
    try {
      const response = await request('/api/health');
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not become healthy.\n${output}`);
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: process.env.PORT || '3100',
      BOOTSTRAP_ADMIN_USERNAME: 'smokeadmin',
      BOOTSTRAP_ADMIN_EMAIL: 'smoke@example.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'SmokeTestPassword!2026',
      APP_ENCRYPTION_KEY: 'smoke-test-encryption-key-that-is-long-enough',
      FIVEM_BRIDGE_SECRET: 'smoke-test-bridge-secret-that-is-long-enough',
      FIVEM_SERVER_URL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', chunk => { output += chunk.toString(); process.stdout.write(chunk); });
  server.stderr.on('data', chunk => { output += chunk.toString(); process.stderr.write(chunk); });

  try {
    await waitForHealth();

    const statusResponse = await request('/api/status');
    assert(statusResponse.ok, 'Public status endpoint failed');
    const status = await statusResponse.json();
    assert(typeof status.onlinePlayers === 'number', 'Status did not contain a numeric player count');

    const loginResponse = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'smokeadmin', password: 'SmokeTestPassword!2026' })
    });
    const loginBody = await loginResponse.json();
    assert(loginResponse.ok && loginBody.success, `Login failed: ${JSON.stringify(loginBody)}`);
    assert(loginBody.csrfToken, 'Login did not return a CSRF token');

    const setCookie = loginResponse.headers.get('set-cookie');
    assert(setCookie, 'Login did not set a session cookie');
    const cookie = setCookie.split(';')[0];

    const meResponse = await request('/api/auth/me', { headers: { Cookie: cookie } });
    const meBody = await meResponse.json();
    assert(meResponse.ok && meBody.user.role === 'superadmin', `Session check failed: ${JSON.stringify(meBody)}`);
    assert(meBody.csrfToken, 'Session check did not rotate the CSRF token');

    const dashboardResponse = await request('/api/admin/dashboard', { headers: { Cookie: cookie } });
    assert(dashboardResponse.ok, `Protected dashboard failed with HTTP ${dashboardResponse.status}`);

    const settingsResponse = await request('/api/admin/settings', { headers: { Cookie: cookie } });
    const settings = await settingsResponse.json();
    assert(settingsResponse.ok && settings.serverIp, `Admin settings failed: ${JSON.stringify(settings)}`);

    const saveResponse = await request('/api/admin/settings', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': meBody.csrfToken },
      body: JSON.stringify({
        serverIp: settings.serverIp,
        season: settings.season,
        maxPlayersFallback: settings.maxPlayersFallback,
        discordMembers: settings.discordMembers,
        whitelistOpen: settings.whitelistOpen,
        maintenanceMode: settings.maintenanceMode
      })
    });
    assert(saveResponse.ok, `CSRF-protected settings update failed with HTTP ${saveResponse.status}`);

    const logoutResponse = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': meBody.csrfToken }
    });
    assert(logoutResponse.ok, `Logout failed with HTTP ${logoutResponse.status}`);

    const afterLogout = await request('/api/admin/dashboard', { headers: { Cookie: cookie } });
    assert(afterLogout.status === 401, 'Session remained valid after logout');

    console.log('Smoke test completed successfully.');
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 5000);
      server.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
