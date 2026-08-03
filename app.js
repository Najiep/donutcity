'use strict';

const API_BASE = '/api';
let serverUpdates = [];
let activeUpdateFilter = 'all';
let publicStatus = null;
let statusStream = null;

const updatesGrid = document.getElementById('updates-grid');
const updatesFilter = document.getElementById('updates-filter');
const rulesAccordion = document.getElementById('rules-accordion');
const copyIpBtn = document.getElementById('copy-ip-btn');
const heroConnectBtn = document.getElementById('hero-connect-btn');
const toastContainer = document.getElementById('toast-container');
const tickerTrack = document.getElementById('ticker-track');

window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initBackgroundCanvas();
  initLiveFeedTicker();
  loadPublicData();
  connectStatusStream();
});

window.addEventListener('beforeunload', () => statusStream?.close());

function setupEventListeners() {
  updatesFilter?.addEventListener('click', event => {
    const pill = event.target.closest('.filter-pill');
    if (!pill) return;
    updatesFilter.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
    pill.classList.add('active');
    activeUpdateFilter = pill.dataset.type || 'all';
    renderUpdates();
  });
  copyIpBtn?.addEventListener('click', copyServerIP);
  heroConnectBtn?.addEventListener('click', copyServerIP);
}

async function loadPublicData() {
  await Promise.allSettled([fetchServerStatus(), fetchUpdates(), fetchRules()]);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

async function fetchServerStatus() {
  try {
    renderServerStatus(await fetchJson('/status'));
  } catch (error) {
    renderServerStatus({ online: false, stale: true, onlinePlayers: 0, maxPlayers: 0, source: 'unavailable' });
    console.warn('Server status unavailable:', error.message);
  }
}

function connectStatusStream() {
  if (!window.EventSource) {
    setInterval(fetchServerStatus, 30000);
    return;
  }
  statusStream = new EventSource('/api/status/stream');
  statusStream.onmessage = event => {
    try { renderServerStatus(JSON.parse(event.data)); } catch { /* ignore malformed event */ }
  };
  statusStream.onerror = () => {
    const label = document.querySelector('.hero-stats-badge .stat-box:nth-child(1) p');
    if (label) label.textContent = 'Reconnecting to live status…';
  };
}

function renderServerStatus(status) {
  publicStatus = status;
  const playerValue = document.querySelector('.hero-stats-badge .stat-box:nth-child(1) h4');
  const playerLabel = document.querySelector('.hero-stats-badge .stat-box:nth-child(1) p');
  if (playerValue) playerValue.textContent = `${Number(status.onlinePlayers || 0)} / ${Number(status.maxPlayers || 0)}`;
  if (playerLabel) {
    if (status.maintenanceMode) playerLabel.textContent = 'Server Under Maintenance';
    else if (!status.online) playerLabel.textContent = status.stale ? 'Status Temporarily Unavailable' : 'Server Offline';
    else if (status.stale) playerLabel.textContent = 'Active Players · Last Known';
    else playerLabel.textContent = 'Active Players Online';
  }

  const whitelistValue = document.querySelector('.hero-stats-badge .stat-box:nth-child(2) h4');
  if (whitelistValue) {
    whitelistValue.textContent = status.whitelistOpen ? 'OPEN' : 'CLOSED';
    whitelistValue.className = status.whitelistOpen ? 'text-neon-green' : 'text-neon-pink';
  }
  const discordValue = document.querySelector('.hero-stats-badge .stat-box:nth-child(3) h4');
  if (discordValue) discordValue.textContent = status.discordMembers || '0';

  const ipText = copyIpBtn?.querySelector('span:nth-child(2)');
  if (ipText && status.ip) ipText.textContent = status.ip;
  const statusDot = copyIpBtn?.querySelector('.status-dot');
  if (statusDot) {
    statusDot.style.background = status.online && !status.stale ? 'var(--neon-green)' : status.stale ? 'var(--neon-gold)' : '#ff0055';
  }

  const footerStatus = document.querySelector('.footer-col:last-child .footer-links li:first-child span');
  if (footerStatus) {
    footerStatus.textContent = status.maintenanceMode ? '● Server Status: Maintenance' : status.online ? '● Server Status: Online' : '● Server Status: Offline';
    footerStatus.style.color = status.online && !status.maintenanceMode ? 'var(--neon-green)' : status.stale ? 'var(--neon-gold)' : '#ff0055';
  }
  const footerIp = document.querySelector('.footer-col:last-child .footer-links li:nth-child(2) span');
  if (footerIp && status.ip) footerIp.textContent = `IP: ${status.ip}`;
}

async function copyServerIP() {
  const ip = publicStatus?.ip || 'play.donutcityrp.com';
  try {
    await navigator.clipboard.writeText(ip);
    showToast(`✨ Server IP copied: ${ip}`);
  } catch {
    prompt('Copy the server IP:', ip);
  }
}

async function fetchUpdates() {
  try {
    serverUpdates = await fetchJson('/updates');
    renderUpdates();
  } catch (error) {
    if (updatesGrid) updatesGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">${escapeHtml(error.message)}</div>`;
  }
}

function renderUpdates() {
  if (!updatesGrid) return;
  const filtered = serverUpdates.filter(item => activeUpdateFilter === 'all' || item.type === activeUpdateFilter);
  if (!filtered.length) {
    updatesGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">No updates found for this category.</div>';
    return;
  }
  updatesGrid.innerHTML = filtered.map(item => `
    <article class="update-card">
      <div class="update-meta"><span class="update-badge badge-${escapeHtml(item.type)}">${escapeHtml(item.typeText)}</span><span class="update-date">${escapeHtml(item.date)}</span></div>
      <h3 class="update-title">${escapeHtml(item.title)}</h3>
      <ul class="update-bullets">${item.bullets.map(value => `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><span>${escapeHtml(value)}</span></li>`).join('')}</ul>
      <div class="update-author"><span>Posted by <strong>${escapeHtml(item.author)}</strong></span></div>
    </article>`).join('');
}

async function fetchRules() {
  try {
    renderRules(await fetchJson('/rules'));
  } catch (error) {
    if (rulesAccordion) rulesAccordion.innerHTML = `<p style="color:var(--text-muted);text-align:center;">${escapeHtml(error.message)}</p>`;
  }
}

function renderRules(rules) {
  if (!rulesAccordion) return;
  rulesAccordion.innerHTML = rules.length ? rules.map((rule, index) => `
    <div class="rule-item ${index === 0 ? 'open' : ''}">
      <button type="button" class="rule-header" onclick="toggleRule(this)" style="width:100%;"><span>${escapeHtml(rule.category)}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
      <div class="rule-content"><p>${escapeHtml(rule.content)}</p></div>
    </div>`).join('') : '<p style="color:var(--text-muted);text-align:center;">No rules published.</p>';
}

window.toggleRule = function toggleRule(header) {
  header.closest('.rule-item')?.classList.toggle('open');
};

window.openModal = function openModal(id) {
  document.getElementById(id)?.classList.add('active');
};

window.closeModal = function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
};

