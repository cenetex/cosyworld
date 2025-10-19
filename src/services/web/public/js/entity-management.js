// Simple tabbed Entity Management; reuses Avatar logic and basic loaders for Locations/Items

import './avatar-management.js';
// Entity management now relies on shared admin bootstrap globals
const api = window.AdminAPI;
const ui = window.AdminUI;
const auth = window.AdminAuth;

(function(){
  function activate(tabId) {
    const tabs = ['avatars','locations','items'];
    tabs.forEach(name => {
      const tab = document.getElementById(`tab-${name}`);
      const panel = document.getElementById(`panel-${name}`);
      if (!tab || !panel) return;
      const active = name === tabId;
      panel.classList.toggle('hidden', !active);
      
      // Update tab styling - modern tab design
      if (active) {
        tab.classList.add('border-indigo-600', 'text-indigo-600', 'font-medium');
        tab.classList.remove('border-transparent', 'text-gray-500');
      } else {
        tab.classList.remove('border-indigo-600', 'text-indigo-600', 'font-medium');
        tab.classList.add('border-transparent', 'text-gray-500');
      }
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    const tA = document.getElementById('tab-avatars');
    const tL = document.getElementById('tab-locations');
    const tI = document.getElementById('tab-items');
    tA && tA.addEventListener('click', () => activate('avatars'));
    tL && tL.addEventListener('click', () => activate('locations'));
    tI && tI.addEventListener('click', () => activate('items'));
    activate('avatars');

    // minimal loaders for locations/items lists
    loadLocations();
    loadItems();
  });

  async function loadLocations() {
    const body = document.getElementById('locations-body');
    if (body) body.innerHTML = '<tr><td colspan="5" class="px-3 py-4 text-center text-sm text-gray-500">Loading locations…</td></tr>';
    try {
      const data = await api.apiFetch('/api/admin/locations?limit=20&offset=0');
      const rows = (data.data || []).map(loc => `
        <tr class="hover:bg-gray-50 transition">
          <td class="px-3 py-3"><img class="h-10 w-10 rounded object-cover" src="${loc.thumbnailUrl || loc.imageUrl || ''}" alt="" onerror="this.style.display='none'"/></td>
          <td class="px-3 py-3 text-sm text-gray-900 font-medium">${loc.name || ''}</td>
          <td class="px-3 py-3 text-sm text-gray-500">${loc.type || ''}</td>
          <td class="px-3 py-3 text-xs text-gray-500">${formatDate(loc.createdAt)}</td>
          <td class="px-3 py-3 text-sm"><button class="edit-location text-indigo-600 hover:text-indigo-900" data-id="${loc._id}">Edit</button></td>
        </tr>`).join('');
      if (body) body.innerHTML = rows || '<tr><td colspan="5" class="px-3 py-4 text-center text-sm text-gray-500">No locations</td></tr>';
      document.querySelectorAll('.edit-location').forEach(btn => btn.addEventListener('click', () => openLocationModal(btn.dataset.id)));
    } catch (e) {
      if (body) body.innerHTML = '<tr><td colspan="5" class="px-3 py-4 text-center text-sm text-red-500">Failed to load locations</td></tr>';
      ui?.error?.(e.message || 'Failed to load locations');
    }
  }

  async function loadItems() {
    const body = document.getElementById('items-body');
    if (body) body.innerHTML = '<tr><td colspan="5" class="px-3 py-4 text-center text-sm text-gray-500">Loading items…</td></tr>';
    try {
      const data = await api.apiFetch('/api/admin/items?limit=20&offset=0');
      const rows = (data.data || []).map(item => `
        <tr class="hover:bg-gray-50 transition">
          <td class="px-3 py-3"><img class="h-10 w-10 rounded object-cover" src="${item.thumbnailUrl || item.imageUrl || ''}" alt="" onerror="this.style.display='none'"/></td>
          <td class="px-3 py-3 text-sm text-gray-900 font-medium">${item.name || ''}</td>
          <td class="px-3 py-3 text-sm text-gray-500">${item.rarity || ''}</td>
          <td class="px-3 py-3 text-xs text-gray-500">${formatDate(item.createdAt)}</td>
          <td class="px-3 py-3 text-sm"><button class="edit-item text-indigo-600 hover:text-indigo-900" data-id="${item._id}">Edit</button></td>
        </tr>`).join('');
      if (body) body.innerHTML = rows || '<tr><td colspan="5" class="px-3 py-4 text-center text-sm text-gray-500">No items</td></tr>';
      document.querySelectorAll('.edit-item').forEach(btn => btn.addEventListener('click', () => openItemModal(btn.dataset.id)));
    } catch (e) {
      if (body) body.innerHTML = '<tr><td colspan="5" class="px-3 py-4 text-center text-sm text-red-500">Failed to load items</td></tr>';
      ui?.error?.(e.message || 'Failed to load items');
    }
  }

  function formatDate(dateLike) {
    if (!dateLike) return '';
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  }

  // Location Modal logic
  async function openLocationModal(id) {
    const modal = document.getElementById('location-modal');
    const title = document.getElementById('location-modal-title');
    const del = document.getElementById('delete-location');
    const form = document.getElementById('location-form');
    if (!modal || !form) return;
    form.dataset.id = id || '';
    del.classList.toggle('hidden', !id);
    title.textContent = id ? 'Edit Location' : 'New Location';
    const preview = document.getElementById('location-image-preview');
    const imageUrlInput = document.getElementById('location-imageUrl');
    const updatePreview = () => {
      const url = imageUrlInput.value?.trim();
      if (url) {
        preview.src = url;
        preview.classList.remove('hidden');
      } else {
        preview.src = '';
        preview.classList.add('hidden');
      }
    };
    imageUrlInput?.removeEventListener('input', updatePreview);
    imageUrlInput?.addEventListener('input', updatePreview);

    if (id) {
      const loc = await api.apiFetch(`/api/admin/locations/${id}`);
      document.getElementById('location-name').value = loc.name || '';
      document.getElementById('location-type').value = loc.type || '';
      document.getElementById('location-imageUrl').value = loc.imageUrl || '';
      document.getElementById('location-description').value = loc.description || '';
      updatePreview();
    } else {
      document.getElementById('location-name').value = '';
      document.getElementById('location-type').value = '';
      document.getElementById('location-imageUrl').value = '';
      document.getElementById('location-description').value = '';
      updatePreview();
    }
    modal.classList.remove('hidden');
  }

  document.getElementById('new-location')?.addEventListener('click', () => openLocationModal());
  document.getElementById('close-location-modal')?.addEventListener('click', () => document.getElementById('location-modal').classList.add('hidden'));
  document.getElementById('cancel-location')?.addEventListener('click', () => document.getElementById('location-modal').classList.add('hidden'));
  document.getElementById('delete-location')?.addEventListener('click', async (e) => {
    const id = document.getElementById('location-form').dataset.id;
    if (!id) return;
    if (!confirm('Delete this location?')) return;
    const btn = e.currentTarget;
    await ui.withButtonLoading(btn, async () => {
  await api.apiFetch(`/api/admin/locations/${id}`, { method: 'DELETE', sign: true, signMeta: { op: 'delete_location', id } });
      ui.success('Location deleted');
    });
    document.getElementById('location-modal').classList.add('hidden');
    loadLocations();
  });
  document.getElementById('location-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const id = form.dataset.id;
    const payload = {
      name: document.getElementById('location-name').value,
      type: document.getElementById('location-type').value,
      imageUrl: document.getElementById('location-imageUrl').value,
      description: document.getElementById('location-description').value,
    };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/admin/locations/${id}` : '/api/admin/locations';
    const saveBtn = document.getElementById('save-location');
    await ui.withButtonLoading(saveBtn, async () => {
      try {
  await api.apiFetch(url, { method, sign: true, signMeta: { op: id ? 'update_location' : 'create_location', id }, body: JSON.stringify(payload), requireCsrf: true });
        ui.success(`Location ${id ? 'updated' : 'created'}`);
        document.getElementById('location-modal').classList.add('hidden');
        loadLocations();
      } catch (err) {
        ui.error(err.message || 'Failed to save location');
      }
    });
  });

  // Item Modal logic
  async function openItemModal(id) {
    const modal = document.getElementById('item-modal');
    const title = document.getElementById('item-modal-title');
    const del = document.getElementById('delete-item');
    const form = document.getElementById('item-form');
    if (!modal || !form) return;
    form.dataset.id = id || '';
    del.classList.toggle('hidden', !id);
    title.textContent = id ? 'Edit Item' : 'New Item';
    const preview = document.getElementById('item-image-preview');
    const imageUrlInput = document.getElementById('item-imageUrl');
    const updatePreview = () => {
      const url = imageUrlInput.value?.trim();
      if (url) {
        preview.src = url;
        preview.classList.remove('hidden');
      } else {
        preview.src = '';
        preview.classList.add('hidden');
      }
    };
    imageUrlInput?.removeEventListener('input', updatePreview);
    imageUrlInput?.addEventListener('input', updatePreview);

    if (id) {
      const item = await api.apiFetch(`/api/admin/items/${id}`);
      document.getElementById('item-name').value = item.name || '';
      document.getElementById('item-rarity').value = item.rarity || '';
      document.getElementById('item-imageUrl').value = item.imageUrl || '';
      document.getElementById('item-description').value = item.description || '';
      updatePreview();
    } else {
      document.getElementById('item-name').value = '';
      document.getElementById('item-rarity').value = '';
      document.getElementById('item-imageUrl').value = '';
      document.getElementById('item-description').value = '';
      updatePreview();
    }
    modal.classList.remove('hidden');
  }

  document.getElementById('new-item')?.addEventListener('click', () => openItemModal());
  document.getElementById('close-item-modal')?.addEventListener('click', () => document.getElementById('item-modal').classList.add('hidden'));
  document.getElementById('cancel-item')?.addEventListener('click', () => document.getElementById('item-modal').classList.add('hidden'));
  document.getElementById('delete-item')?.addEventListener('click', async (e) => {
    const id = document.getElementById('item-form').dataset.id;
    if (!id) return;
    if (!confirm('Delete this item?')) return;
    const btn = e.currentTarget;
    await ui.withButtonLoading(btn, async () => {
  await api.apiFetch(`/api/admin/items/${id}`, { method: 'DELETE', sign: true, signMeta: { op: 'delete_item', id }, requireCsrf: true });
      ui.success('Item deleted');
    });
    document.getElementById('item-modal').classList.add('hidden');
    loadItems();
  });
  document.getElementById('item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const id = form.dataset.id;
    const name = document.getElementById('item-name').value?.trim() || '';
    if (name.length > 120) { ui.error('Name must be at most 120 characters.'); return; }
    const payload = {
      name,
      rarity: document.getElementById('item-rarity').value,
      imageUrl: document.getElementById('item-imageUrl').value,
      description: document.getElementById('item-description').value,
    };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/admin/items/${id}` : '/api/admin/items';
    const saveBtn = document.getElementById('save-item');
    await ui.withButtonLoading(saveBtn, async () => {
      try {
  await api.apiFetch(url, { method, sign: true, signMeta: { op: id ? 'update_item' : 'create_item', id }, body: JSON.stringify(payload), requireCsrf: true });
        ui.success(`Item ${id ? 'updated' : 'created'}`);
        document.getElementById('item-modal').classList.add('hidden');
        loadItems();
      } catch (err) {
        ui.error(err.message || 'Failed to save item');
      }
    });
  });
})();
