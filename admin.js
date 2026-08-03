'use strict';

const API_BASE = '/api';
const state = {
  user: null,
  csrfToken: '',
  applications: [],
  updates: [],
  rules: [],
  users: [],
  audits: [],
  appFilter: 'all',
  statusStream: null
};

const roleAccess = {
  superadmin: new Set(['content', 'settings', 'webhooks', 'superadmin', 'audit']),
  admin: new Set(['content', 'settings', 'webhooks', 'audit']),
  moderator: new Set([]),
  content: new Set(['content'])
};

document.addEventListener('DOMContentLoaded', checkSession);

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    method,
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login')) showLogin();
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

async function checkSession() {
  try {
    const data = await api('/auth/me');
    authenticate(data);
  } catch {
    showLogin();
  }
}

function authenticate(data) {
  state.user = data.user;
  state.csrfToken = data.csrfToken;
  document.getElementById('auth-modal').classList.remove('active');
  document.getElementById('admin-dashboard').style.display = 'block';
  document.getElementById('admin-user-name').textContent = state.user.username;
  document.getElementById('admin-user-role').textContent = state.user.role;
  const author = document.getElementById('upd-author');
  if (author && !author.value) author.value = `${state.user.username} (Donut City Staff)`;
  applyRoleVisibility();
  connectStatusStream();
  loadAllData();
}

function showLogin() {
  state.user = null;
  state.csrfToken = '';
  state.statusStream?.close();
  state.statusStream = null;
  document.getElementById('admin-dashboard').style.display = 'none';
  document.getElementById('auth-modal').classList.add('active');
}

window.handleAdminLogin = async function handleAdminLogin(event) {
  event.preventDefault();
  const message = document.getElementById('login-message');
  message.textContent = 'Signing in…';
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        login: document.getElementById('admin-login').value.trim(),
        password: document.getElementById('admin-password').value
      })
    });
    document.getElementById('login-form').reset();
    message.textContent = '';
    authenticate(data);
    showToast('🔓 Secure admin session started.');
  } catch (error) {
    message.textContent = error.message;
  }
};

window.logoutAdmin = async function logoutAdmin() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch (error) {
    console.warn(error);
  } finally {
    showLogin();
    showToast('🔒 Logged out.');
  }
};

function applyRoleVisibility() {
  const allowed = roleAccess[state.user?.role] || new Set();
  document.querySelectorAll('[data-permission]').forEach(element => {
    const permission = element.dataset.permission;
    element.style.display = allowed.has(permission) ? '' : 'none';
  });
}

window.switchTab = function switchTab(tabId) {
  const selected = document.getElementById(tabId);
  if (!selected || selected.style.display === 'none' && selected.dataset.permission && !roleAccess[state.user.role]?.has(selected.dataset.permission)) return;
  document.querySelectorAll('.admin-panel').forEach(panel => { panel.style.display = 'none'; });
  document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active'));
  selected.style.display = 'block';
  document.querySelector(`.admin-tab[data-tab="${tabId}"]`)?.classList.add('active');
};

window.loadAllData = async function loadAllData() {
  const tasks = [fetchDashboard(), fetchApplications()];
  const allowed = roleAccess[state.user.role] || new Set();
  if (allowed.has('content')) tasks.push(fetchUpdates(), fetchRules());
  if (allowed.has('settings')) tasks.push(fetchSettings());
  if (allowed.has('webhooks')) tasks.push(fetchWebhooks());
  if (allowed.has('superadmin')) tasks.push(fetchUsers());
  if (allowed.has('audit')) tasks.push(fetchAuditLogs());
  await Promise.allSettled(tasks);
};

async function fetchDashboard() {
  try {
    const data = await api('/admin/dashboard');
    document.getElementById('metric-pending').textContent = data.pendingApplications;
    document.getElementById('metric-updates').textContent = data.publishedUpdates;
    document.getElementById('metric-admins').textContent = data.activeAdmins;
    document.getElementById('metric-audits').textContent = data.auditEvents24h;
    renderLiveStatus(data.status);
  } catch (error) {
    showToast(`⚠️ Dashboard: ${error.message}`);
  }
}

