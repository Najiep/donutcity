/* ==========================================================================
   DONUT CITY NEXT GENERATION ROLEPLAY - FRONTEND APP ENGINE (API CONNECTED)
   ========================================================================== */

const API_BASE = 'http://localhost:3000/api';

// App State
let serverUpdates = [];
let activeUpdateFilter = 'all';

// DOM Elements
const updatesGrid = document.getElementById('updates-grid');
const updatesFilter = document.getElementById('updates-filter');
const rulesAccordion = document.getElementById('rules-accordion');
const copyIpBtn = document.getElementById('copy-ip-btn');
const heroConnectBtn = document.getElementById('hero-connect-btn');
const toastContainer = document.getElementById('toast-container');
const tickerTrack = document.getElementById('ticker-track');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  fetchServerStatus();
  fetchUpdates();
  fetchRules();
  initBackgroundCanvas();
  initLiveFeedTicker();
  setupEventListeners();
});

function setupEventListeners() {
  // Updates Filter Pills
  updatesFilter.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeUpdateFilter = pill.dataset.type;
    renderUpdates();
  });

  // Copy IP Button
  copyIpBtn.addEventListener('click', copyServerIP);
  if (heroConnectBtn) heroConnectBtn.addEventListener('click', copyServerIP);
}

function copyServerIP() {
  navigator.clipboard.writeText('play.donutcityrp.com');
  showToast('✨ Server IP copied: play.donutcityrp.com — Open FiveM & connect!');
}

// Fetch Live Server Status
async function fetchServerStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) return;
    const status = await res.json();

    const statPlayers = document.getElementById('stat-online-players');
    if (statPlayers) statPlayers.textContent = `${status.onlinePlayers} / ${status.maxPlayers}`;

    const statWhitelist = document.querySelector('.hero-stats-badge .stat-box:nth-child(2) h4');
    if (statWhitelist) {
      statWhitelist.textContent = status.whitelistOpen ? 'OPEN' : 'CLOSED';
      statWhitelist.className = status.whitelistOpen ? 'text-neon-green' : 'text-neon-pink';
    }

    const statDiscord = document.querySelector('.hero-stats-badge .stat-box:nth-child(3) h4');
    if (statDiscord) statDiscord.textContent = status.discordMembers;
  } catch (err) {
    console.log('Using local fallback for status', err);
  }
}

// Fetch Updates & Patch Notes from REST API
async function fetchUpdates() {
  try {
    const res = await fetch(`${API_BASE}/updates`);
    if (res.ok) {
      serverUpdates = await res.json();
      renderUpdates();
    }
  } catch (err) {
    console.log('Failed to fetch live updates from API', err);
  }
}

// Render Updates & Patch Notes Cards
function renderUpdates() {
  const filtered = serverUpdates.filter(item => {
    return activeUpdateFilter === 'all' || item.type === activeUpdateFilter;
  });

  if (filtered.length === 0) {
    updatesGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <p>No updates found for this category.</p>
      </div>
    `;
    return;
  }

  updatesGrid.innerHTML = filtered.map(item => `
    <div class="update-card">
      <div class="update-meta">
        <span class="update-badge badge-${item.type}">${item.typeText}</span>
        <span class="update-date">${item.date}</span>
      </div>

      <h3 class="update-title">${escapeHtml(item.title)}</h3>

      <ul class="update-bullets">
        ${item.bullets.map(b => `
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span>${escapeHtml(b)}</span>
          </li>
        `).join('')}
      </ul>

      <div class="update-author">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>Posted by <strong>${escapeHtml(item.author)}</strong></span>
      </div>
    </div>
  `).join('');
}

// Fetch Server Rules from REST API
async function fetchRules() {
  try {
    const res = await fetch(`${API_BASE}/rules`);
    if (res.ok) {
      const rules = await res.json();
      renderRules(rules);
    }
  } catch (err) {
    console.log('Failed to fetch live rules from API', err);
  }
}

function renderRules(rules) {
  rulesAccordion.innerHTML = rules.map((rule, idx) => `
    <div class="rule-item ${idx === 0 ? 'open' : ''}">
      <div class="rule-header" onclick="toggleRule(this)">
        <span>${escapeHtml(rule.category)}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="rule-content">
        <p>${escapeHtml(rule.content)}</p>
      </div>
    </div>
  `).join('');
}

window.toggleRule = function(headerElement) {
  const item = headerElement.closest('.rule-item');
  item.classList.toggle('open');
};

// Modal Controls
window.openModal = function(modalId) {
  document.getElementById(modalId).classList.add('active');
};

window.closeModal = function(modalId) {
  document.getElementById(modalId).classList.remove('active');
};

// Whitelist Application Submit Handler (Sends to REST API Backend)
window.handleWhitelistSubmit = async function(event) {
  event.preventDefault();
  const discordTag = document.getElementById('app-name').value.trim();
  const steamHex = document.getElementById('app-hex').value.trim();
  const age = document.getElementById('app-age').value;
  const backstory = document.getElementById('app-backstory').value.trim();
  const scenario = document.getElementById('app-scenario').value.trim();

  try {
    const res = await fetch(`${API_BASE}/whitelist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordTag, steamHex, age, backstory, scenario })
    });
    const data = await res.json();

    if (data.success) {
      closeModal('whitelist-modal');
      showToast(`🎉 Whitelist Application Submitted for ${discordTag}!`);

      setTimeout(() => {
        alert(`🍩 DONUT CITY WHITELIST APPLICATION RECEIVED!\n\nThank you for applying, ${discordTag}!\n\nYour application has been saved to the server backend (ID: ${data.application.id}). Our Admin team will review your backstory in the Admin Control Panel.`);
        document.getElementById('whitelist-form').reset();
      }, 300);
    }
  } catch (err) {
    showToast('⚠️ Could not connect to backend server. Make sure node server.js is running.');
  }
};

// Toast Notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3400);
}

// Live Server Feed Ticker
function initLiveFeedTicker() {
  const mockFeed = [
    { text: '🛠️ Season 04 Retrowave Patch 4.2 Deployed Live!' },
    { text: '✨ Whitelist Status: OPEN — Apply Today!' },
    { text: '🚓 LSPD is Hiring Active Officers & EMS Cadets' },
    { text: '🏎️ Donut City Grand Prix Race Event starts this Friday' },
    { text: '📢 Community Discord reached 14,800+ Members' }
  ];

  const itemsHTML = [...mockFeed, ...mockFeed].map(f => `
    <div class="ticker-item">
      <span>${f.text}</span> &bull;
    </div>
  `).join('');

  tickerTrack.innerHTML = itemsHTML;
}

// Helper to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// Animated Canvas Retrowave Background
function initBackgroundCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const particles = [];
  for (let i = 0; i < 45; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 2 + 1,
      color: Math.random() > 0.5 ? '#ff007f' : '#00f0ff',
      vx: (Math.random() - 0.5) * 0.4,
      vy: -Math.random() * 0.6 - 0.2
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gridY = canvas.height * 0.7;
    ctx.strokeStyle = 'rgba(255, 0, 127, 0.15)';
    ctx.lineWidth = 1;

    for (let y = gridY; y < canvas.height; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const centerX = canvas.width / 2;
    for (let x = -canvas.width; x < canvas.width * 2; x += 80) {
      ctx.beginPath();
      ctx.moveTo(centerX + (x - centerX) * 0.2, gridY);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      p.x += p.vx;
      p.y += p.vy;

      if (p.y < 0) {
        p.y = canvas.height;
        p.x = Math.random() * canvas.width;
      }
    });

    requestAnimationFrame(animate);
  }

  animate();
}
