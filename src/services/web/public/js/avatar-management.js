/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { apiFetch } from './admin/admin-api.js';
import { success as toastSuccess, error as toastError, withButtonLoading } from './admin/admin-ui.js';
import { ensureWallet } from './admin/admin-auth.js';
import { 
  fetchModels, 
  getProviders, 
  getModelsForProvider, 
  initTwoPartSelector, 
  initSingleSelector,
  getRarityStyle 
} from './admin/model-selector.js';

document.addEventListener("DOMContentLoaded", async () => {
  // Ensure wallet (non-fatal)
  try { await ensureWallet(); } catch {}
  
  // Default placeholder image (SVG data URI)
  const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23e5e7eb' width='200' height='200'/%3E%3Ctext fill='%239ca3af' font-family='sans-serif' font-size='14' x='50%25' y='50%25' text-anchor='middle' dy='.3em'%3ENo Image%3C/text%3E%3C/svg%3E";
  
  // State Management
  const state = {
    currentPage: 1,
    pageSize: 20,
    totalAvatars: 0,
    currentStatusFilter: "all",
    currentModelFilter: "all", 
    currentSearch: "",
  };

  // Store models data for backward compatibility
  let modelsData = [];
  let modelsByProvider = new Map();

  // Enhanced model selector functionality using shared module
  async function loadModels() {
    const modelSelect = document.getElementById('model-filter');
    if (!modelSelect) return;

    try {
      // Use shared module to initialize filter dropdown with optgroups
      await initSingleSelector({
        selectElement: modelSelect,
        includeAllOption: true,
        onModelChange: (value) => {
          state.currentModelFilter = value;
          state.currentPage = 1;
          loadAvatars();
        },
        initialValue: state.currentModelFilter !== 'all' ? state.currentModelFilter : null
      });

      // Store data for backward compatibility
      modelsData = await fetchModels();
      
      // Build provider map for local use
      modelsByProvider = new Map();
      const providers = getProviders();
      providers.forEach(provider => {
        modelsByProvider.set(provider, getModelsForProvider(provider));
      });

      console.log(`[avatar-management] Loaded ${modelsData.length} models from ${providers.length} providers`);

      // Initialize modal dropdowns after models are loaded
      initializeModalModelSelectors();
    } catch (error) {
      console.error('Error loading models:', error);
      modelSelect.innerHTML = '<option disabled selected>Error loading models</option>';
    }
  }

  // Initialize provider/model dropdowns in modal using shared module
  async function initializeModalModelSelectors() {
    const providerSelect = document.getElementById('avatar-model-provider');
    const modelNameSelect = document.getElementById('avatar-model-name');
    const rarityBadge = document.getElementById('model-rarity-badge');

    if (!providerSelect || !modelNameSelect) {
      console.warn('Model selector elements not found');
      return;
    }

    await initTwoPartSelector({
      providerSelect,
      modelSelect: modelNameSelect,
      rarityBadge
    });
  }

  // Update rarity badge - now uses shared module's getRarityStyle
  function updateRarityBadge(rarity) {
    const badge = document.getElementById('model-rarity-badge');
    if (!badge) return;
    
    const span = badge.querySelector('span');
    span.style.cssText = `display: inline-flex; align-items: center; padding: 0.25rem 0.625rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; border: 1px solid; ${getRarityStyle(rarity)}`;
    span.className = '';
    span.textContent = rarity.toUpperCase();
    badge.classList.remove('hidden');
  }

  // Hide rarity badge
  function hideRarityBadge() {
    const badge = document.getElementById('model-rarity-badge');
    if (badge) badge.classList.add('hidden');
  }

  loadModels();

  // DOM Elements 
  const elements = {
    statusFilter: document.getElementById('status-filter'),
    modelFilter: document.getElementById('model-filter'),
    avatarsBody: document.getElementById("avatars-body"),
    paginationInfo: document.getElementById("pagination-info"),
    prevPageBtn: document.getElementById("prev-page"),
    nextPageBtn: document.getElementById("next-page"),
    avatarFilter: document.getElementById("avatar-filter"),
    avatarSearch: document.getElementById("avatar-search"),
    newAvatarBtn: document.getElementById("new-avatar"),
    avatarModal: document.getElementById("avatar-modal"),
    closeModal: document.getElementById("close-modal"),
    cancelEdit: document.getElementById("cancel-edit"),
    deleteAvatarBtn: document.getElementById("delete-avatar"),
    avatarForm: document.getElementById("avatar-form"),
    modalTitle: document.getElementById("modal-title"),
    imageUrlInput: document.getElementById("avatar-image-url"),
    saveBtn: document.getElementById("save-avatar"),
    socialSection: document.getElementById('social-connections-section'),
    socialList: document.getElementById('social-connections-content'),
    socialRefreshBtn: document.getElementById('refresh-social-connections'),
    
    // Tabs
    tabBtnGeneral: document.getElementById("tab-btn-general"),
    tabBtnSocial: document.getElementById("tab-btn-social"),
    tabBtnNft: document.getElementById("tab-btn-nft"),
    tabContentGeneral: document.getElementById("tab-content-general"),
    tabContentSocial: document.getElementById("tab-content-social"),
    tabContentNft: document.getElementById("tab-content-nft"),
  };

  // Initialization
  loadAvatars();
  setupEventListeners();

  // Signed headers now imported from admin-auth.js

  // Event Listeners Setup
  function setupEventListeners() {
    elements.prevPageBtn.addEventListener("click", () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        loadAvatars();
      }
    });

    elements.nextPageBtn.addEventListener("click", () => {
      if (state.currentPage * state.pageSize < state.totalAvatars) {
        state.currentPage++;
        loadAvatars();
      }
    });

    elements.statusFilter.addEventListener("change", () => {
      state.currentStatusFilter = elements.statusFilter.value;
      state.currentPage = 1;
      loadAvatars();
    });

    elements.avatarSearch.addEventListener(
      "input",
      debounce(() => {
        state.currentSearch = elements.avatarSearch.value;
        state.currentPage = 1;
        loadAvatars();
      }, 300),
    );

    elements.newAvatarBtn.addEventListener("click", openNewAvatarModal);

    elements.closeModal.addEventListener("click", closeModal);
    elements.cancelEdit.addEventListener("click", closeModal);

    // Tab Listeners
    if (elements.tabBtnGeneral) elements.tabBtnGeneral.addEventListener("click", () => switchTab("general"));
    if (elements.tabBtnSocial) elements.tabBtnSocial.addEventListener("click", () => switchTab("social"));
    if (elements.tabBtnNft) elements.tabBtnNft.addEventListener("click", () => switchTab("nft"));

    // Preview Prompt button
  document.getElementById("preview-prompt").addEventListener("click", withButtonLoading(document.getElementById("preview-prompt"), async () => {
      const avatarId = elements.avatarForm.dataset.avatarId;
      if (!avatarId) {
        toastError("Save the avatar first to preview prompts");
        return;
      }
      
      const previewContainer = document.getElementById("prompt-preview-container");
      const previewContent = document.getElementById("prompt-preview-content");
      
      try {
        previewContent.innerHTML = "Loading preview...";
        previewContainer.classList.remove("hidden");
        
  const data = await apiFetch(`/api/admin/avatars/${avatarId}/preview-prompt`);
        previewContent.innerHTML = data.prompt || "No prompt preview available";
      } catch (error) {
        console.error("Error fetching prompt preview:", error);
        previewContent.innerHTML = `Error loading preview: ${error.message}`;
      }
    }));

    // Close modal with Escape key
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        !elements.avatarModal.classList.contains("hidden")
      ) {
        closeModal();
      }
    });

    elements.avatarForm.addEventListener("submit", handleFormSubmit);

    elements.deleteAvatarBtn.addEventListener("click", handleDeleteAvatar);

    if (elements.socialRefreshBtn) {
      elements.socialRefreshBtn.addEventListener('click', withButtonLoading(elements.socialRefreshBtn, async () => {
        const avatarId = elements.avatarForm.dataset.avatarId;
        if (!avatarId) {
          toastError('Select an avatar before refreshing connections');
          return;
        }
        await loadSocialConnections(avatarId, { silent: true });
      }));
    }

    // Add file input element for direct uploads
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'image/*';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// Add upload button next to image URL input
const uploadButton = document.createElement('button');
uploadButton.textContent = 'Upload Image';
uploadButton.className = 'ml-2 px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700';
elements.imageUrlInput.parentNode.appendChild(uploadButton);

