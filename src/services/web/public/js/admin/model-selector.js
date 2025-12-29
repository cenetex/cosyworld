/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * Shared model selector component for admin pages.
 * Loads models from the API and displays them in author/model format.
 */

// Cache for models data
let modelsCache = null;
let modelsByProvider = new Map();

/**
 * Fetch models from the API
 * @returns {Promise<Array>} Array of model objects
 */
export async function fetchModels() {
  if (modelsCache) return modelsCache;
  
  try {
    const response = await fetch('/api/models/config');
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    
    const data = await response.json();
    modelsCache = Array.isArray(data) ? data : [];
    
    // Build provider map
    modelsByProvider.clear();
    modelsCache.forEach(modelObj => {
      const fullModel = modelObj?.model;
      if (!fullModel) return;
      
      const [provider, ...modelParts] = fullModel.split('/');
      const modelName = modelParts.join('/');
      
      if (provider && modelName) {
        if (!modelsByProvider.has(provider)) {
          modelsByProvider.set(provider, []);
        }
        modelsByProvider.get(provider).push({
          fullName: fullModel,
          modelName: modelName,
          rarity: modelObj.rarity || 'common',
          contextLength: modelObj.contextLength,
          pricing: modelObj.pricing
        });
      }
    });
    
    console.log(`[model-selector] Loaded ${modelsCache.length} models from ${modelsByProvider.size} providers`);
    return modelsCache;
  } catch (error) {
    console.error('[model-selector] Error fetching models:', error);
    return [];
  }
}

/**
 * Get all providers
 * @returns {Array<string>} Sorted list of provider names
 */
export function getProviders() {
  return Array.from(modelsByProvider.keys()).sort();
}

/**
 * Get models for a specific provider
 * @param {string} provider - Provider name (e.g., 'openai', 'anthropic')
 * @returns {Array} Models for that provider
 */
export function getModelsForProvider(provider) {
  return modelsByProvider.get(provider) || [];
}

/**
 * Get rarity styles for badges
 * @param {string} rarity - Rarity level
 * @returns {string} CSS styles
 */
export function getRarityStyle(rarity) {
  const styles = {
    'legendary': 'background: rgba(234, 179, 8, 0.2); color: #facc15; border-color: rgba(234, 179, 8, 0.5);',
    'rare': 'background: rgba(168, 85, 247, 0.2); color: #c084fc; border-color: rgba(168, 85, 247, 0.5);',
    'uncommon': 'background: rgba(59, 130, 246, 0.2); color: #60a5fa; border-color: rgba(59, 130, 246, 0.5);',
    'common': 'background: var(--color-surface); color: var(--color-text-muted); border-color: var(--color-border);'
  };
  return styles[rarity] || styles.common;
}

/**
 * Initialize a two-part model selector (provider + model dropdowns)
 * @param {object} options - Configuration options
 * @param {HTMLSelectElement} options.providerSelect - Provider dropdown element
 * @param {HTMLSelectElement} options.modelSelect - Model dropdown element
 * @param {HTMLElement} [options.rarityBadge] - Optional rarity badge element
 * @param {Function} [options.onModelChange] - Callback when model selection changes
 * @param {string} [options.initialValue] - Initial model value (full name like 'openai/gpt-4o')
 */
