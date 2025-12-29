import { initializeWallet, connectWallet, signWriteHeaders } from './services/wallet.js';

async function fetchStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    const data = await res.json();
    const counts = data.counts || {};
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '--'; };
    setText('stat-avatars', counts.avatars ?? '--');
    setText('stat-items', counts.items ?? '--');
    setText('stat-locations', counts.locations ?? '--');
    setText('stat-memories', counts.memories ?? '--');
  } catch (e) {
    console.warn('Failed to load stats', e);
  }
  
  // Load payment stats
  await fetchPaymentStats();
}

async function fetchPaymentStats() {
  try {
    const res = await fetch('/api/payment/stats');
    if (!res.ok) {
      // Payment not configured, show N/A
      updatePaymentUI(null);
      return;
    }
    const data = await res.json();
    updatePaymentUI(data);
  } catch (e) {
    console.warn('Failed to load payment stats', e);
    updatePaymentUI(null);
  }
}

async function fetchBotStatus() {
  try {
    const res = await fetch('/api/admin/bots');
    if (!res.ok) {
      renderBotGrid([]);
      return;
    }
    const data = await res.json();
    renderBotGrid(data.data || []);
  } catch (e) {
    console.warn('Failed to load bot status', e);
    renderBotGrid([]);
  }
}

function renderBotGrid(bots) {
  const grid = document.getElementById('bot-grid');
  const badge = document.getElementById('bot-count-badge');
  
  if (!grid) return;
  
  // Update badge (v2 design)
  if (badge) {
    const activeCount = bots.filter(b => b.enabled).length;
    badge.textContent = `${activeCount}/${bots.length} Active`;
    badge.className = activeCount > 0 ? 'badge badge-success' : 'badge badge-warning';
  }
  
  if (bots.length === 0) {
    grid.innerHTML = `
      <a href="/admin/bots/" class="bot-card bot-card-empty">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">➕</div>
        <div style="font-weight: 500;">Create your first bot</div>
        <div style="font-size: var(--text-xs); color: var(--color-text-muted); margin-top: 0.25rem;">Click to get started</div>
      </a>
    `;
    return;
  }
  
  grid.innerHTML = bots.slice(0, 6).map(bot => `
    <a href="/admin/bots/detail.html?id=${bot.botId}" class="bot-card">
      <div class="bot-card-header">
        <div class="bot-card-info">
          <div class="bot-card-avatar">${getBotEmoji(bot)}</div>
          <div>
            <div class="bot-card-name">${escapeHtml(bot.name)}</div>
            <div class="bot-card-id">${bot.botId}</div>
          </div>
        </div>
        <div class="bot-card-status">
          <div class="dot ${bot.enabled ? 'active' : 'inactive'}"></div>
          <span>${bot.enabled ? 'Active' : 'Paused'}</span>
        </div>
      </div>
      <div class="bot-card-platforms">
        ${bot.platforms?.discord?.enabled ? '<span class="badge badge-info">Discord</span>' : ''}
        ${bot.platforms?.telegram?.enabled ? '<span class="badge badge-primary">Telegram</span>' : ''}
        ${bot.platforms?.x?.enabled ? '<span class="badge">𝕏</span>' : ''}
        ${!bot.platforms?.discord?.enabled && !bot.platforms?.telegram?.enabled && !bot.platforms?.x?.enabled ? '<span style="font-size: var(--text-xs); color: var(--color-text-muted);">No platforms</span>' : ''}
      </div>
      <div class="bot-card-footer">
        <span>${bot.avatars?.length || 0} avatars</span>
        <span>Last active: ${formatRelativeTime(bot.lastActiveAt)}</span>
      </div>
    </a>
  `).join('') + (bots.length > 6 ? `
    <a href="/admin/bots/" class="bot-card bot-card-empty">
      <div style="font-weight: 500;">View all ${bots.length} bots</div>
      <div style="margin-top: 0.25rem;">→</div>
    </a>
  ` : '');
}

