/* ==========================================================================
   DONUT CITY ADMIN DASHBOARD LOGIC (FULL CRUD & DISCORD INTEGRATION)
   ========================================================================== */

const API_BASE = 'http://localhost:3000/api';
let adminToken = localStorage.getItem('donut_admin_token');
let applications = [];
let serverUpdates = [];
let serverRules = [];
let currentAppFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    document.getElementById('auth-modal').classList.remove('active');
    document.getElementById('admin-dashboard').style.display = 'block';
    loadDashboardData();
  }
});

// Admin Passcode Login
window.handleAdminLogin = async function(event) {
  event.preventDefault();
  const passcode = document.getElementById('admin-passcode-input').value;

  try {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode })
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem('donut_admin_token', data.token);
      adminToken = data.token;
      document.getElementById('auth-modal').classList.remove('active');
      document.getElementById('admin-dashboard').style.display = 'block';
      loadDashboardData();
      showToast('🔓 Admin Authenticated Successfully!');
    } else {
      showToast('❌ Invalid Passcode. Access Denied.');
    }
  } catch (err) {
    showToast('⚠️ Backend Server Offline. Start server using: node server.js');
  }
};

window.logoutAdmin = function() {
  localStorage.removeItem('donut_admin_token');
  location.reload();
};

// Load Admin Dashboard Data
async function loadDashboardData() {
  await fetchApplications();
  await fetchUpdates();
  await fetchRules();
  await fetchWebhooks();
  await fetchStatusControls();
}

// ==========================================
// 1. WHITELIST APPLICATIONS MANAGEMENT
// ==========================================
async function fetchApplications() {
  try {
    const res = await fetch(`${API_BASE}/whitelist`);
    applications = await res.json();
    renderApplicationsTable();
  } catch (err) {
    console.error('Failed to fetch applications', err);
  }
}

function renderApplicationsTable() {
  const pendingCount = applications.filter(a => a.status === 'Pending').length;
  document.getElementById('pending-count').textContent = pendingCount;

  const filtered = applications.filter(a => {
    return currentAppFilter === 'all' || a.status === currentAppFilter;
  });

  const tbody = document.getElementById('whitelist-table-body');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No applications found in this category.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(app => `
    <tr>
      <td><strong>${escapeHtml(app.discordTag)}</strong></td>
      <td><code style="color: var(--neon-cyan);">${escapeHtml(app.steamHex)}</code></td>
      <td>${app.age} yrs</td>
      <td style="max-width: 320px;">
        <div style="font-weight: 600; color: #fff;">${escapeHtml(app.backstory)}</div>
        <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 4px;">Scenario: ${escapeHtml(app.scenario)}</div>
      </td>
      <td>${new Date(app.submittedAt).toLocaleDateString()}</td>
      <td>
        <span class="badge-status status-${app.status.toLowerCase()}">${app.status}</span>
      </td>
      <td>
        ${app.status === 'Pending' ? `
          <button class="btn-approve" onclick="updateAppStatus('${app.id}', 'Approved')">Approve</button>
          <button class="btn-delete" style="background: rgba(255,0,85,0.15); margin-right:4px;" onclick="updateAppStatus('${app.id}', 'Rejected')">Reject</button>
        ` : `
          <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; margin-right: 4px;" onclick="updateAppStatus('${app.id}', 'Pending')">Reset</button>
        `}
        <button class="btn-delete" style="padding: 4px 8px; font-size: 0.75rem;" onclick="deleteApplication('${app.id}')" title="Delete App Entry">🗑️</button>
      </td>
    </tr>
  `).join('');
}

window.filterApps = function(status) {
  currentAppFilter = status;
  renderApplicationsTable();
};