export async function initTwoPartSelector(options) {
  const { providerSelect, modelSelect, rarityBadge, onModelChange, initialValue } = options;
  
  if (!providerSelect || !modelSelect) {
    console.warn('[model-selector] Missing select elements');
    return;
  }
  
  // Show loading state
  providerSelect.innerHTML = '<option value="">Loading providers...</option>';
  providerSelect.disabled = true;
  modelSelect.innerHTML = '<option value="">Loading...</option>';
  modelSelect.disabled = true;
  
  // Fetch models
  await fetchModels();
  
  // Populate providers
  providerSelect.innerHTML = '<option value="">Select provider...</option>';
  providerSelect.disabled = false;
  
  const providers = getProviders();
  providers.forEach(provider => {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = provider;
    providerSelect.appendChild(option);
  });
  
  // Reset model dropdown
  modelSelect.innerHTML = '<option value="">Select provider first</option>';
  
  // Provider change handler
  providerSelect.onchange = () => {
    const selectedProvider = providerSelect.value;
    modelSelect.innerHTML = '';
    modelSelect.disabled = !selectedProvider;
    
    if (selectedProvider) {
      const models = getModelsForProvider(selectedProvider);
      modelSelect.innerHTML = '<option value="">Select model...</option>';
      
      models.forEach(modelInfo => {
        const option = document.createElement('option');
        option.value = modelInfo.fullName;
        option.textContent = modelInfo.modelName;
        option.dataset.rarity = modelInfo.rarity;
        modelSelect.appendChild(option);
      });
      
      modelSelect.disabled = false;
    } else {
      modelSelect.innerHTML = '<option value="">Select provider first</option>';
      if (rarityBadge) rarityBadge.classList.add('hidden');
    }
  };
  
  // Model change handler
  modelSelect.onchange = () => {
    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    const rarity = selectedOption?.dataset?.rarity;
    
    if (rarityBadge && rarity) {
      const span = rarityBadge.querySelector('span') || rarityBadge;
      span.style.cssText = `display: inline-flex; align-items: center; padding: 0.25rem 0.625rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; border: 1px solid; ${getRarityStyle(rarity)}`;
      span.textContent = rarity.toUpperCase();
      rarityBadge.classList.remove('hidden');
    }
    
    if (onModelChange) {
      onModelChange(modelSelect.value, selectedOption?.dataset);
    }
  };
  
  // Set initial value if provided
  if (initialValue && initialValue.includes('/')) {
    const [provider] = initialValue.split('/');
    if (providers.includes(provider)) {
      providerSelect.value = provider;
      providerSelect.dispatchEvent(new Event('change'));
      
      // Wait for model options to populate
      setTimeout(() => {
        modelSelect.value = initialValue;
        modelSelect.dispatchEvent(new Event('change'));
      }, 0);
    }
  }
}

/**
 * Initialize a single dropdown with all models in author/model format
 * @param {object} options - Configuration options
 * @param {HTMLSelectElement} options.selectElement - The select element
 * @param {boolean} [options.includeAllOption=true] - Include "All Models" option
 * @param {Function} [options.onModelChange] - Callback when selection changes
 * @param {string} [options.initialValue] - Initial selected value
 */
export async function initSingleSelector(options) {
  const { selectElement, includeAllOption = true, onModelChange, initialValue } = options;
  
  if (!selectElement) {
    console.warn('[model-selector] Missing select element');
    return;
  }
  
  // Show loading state
  selectElement.innerHTML = '<option disabled selected>Loading models...</option>';
  
  // Fetch models
  const models = await fetchModels();
  
  // Clear and populate
  selectElement.innerHTML = '';
  
  if (includeAllOption) {
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Models';
    selectElement.appendChild(allOption);
  }
  
  if (models.length === 0) {
    selectElement.innerHTML = '<option disabled selected>No models available</option>';
    return;
  }
  
  // Group by provider with optgroups
  const providers = getProviders();
  providers.forEach(provider => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = provider;
    
    const providerModels = getModelsForProvider(provider);
    providerModels.forEach(modelInfo => {
      const option = document.createElement('option');
      option.value = modelInfo.fullName;
      option.textContent = modelInfo.modelName;
      option.dataset.rarity = modelInfo.rarity;
      optgroup.appendChild(option);
    });
    
    selectElement.appendChild(optgroup);
  });
  
  // Set initial value
  if (initialValue) {
    selectElement.value = initialValue;
  }
  
  // Change handler
  if (onModelChange) {
    selectElement.onchange = () => {
      const selectedOption = selectElement.options[selectElement.selectedIndex];
      onModelChange(selectElement.value, selectedOption?.dataset);
    };
  }
}

/**
 * Format a model name for display (extract just the model part)
 * @param {string} fullModelName - Full model name like 'openai/gpt-4o'
 * @returns {string} Just the model part like 'gpt-4o'
 */
export function formatModelName(fullModelName) {
  if (!fullModelName) return 'Unknown';
  const parts = fullModelName.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : fullModelName;
}

/**
 * Format a model for display with author
 * @param {string} fullModelName - Full model name like 'openai/gpt-4o'
 * @returns {object} { author, model, display }
 */
export function parseModelName(fullModelName) {
  if (!fullModelName) return { author: '', model: '', display: 'Unknown' };
  const [author, ...modelParts] = fullModelName.split('/');
  const model = modelParts.join('/');
  return {
    author: author || '',
    model: model || fullModelName,
    display: `${author}/${model}`
  };
}

// Export for use in inline scripts
if (typeof window !== 'undefined') {
  window.ModelSelector = {
    fetchModels,
    getProviders,
    getModelsForProvider,
    getRarityStyle,
    initTwoPartSelector,
    initSingleSelector,
    formatModelName,
    parseModelName
  };
}
