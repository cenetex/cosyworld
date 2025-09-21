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
  return g.guildName || g.name || g.id;
}

function iconUrl(g) {
  if (g.iconUrl) return g.iconUrl;
  if (g.icon) return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`;
  return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function renderGuildCard(g) {
  const authorized = !!(g.authorized || g.whitelisted);
  const card = el('div','p-3 border rounded bg-white flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4');
  const statusBadge = authorized
    ? '<span class="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 whitespace-nowrap">authorized</span>'
    : '<span class="text-[10px] px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 whitespace-nowrap">detected</span>';
  card.innerHTML = `
    <div class="flex items-start gap-3 min-w-0 sm:items-center">
      <img src="${iconUrl(g)}" class="w-10 h-10 rounded bg-gray-200 border flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
      <div class="min-w-0 space-y-1">
        <div class="flex items-center gap-2 min-w-0">
          <div class="text-sm font-medium truncate" title="${guildDisplayName(g)}">${guildDisplayName(g)}</div>
          ${statusBadge}
        </div>
        <div class="text-[11px] text-gray-500 break-all">ID: <code class="font-mono">${g.guildId || g.id}</code></div>
      </div>
    </div>
    <div class="flex flex-row flex-wrap sm:flex-nowrap items-center gap-2 sm:ml-auto" data-actions></div>`;
  const actions = card.querySelector('[data-actions]');
  if (authorized) {
    actions.innerHTML = `
      <button class="btn outline text-xs w-auto" data-act="deauth">Deauthorize</button>
      <button class="btn outline text-xs w-auto" data-act="cache">Cache</button>
      <button class="btn danger text-xs w-auto" data-act="delete">Delete</button>`;
    bindAuthorizedActions(card, g);
  } else {
    actions.innerHTML = `<button class="btn text-xs w-auto" data-act="authorize" style="--btn-bg:#059669; --btn-bg-hover:#047857; --btn-border:#059669;">Authorize</button>`;
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
    const authorized = (configs||[]).filter(g => g.authorized || g.whitelisted).sort((a,b)=>guildDisplayName(a).localeCompare(guildDisplayName(b)));
    // Remove any detected entries already authorized
    const detectedFiltered = (detected||[]).filter(g => !authorized.find(a => (a.guildId||a.id) === g.id)).sort((a,b)=>guildDisplayName(a).localeCompare(guildDisplayName(b)));

    if (counts) counts.textContent = `${authorized.length} auth · ${detectedFiltered.length} detected`;

    // Render Authorized
    if (authList) {
      authList.innerHTML = '';
      if (!authorized.length) authList.innerHTML = '<div class="text-xs text-gray-500">None</div>';
      authorized.forEach(g => authList.appendChild(renderGuildCard(g)));
    }
    // Render Detected
    if (detList) {
      detList.innerHTML = '';
      if (!detectedFiltered.length) detList.innerHTML = '<div class="text-xs text-gray-500">None</div>';
      detectedFiltered.forEach(g => detList.appendChild(renderGuildCard(g)));
    }
  } catch (e) {
    if (authList) authList.innerHTML = '<div class="text-xs text-red-600">Failed to load</div>';
    if (detList) detList.innerHTML = '<div class="text-xs text-red-600">Failed to load</div>';
    ui.error(e.message || 'Failed to load servers');
  }
}

function bindAuthorizedActions(card, g) {
  const id = g.guildId || g.id;
  card.querySelector('[data-act="deauth"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const original = btn.textContent; btn.textContent='…'; btn.disabled=true;
    try {
      await apiWrap(`/api/guilds/${encodeURIComponent(id)}`, { method:'PATCH', body: JSON.stringify({ authorized:false, whitelisted:false }) });
      await apiWrap(`/api/guilds/${encodeURIComponent(id)}/clear-cache`, { method:'POST' });
      ui.success('Deauthorized');
      loadAll();
    } catch (err) { ui.error(err.message||'Failed'); }
    finally { btn.textContent=original; btn.disabled=false; }
  });
  card.querySelector('[data-act="cache"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget; const original = btn.textContent; btn.textContent='…'; btn.disabled=true;
    try { await apiWrap(`/api/guilds/${encodeURIComponent(id)}/clear-cache`, { method:'POST' }); ui.success('Cache cleared'); }
    catch (err) { ui.error(err.message||'Failed'); }
    finally { btn.textContent=original; btn.disabled=false; }
  });
  card.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
    if (!confirm('Delete this server configuration?')) return;
    const btn = e.currentTarget; const original = btn.textContent; btn.textContent='…'; btn.disabled=true;
    try { await apiWrap(`/api/guilds/${encodeURIComponent(id)}`, { method:'DELETE' }); ui.success('Deleted'); loadAll(); }
    catch (err) { ui.error(err.message||'Failed'); }
    finally { btn.textContent=original; btn.disabled=false; }
  });
}

function bindDetectedActions(card, g) {
  card.querySelector('[data-act="authorize"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget; const original = btn.textContent; btn.textContent='…'; btn.disabled=true;
    try {
      await apiWrap(`/api/guilds/${encodeURIComponent(g.id)}/authorize`, { method:'POST' });
      ui.success(`Authorized ${guildDisplayName(g)}`);
      loadAll();
    } catch (err) { ui.error(err.message||'Failed'); }
    finally { btn.textContent=original; btn.disabled=false; }
  });
}

window.addEventListener('admin:bootstrapReady', () => loadAll());
if (document.readyState !== 'loading') loadAll(); else document.addEventListener('DOMContentLoaded', loadAll);

document.getElementById('btnRefreshAll')?.addEventListener('click', loadAll);