function connectStatusStream() {
  state.statusStream?.close();
  if (!window.EventSource) return;
  const stream = new EventSource('/api/status/stream');
  stream.onmessage = event => {
    try { renderLiveStatus(JSON.parse(event.data)); } catch { /* ignore malformed event */ }
  };
  stream.onerror = () => {
    const line = document.getElementById('overview-live-state');
    if (line) line.innerHTML = '<span class="status-dot-live status-dot-stale"></span><span>Live stream reconnecting…</span>';
  };
  state.statusStream = stream;
}

function renderLiveStatus(status) {
  if (!status) return;
  const current = Number(status.onlinePlayers || 0);
  const max = Number(status.maxPlayers || 0);
  document.getElementById('metric-players').textContent = `${current} / ${max}`;
  const sourceText = status.source === 'fivem-bridge' ? 'FiveM bridge' : status.source === 'fivem-endpoint' ? 'FiveM endpoint' : 'Not configured';
  const stateClass = status.online && !status.stale ? 'status-dot-live' : status.stale ? 'status-dot-live status-dot-stale' : 'status-dot-live status-dot-offline';
  const updated = status.updatedAt ? ` · ${formatDate(status.updatedAt)}` : '';
  const text = status.maintenanceMode ? 'Maintenance mode' : status.online ? `${sourceText}${status.stale ? ' (stale)' : ''}${updated}` : `Offline / unavailable · ${sourceText}`;
  const markup = `<span class="${stateClass}"></span><span>${escapeHtml(text)}</span>`;
  document.getElementById('overview-live-state').innerHTML = markup;
  const statusLine = document.getElementById('status-live-state');
  if (statusLine) statusLine.innerHTML = markup;
  const count = document.getElementById('status-live-count');
  if (count) count.textContent = `${current} / ${max}`;

  const grid = document.getElementById('instance-grid');
  if (grid) {
    const instances = status.instances || {};
    const entries = Object.entries(instances);
    grid.innerHTML = entries.length
      ? entries.map(([name, value]) => `<div class="metric-card"><span>${escapeHtml(instanceLabel(name))}</span><strong>${Number(value || 0)}</strong></div>`).join('')
      : '<div class="empty-state" style="grid-column:1/-1;">Per-instance counts become available when <code>dex_webbridge</code> is running.</div>';
  }
}

function instanceLabel(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric === 0 ? 'Server 1 / Default Bucket' : `Routing Bucket ${numeric}`;
  return value;
}

async function fetchApplications() {
  try {
    state.applications = await api('/admin/whitelist');
    renderApplications();
  } catch (error) {
    document.getElementById('whitelist-table-body').innerHTML = emptyRow(6, error.message);
  }
}