window.updateAppStatus = async function(appId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/whitelist/${appId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✨ Whitelist Application ${newStatus}! Notification sent to Discord.`);
      loadDashboardData();
    }
  } catch (err) {
    showToast('⚠️ Failed to update application status.');
  }
};

window.deleteApplication = async function(appId) {
  if (!confirm('Are you sure you want to delete this Whitelist Application entry?')) return;

  try {
    const res = await fetch(`${API_BASE}/whitelist/${appId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('🗑️ Whitelist Application deleted.');
      fetchApplications();
    }
  } catch (err) {
    showToast('⚠️ Failed to delete application.');
  }
};

// ==========================================
// 2. SERVER PATCH NOTES & UPDATES (CRUD)
// ==========================================
async function fetchUpdates() {
  try {
    const res = await fetch(`${API_BASE}/updates`);
    serverUpdates = await res.json();
    renderUpdatesTable();
  } catch (err) {
    console.error('Failed to fetch updates', err);
  }
}

function renderUpdatesTable() {
  const tbody = document.getElementById('updates-table-body');
  if (serverUpdates.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No patch notes published yet.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = serverUpdates.map(upd => `
    <tr>
      <td><strong>${escapeHtml(upd.title)}</strong></td>
      <td><span class="update-badge badge-${upd.type}">${escapeHtml(upd.typeText)}</span></td>
      <td>${upd.date}</td>
      <td>${escapeHtml(upd.author)}</td>
      <td style="max-width: 300px; font-size: 0.82rem; color: var(--text-muted);">
        ${upd.bullets.map(b => `<div>• ${escapeHtml(b)}</div>`).join('')}
      </td>
      <td>
        <button class="btn-delete" onclick="deleteUpdate('${upd.id}')">
          🗑️ Delete Update
        </button>
      </td>
    </tr>
  `).join('');
}

// Publish New Patch Note
window.handlePublishUpdate = async function(event) {
  event.preventDefault();
  const title = document.getElementById('upd-title').value.trim();
  const type = document.getElementById('upd-type').value;
  const author = document.getElementById('upd-author').value.trim();
  const bulletsText = document.getElementById('upd-bullets').value.trim();
  const bullets = bulletsText.split('\n').map(b => b.trim()).filter(b => b.length > 0);

  try {
    const res = await fetch(`${API_BASE}/updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, type, author, bullets })
    });
    const data = await res.json();
    if (data.success) {
      showToast('🚀 Patch Note Published to Live Website & Discord!');
      document.getElementById('upd-title').value = '';
      document.getElementById('upd-bullets').value = '';
      fetchUpdates();
    }
  } catch (err) {
    showToast('⚠️ Failed to publish patch note.');
  }
};

// DELETE Server Update / Patch Note
window.deleteUpdate = async function(updateId) {
  if (!confirm('Are you sure you want to DELETE this server update/patch note? It will be removed from the live website immediately.')) return;

  try {
    const res = await fetch(`${API_BASE}/updates/${updateId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('🗑️ Server Patch Note Deleted successfully!');
      fetchUpdates();
    } else {
      showToast('❌ Failed to delete patch note.');
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server backend.');
  }
};

// ==========================================
// 3. SERVER RULES MANAGEMENT (CRUD)
// ==========================================
async function fetchRules() {
  try {
    const res = await fetch(`${API_BASE}/rules`);
    serverRules = await res.json();
    renderRulesAdminList();
  } catch (err) {
    console.error('Failed to fetch rules', err);
  }
}

function renderRulesAdminList() {
  const container = document.getElementById('rules-admin-list');
  if (serverRules.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted);">No rules configured.</p>`;
    return;
  }

  container.innerHTML = serverRules.map((rule, idx) => `
    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-md); padding: 16px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
      <div>
        <h4 style="color: #fff; font-size: 0.95rem; margin-bottom: 4px;">${escapeHtml(rule.category)}</h4>
        <p style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(rule.content)}</p>
      </div>
      <button class="btn-delete" style="white-space: nowrap;" onclick="deleteRule(${idx})">🗑️ Delete Rule</button>
    </div>
  `).join('');
}

window.handleAddRule = async function(event) {
  event.preventDefault();
  const category = document.getElementById('rule-category').value.trim();
  const content = document.getElementById('rule-content').value.trim();

  try {
    const res = await fetch(`${API_BASE}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, content })
    });
    const data = await res.json();
    if (data.success) {
      showToast('📖 Server Rule Added!');
      document.getElementById('rule-category').value = '';
      document.getElementById('rule-content').value = '';
      fetchRules();
    }
  } catch (err) {
    showToast('⚠️ Failed to add server rule.');
  }
};

window.deleteRule = async function(index) {
  if (!confirm('Delete this server rule entry?')) return;

  try {
    const res = await fetch(`${API_BASE}/rules/${index}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('🗑️ Server Rule Deleted.');
      fetchRules();
    }
  } catch (err) {
    showToast('⚠️ Failed to delete server rule.');
  }
};

// ==========================================
// 4. DISCORD WEBHOOK CONFIGURATION
// ==========================================
async function fetchWebhooks() {
  try {
    const res = await fetch(`${API_BASE}/webhooks`);
    const data = await res.json();
    document.getElementById('webhook-whitelist').value = data.whitelistWebhook || '';
    document.getElementById('webhook-patchnotes').value = data.patchNotesWebhook || '';
  } catch (err) {
    console.error('Failed to fetch Webhook config', err);
  }
}

window.handleSaveWebhooks = async function(event) {
  event.preventDefault();
  const whitelistWebhook = document.getElementById('webhook-whitelist').value.trim();
  const patchNotesWebhook = document.getElementById('webhook-patchnotes').value.trim();

  try {
    const res = await fetch(`${API_BASE}/webhooks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whitelistWebhook, patchNotesWebhook })
    });
    const data = await res.json();
    if (data.success) {
      showToast('🔗 Discord Webhooks Saved Successfully!');
    }
  } catch (err) {
    showToast('⚠️ Failed to save Webhook configuration.');
  }
};

window.testWebhook = async function(type) {
  const inputId = type === 'whitelist' ? 'webhook-whitelist' : 'webhook-patchnotes';
  const url = document.getElementById(inputId).value.trim();

  if (!url) {
    showToast('⚠️ Please paste a valid Discord Webhook URL first.');
    return;
  }

  showToast('⏳ Sending test embed to Discord...');

  try {
    const res = await fetch(`${API_BASE}/webhooks/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, url })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Test Embed Sent! Check your Discord channel!');
    } else {
      showToast('❌ Discord Webhook failed. Verify URL in Discord channel settings.');
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server backend.');
  }
};

// ==========================================
// 5. SERVER STATUS CONTROL
// ==========================================
async function fetchStatusControls() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    const status = await res.json();
    document.getElementById('status-players').value = status.onlinePlayers;
    document.getElementById('status-max-players').value = status.maxPlayers;
    document.getElementById('status-whitelist-open').value = status.whitelistOpen ? 'true' : 'false';
    document.getElementById('status-discord').value = status.discordMembers;
  } catch (err) {
    console.error('Failed to fetch status controls', err);
  }
}

window.handleSaveStatus = async function(event) {
  event.preventDefault();
  const onlinePlayers = parseInt(document.getElementById('status-players').value);
  const maxPlayers = parseInt(document.getElementById('status-max-players').value);
  const whitelistOpen = document.getElementById('status-whitelist-open').value === 'true';
  const discordMembers = document.getElementById('status-discord').value.trim();

  try {
    const res = await fetch(`${API_BASE}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onlinePlayers, maxPlayers, whitelistOpen, discordMembers })
    });
    const data = await res.json();
    if (data.success) {
      showToast('⚙️ Server Status Updated Live!');
    }
  } catch (err) {
    showToast('⚠️ Failed to update server status.');
  }
};

// Switch Tabs
window.switchTab = function(tabId) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

  document.querySelectorAll('.admin-card').forEach(c => c.style.display = 'none');
  document.getElementById(tabId).style.display = 'block';
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}