uploadButton.addEventListener('click', withButtonLoading(uploadButton, async () => {
  fileInput.click();
}));

  fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);

  try {
    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading...';

      const data = await apiFetch('/api/admin/upload-image', { method: 'POST', body: formData, sign: true, signMeta: { op: 'upload_image' }, requireCsrf: true });
  const finalUrl = data?.url || '';
  elements.imageUrlInput.value = finalUrl;
  const preview = document.getElementById('avatar-image-preview');
  if (preview) {
    preview.src = finalUrl;
  }
    toastSuccess('Image uploaded successfully');
  } catch (error) {
    console.error('Upload error:', error);
    toastError(error.message || 'Failed to upload image');
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = 'Upload Image';
    fileInput.value = ''; // Reset file input
  }
});

elements.imageUrlInput.addEventListener("input", () => {
  const url = elements.imageUrlInput.value.trim();
  const preview = document.getElementById('avatar-image-preview');
  if (preview) {
    preview.src = url || DEFAULT_AVATAR;
  }
});

// Add emoji preview update
const emojiInput = document.getElementById('avatar-emoji');
if (emojiInput) {
  emojiInput.addEventListener("input", () => {
    const emoji = emojiInput.value.trim();
    const emojiPreview = document.getElementById('avatar-preview-emoji');
    if (emojiPreview) {
      if (emoji) {
        emojiPreview.textContent = emoji;
        emojiPreview.classList.remove('hidden');
      } else {
        emojiPreview.classList.add('hidden');
      }
    }
  });
}
  }

  // Avatar List Functions
  async function loadAvatars() {
    try {
      // If there's an active search query, skip loading paginated avatars
      if (state.currentSearch.trim().length >= 2) {
        return;
      }

      const params = new URLSearchParams({
        page: state.currentPage,
        limit: state.pageSize,
        status: state.currentStatusFilter,
        model: state.currentModelFilter,
      });

      const data = await apiFetch(`/api/avatars?${params}`);
      
      if (data.error) {
        throw new Error(data.error);
      }

      const avatars = data.avatars || [];
      state.totalAvatars = data.total || 0;

      if (avatars.length === 0) {
        elements.avatarsBody.innerHTML = '<tr><td colspan="7" style="padding: 1rem 1.5rem; text-align: center; font-size: 0.875rem; color: var(--color-text-muted);">No avatars found</td></tr>';
      } else {
        renderAvatars(avatars);
      }
      
      updatePagination(state.totalAvatars, data.page || 1, data.limit || state.pageSize);
    } catch (error) {
      console.error("Error loading avatars:", error);
      elements.avatarsBody.innerHTML = '<tr><td colspan="7" style="padding: 1rem 1.5rem; text-align: center; font-size: 0.875rem; color: var(--color-danger);">Failed to load avatars</td></tr>';
    }
  }

  // Unified pagination updater; parameters optional
  function updatePagination(total = state.totalAvatars, page = state.currentPage, limit = state.pageSize) {
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    if (elements.paginationInfo) {
      elements.paginationInfo.textContent = `Showing ${start}-${end} of ${total} avatars`;
    }
    if (elements.prevPageBtn && elements.nextPageBtn) {
      elements.prevPageBtn.disabled = page === 1;
      elements.nextPageBtn.disabled = end >= total;
    }
  }

  function renderAvatars(avatars) {
    if (avatars.length === 0) {
      elements.avatarsBody.innerHTML = `<tr><td colspan="7" style="padding: 1rem 1.5rem; text-align: center; font-size: 0.875rem; color: var(--color-text-muted);">No avatars found</td></tr>`;
      return;
    }
    elements.avatarsBody.innerHTML = avatars.map(createAvatarRow).join("");
    setupRowEventListeners();
  }

  function createAvatarRow(avatar) {
    const truncatedId = avatar._id ? avatar._id.substring(0, 8) + '...' : '';
    return `
      <tr style="transition: background 0.2s;" onmouseover="this.style.background='var(--color-surface-hover)'" onmouseout="this.style.background=''">
        <td style="padding: 0.75rem;">
          <img style="height: 2.5rem; width: 2.5rem; border-radius: 50%; object-fit: cover;" src="${avatar.thumbnailUrl || avatar.imageUrl || "/images/default-avatar.svg"}" alt="${avatar.name || "Avatar"}">
        </td>
        <td style="padding: 0.75rem; font-size: 0.875rem; font-weight: 500; color: var(--color-text);">
          <div style="display: flex; flex-direction: column;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${avatar.name || "Unnamed"} ${avatar.emoji || ""}</span>
            <span class="mobile-only" style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: normal;">${truncatedId}</span>
          </div>
        </td>
        <td class="desktop-only" style="padding: 0.75rem; font-size: 0.75rem; color: var(--color-text-muted);" title="${avatar._id}">${truncatedId}</td>
        <td style="padding: 0.75rem;">
          <span style="padding: 0.25rem 0.5rem; display: inline-flex; font-size: 0.75rem; line-height: 1.25rem; font-weight: 600; border-radius: 9999px; ${getStatusStyle(avatar.status)}">
            ${avatar.status || "Unknown"}
          </span>
        </td>
        <td class="desktop-only" style="padding: 0.75rem; font-size: 0.75rem; color: var(--color-text-muted);" title="${avatar.model || "Not specified"}">${avatar.model || "Not specified"}</td>
        <td class="tablet-only" style="padding: 0.75rem; font-size: 0.75rem; color: var(--color-text-muted);">${formatDate(avatar.createdAt)}</td>
        <td style="padding: 0.75rem; font-size: 0.875rem;">
          <div style="display: flex; gap: 0.5rem;">
            <button data-avatar-id="${avatar._id}" class="edit-avatar" style="color: var(--color-accent); font-weight: 500; cursor: pointer; background: none; border: none;">Edit</button>
            <button data-avatar-id="${avatar._id}" class="delete-avatar" style="color: var(--color-danger); font-weight: 500; cursor: pointer; background: none; border: none;">Del</button>
          </div>
        </td>
      </tr>
    `;
  }

  function setupRowEventListeners() {
    document.querySelectorAll(".edit-avatar").forEach((button) => {
      button.addEventListener("click", () =>
        editAvatar(button.dataset.avatarId),
      );
    });
    document.querySelectorAll(".delete-avatar").forEach((button) => {
      button.addEventListener("click", () => {
        if (confirm("Are you sure you want to delete this avatar?")) {
          deleteAvatar(button.dataset.avatarId);
        }
      });
    });
  }

  // (removed duplicate updatePagination definition)

  // Modal Functions
  function switchTab(tabName) {
    const tabs = ['general', 'social', 'nft'];
    tabs.forEach(t => {
      const btn = elements[`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`];
      const content = elements[`tabContent${t.charAt(0).toUpperCase() + t.slice(1)}`];
      
      if (!btn || !content) return;

      if (t === tabName) {
        btn.classList.add('tab-active');
        btn.classList.remove('tab-inactive');
        content.classList.remove('hidden');
      } else {
        btn.classList.remove('tab-active');
        btn.classList.add('tab-inactive');
        content.classList.add('hidden');
      }
    });

    // Special handling for Social tab
    if (tabName === 'social') {
      const avatarId = elements.avatarForm.dataset.avatarId;
      if (avatarId) {
        loadSocialConnections(avatarId);
      } else {
        elements.socialList.innerHTML = '<div style="color: var(--color-text-muted); padding: 1rem; text-align: center;">Please save the avatar first to manage social connections.</div>';
      }
    }
  }

  function openNewAvatarModal() {
    elements.avatarForm.dataset.avatarId = "";
    elements.modalTitle.textContent = "Create New Avatar";
    elements.deleteAvatarBtn.classList.add("hidden");
    resetForm();
    initializeModalModelSelectors(); // Reinitialize dropdowns
    switchTab('general');
    elements.avatarModal.classList.remove("hidden");
  }

  async function editAvatar(avatarId) {
    try {
      elements.avatarModal.classList.remove("hidden");
      elements.modalTitle.textContent = "Loading Avatar Data...";
      switchTab('general');
    const avatar = await apiFetch(`/api/admin/avatars/${avatarId}`);
      elements.modalTitle.textContent = `Edit Avatar: ${avatar.name}`;
      elements.avatarForm.dataset.avatarId = avatarId;
      elements.deleteAvatarBtn.classList.remove("hidden");
      initializeModalModelSelectors(); // Reinitialize dropdowns before populating
      populateForm(avatar);
      
      // Initialize NFT section
      await initializeNftSection(avatarId);
    } catch (error) {
      console.error("Error fetching avatar:", error);
      closeModal();
      toastError("Failed to load avatar details");
    }
  }

  function resetForm() {
    elements.avatarForm.reset();
    const preview = document.getElementById('avatar-image-preview');
    const emojiPreview = document.getElementById('avatar-preview-emoji');
    const providerSelect = document.getElementById('avatar-model-provider');
    const modelNameSelect = document.getElementById('avatar-model-name');
    
    if (preview) {
      preview.src = DEFAULT_AVATAR;
    }
    if (emojiPreview) {
      emojiPreview.textContent = '';
      emojiPreview.classList.add('hidden');
    }
    if (providerSelect) {
      providerSelect.value = '';
    }
    if (modelNameSelect) {
      modelNameSelect.innerHTML = '<option value="">Select provider first</option>';
      modelNameSelect.disabled = true;
    }
    hideRarityBadge();
    
    // Hide prompt preview
    const promptContainer = document.getElementById('prompt-preview-container');
    if (promptContainer) {
      promptContainer.classList.add('hidden');
    }
  }

  function populateForm(avatar) {
    document.getElementById("avatar-name").value = avatar.name || "";
    document.getElementById("avatar-status").value = avatar.status || "alive";
    document.getElementById("avatar-emoji").value = avatar.emoji || "";
    document.getElementById("avatar-description").value = avatar.description || "";
    document.getElementById("avatar-personality").value = avatar.personality || "";
    
    const imageUrl = avatar.imageUrl || avatar.thumbnailUrl || DEFAULT_AVATAR;
    elements.imageUrlInput.value = avatar.imageUrl || "";
    
    const preview = document.getElementById('avatar-image-preview');
    if (preview) {
      preview.src = imageUrl;
    }
    
    // Update emoji preview
    const emojiPreview = document.getElementById('avatar-preview-emoji');
    if (emojiPreview && avatar.emoji) {
      emojiPreview.textContent = avatar.emoji;
      emojiPreview.classList.remove('hidden');
    } else if (emojiPreview) {
      emojiPreview.classList.add('hidden');
    }
    
    // Populate model dropdowns
    const fullModel = avatar.model || "google/gemini-2.0-flash";
    const provider = (avatar.provider || (fullModel.includes('/') ? fullModel.split('/')[0] : '') || '').trim();
    
    const providerSelect = document.getElementById('avatar-model-provider');
    const modelNameSelect = document.getElementById('avatar-model-name');
    
    if (providerSelect && modelNameSelect) {
      // Set provider
      providerSelect.value = provider || '';
      
      // Trigger provider change to populate models
      if (provider && modelsByProvider.has(provider)) {
        const models = modelsByProvider.get(provider) || [];
        modelNameSelect.innerHTML = '';
        modelNameSelect.disabled = false;
        
        models.forEach(modelInfo => {
          const option = document.createElement('option');
          option.value = modelInfo.fullName;
          option.textContent = modelInfo.modelName;
          option.dataset.rarity = modelInfo.rarity;
          modelNameSelect.appendChild(option);
        });
        
        // Set the model
        modelNameSelect.value = fullModel;
        
        // Update rarity badge
        const selectedModel = models.find(m => m.fullName === fullModel);
        if (selectedModel) {
          updateRarityBadge(selectedModel.rarity);
        }
      }
    }
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const avatarId = elements.avatarForm.dataset.avatarId;
    const method = avatarId ? "PUT" : "POST";
    const url = avatarId
      ? `/api/admin/avatars/${avatarId}`
      : "/api/admin/avatars";
    
    // Build payload manually to use the model from avatar-model-name dropdown
    const payload = {
      name: document.getElementById("avatar-name").value,
      status: document.getElementById("avatar-status").value,
      provider: document.getElementById("avatar-model-provider")?.value || null,
      model: document.getElementById("avatar-model-name").value, // Get from split dropdown
      emoji: document.getElementById("avatar-emoji").value,
      description: document.getElementById("avatar-description").value,
      personality: document.getElementById("avatar-personality").value,
      imageUrl: elements.imageUrlInput.value
    };
    
    elements.saveBtn.disabled = true;
    elements.saveBtn.textContent = "Saving...";

    try {
      await apiFetch(url, { method, body: payload, sign: true, signMeta: { op: avatarId ? 'update_avatar' : 'create_avatar', id: avatarId }, requireCsrf: true });
      // Fetch the updated avatar and refresh the modal fields
      let updatedAvatar;
      if (avatarId) {
  updatedAvatar = await apiFetch(`/api/admin/avatars/${avatarId}`);
        populateForm(updatedAvatar);
        toastSuccess("Avatar updated successfully");
      } else {
        // For new avatar, close modal and reload list
        closeModal();
        loadAvatars();
        toastSuccess("Avatar created successfully");
        return;
      }
      // Also reload avatars list in the background
      loadAvatars();
    } catch (error) {
      console.error("Error saving avatar:", error);
      toastError(error.message || "Failed to save avatar");
    } finally {
      elements.saveBtn.disabled = false;
      elements.saveBtn.textContent = "Save Changes";
    }
  }

  async function handleDeleteAvatar() {
    const avatarId = elements.avatarForm.dataset.avatarId;
    if (!avatarId || !confirm("Are you sure you want to delete this avatar?"))
      return;

    try {
  await apiFetch(`/api/admin/avatars/${avatarId}`, { method: 'DELETE', sign: true, signMeta: { op: 'delete_avatar', id: avatarId }, requireCsrf: true });
      closeModal();
      loadAvatars();
      toastSuccess("Avatar deleted successfully");
    } catch (error) {
      console.error("Error deleting avatar:", error);
      toastError("Failed to delete avatar");
    }
  }

  // Row action delete (confirmation already handled by caller)
  async function deleteAvatar(avatarId) {
    if (!avatarId) return;
    try {
  await apiFetch(`/api/admin/avatars/${avatarId}`, { method: 'DELETE', sign: true, signMeta: { op: 'delete_avatar', id: avatarId }, requireCsrf: true });
      // If modal is open for this avatar, close it
      if (elements.avatarForm.dataset.avatarId === avatarId) closeModal();
      loadAvatars();
      toastSuccess("Avatar deleted successfully");
    } catch (error) {
      console.error("Error deleting avatar:", error);
      toastError("Failed to delete avatar");
    }
  }

  function closeModal() {
    elements.avatarModal.classList.add("hidden");
  }

  // Utility Functions
  // Legacy showNotification replaced by toasts (toastSuccess/toastError)

  function getStatusColor(status) {
    return (
      {
        alive: "bg-green-100 text-green-800",
        dead: "bg-red-100 text-red-800",
        inactive: "bg-gray-100 text-gray-800",
      }[status] || "bg-gray-100 text-gray-800"
    );
  }

  function getStatusStyle(status) {
    const styles = {
      alive: "background: rgba(34, 197, 94, 0.2); color: #4ade80;",
      dead: "background: rgba(239, 68, 68, 0.2); color: #f87171;",
      inactive: "background: var(--color-surface); color: var(--color-text-muted);",
    };
    return styles[status] || styles.inactive;
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
        });
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function loadingSpinner() {
    return `
      <tr>
        <td colspan="7" style="padding: 1rem 1.5rem; text-align: center; font-size: 0.875rem; color: var(--color-text-muted);">
          <svg style="animation: spin 1s linear infinite; height: 1.25rem; width: 1.25rem; margin: 0 auto; color: var(--color-accent-primary);" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </td>
      </tr>
    `;
  }

  async function searchAvatars(query) {
    try {
    const data = await apiFetch(`/api/avatars/search?name=${encodeURIComponent(query)}`);
      const avatars = data.avatars || [];

      if (avatars.length === 0) {
        elements.avatarsBody.innerHTML = '<tr><td colspan="7" style="padding: 1rem 1.5rem; text-align: center; font-size: 0.875rem; color: var(--color-text-muted);">No avatars found</td></tr>';
      } else {
        renderAvatars(avatars);
      }
    } catch (error) {
      console.error("Error searching avatars:", error);
      elements.avatarsBody.innerHTML = '<tr><td colspan="7" style="padding: 1rem 1.5rem; text-align: center; font-size: 0.875rem; color: var(--color-danger);">Failed to search avatars</td></tr>';
    }
  }

  // Update the avatarSearch event listener to trigger search
  elements.avatarSearch.addEventListener(
    "input",
    debounce(() => {
      const query = elements.avatarSearch.value.trim();
      state.currentSearch = query; // Update the search state
      if (query.length >= 2) {
        searchAvatars(query);
      } else {
        state.currentPage = 1;
        state.currentSearch = ""; // Clear the search state
        loadAvatars();
      }
    }, 300),
  );

  // ============================================================
  // NFT DEPLOYMENT FUNCTIONALITY
  // ============================================================
  
  async function initializeNftSection(avatarId) {
    const nftSection = document.getElementById('nft-section');
    const nftStatus = document.getElementById('nft-status');
    const generateBtn = document.getElementById('generate-nft-metadata');
    const deployBtn = document.getElementById('deploy-to-arweave');
    const mobileBtn = document.getElementById('view-mobile-deployment');
    
    if (!nftSection) return;
    
    // Show NFT section
    nftSection.classList.remove('hidden');
    
    // Check deployment status
    try {
      const status = await apiFetch(`/api/nft/avatar/${avatarId}/status`);
      
      if (status.deployed) {
        displayDeploymentStatus(status.deployment);
        generateBtn.classList.add('hidden');
        deployBtn.classList.add('hidden');
        mobileBtn.classList.remove('hidden');
      } else {
        nftStatus.innerHTML = `
          <div style="background: var(--color-info-bg); border: 1px solid var(--color-info); border-radius: 0.375rem; padding: 0.75rem; font-size: 0.875rem; color: var(--color-info);">
            <span style="font-weight: 600;">Ready to deploy!</span> Generate NFT metadata and deploy to Arweave.
          </div>
        `;
        generateBtn.classList.remove('hidden');
        deployBtn.classList.add('hidden');
        mobileBtn.classList.add('hidden');
      }
    } catch (error) {
      console.error('Error checking NFT status:', error);
      nftStatus.innerHTML = `
        <div style="background: var(--color-warning-bg); border: 1px solid var(--color-warning); border-radius: 0.375rem; padding: 0.75rem; font-size: 0.875rem; color: var(--color-warning);">
          Could not load NFT status. You can still generate metadata.
        </div>
      `;
    }
    
    // Set up event listeners
    generateBtn.onclick = () => generateNftMetadata(avatarId);
    deployBtn.onclick = () => deployToArweave(avatarId);
    mobileBtn.onclick = () => openMobileDeployment(avatarId);
  }
  
  async function generateNftMetadata(avatarId) {
    const generateBtn = document.getElementById('generate-nft-metadata');
    const deployBtn = document.getElementById('deploy-to-arweave');
    const manifestsDiv = document.getElementById('nft-manifests');
    const nftStatus = document.getElementById('nft-status');
    
    try {
      generateBtn.disabled = true;
      generateBtn.innerHTML = '<span class="mr-2">⏳</span>Generating...';
      
      const metadata = await apiFetch(`/api/nft/avatar/${avatarId}/metadata`);
      
      // Display manifests
      document.getElementById('base-manifest').textContent = JSON.stringify(metadata.base, null, 2);
      document.getElementById('solana-manifest').textContent = JSON.stringify(metadata.solana, null, 2);
      manifestsDiv.classList.remove('hidden');
      
      // Show deploy button
      deployBtn.classList.remove('hidden');
      
      nftStatus.innerHTML = `
        <div style="background: var(--color-success-bg); border: 1px solid var(--color-success); border-radius: 0.375rem; padding: 0.75rem; font-size: 0.875rem; color: var(--color-success);">
          <span style="font-weight: 600;">✓ Metadata generated!</span> Review the manifests below and deploy to Arweave.
        </div>
      `;
      
      toastSuccess('NFT metadata generated successfully');
    } catch (error) {
      console.error('Error generating NFT metadata:', error);
      toastError(error.message || 'Failed to generate NFT metadata');
      nftStatus.innerHTML = `
        <div style="background: var(--color-error-bg); border: 1px solid var(--color-error); border-radius: 0.375rem; padding: 0.75rem; font-size: 0.875rem; color: var(--color-error);">
          <span style="font-weight: 600;">Error:</span> ${error.message || 'Failed to generate metadata'}
        </div>
      `;
    } finally {
      generateBtn.disabled = false;
      generateBtn.innerHTML = '<span class="mr-2">📋</span>Generate NFT Metadata';
    }
  }
  
  async function deployToArweave(avatarId) {
    const deployBtn = document.getElementById('deploy-to-arweave');
    const nftStatus = document.getElementById('nft-status');
    const mobileBtn = document.getElementById('view-mobile-deployment');
    
    if (!confirm('Deploy this avatar NFT to Arweave? This will upload the image and metadata.')) {
      return;
    }
    
    try {
      deployBtn.disabled = true;
      deployBtn.innerHTML = '<span class="mr-2">⏳</span>Deploying...';
      
      nftStatus.innerHTML = `
        <div style="background: var(--color-info-bg); border: 1px solid var(--color-info); border-radius: 0.375rem; padding: 0.75rem; font-size: 0.875rem; color: var(--color-info);">
          <div style="display: flex; align-items: center;">
            <svg style="animation: spin 1s linear infinite; height: 1.25rem; width: 1.25rem; margin-right: 0.5rem;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span style="font-weight: 600;">Uploading to Arweave...</span> This may take a few moments.
          </div>
        </div>
      `;
      
      const result = await apiFetch(`/api/nft/avatar/${avatarId}/deploy`, {
        method: 'POST',
        body: { walletConnected: false }
      });
      
      displayDeploymentStatus(result);
      
      // Hide generate and deploy buttons, show mobile button
      document.getElementById('generate-nft-metadata').classList.add('hidden');
      deployBtn.classList.add('hidden');
      mobileBtn.classList.remove('hidden');
      
      toastSuccess('Avatar deployed to Arweave successfully!');
    } catch (error) {
      console.error('Error deploying to Arweave:', error);
      toastError(error.message || 'Failed to deploy to Arweave');
      nftStatus.innerHTML = `
        <div style="background: var(--color-error-bg); border: 1px solid var(--color-error); border-radius: 0.375rem; padding: 0.75rem; font-size: 0.875rem; color: var(--color-error);">
          <span style="font-weight: 600;">Deployment failed:</span> ${error.message || 'Unknown error'}
        </div>
      `;
      deployBtn.disabled = false;
      deployBtn.innerHTML = '<span class="mr-2">🚀</span>Deploy to Arweave';
    }
  }
  
  function displayDeploymentStatus(deployment) {
    const nftStatus = document.getElementById('nft-status');
    const linksDiv = document.getElementById('nft-deployment-links');
    
    nftStatus.innerHTML = `
      <div style="background: var(--color-success-bg); border: 1px solid var(--color-success); border-radius: 0.375rem; padding: 0.75rem; font-size: 0.875rem; color: var(--color-success);">
        <span style="font-weight: 600;">✓ Deployed to Arweave!</span>
        <div style="margin-top: 0.5rem; font-size: 0.75rem;">
          ${deployment.simulated ? '<span style="background: var(--color-warning-bg); color: var(--color-warning); padding: 0.25rem 0.5rem; border-radius: 0.25rem;">Simulated (Arweave not configured)</span>' : ''}
          Deployed on: ${new Date(deployment.deployed).toLocaleString()}
        </div>
      </div>
    `;
    
    // Display Arweave links
    document.getElementById('nft-image-link').href = deployment.image.url;
    document.getElementById('nft-image-link').textContent = deployment.image.txId;
    document.getElementById('nft-base-link').href = deployment.base.url;
    document.getElementById('nft-base-link').textContent = deployment.base.txId;
    document.getElementById('nft-solana-link').href = deployment.solana.url;
    document.getElementById('nft-solana-link').textContent = deployment.solana.txId;
    
    linksDiv.classList.remove('hidden');
  }
  
  function openMobileDeployment(avatarId) {
    window.open(`/deploy-avatar.html?id=${avatarId}`, '_blank');
  }

  // ============================================================
  // SOCIAL PLATFORM FUNCTIONS
  // ============================================================

  async function loadSocialConnections(avatarId, options = {}) {
    if (!elements.socialList) return;
    
    if (!options.silent) {
      elements.socialList.innerHTML = '<div style="color: var(--color-text-muted);">Loading connections...</div>';
    }

    try {
      const response = await apiFetch(`/api/social/connections/${avatarId}`);
      renderSocialConnections(avatarId, response.connections || []);
    } catch (error) {
      console.error("Error loading social connections:", error);
      elements.socialList.innerHTML = `<div style="color: var(--color-danger);">Failed to load connections: ${error.message}</div>`;
    }
  }

  function renderSocialConnections(avatarId, connections) {
    elements.socialList.innerHTML = '';
    
    // Telegram
    const telegram = connections.find(c => c.platform === 'telegram');
    const telegramCard = createSocialCard('telegram', 'Telegram', telegram, avatarId);
    elements.socialList.appendChild(telegramCard);

    // X (Twitter)
    const x = connections.find(c => c.platform === 'x');
    const xCard = createSocialCard('x', 'X / Twitter', x, avatarId);
    elements.socialList.appendChild(xCard);
    
    // Discord (Placeholder)
    const discord = connections.find(c => c.platform === 'discord');
    const discordCard = createSocialCard('discord', 'Discord', discord, avatarId);
    elements.socialList.appendChild(discordCard);
  }

  function createSocialCard(platform, label, connection, avatarId) {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.cssText = 'padding: 1rem;';
    
    const isConnected = !!connection && connection.status === 'connected';
    const statusStyle = isConnected 
      ? 'background: rgba(34, 197, 94, 0.2); color: #4ade80;' 
      : 'background: var(--color-surface); color: var(--color-text-muted);';
    
    let content = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h5 style="font-weight: 700; color: var(--color-text);">${label}</h5>
          <p style="font-size: 0.875rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">${getPlatformDescription(platform)}</p>
          <div style="display: flex; align-items: center; margin-top: 0.5rem;">
            <span style="display: inline-flex; align-items: center; padding: 0.25rem 0.625rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; ${statusStyle}">
              ${isConnected ? 'Connected' : 'Not Connected'}
            </span>
            ${isConnected && connection.username ? `<span style="margin-left: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">@${connection.username}</span>` : ''}
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${getPlatformActions(platform, isConnected, avatarId)}
        </div>
      </div>
    `;
    
    // Add specific inputs for disconnected states (e.g. Telegram Token)
    if (!isConnected && platform === 'telegram') {
      content += `
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--color-border-subtle);">
          <label style="display: block; font-size: 0.75rem; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 0.25rem;">Bot Token (from @BotFather)</label>
          <div style="display: flex; gap: 0.5rem;">
            <input type="text" id="telegram-token-${avatarId}" class="form-input" style="flex: 1; font-size: 0.875rem;" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11">
            <button type="button" class="connect-telegram btn btn-primary" style="white-space: nowrap;">
              Connect
            </button>
          </div>
        </div>
      `;
    }

    div.innerHTML = content;

    // Attach event listeners
    if (!isConnected && platform === 'telegram') {
      const btn = div.querySelector('.connect-telegram');
      const input = div.querySelector(`#telegram-token-${avatarId}`);
      btn.addEventListener('click', () => connectTelegram(avatarId, input.value));
    } else if (isConnected) {
      const disconnectBtn = div.querySelector('.disconnect-btn');
      if (disconnectBtn) {
        disconnectBtn.addEventListener('click', () => disconnectPlatform(avatarId, platform));
      }
    }
    
    if (platform === 'x' && !isConnected) {
       const connectBtn = div.querySelector('.connect-x');
       if (connectBtn) {
         connectBtn.addEventListener('click', () => window.open(`/api/xauth/auth?avatarId=${avatarId}`, '_blank'));
       }
    }

    return div;
  }

  function getPlatformDescription(platform) {
    switch(platform) {
      case 'telegram': return 'Connect a BotFather token to enable DM + channel routing.';
      case 'x': return 'Authenticate via OAuth to post as this avatar.';
      case 'discord': return 'Manage Discord channel presence.';
      default: return '';
    }
  }

  function getPlatformActions(platform, isConnected, avatarId) {
    if (isConnected) {
      return `<button type="button" class="disconnect-btn btn btn-sm" style="color: var(--color-danger); border: 1px solid var(--color-border); background: var(--color-surface);">Disconnect</button>`;
    } else {
      if (platform === 'x') {
        return `<button type="button" class="connect-x btn btn-sm btn-primary">Connect with X</button>`;
      }
      return ''; // Telegram handled via input form
    }
  }

  async function connectTelegram(avatarId, token) {
    if (!token) return toastError('Please enter a bot token');
    try {
      await apiFetch(`/api/social/connect/${avatarId}`, {
        method: 'POST',
        body: { platform: 'telegram', credentials: { token } }
      });
      toastSuccess('Telegram connected successfully');
      loadSocialConnections(avatarId);
    } catch (error) {
      toastError(error.message);
    }
  }

  async function disconnectPlatform(avatarId, platform) {
    if (!confirm(`Are you sure you want to disconnect ${platform}?`)) return;
    try {
      await apiFetch(`/api/social/disconnect/${avatarId}`, {
        method: 'POST',
        body: { platform }
      });
      toastSuccess(`${platform} disconnected`);
      loadSocialConnections(avatarId);
    } catch (error) {
      toastError(error.message);
    }
  }
});