function getBotEmoji(bot) {
  if (bot.platforms?.discord?.enabled) return '💬';
  if (bot.platforms?.telegram?.enabled) return '📱';
  if (bot.platforms?.x?.enabled) return '𝕏';
  return '🤖';
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updatePaymentUI(data) {
  const badge = document.getElementById('payment-status-badge');
  const setText = (id, v) => { 
    const el = document.getElementById(id); 
    if (el) el.textContent = v ?? '--'; 
  };
  
  if (!data || !data.stats) {
    // Not configured or error loading
    if (badge) {
      badge.textContent = 'ERROR';
      badge.className = 'badge badge-danger';
    }
    setText('payment-stat-transactions', '0');
    setText('payment-stat-volume', '$0.00');
    setText('payment-stat-wallets', '0');
    setText('payment-stat-revenue', '$0.00');
    return;
  }
  
  // Check configuration status
  const x402Configured = data.configured?.x402;
  const walletConfigured = data.configured?.wallet;
  
  // Format USDC amounts
  const formatUSDC = (amount) => {
    const usd = (amount || 0) / 1e6;
    return '$' + usd.toFixed(2);
  };
  
  const totalTx = (data.stats.x402Transactions || 0) + (data.stats.walletTransactions || 0);
  const totalVolume = data.stats.totalVolume || 0;
  const platformRevenue = data.stats.platformRevenue || 0;
  
  // Update badge based on configuration and activity (v2 design)
  if (badge) {
    if (!x402Configured && !walletConfigured) {
      badge.textContent = 'NOT CONFIGURED';
      badge.className = 'badge badge-warning';
    } else if (totalTx > 0) {
      badge.textContent = 'OPERATIONAL';
      badge.className = 'badge badge-success';
    } else {
      badge.textContent = 'READY';
      badge.className = 'badge badge-info';
    }
  }
  
  setText('payment-stat-transactions', totalTx.toLocaleString());
  setText('payment-stat-volume', formatUSDC(totalVolume));
  setText('payment-stat-wallets', (data.stats.agentWallets || 0).toLocaleString());
  setText('payment-stat-revenue', formatUSDC(platformRevenue));
}

async function ensureAdminSession() {
  // After wallet connect, try a simple server verify to create user (client-only demo)
  // Real flow: call /api/auth/nonce then sign and POST /api/auth/verify
  const status = document.getElementById('admin-login-status');
  const state = window.state || {};
  if (!state.wallet?.publicKey) {
    if (status) status.textContent = 'Connect with Phantom to access admin features';
    return;
  }

  if (status) status.textContent = 'Wallet connected. Click to verify admin access…';
}

function wirePhantomLogin() {
  // Inject a click handler to run full nonce/sign/verify when wallet connects
  window.addEventListener('wallet:connected', async () => {
    await doVerify();
  });

  async function doVerify() {
    try {
      const address = window.state?.wallet?.publicKey;
      if (!address) return;
      const nonceRes = await fetch('/api/auth/nonce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      const { nonce } = await nonceRes.json();

      const provider = window?.phantom?.solana;
      if (!provider) throw new Error('Phantom not available');
      const encoded = new TextEncoder().encode(nonce);
      const { signature } = await provider.signMessage(encoded, 'utf8');

      // Phantom returns a Uint8Array signature; send as array for simplicity
      const verifyRes = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, nonce, signature: Array.from(signature) }) });
      const data = await verifyRes.json();
      const status = document.getElementById('admin-login-status');
      if (verifyRes.ok && data?.user) {
        if (status) status.textContent = data.user.isAdmin ? 'Admin access granted' : 'Logged in (no admin rights)';
      } else {
        if (status) status.textContent = data?.error || 'Verification failed';
      }
    } catch (e) {
      const status = document.getElementById('admin-login-status');
      if (status) status.textContent = `Login error: ${e.message}`;
      console.error(e);
    }
  }
}

function init() {
  initializeWallet();
  fetchStats();
  fetchBotStatus();
  fetchPlatformStatus();
  ensureAdminSession();
  wirePhantomLogin();
}

// Expose migration function globally
window.migrateAvatarsToDefault = async function() {
  const migrationStatus = document.getElementById('migration-status');
  const migrateBtn = document.getElementById('migrate-avatars-btn');
  
  if (migrationStatus) {
    migrationStatus.style.display = 'block';
    migrationStatus.className = 'alert alert-info';
    migrationStatus.textContent = 'Migrating avatars to default bot...';
  }
  if (migrateBtn) migrateBtn.disabled = true;
  
  try {
    const res = await fetch('/api/admin/bots/migrate-avatars', { method: 'POST' });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Migration failed');
    
    if (migrationStatus) {
      migrationStatus.className = 'alert alert-success';
      migrationStatus.textContent = `Successfully assigned ${data.data.assigned} avatar(s) to the default bot.`;
    }
    if (migrateBtn) migrateBtn.style.display = 'none';
    
    // Refresh platform status
    await fetchPlatformStatus();
  } catch (e) {
    if (migrationStatus) {
      migrationStatus.className = 'alert alert-danger';
      migrationStatus.textContent = 'Migration failed: ' + e.message;
    }
  } finally {
    if (migrateBtn) migrateBtn.disabled = false;
  }
};