function renderApplications() {
  const pending = state.applications.filter(item => item.status === 'Pending').length;
  document.getElementById('pending-count').textContent = pending;
  const rows = state.applications.filter(item => state.appFilter === 'all' || item.status === state.appFilter);
  document.getElementById('whitelist-table-body').innerHTML = rows.length ? rows.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.discordTag)}</strong><br><span style="color:var(--text-muted);">Age ${Number(item.age)}</span></td>
      <td><code style="color:var(--neon-cyan);">${escapeHtml(item.steamHex)}</code></td>
      <td style="min-width:300px;max-width:420px;"><strong>Backstory:</strong> ${escapeHtml(item.backstory)}<br><br><strong>Scenario:</strong> ${escapeHtml(item.scenario)}${item.reviewNote ? `<br><br><strong>Review note:</strong> ${escapeHtml(item.reviewNote)}` : ''}</td>
      <td>${formatDate(item.submittedAt)}</td>
      <td><span class="badge-status status-${item.status.toLowerCase()}">${item.status}</span></td>
      <td style="min-width:190px;">
        <button class="btn-small btn-approve" onclick="updateAppStatus('${item.id}','Approved')">Approve</button>
        <button class="btn-small btn-delete" onclick="updateAppStatus('${item.id}','Rejected')">Reject</button>
        <button class="btn-small btn-neutral" onclick="updateAppStatus('${item.id}','Pending')">Reset</button>
        <button class="btn-small btn-delete" onclick="deleteApplication('${item.id}')">Delete</button>
      </td>
    </tr>`).join('') : emptyRow(6, 'No applications found.');
}

window.filterApps = function filterApps(status, button) {
  state.appFilter = status;
  button?.parentElement?.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
  button?.classList.add('active');
  renderApplications();
};

window.updateAppStatus = async function updateAppStatus(id, status) {
  const reviewNote = prompt(`Optional review note for ${status}:`, '') || '';
  try {
    await api(`/admin/whitelist/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status, reviewNote }) });
    showToast(`✅ Application marked ${status}.`);
    await Promise.all([fetchApplications(), fetchDashboard(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.deleteApplication = async function deleteApplication(id) {
  if (!confirm('Soft-delete this whitelist application?')) return;
  try {
    await api(`/admin/whitelist/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('🗑️ Application removed.');
    await Promise.all([fetchApplications(), fetchDashboard(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

async function fetchUpdates() {
  try {
    state.updates = await api('/admin/updates');
    document.getElementById('updates-table-body').innerHTML = state.updates.length ? state.updates.map(item => `
      <tr><td><strong>${escapeHtml(item.title)}</strong><br><span style="color:var(--text-muted);">${item.bullets.map(value => `• ${escapeHtml(value)}`).join('<br>')}</span></td><td>${escapeHtml(item.typeText)}</td><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.author)}</td><td><button class="btn-small btn-delete" onclick="deleteUpdate('${item.id}')">Delete</button></td></tr>`).join('') : emptyRow(5, 'No patch notes published.');
  } catch (error) { document.getElementById('updates-table-body').innerHTML = emptyRow(5, error.message); }
}

window.handlePublishUpdate = async function handlePublishUpdate(event) {
  event.preventDefault();
  const bullets = document.getElementById('upd-bullets').value.split('\n').map(value => value.replace(/^[•*-]\s*/, '').trim()).filter(Boolean);
  try {
    await api('/admin/updates', { method: 'POST', body: JSON.stringify({ title: document.getElementById('upd-title').value.trim(), type: document.getElementById('upd-type').value, author: document.getElementById('upd-author').value.trim(), bullets }) });
    event.target.reset();
    document.getElementById('upd-author').value = `${state.user.username} (Donut City Staff)`;
    showToast('🚀 Patch note published.');
    await Promise.all([fetchUpdates(), fetchDashboard(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.deleteUpdate = async function deleteUpdate(id) {
  if (!confirm('Permanently delete this patch note?')) return;
  try {
    await api(`/admin/updates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('🗑️ Patch note deleted.');
    await Promise.all([fetchUpdates(), fetchDashboard(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

async function fetchRules() {
  try {
    state.rules = await api('/admin/rules');
    document.getElementById('rules-admin-list').innerHTML = state.rules.length ? state.rules.map(rule => `
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:var(--radius-md);padding:15px;margin-bottom:10px;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;"><div><strong>${escapeHtml(rule.category)}</strong><p style="color:var(--text-muted);font-size:.84rem;margin-top:5px;">${escapeHtml(rule.content)}</p></div><button class="btn-small btn-delete" onclick="deleteRule('${rule.id}')">Delete</button></div>`).join('') : '<div class="empty-state">No rules configured.</div>';
  } catch (error) { document.getElementById('rules-admin-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

window.handleAddRule = async function handleAddRule(event) {
  event.preventDefault();
  try {
    await api('/admin/rules', { method: 'POST', body: JSON.stringify({ category: document.getElementById('rule-category').value.trim(), content: document.getElementById('rule-content').value.trim() }) });
    event.target.reset();
    showToast('📖 Rule added.');
    await Promise.all([fetchRules(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.deleteRule = async function deleteRule(id) {
  if (!confirm('Delete this server rule?')) return;
  try {
    await api(`/admin/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('🗑️ Rule deleted.');
    await Promise.all([fetchRules(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

async function fetchSettings() {
  try {
    const data = await api('/admin/settings');
    document.getElementById('setting-server-ip').value = data.serverIp;
    document.getElementById('setting-season').value = data.season;
    document.getElementById('setting-max-players').value = data.maxPlayersFallback;
    document.getElementById('setting-discord').value = data.discordMembers;
    document.getElementById('setting-whitelist').value = String(data.whitelistOpen);
    document.getElementById('setting-maintenance').value = String(data.maintenanceMode);
    renderLiveStatus(data.live);
  } catch (error) { showToast(`⚠️ Settings: ${error.message}`); }
}

window.handleSaveSettings = async function handleSaveSettings(event) {
  event.preventDefault();
  try {
    await api('/admin/settings', { method: 'PUT', body: JSON.stringify({
      serverIp: document.getElementById('setting-server-ip').value.trim(),
      season: document.getElementById('setting-season').value.trim(),
      maxPlayersFallback: Number(document.getElementById('setting-max-players').value),
      discordMembers: document.getElementById('setting-discord').value.trim(),
      whitelistOpen: document.getElementById('setting-whitelist').value === 'true',
      maintenanceMode: document.getElementById('setting-maintenance').value === 'true'
    }) });
    showToast('⚙️ Public settings saved.');
    await Promise.all([fetchSettings(), fetchDashboard(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

async function fetchWebhooks() {
  try {
    const data = await api('/admin/webhooks');
    document.getElementById('webhook-whitelist-status').textContent = data.whitelistConfigured ? data.whitelistMasked : 'Not configured';
    document.getElementById('webhook-patchnotes-status').textContent = data.patchNotesConfigured ? data.patchNotesMasked : 'Not configured';
  } catch (error) { showToast(`⚠️ Webhooks: ${error.message}`); }
}

window.saveWebhook = async function saveWebhook(kind) {
  const input = document.getElementById(kind === 'whitelist' ? 'webhook-whitelist' : 'webhook-patchnotes');
  if (!input.value.trim()) return showToast('Paste a Discord webhook URL first.');
  try {
    await api('/admin/webhooks', { method: 'PUT', body: JSON.stringify({ kind, url: input.value.trim() }) });
    input.value = '';
    showToast('🔗 Webhook encrypted and saved.');
    await Promise.all([fetchWebhooks(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.clearWebhook = async function clearWebhook(kind) {
  if (!confirm('Remove this webhook configuration?')) return;
  try {
    await api('/admin/webhooks', { method: 'PUT', body: JSON.stringify({ kind, url: '' }) });
    showToast('Webhook cleared.');
    await Promise.all([fetchWebhooks(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.testWebhook = async function testWebhook(kind) {
  try {
    await api('/admin/webhooks/test', { method: 'POST', body: JSON.stringify({ kind }) });
    showToast('✅ Test message sent to Discord.');
    await fetchAuditLogsIfAllowed();
  } catch (error) { showToast(`❌ ${error.message}`); }
};

async function fetchUsers() {
  try {
    state.users = await api('/admin/users');
    document.getElementById('users-table-body').innerHTML = state.users.length ? state.users.map(user => `
      <tr><td><strong>${escapeHtml(user.username)}</strong><br><span style="color:var(--text-muted);">${escapeHtml(user.email || 'No email')}</span></td><td><select onchange="changeUserRole('${user.id}',this.value)" ${Number(user.id) === Number(state.user.id) ? 'disabled' : ''}><option value="moderator" ${user.role === 'moderator' ? 'selected' : ''}>Moderator</option><option value="content" ${user.role === 'content' ? 'selected' : ''}>Content</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option><option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Superadmin</option></select></td><td><span class="badge-status ${user.isActive ? 'status-active' : 'status-disabled'}">${user.isActive ? 'Active' : 'Disabled'}</span></td><td>${user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never'}</td><td><button class="btn-small ${user.isActive ? 'btn-delete' : 'btn-approve'}" onclick="toggleUser('${user.id}',${!user.isActive})" ${Number(user.id) === Number(state.user.id) ? 'disabled' : ''}>${user.isActive ? 'Disable' : 'Enable'}</button><button class="btn-small btn-neutral" onclick="resetUserPassword('${user.id}')">Reset Password</button></td></tr>`).join('') : emptyRow(5, 'No admin accounts.');
  } catch (error) { document.getElementById('users-table-body').innerHTML = emptyRow(5, error.message); }
}

window.handleCreateUser = async function handleCreateUser(event) {
  event.preventDefault();
  try {
    await api('/admin/users', { method: 'POST', body: JSON.stringify({ username: document.getElementById('new-user-name').value.trim(), email: document.getElementById('new-user-email').value.trim(), password: document.getElementById('new-user-password').value, role: document.getElementById('new-user-role').value }) });
    event.target.reset();
    showToast('👤 Admin account created.');
    await Promise.all([fetchUsers(), fetchDashboard(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.changeUserRole = async function changeUserRole(id, role) {
  try {
    await api(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    showToast('Role updated.');
    await Promise.all([fetchUsers(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); await fetchUsers(); }
};

window.toggleUser = async function toggleUser(id, isActive) {
  if (!confirm(`${isActive ? 'Enable' : 'Disable'} this admin account?`)) return;
  try {
    await api(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
    showToast(`Account ${isActive ? 'enabled' : 'disabled'}.`);
    await Promise.all([fetchUsers(), fetchDashboard(), fetchAuditLogsIfAllowed()]);
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.resetUserPassword = async function resetUserPassword(id) {
  const password = prompt('Enter a new temporary password (minimum 12 characters):');
  if (!password) return;
  try {
    await api(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ password }) });
    showToast('🔐 Password reset and existing sessions revoked.');
    await fetchAuditLogsIfAllowed();
  } catch (error) { showToast(`❌ ${error.message}`); }
};

window.fetchAuditLogs = async function fetchAuditLogs() {
  try {
    state.audits = await api('/admin/audit?limit=150');
    document.getElementById('audit-table-body').innerHTML = state.audits.length ? state.audits.map(log => `<tr><td>${formatDate(log.createdAt)}</td><td>${escapeHtml(log.username)}</td><td><code>${escapeHtml(log.action)}</code></td><td>${escapeHtml([log.targetType, log.targetId].filter(Boolean).join(' #') || '—')}</td><td>${escapeHtml(log.ipAddress || '—')}</td></tr>`).join('') : emptyRow(5, 'No audit events.');
  } catch (error) {
    const target = document.getElementById('audit-table-body');
    if (target) target.innerHTML = emptyRow(5, error.message);
  }
};

async function fetchAuditLogsIfAllowed() {
  if (roleAccess[state.user?.role]?.has('audit')) await fetchAuditLogs();
}

window.handleChangePassword = async function handleChangePassword(event) {
  event.preventDefault();
  const newPassword = document.getElementById('new-password').value;
  if (newPassword !== document.getElementById('confirm-password').value) return showToast('New passwords do not match.');
  try {
    await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: document.getElementById('current-password').value, newPassword }) });
    event.target.reset();
    showToast('🔐 Password changed. Other sessions were revoked.');
  } catch (error) { showToast(`❌ ${error.message}`); }
};

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3400);
}