window.handleWhitelistSubmit = async function handleWhitelistSubmit(event) {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    const data = await fetchJson('/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discordTag: document.getElementById('app-name').value.trim(),
        steamHex: document.getElementById('app-hex').value.trim(),
        age: Number(document.getElementById('app-age').value),
        backstory: document.getElementById('app-backstory').value.trim(),
        scenario: document.getElementById('app-scenario').value.trim()
      })
    });
    closeModal('whitelist-modal');
    event.target.reset();
    showToast(`🎉 Application #${data.application.id} submitted successfully.`);
  } catch (error) {
    showToast(`❌ ${error.message}`);
  } finally {
    if (submit) submit.disabled = false;
  }
};

function initLiveFeedTicker() {
  if (!tickerTrack) return;
  const messages = [
    '⚡ Live player count is connected directly to the FiveM server',
    '✨ Whitelist applications are reviewed in the secured admin portal',
    '🚓 Donut City departments are recruiting active roleplayers',
    '🛡️ Admin actions are protected and recorded in audit logs'
  ];
  tickerTrack.innerHTML = [...messages, ...messages].map(text => `<span class="ticker-item">${escapeHtml(text)}</span>`).join('');
}

function initBackgroundCanvas() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const particles = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), radius: Math.random() * 1.5 + 0.4, speed: Math.random() * 0.00025 + 0.00008 }));

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function animate() {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.fillStyle = 'rgba(0,240,255,.35)';
    for (const particle of particles) {
      particle.y -= particle.speed;
      if (particle.y < -0.02) { particle.y = 1.02; particle.x = Math.random(); }
      context.beginPath();
      context.arc(particle.x * window.innerWidth, particle.y * window.innerHeight, particle.radius, 0, Math.PI * 2);
      context.fill();
    }
    requestAnimationFrame(animate);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();
  animate();
}

function showToast(message) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3400);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