async function fetchPlatformStatus() {
  const discordStatus = document.getElementById('platform-discord-status');
  const telegramStatus = document.getElementById('platform-telegram-status');
  const xStatus = document.getElementById('platform-x-status');
  const avatarsCount = document.getElementById('platform-avatars-count');
  const hint = document.getElementById('platform-hint');
  const migrateBtn = document.getElementById('migrate-avatars-btn');
  
  if (!discordStatus && !telegramStatus && !xStatus) return;
  
  try {
    // Fetch default bot status
    const res = await fetch('/api/admin/bots/default');
    if (!res.ok) {
      // No default bot yet
      if (discordStatus) discordStatus.textContent = 'Not configured';
      if (telegramStatus) telegramStatus.textContent = 'Not configured';
      if (xStatus) xStatus.textContent = 'Not configured';
      if (avatarsCount) avatarsCount.textContent = '0';
      if (hint) hint.style.display = 'block';
      return;
    }
    
    const data = await res.json();
    const bot = data.data || data;
    const platforms = bot.platforms || {};
    
    // Update platform statuses with handles/usernames
    if (discordStatus) {
      const discord = platforms.discord || {};
      if (discord.enabled) {
        const guildCount = discord.guildIds?.length || 0;
        const clientId = discord.clientId;
        if (guildCount > 0) {
          discordStatus.textContent = `${guildCount} guild${guildCount > 1 ? 's' : ''}`;
          discordStatus.style.color = 'var(--color-success)';
        } else if (clientId) {
          discordStatus.textContent = 'Connected';
          discordStatus.style.color = 'var(--color-success)';
        } else {
          discordStatus.textContent = 'Enabled';
          discordStatus.style.color = 'var(--color-warning)';
        }
      } else {
        discordStatus.textContent = 'Disabled';
        discordStatus.style.color = 'var(--color-text-muted)';
      }
    }
    
    if (telegramStatus) {
      const telegram = platforms.telegram || {};
      if (telegram.enabled) {
        const username = telegram.botUsername;
        if (username) {
          telegramStatus.textContent = `@${username.replace(/^@/, '')}`;
          telegramStatus.style.color = 'var(--color-success)';
        } else if (telegram.botToken) {
          telegramStatus.textContent = 'Connected';
          telegramStatus.style.color = 'var(--color-success)';
        } else {
          telegramStatus.textContent = 'Enabled';
          telegramStatus.style.color = 'var(--color-warning)';
        }
      } else {
        telegramStatus.textContent = 'Disabled';
        telegramStatus.style.color = 'var(--color-text-muted)';
      }
    }
    
    if (xStatus) {
      const x = platforms.x || {};
      if (x.enabled) {
        const handle = x.accountId || x.handle || x.username;
        if (handle) {
          xStatus.textContent = `@${handle.replace(/^@/, '')}`;
          xStatus.style.color = 'var(--color-success)';
        } else if (x.oauth1?.apiKey) {
          xStatus.textContent = 'Connected';
          xStatus.style.color = 'var(--color-success)';
        } else {
          xStatus.textContent = 'Enabled';
          xStatus.style.color = 'var(--color-warning)';
        }
      } else {
        xStatus.textContent = 'Disabled';
        xStatus.style.color = 'var(--color-text-muted)';
      }
    }
    
    // Get the bot's assigned avatar count
    const botAvatarCount = bot.avatars?.length || bot.avatarIds?.length || 0;
    
    // Get global avatar count from stats element (already populated by fetchStats)
    const globalAvatarsEl = document.getElementById('stat-avatars');
    const globalAvatarCount = globalAvatarsEl ? parseInt(globalAvatarsEl.textContent, 10) || 0 : 0;
    
    if (avatarsCount) {
      avatarsCount.textContent = botAvatarCount.toString();
      
      // Show migrate button if there are unassigned avatars
      if (migrateBtn) {
        const unassigned = globalAvatarCount - botAvatarCount;
        if (unassigned > 0) {
          migrateBtn.style.display = 'block';
          migrateBtn.textContent = `Assign ${unassigned} unassigned`;
        } else {
          migrateBtn.style.display = 'none';
        }
      }
    }
    
    // Show hint if no platforms are configured
    const anyConnected = platforms.discord?.enabled || platforms.telegram?.enabled || platforms.x?.enabled;
    if (hint) {
      hint.style.display = anyConnected ? 'none' : 'block';
    }
  } catch (e) {
    console.warn('Failed to load platform status', e);
    if (discordStatus) discordStatus.textContent = '--';
    if (telegramStatus) telegramStatus.textContent = '--';
    if (xStatus) xStatus.textContent = '--';
  }
}

// Wait for both DOM ready and admin bootstrap readiness (so window.AdminAPI is present)
function onReady(fn){
  if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(fn,0); }
  else document.addEventListener('DOMContentLoaded', fn);
}
let _bootstrapReady = false;
window.addEventListener('admin:bootstrapReady', () => { _bootstrapReady = true; });
onReady(() => {
  // If bootstrap not yet ready, poll briefly
  const start = Date.now();
  (function waitBootstrap(){
    if (_bootstrapReady || (window.AdminAPI && window.AdminAuth)) return init();
    if (Date.now() - start > 3000) { // 3s timeout
      console.warn('[admin-dashboard] bootstrap not detected; continuing anyway');
      return init();
    }
    setTimeout(waitBootstrap, 50);
  })();
});

// Note: wireAdminX, wireGlobalXToggle, and wireOAuth1Form have been deprecated.
// Platform configuration (X, Telegram, Discord) is now managed per-bot on the bot detail page.
// See /admin/bots/detail.html?id=default&tab=platforms for platform configuration.
