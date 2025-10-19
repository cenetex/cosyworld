// admin-servers.js (simplified two-column version: Authorized / Detected)
// Relies on admin-bootstrap for globals
const api = window.AdminAPI;
const ui = window.AdminUI;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function guildDisplayName(g) {
  return g.guildName || g.name || g.id || g.guildId || 'Unknown Server';
}

function iconUrl(g) {
  const guildId = g.guildId || g.id;
  if (g.iconUrl) return g.iconUrl;
  if (g.icon && guildId) return `https://cdn.discordapp.com/icons/${guildId}/${g.icon}.png`;
  return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function renderGuildCard(g) {
  const authorized = !!(g.authorized || g.whitelisted);
  const card = el('div','p-4 border rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow');
  const statusBadge = authorized
    ? '<span class="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium whitespace-nowrap">✓ Authorized</span>'
    : '<span class="text-xs px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700 font-medium whitespace-nowrap">⚠ Detected</span>';
  
  if (authorized) {
    // Authorized servers: improved wide-screen layout
    card.innerHTML = `
      <div class="flex flex-col gap-4">
        <!-- Header Row -->
        <div class="flex items-center gap-3">
          <img src="${iconUrl(g)}" class="w-12 h-12 rounded-lg bg-gray-200 border-2 border-gray-300 flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-base font-semibold text-gray-900 truncate" title="${guildDisplayName(g)}">${guildDisplayName(g)}</h3>
              ${statusBadge}
            </div>
            <div class="text-xs text-gray-500">
              <code class="font-mono bg-gray-100 px-1.5 py-0.5 rounded">${g.guildId || g.id}</code>
            </div>
          </div>
        </div>
        
        <!-- X Account Configuration Section -->
        <div class="border-t pt-3 space-y-2">
          <div class="text-xs font-semibold text-gray-700 mb-2">X Account Overrides</div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <div>
              <label class="block text-xs text-gray-600 mb-1">Image Posts</label>
              <select class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" data-x-image>
                <option value="">Auto (Default)</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-600 mb-1">Video Posts</label>
              <select class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" data-x-video>
                <option value="">Auto (Default)</option>
              </select>
            </div>
          </div>
          <button class="btn outline text-xs w-full sm:w-auto px-4" data-act="save-x" title="Save X account overrides">
            💾 Save X Accounts
          </button>
        </div>
        
        <!-- Action Buttons -->
        <div class="flex flex-wrap gap-2 pt-2 border-t" data-actions>
          <button class="btn outline text-xs flex-1 sm:flex-none" data-act="cache">
            🔄 Clear Cache
          </button>
          <button class="btn outline text-xs flex-1 sm:flex-none" data-act="deauth">
            🚫 Deauthorize
          </button>
          <button class="btn danger text-xs flex-1 sm:flex-none" data-act="delete">
            🗑️ Delete
          </button>
        </div>
      </div>`;
    bindAuthorizedActions(card, g);
    hydrateXSelectors(card, g);
  } else {
    // Detected servers: simpler layout
    card.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center gap-3">
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <img src="${iconUrl(g)}" class="w-12 h-12 rounded-lg bg-gray-200 border-2 border-gray-300 flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-base font-semibold text-gray-900 truncate" title="${guildDisplayName(g)}">${guildDisplayName(g)}</h3>
              ${statusBadge}
            </div>
            <div class="text-xs text-gray-500">
              <code class="font-mono bg-gray-100 px-1.5 py-0.5 rounded">${g.id}</code>
            </div>
          </div>
        </div>
        <div class="flex justify-end sm:justify-start">
          <button class="btn text-xs px-4 py-2 whitespace-nowrap" data-act="authorize" style="--btn-bg:#059669; --btn-bg-hover:#047857; --btn-border:#059669;">
            ✓ Authorize Server
          </button>
        </div>
      </div>`;
    bindDetectedActions(card, g);
  }
  return card;
}

async function apiWrap(path, opts) {
  return api.apiFetch(path, { requireCsrf: true, sign: true, ...(opts||{}) });
}

async function loadAll() {
  const authList = document.getElementById('authorizedList');
  const detList = document.getElementById('detectedList');
  const counts = document.getElementById('serverCounts');
  if (authList) authList.innerHTML = '<div class="text-xs text-gray-500">Loading...</div>';
  if (detList) detList.innerHTML = '<div class="text-xs text-gray-500">Loading...</div>';
  if (counts) counts.textContent = '…';
  try {
    const [configs, detected] = await Promise.all([
      apiWrap('/api/guilds'),
      apiWrap('/api/guilds/detected')
    ]);
    
    const authorized = (configs||[]).filter(g => g.authorized || g.whitelisted).sort((a,b)=>{
      const nameA = guildDisplayName(a) || '';
      const nameB = guildDisplayName(b) || '';
      return nameA.localeCompare(nameB);
    });
    // Remove any detected entries already authorized
    const detectedFiltered = (detected||[]).filter(g => !authorized.find(a => (a.guildId||a.id) === g.id)).sort((a,b)=>{
      const nameA = guildDisplayName(a) || '';
      const nameB = guildDisplayName(b) || '';
      return nameA.localeCompare(nameB);
    });

    if (counts) counts.textContent = `${authorized.length} auth · ${detectedFiltered.length} detected`;

    // Render Authorized
    if (authList) {
      authList.innerHTML = '';
      if (!authorized.length) authList.innerHTML = '<div class="text-sm text-gray-500 text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">No authorized servers yet</div>';
      authorized.forEach(g => authList.appendChild(renderGuildCard(g)));
    }
    // Render Detected
    if (detList) {
      detList.innerHTML = '';
      if (!detectedFiltered.length) detList.innerHTML = '<div class="text-sm text-gray-500 text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">No detected servers</div>';
      detectedFiltered.forEach(g => detList.appendChild(renderGuildCard(g)));
    }
  } catch (e) {
    console.error('Failed to load servers:', e);
    if (authList) authList.innerHTML = '<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Failed to load authorized servers</div>';
    if (detList) detList.innerHTML = '<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Failed to load detected servers</div>';
    ui.error(e.message || 'Failed to load servers');
  }
}

function bindAuthorizedActions(card, g) {
  const id = g.guildId || g.id;
  
  // Deauthorize button
  const deauthBtn = card.querySelector('[data-act="deauth"]');
  if (deauthBtn) {
    const originalHTML = deauthBtn.innerHTML;
    deauthBtn.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.innerHTML = '⏳ Processing...';
      btn.disabled = true;
      try {
        await apiWrap(`/api/guilds/${encodeURIComponent(id)}`, { method:'PATCH', body: JSON.stringify({ authorized:false, whitelisted:false }) });
        await apiWrap(`/api/guilds/${encodeURIComponent(id)}/clear-cache`, { method:'POST' });
        ui.success('Deauthorized');
        loadAll();
      } catch (err) { 
        console.error('Deauthorize error:', err);
        ui.error(err.message||'Failed to deauthorize'); 
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }
    });
  }
  
  // Clear cache button
  const cacheBtn = card.querySelector('[data-act="cache"]');
  if (cacheBtn) {
    const originalHTML = cacheBtn.innerHTML;
    cacheBtn.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.innerHTML = '⏳ Clearing...';
      btn.disabled = true;
      try { 
        await apiWrap(`/api/guilds/${encodeURIComponent(id)}/clear-cache`, { method:'POST' }); 
        ui.success('Cache cleared'); 
      }
      catch (err) { 
        console.error('Cache clear error:', err);
        ui.error(err.message||'Failed to clear cache'); 
      }
      finally { 
        btn.innerHTML = originalHTML;
        btn.disabled = false; 
      }
    });
  }
  
  // Delete button
  const deleteBtn = card.querySelector('[data-act="delete"]');
  if (deleteBtn) {
    const originalHTML = deleteBtn.innerHTML;
    deleteBtn.addEventListener('click', async (e) => {
      if (!confirm('Delete this server configuration?')) return;
      const btn = e.currentTarget;
      btn.innerHTML = '⏳ Deleting...';
      btn.disabled = true;
      try { 
        await apiWrap(`/api/guilds/${encodeURIComponent(id)}`, { method:'DELETE' }); 
        ui.success('Deleted'); 
        loadAll(); 
      }
      catch (err) { 
        console.error('Delete error:', err);
        ui.error(err.message||'Failed to delete'); 
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }
    });
  }
  
  // Save X overrides
  const saveBtn = card.querySelector('[data-act="save-x"]');
  if (saveBtn) {
    const originalHTML = saveBtn.innerHTML;
    saveBtn.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.innerHTML = '⏳ Saving...';
      btn.disabled = true;
      try {
        const imageSel = card.querySelector('[data-x-image]');
        const videoSel = card.querySelector('[data-x-video]');
        const body = {
          imageAuthId: imageSel?.value || null,
          videoAuthId: videoSel?.value || null
        };
        await apiWrap(`/api/guilds/${encodeURIComponent(id)}/x-accounts`, { method:'PUT', body: JSON.stringify(body) });
        ui.success('X account overrides saved');
      } catch (err) { 
        console.error('Save X accounts error:', err);
        ui.error(err.message||'Failed to save X accounts'); 
      }
      finally { 
        btn.innerHTML = originalHTML;
        btn.disabled = false; 
      }
    });
  }
}

function bindDetectedActions(card, g) {
  const authorizeBtn = card.querySelector('[data-act="authorize"]');
  if (authorizeBtn) {
    const originalHTML = authorizeBtn.innerHTML;
    authorizeBtn.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.innerHTML = '⏳ Authorizing...';
      btn.disabled = true;
      try {
        await apiWrap(`/api/guilds/${encodeURIComponent(g.id)}/authorize`, { method:'POST' });
        ui.success(`Authorized ${guildDisplayName(g)}`);
        loadAll();
      } catch (err) { 
        console.error('Authorize error:', err);
        ui.error(err.message||'Failed to authorize'); 
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }
    });
  }
}

window.addEventListener('admin:bootstrapReady', () => loadAll());
if (document.readyState !== 'loading') loadAll(); else document.addEventListener('DOMContentLoaded', loadAll);

document.getElementById('btnRefreshAll')?.addEventListener('click', loadAll);

// --- X account selectors hydration ---
let _xAccountCache = null;
async function loadXAccountOptions() {
  if (_xAccountCache) return _xAccountCache;
  try {
    const res = await apiWrap('/api/admin/x-accounts');
    const list = (res?.xAccounts || []).map(r => ({
      id: r.xAuthId,
      name: r.avatar?.name || r.xProfile?.username || 'unknown',
      hasVideoCreds: !!r.xAuth?.authorized && !!r.xProfile && !!r.xAuth?.global ? !!r.xAuth?.authorized : !!r.xProfile, // heuristic
      global: !!r.xAuth?.global
    }));
    _xAccountCache = list;
    return list;
  } catch (e) { ui.error('Failed to load X accounts'); return []; }
}

async function hydrateXSelectors(card, g) {
  const imgSel = card.querySelector('[data-x-image]');
  const vidSel = card.querySelector('[data-x-video]');
  if (!imgSel || !vidSel) return;
  // Load current overrides
  let current = null;
  try { current = await apiWrap(`/api/guilds/${encodeURIComponent(g.guildId||g.id)}/x-accounts`); } catch {}
  const currentImg = current?.xAccounts?.imageAuthId || '';
  const currentVid = current?.xAccounts?.videoAuthId || '';
  const opts = await loadXAccountOptions();
  for (const acct of opts) {
    const opt1 = document.createElement('option');
    opt1.value = acct.id; opt1.textContent = `${acct.name}${acct.global ? ' (global)' : ''}`; if (acct.id === currentImg) opt1.selected = true; imgSel.appendChild(opt1);
    const opt2 = document.createElement('option');
    opt2.value = acct.id; opt2.textContent = `${acct.name}${acct.global ? ' (global)' : ''}${acct.hasVideoCreds ? '' : ' *'}`; if (acct.id === currentVid) opt2.selected = true; vidSel.appendChild(opt2);
  }
  if (currentImg && ![...imgSel.options].some(o=>o.value===currentImg)) {
    const orphan = document.createElement('option'); orphan.value=currentImg; orphan.textContent=`(missing) ${currentImg}`; orphan.selected=true; imgSel.appendChild(orphan);
  }
  if (currentVid && ![...vidSel.options].some(o=>o.value===currentVid)) {
    const orphan = document.createElement('option'); orphan.value=currentVid; orphan.textContent=`(missing) ${currentVid}`; orphan.selected=true; vidSel.appendChild(orphan);
  }
}
