/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { apiFetch } from './admin/admin-api.js';
import { success as toastSuccess, error as toastError, withButtonLoading } from './admin/admin-ui.js';
import { ensureWallet } from './admin/admin-auth.js';

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

  // Store models data globally for modal use
  let modelsData = [];
  let modelsByProvider = new Map();

  // Enhanced model selector functionality with provider/model split
  async function loadModels() {
    const modelSelect = document.getElementById('model-filter');

    // Show loading indicator
    const loadingOption = document.createElement('option');
    loadingOption.textContent = 'Loading...';
    loadingOption.disabled = true;
    loadingOption.selected = true;
    modelSelect.appendChild(loadingOption);

    try {
      console.log('Fetching models from /api/models/config...');
      const response = await fetch('/api/models/config');
      if (!response.ok) {
        console.error(`HTTP error ${response.status}`);
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();
      console.log('Raw API response:', data);

      // Store models data globally
      modelsData = Array.isArray(data) ? data : [];
      console.log(`Parsed ${modelsData.length} models from API`);

      // Clear existing options
      modelSelect.innerHTML = '';

      // Add default option
      const defaultOption = document.createElement('option');
      defaultOption.value = 'all';
      defaultOption.textContent = 'All Models';
      modelSelect.appendChild(defaultOption);

      // Compute model name list from API
      const modelNames = modelsData.map(m => m?.model).filter(Boolean);
      console.log(`Found ${modelNames.length} valid model names`);

      if (modelNames.length === 0) {
        console.warn('No models returned from API - check API endpoint');
        modelSelect.innerHTML = '<option disabled selected>No models available</option>';
        return;
      }

      // Build provider map for modal
      modelsByProvider.clear();
      modelNames.forEach((fullModel) => {
        const [provider, ...modelParts] = fullModel.split('/');
        const modelName = modelParts.join('/');
        if (provider && modelName) {
          if (!modelsByProvider.has(provider)) {
            modelsByProvider.set(provider, []);
          }
          modelsByProvider.get(provider).push({
            fullName: fullModel,
            modelName: modelName,
            rarity: modelsData.find(m => m.model === fullModel)?.rarity || 'common'
          });
        }
      });

      console.log(`Loaded ${modelNames.length} models from ${modelsByProvider.size} providers`);
      console.log('Providers:', Array.from(modelsByProvider.keys()));

      // Populate filter dropdown with full model names
      modelNames.forEach((model) => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
      });

      // Preserve current selection if possible
      if (modelNames.includes(state.currentModelFilter)) {
        modelSelect.value = state.currentModelFilter;
      }

      // Add filter listeners (ensure only one listener is attached)
      modelSelect.onchange = () => {
        state.currentModelFilter = modelSelect.value;
        state.currentPage = 1;
        loadAvatars();
      };

      // Initialize modal dropdowns after models are loaded
      initializeModalModelSelectors();
    } catch (error) {
      console.error('Error loading models:', error);

      // Show error message
      modelSelect.innerHTML = '<option disabled selected>Error loading models</option>';
    }
  }

  // Initialize provider/model dropdowns in modal
  function initializeModalModelSelectors() {
    const providerSelect = document.getElementById('avatar-model-provider');
    const modelNameSelect = document.getElementById('avatar-model-name');
    const rarityBadge = document.getElementById('model-rarity-badge');

    if (!providerSelect || !modelNameSelect) {
      console.warn('Model selector elements not found');
      return;
    }

    // Check if models are loaded yet
    if (modelsByProvider.size === 0) {
      console.warn('Models not loaded yet, provider list will be empty');
      providerSelect.innerHTML = '<option value="">Loading providers...</option>';
      modelNameSelect.innerHTML = '<option value="">Loading models...</option>';
      modelNameSelect.disabled = true;
      return;
    }

    // Clear and populate provider dropdown
    providerSelect.innerHTML = '<option value="">Select provider...</option>';
    const providers = Array.from(modelsByProvider.keys()).sort();
    
    console.log('Populating providers:', providers.length, 'providers found');
    
    providers.forEach(provider => {
      const option = document.createElement('option');
      option.value = provider;
      option.textContent = provider;
      providerSelect.appendChild(option);
    });

    // Reset model dropdown
    modelNameSelect.innerHTML = '<option value="">Select provider first</option>';
    modelNameSelect.disabled = true;

    // Provider change handler
    providerSelect.onchange = () => {
      const selectedProvider = providerSelect.value;
      modelNameSelect.innerHTML = '';
      modelNameSelect.disabled = !selectedProvider;
      
      if (selectedProvider) {
        const models = modelsByProvider.get(selectedProvider) || [];
        console.log(`Provider ${selectedProvider} has ${models.length} models`);
        models.forEach(modelInfo => {
          const option = document.createElement('option');
          option.value = modelInfo.fullName;
          option.textContent = modelInfo.modelName;
          option.dataset.rarity = modelInfo.rarity;
          modelNameSelect.appendChild(option);
        });
        if (models.length > 0) {
          modelNameSelect.selectedIndex = 0;
          updateRarityBadge(models[0].rarity);
        }
      } else {
        modelNameSelect.innerHTML = '<option value="">Select provider first</option>';
        hideRarityBadge();
      }
    };

    // Model name change handler
    modelNameSelect.onchange = () => {
      const selectedOption = modelNameSelect.options[modelNameSelect.selectedIndex];
      if (selectedOption && selectedOption.dataset.rarity) {
        updateRarityBadge(selectedOption.dataset.rarity);
      }
    };
  }

  // Update rarity badge
  function updateRarityBadge(rarity) {
    const badge = document.getElementById('model-rarity-badge');
    if (!badge) return;
    
    const span = badge.querySelector('span');
    const rarityColors = {
      'legendary': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'rare': 'bg-purple-100 text-purple-800 border-purple-300',
      'uncommon': 'bg-blue-100 text-blue-800 border-blue-300',
      'common': 'bg-gray-100 text-gray-800 border-gray-300'
    };
    
    span.className = `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${rarityColors[rarity] || rarityColors.common}`;
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
        elements.avatarsBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">No avatars found</td></tr>';
      } else {
        renderAvatars(avatars);
      }
      
      updatePagination(state.totalAvatars, data.page || 1, data.limit || state.pageSize);
    } catch (error) {
      console.error("Error loading avatars:", error);
      elements.avatarsBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-red-500">Failed to load avatars</td></tr>';
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
      elements.avatarsBody.innerHTML = `<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">No avatars found</td></tr>`;
      return;
    }
    elements.avatarsBody.innerHTML = avatars.map(createAvatarRow).join("");
    setupRowEventListeners();
  }

  function createAvatarRow(avatar) {
    const truncatedId = avatar._id ? avatar._id.substring(0, 8) + '...' : '';
    return `
      <tr class="hover:bg-gray-50 transition">
        <td class="px-3 py-3">
          <img class="h-10 w-10 rounded-full object-cover" src="${avatar.thumbnailUrl || avatar.imageUrl || "/default-avatar.png"}" alt="${avatar.name || "Avatar"}">
        </td>
        <td class="px-3 py-3 text-sm font-medium text-gray-900">
          <div class="flex flex-col">
            <span class="truncate">${avatar.name || "Unnamed"} ${avatar.emoji || ""}</span>
            <span class="md:hidden text-xs text-gray-400 font-normal">${truncatedId}</span>
          </div>
        </td>
        <td class="hidden md:table-cell px-3 py-3 text-xs text-gray-500 truncate" title="${avatar._id}">${truncatedId}</td>
        <td class="px-3 py-3">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(avatar.status)}">
            ${avatar.status || "Unknown"}
          </span>
        </td>
        <td class="hidden lg:table-cell px-3 py-3 text-xs text-gray-500 truncate" title="${avatar.model || "Not specified"}">${avatar.model || "Not specified"}</td>
        <td class="hidden sm:table-cell px-3 py-3 text-xs text-gray-500">${formatDate(avatar.createdAt)}</td>
        <td class="px-3 py-3 text-sm">
          <div class="flex flex-col sm:flex-row gap-1 sm:gap-2">
            <button data-avatar-id="${avatar._id}" class="edit-avatar text-indigo-600 hover:text-indigo-900 font-medium">Edit</button>
            <button data-avatar-id="${avatar._id}" class="delete-avatar text-red-600 hover:text-red-900 font-medium">Del</button>
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
  function openNewAvatarModal() {
    elements.avatarForm.dataset.avatarId = "";
    elements.modalTitle.textContent = "Create New Avatar";
    elements.deleteAvatarBtn.classList.add("hidden");
    resetForm();
    initializeModalModelSelectors(); // Reinitialize dropdowns
    elements.avatarModal.classList.remove("hidden");
  }

  async function editAvatar(avatarId) {
    try {
      elements.avatarModal.classList.remove("hidden");
      elements.modalTitle.textContent = "Loading Avatar Data...";
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
    const [provider, ...modelParts] = fullModel.split('/');
    const modelName = modelParts.join('/');
    
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
        <td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">
          <svg class="animate-spin h-5 w-5 text-indigo-500 mx-auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
        elements.avatarsBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">No avatars found</td></tr>';
      } else {
        renderAvatars(avatars);
      }
    } catch (error) {
      console.error("Error searching avatars:", error);
      elements.avatarsBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-red-500">Failed to search avatars</td></tr>';
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
          <div class="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
            <span class="font-semibold">Ready to deploy!</span> Generate NFT metadata and deploy to Arweave.
          </div>
        `;
        generateBtn.classList.remove('hidden');
        deployBtn.classList.add('hidden');
        mobileBtn.classList.add('hidden');
      }
    } catch (error) {
      console.error('Error checking NFT status:', error);
      nftStatus.innerHTML = `
        <div class="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
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
        <div class="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800">
          <span class="font-semibold">✓ Metadata generated!</span> Review the manifests below and deploy to Arweave.
        </div>
      `;
      
      toastSuccess('NFT metadata generated successfully');
    } catch (error) {
      console.error('Error generating NFT metadata:', error);
      toastError(error.message || 'Failed to generate NFT metadata');
      nftStatus.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
          <span class="font-semibold">Error:</span> ${error.message || 'Failed to generate metadata'}
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
        <div class="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
          <div class="flex items-center">
            <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="font-semibold">Uploading to Arweave...</span> This may take a few moments.
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
        <div class="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
          <span class="font-semibold">Deployment failed:</span> ${error.message || 'Unknown error'}
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
      <div class="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800">
        <span class="font-semibold">✓ Deployed to Arweave!</span>
        <div class="mt-2 text-xs">
          ${deployment.simulated ? '<span class="bg-yellow-200 text-yellow-900 px-2 py-1 rounded">Simulated (Arweave not configured)</span>' : ''}
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
});
