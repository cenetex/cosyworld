/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { apiFetch } from './admin/admin-api.js';
import { success as toastSuccess, error as toastError } from './admin/admin-ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  const listEl = document.getElementById('admins-list');
  const inviteBtn = document.getElementById('invite-admin-btn');
  const inviteModal = document.getElementById('invite-modal');
  const inviteLinkInput = document.getElementById('invite-link');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const closeInviteModalBtn = document.getElementById('close-invite-modal');

  // Load Admins
  async function loadAdmins() {
    listEl.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">Loading...</td></tr>';
    try {
      const data = await apiFetch('/api/admin/users');
      renderAdmins(data.admins);
    } catch (e) {
      listEl.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">Error: ${e.message}</td></tr>`;
    }
  }

  function renderAdmins(admins) {
    if (!admins || admins.length === 0) {
      listEl.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">No admins found.</td></tr>';
      return;
    }

    listEl.innerHTML = admins.map(admin => `
      <tr>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 font-mono">
          ${admin.walletAddress}
          ${admin.isEnv ? '<span class="ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Env</span>' : ''}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${admin.source}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${admin.createdAt ? new Date(admin.createdAt).toLocaleDateString() : '-'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${admin.lastLogin ? new Date(admin.lastLogin).toLocaleDateString() : '-'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          ${!admin.isEnv ? `
            <button class="text-red-600 hover:text-red-900 remove-admin-btn" data-wallet="${admin.walletAddress}">Remove</button>
          ` : '<span class="text-gray-400 cursor-not-allowed" title="Cannot remove environment-configured admin">Locked</span>'}
        </td>
      </tr>
    `).join('');

    // Attach event listeners
    document.querySelectorAll('.remove-admin-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const wallet = e.target.dataset.wallet;
        if (confirm(`Are you sure you want to remove admin access for ${wallet}?`)) {
          try {
            await apiFetch('/api/admin/users/remove', {
              method: 'POST',
              body: { walletAddress: wallet },
              requireCsrf: true,
              sign: true,
              signMeta: { op: 'remove_admin', target: wallet }
            });
            toastSuccess('Admin removed successfully');
            loadAdmins();
          } catch (err) {
            toastError(err.message);
          }
        }
      });
    });
  }

  // Invite Flow
  inviteBtn.addEventListener('click', async () => {
    try {
      const data = await apiFetch('/api/admin/users/invite', {
        method: 'POST',
        requireCsrf: true,
        sign: true,
        signMeta: { op: 'create_invite' }
      });
      
      inviteLinkInput.value = data.inviteUrl;
      inviteModal.classList.remove('hidden');
    } catch (e) {
      toastError(e.message);
    }
  });

  copyLinkBtn.addEventListener('click', () => {
    inviteLinkInput.select();
    document.execCommand('copy');
    toastSuccess('Link copied to clipboard');
  });

  closeInviteModalBtn.addEventListener('click', () => {
    inviteModal.classList.add('hidden');
  });

  // Initial Load
  loadAdmins();
});
