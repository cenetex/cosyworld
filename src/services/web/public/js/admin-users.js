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
    listEl.innerHTML = '<tr><td colspan="5" style="padding: 1rem 1.5rem; text-align: center; color: var(--color-text-muted);">Loading...</td></tr>';
    try {
      const data = await apiFetch('/api/admin/users');
      renderAdmins(data.admins);
    } catch (e) {
      listEl.innerHTML = `<tr><td colspan="5" style="padding: 1rem 1.5rem; text-align: center; color: var(--color-danger);">Error: ${e.message}</td></tr>`;
    }
  }

  function renderAdmins(admins) {
    if (!admins || admins.length === 0) {
      listEl.innerHTML = '<tr><td colspan="5" style="padding: 1rem 1.5rem; text-align: center; color: var(--color-text-muted);">No admins found.</td></tr>';
      return;
    }

    listEl.innerHTML = admins.map(admin => `
      <tr style="transition: background 0.2s;" onmouseover="this.style.background='var(--color-surface-hover)'" onmouseout="this.style.background=''">
        <td style="padding: 1rem 1.5rem; white-space: nowrap; font-size: 0.875rem; font-weight: 500; color: var(--color-text); font-family: monospace;">
          ${admin.walletAddress}
          ${admin.isEnv ? '<span style="margin-left: 0.5rem; padding: 0.125rem 0.5rem; display: inline-flex; font-size: 0.75rem; font-weight: 600; border-radius: 9999px; background: var(--color-warning-bg); color: var(--color-warning);">Env</span>' : ''}
        </td>
        <td style="padding: 1rem 1.5rem; white-space: nowrap; font-size: 0.875rem; color: var(--color-text-muted);">
          ${admin.source}
        </td>
        <td style="padding: 1rem 1.5rem; white-space: nowrap; font-size: 0.875rem; color: var(--color-text-muted);">
          ${admin.createdAt ? new Date(admin.createdAt).toLocaleDateString() : '-'}
        </td>
        <td style="padding: 1rem 1.5rem; white-space: nowrap; font-size: 0.875rem; color: var(--color-text-muted);">
          ${admin.lastLogin ? new Date(admin.lastLogin).toLocaleDateString() : '-'}
        </td>
        <td style="padding: 1rem 1.5rem; white-space: nowrap; text-align: right; font-size: 0.875rem; font-weight: 500;">
          ${!admin.isEnv ? `
            <button class="remove-admin-btn" style="color: var(--color-danger); cursor: pointer; background: none; border: none;" data-wallet="${admin.walletAddress}">Remove</button>
          ` : '<span style="color: var(--color-text-muted); cursor: not-allowed;" title="Cannot remove environment-configured admin">Locked</span>'}
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
