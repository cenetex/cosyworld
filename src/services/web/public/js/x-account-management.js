/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

document.addEventListener("DOMContentLoaded", () => {
  const api = window.AdminAPI;
  const ui = window.AdminUI;
  const auth = window.AdminAuth;
  // DOM Elements
  const elements = {
    xAccountsBody: document.getElementById("x-accounts-body"),
    refreshButton: document.getElementById("refresh-accounts"),
  };

  // Initialization
  loadXAccounts();
  setupEventListeners();

  // Event Listeners Setup
  function setupEventListeners() {
    elements.refreshButton.addEventListener("click", () => {
      loadXAccounts();
    });
  }

  // Helper to produce signed headers for admin writes
  async function getSignedHeaders(extra) { return auth.getSignedHeaders(extra); }

  // X Accounts Functions
  async function loadXAccounts() {
    try {
      elements.xAccountsBody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Loading X accounts...</td></tr>';

      // Fetch all X auth records with avatar details
      const data = await api.apiFetch('/api/admin/x-accounts');

      if (data.error) {
        throw new Error(data.error);
      }

      const xAccounts = data.xAccounts || [];

      if (xAccounts.length === 0) {
        elements.xAccountsBody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">No X accounts found</td></tr>';
      } else {
        renderXAccounts(xAccounts);
      }
    } catch (error) {
  console.error("Error loading X accounts:", error);
  ui.error(error.message || 'Failed to load X accounts');
      elements.xAccountsBody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-red-500">Failed to load X accounts</td></tr>';
    }
  }

  function renderXAccounts(xAccounts) {
    if (xAccounts.length === 0) {
      elements.xAccountsBody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">No X accounts found</td></tr>`;
      return;
    }
    elements.xAccountsBody.innerHTML = xAccounts.map(createXAccountRow).join("");
    setupRowEventListeners();
  // Enrich rows that are authorized but missing cached profile
  enrichMissingProfiles(xAccounts);
  }

  function createXAccountRow(xAccount) {
    const { avatar, xAuth, xProfile, xAuthId } = xAccount;

    return `
      <tr data-avatar-id="${avatar._id}">
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <img class="h-10 w-10 rounded-full object-cover" src="${avatar.thumbnailUrl || avatar.imageUrl || "/default-avatar.png"}" alt="${avatar.name || "Avatar"}">
            <div class="ml-3">
              <div class="text-sm font-medium text-gray-900">${avatar.name || "Unnamed"}</div>
              <div class="text-sm text-gray-500">${avatar._id}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          ${renderXProfileCell(xProfile)}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(xAuth.authorized)}">
            ${xAuth.authorized ? 'Connected' : 'Disconnected'}
          </span>
          ${xAuth.global ? '<span class="ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-indigo-100 text-indigo-800">Global</span>' : ''}
          ${xAuth.error ? `<div class="text-xs text-red-500 mt-1">${xAuth.error}</div>` : ''}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${xAuth.expiresAt ? formatDate(xAuth.expiresAt) : 'N/A'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm space-x-3">
          ${xAuth.authorized ? `
            <button data-avatar-id="${avatar._id}" class="reauthorize-x text-indigo-600 hover:text-indigo-900">Re-authorize</button>
            <button data-avatar-id="${avatar._id}" data-xauth-id="${xAuthId}" class="set-global-x text-green-600 hover:text-green-900 ${xAuth.global ? 'hidden' : ''}">Set Global</button>
            <button data-avatar-id="${avatar._id}" class="disconnect-x text-red-600 hover:text-red-900">Disconnect</button>
          ` : `
            <button data-avatar-id="${avatar._id}" class="connect-x text-blue-600 hover:text-blue-900">Connect</button>
            <button data-avatar-id="${avatar._id}" class="reauthorize-x text-indigo-600 hover:text-indigo-900">Re-authorize</button>
          `}
        </td>
      </tr>
    `;
  }

  function renderXProfileCell(xProfile) {
    if (!xProfile) return '<span class="text-sm text-gray-500">Not connected</span>';
    return `
      <div class="flex items-center">
        <img class="h-8 w-8 rounded-full object-cover" src="${xProfile.profile_image_url || "/default-avatar.png"}" alt="${xProfile.name || "X User"}">
        <div class="ml-3">
          <div class="text-sm font-medium text-gray-900">${xProfile.name || "Unknown"}</div>
          <div class="text-sm text-gray-500">@${xProfile.username || "unknown"}</div>
        </div>
      </div>`;
  }

  async function enrichMissingProfiles(xAccounts) {
    const targets = xAccounts.filter(a => a?.xAuth?.authorized && !a?.xProfile);
    if (!targets.length) return;
    await Promise.all(targets.map(async (acc) => {
      try {
        const id = acc.avatar?._id;
        if (!id) return;
        const res = await fetch(`/api/xauth/status/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        const p = data?.profile;
        if (!p) return;
        // Update the X Profile cell in-place
        const row = elements.xAccountsBody.querySelector(`tr[data-avatar-id="${id}"]`);
        const cell = row?.children?.[1];
        if (cell) {
          cell.innerHTML = renderXProfileCell(p);
        }
      } catch {}
    }));
  }

  function setupRowEventListeners() {
    document.querySelectorAll(".disconnect-x").forEach((button) => {
      button.addEventListener("click", () => disconnectX(button.dataset.avatarId));
    });
    document.querySelectorAll(".connect-x").forEach((button) => {
      button.addEventListener("click", () => connectX(button.dataset.avatarId));
    });
    document.querySelectorAll(".reauthorize-x").forEach((button) => {
      button.addEventListener("click", () => reauthorizeX(button.dataset.avatarId));
    });
    document.querySelectorAll('.set-global-x').forEach((button) => {
      button.addEventListener('click', () => setGlobalX(button.dataset.xauthId));
    });
  }

  async function disconnectX(avatarId) {
    if (!confirm("Are you sure you want to disconnect this X account?")) return;

    try {
      await api.apiFetch(`/api/xauth/disconnect/${avatarId}`, { method: 'POST', sign: true, signMeta: { op: 'disconnect_x', avatarId }, requireCsrf: true });
      await loadXAccounts();
      ui.success('X account disconnected');
    } catch (error) {
      console.error("Error disconnecting X account:", error);
      ui.error(error.message || 'Disconnect failed');
    }
  }

  async function connectX(avatarId) {
    // For admin purposes, we might need to implement a way to connect
    // This would require wallet signature, so it's complex for admin panel
    ui.error("Use avatar's main interface to connect new X account");
  }

  async function reauthorizeX(avatarId) {
    try {
      // Start admin-permitted OAuth flow for this avatar
      const data = await api.apiFetch(`/api/xauth/admin/auth-url/${avatarId}`);
      const w = 600, h = 650;
      const l = window.screen.width / 2 - w / 2;
      const t = window.screen.height / 2 - h / 2;
      const popup = window.open(data.url, 'xauth_popup', `width=${w},height=${h},top=${t},left=${l},resizable=yes,scrollbars=yes`);
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        throw new Error('Popup blocked. Please allow popups.');
      }
      const onMsg = async (ev) => {
        if (ev.data?.type === 'X_AUTH_SUCCESS' || ev.data?.type === 'X_AUTH_ERROR') {
          window.removeEventListener('message', onMsg);
          await loadXAccounts();
          if (ev.data?.type === 'X_AUTH_SUCCESS') ui.success('X account re-authorized');
          else ui.error('X re-authorization failed');
        }
      };
      window.addEventListener('message', onMsg);
    } catch (e) {
      console.error('Re-authorize failed', e);
      ui.error(e.message || 'Re-authorize failed');
    }
  }


  // Utility Functions
  // Legacy showNotification replaced by AdminUI toasts

  function getStatusColor(authorized) {
    return authorized ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
  }

  function formatDate(dateString) {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    return isNaN(date.getTime())
      ? "Invalid date"
      : date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  }
});
