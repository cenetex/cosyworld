/**
 * CosyWorld Configuration Wizard - Client Script
 */

let currentStep = 1;
const totalSteps = 7;
let configData = {
  encryption: {},
  mongo: {},
  discord: {},
  ai: { openrouter: {}, google: {} },
  optional: {}
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  updateProgress();
  
  // Load existing configuration from server
  try {
    const response = await fetch('/api/wizard/config');
    const existingConfig = await response.json();
    
    // Map server config to wizard configData structure
    configData = {
      encryption: {
        key: existingConfig.encryption?.hasKey ? '' : '' // Will be populated or generated
      },
      mongo: {
        uri: '', // Will be populated if exists
        dbName: existingConfig.mongo?.dbName || 'cosyworld8'
      },
      discord: {
        botToken: '',
        clientId: existingConfig.discord?.clientId || ''
      },
      ai: {
        service: existingConfig.ai?.service || 'openrouter',
        openrouter: {
          apiKey: '',
          model: existingConfig.ai?.openrouter?.model || 'google/gemini-2.5-pro'
        },
        google: {
          apiKey: '',
          model: existingConfig.ai?.google?.model || 'gemini-2.5-flash'
        }
      },
      optional: {}
    };
    
    // If encryption key doesn't exist, generate one
    if (!existingConfig.encryption?.hasKey) {
      await generateKey();
    } else {
      // Key exists but is masked, show placeholder and remove required
      const encKeyField = document.getElementById('encryptionKey');
      encKeyField.placeholder = 'Encryption key already configured';
      encKeyField.setAttribute('data-existing', 'true');
      encKeyField.removeAttribute('required');
    }
    
    // Populate non-secret fields (like clientId, dbName, models)
    if (existingConfig.mongo?.dbName) {
      document.getElementById('mongoDbName').value = existingConfig.mongo.dbName;
    }
    if (existingConfig.discord?.clientId) {
      document.getElementById('discordClientId').value = existingConfig.discord.clientId;
    }
    if (existingConfig.ai?.service) {
      document.getElementById('aiService').value = existingConfig.ai.service;
    }
    if (existingConfig.ai?.openrouter?.model) {
      document.getElementById('openrouterModel').value = existingConfig.ai.openrouter.model;
    }
    if (existingConfig.ai?.google?.model) {
      document.getElementById('googleModel').value = existingConfig.ai.google.model;
    }
    
    // For masked secrets, show placeholders to indicate they exist
    // Also remove 'required' attribute to allow keeping existing values
    if (existingConfig.mongo?.uri && existingConfig.mongo.configured) {
      const mongoUriField = document.getElementById('mongoUri');
      mongoUriField.placeholder = 'Already configured - leave empty to keep existing';
      mongoUriField.setAttribute('data-existing', 'true');
      mongoUriField.removeAttribute('required');
    }
    if (existingConfig.discord?.botToken && existingConfig.discord.configured) {
      const discordTokenField = document.getElementById('discordBotToken');
      discordTokenField.placeholder = 'Already configured - leave empty to keep existing';
      discordTokenField.setAttribute('data-existing', 'true');
      discordTokenField.removeAttribute('required');
    }
    if (existingConfig.ai?.openrouter?.apiKey && existingConfig.ai.openrouter.configured) {
      const openrouterKeyField = document.getElementById('openrouterApiKey');
      openrouterKeyField.placeholder = 'Already configured - leave empty to keep existing';
      openrouterKeyField.setAttribute('data-existing', 'true');
      openrouterKeyField.removeAttribute('required');
    }
    if (existingConfig.ai?.google?.apiKey && existingConfig.ai.google.configured) {
      const googleKeyField = document.getElementById('googleApiKey');
      googleKeyField.placeholder = 'Already configured - leave empty to keep existing';
      googleKeyField.setAttribute('data-existing', 'true');
      googleKeyField.removeAttribute('required');
    }
    
    // Show status message
    const status = await fetch('/api/wizard/status').then(r => r.json());
    if (status.configured) {
      showAlert('step1', 'success', 'Application is already configured! Fields with existing values are marked. Leave them empty to keep current values.');
    }
  } catch (err) {
    console.error('Failed to load existing config:', err);
    // Fallback: generate new key if loading fails
    await generateKey();
  }
});

function updateProgress() {
  const progress = ((currentStep - 1) / totalSteps) * 100;
  document.getElementById('progressFill').style.width = progress + '%';
}

function nextStep() {
  if (currentStep < 8) {
    document.querySelector(`[data-step="${currentStep}"]`).classList.remove('active');
    currentStep++;
    document.querySelector(`[data-step="${currentStep}"]`).classList.add('active');
    updateProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Show summary on review step
    if (currentStep === 7) {
      showConfigSummary();
    }
  }
}

function prevStep() {
  if (currentStep > 1) {
    document.querySelector(`[data-step="${currentStep}"]`).classList.remove('active');
    currentStep--;
    document.querySelector(`[data-step="${currentStep}"]`).classList.add('active');
    updateProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

async function validateAndNext(section) {
  // Collect data for the section
  let data;
  
  switch (section) {
    case 'encryption':
      const encKeyField = document.getElementById('encryptionKey');
      data = {
        key: encKeyField.value || (encKeyField.getAttribute('data-existing') ? 'KEEP_EXISTING' : '')
      };
      configData.encryption = data;
      break;
      
    case 'mongo':
      const mongoUriField = document.getElementById('mongoUri');
      data = {
        uri: mongoUriField.value || (mongoUriField.getAttribute('data-existing') ? 'KEEP_EXISTING' : ''),
        dbName: document.getElementById('mongoDbName').value
      };
      configData.mongo = data;
      break;
      
    case 'discord':
      const discordTokenField = document.getElementById('discordBotToken');
      data = {
        botToken: discordTokenField.value || (discordTokenField.getAttribute('data-existing') ? 'KEEP_EXISTING' : ''),
        clientId: document.getElementById('discordClientId').value
      };
      configData.discord = data;
      break;
      
    case 'ai':
      const service = document.getElementById('aiService').value;
      const openrouterKeyField = document.getElementById('openrouterApiKey');
      const googleKeyField = document.getElementById('googleApiKey');
      
      data = {
        service: service,
        openrouter: {
          apiKey: openrouterKeyField.value || (openrouterKeyField.getAttribute('data-existing') ? 'KEEP_EXISTING' : ''),
          model: document.getElementById('openrouterModel').value
        },
        google: {
          apiKey: googleKeyField.value || (googleKeyField.getAttribute('data-existing') ? 'KEEP_EXISTING' : ''),
          model: document.getElementById('googleModel').value
        }
      };
      configData.ai = data;
      break;
  }
  
  // Validate with server
  try {
    const response = await fetch('/api/wizard/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, data })
    });
    
    const result = await response.json();
    
    if (result.valid) {
      clearAlert(`step${currentStep + 1}`);
      nextStep();
    } else {
      showAlert(`step${currentStep + 1}`, 'error', 'Validation Failed', result.errors);
    }
  } catch (error) {
    showAlert(`step${currentStep + 1}`, 'error', 'Validation Error: ' + error.message);
  }
}

async function generateKey() {
  try {
    const response = await fetch('/api/wizard/generate-key', { method: 'POST' });
    const data = await response.json();
    document.getElementById('encryptionKey').value = data.key;
  } catch (error) {
    console.error('Key generation failed:', error);
    // Fallback: generate client-side
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const key = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    document.getElementById('encryptionKey').value = key;
  }
}

async function importEnv() {
  const envContent = document.getElementById('importEnv').value;
  if (!envContent.trim()) {
    showAlert('step1', 'error', 'Please paste your .env file content first.');
    return;
  }
  
  try {
    const response = await fetch('/api/wizard/import-env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envContent })
    });
    
    const result = await response.json();
    
    if (result.success) {
      configData = result.config;
      populateFields();
      showAlert('step1', 'success', 'Configuration imported successfully! Click Next to review.');
    } else {
      showAlert('step1', 'error', 'Import failed: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    showAlert('step1', 'error', 'Import failed: ' + error.message);
  }
}

function populateFields() {
  // Populate form fields with imported data
  if (configData.encryption?.key) {
    document.getElementById('encryptionKey').value = configData.encryption.key;
  }
  if (configData.mongo?.uri) {
    document.getElementById('mongoUri').value = configData.mongo.uri;
  }
  if (configData.mongo?.dbName) {
    document.getElementById('mongoDbName').value = configData.mongo.dbName;
  }
  if (configData.discord?.botToken) {
    document.getElementById('discordBotToken').value = configData.discord.botToken;
  }
  if (configData.discord?.clientId) {
    document.getElementById('discordClientId').value = configData.discord.clientId;
  }
  if (configData.ai?.service) {
    document.getElementById('aiService').value = configData.ai.service;
  }
  if (configData.ai?.openrouter?.apiKey) {
    document.getElementById('openrouterApiKey').value = configData.ai.openrouter.apiKey;
  }
  if (configData.ai?.openrouter?.model) {
    document.getElementById('openrouterModel').value = configData.ai.openrouter.model;
  }
  if (configData.ai?.google?.apiKey) {
    document.getElementById('googleApiKey').value = configData.ai.google.apiKey;
  }
  if (configData.ai?.google?.model) {
    document.getElementById('googleModel').value = configData.ai.google.model;
  }
}

function toggleSection(section) {
  const checkbox = document.getElementById('enable' + section.charAt(0).toUpperCase() + section.slice(1));
  const fields = document.getElementById(section + 'Fields');
  fields.style.display = checkbox.checked ? 'block' : 'none';
}

function showConfigSummary() {
  const summary = document.getElementById('configSummary');
  const items = [];
  
  items.push(`<p><strong>🔐 Encryption:</strong> Configured (${configData.encryption.key?.length || 0} chars)</p>`);
  items.push(`<p><strong>🗄️ Database:</strong> ${maskValue(configData.mongo.uri)} / ${configData.mongo.dbName}</p>`);
  items.push(`<p><strong>🤖 Discord:</strong> Bot configured with client ID ${configData.discord.clientId}</p>`);
  
  const aiService = configData.ai.service || 'openrouter';
  const hasOpenRouter = configData.ai.openrouter?.apiKey;
  const hasGoogle = configData.ai.google?.apiKey;
  items.push(`<p><strong>🤖 AI Service:</strong> ${aiService} ${hasOpenRouter ? '(OpenRouter ✓)' : ''} ${hasGoogle ? '(Google ✓)' : ''}</p>`);
  
  // Optional services
  const optional = [];
  if (document.getElementById('enableReplicate')?.checked) {
    optional.push('Replicate');
  }
  if (document.getElementById('enableS3')?.checked) {
    optional.push('S3/CloudFront');
  }
  if (document.getElementById('enableTwitter')?.checked) {
    optional.push('X/Twitter');
  }
  
  if (optional.length > 0) {
    items.push(`<p><strong>⚙️ Optional:</strong> ${optional.join(', ')}</p>`);
  }
  
  summary.innerHTML = items.join('');
}

async function saveConfiguration() {
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="loading"></span> Saving...';
  
  // Collect all configuration data
  const config = {
    encryption: {
      key: document.getElementById('encryptionKey').value,
    },
    mongo: {
      uri: document.getElementById('mongoUri').value,
      dbName: document.getElementById('mongoDbName').value
    },
    discord: {
      botToken: document.getElementById('discordBotToken').value,
      clientId: document.getElementById('discordClientId').value
    },
    ai: {
      service: document.getElementById('aiService').value,
      openrouter: {
        apiKey: document.getElementById('openrouterApiKey').value,
        model: document.getElementById('openrouterModel').value,
        chatModel: document.getElementById('openrouterModel').value,
        visionModel: document.getElementById('openrouterModel').value,
        structuredModel: document.getElementById('openrouterModel').value
      },
      google: {
        apiKey: document.getElementById('googleApiKey').value,
        model: document.getElementById('googleModel').value
      }
    },
    optional: {},
    nodeEnv: 'production',
    baseUrl: 'http://localhost:3000',
    publicUrl: 'http://localhost:3000'
  };

  // Add optional services
  if (document.getElementById('enableReplicate')?.checked) {
    config.optional.replicate = {
      apiToken: document.getElementById('replicateToken').value
    };
  }
  
  if (document.getElementById('enableS3')?.checked) {
    config.optional.s3 = {
      endpoint: document.getElementById('s3Endpoint').value,
      apiKey: document.getElementById('s3ApiKey').value
    };
  }
  
  if (document.getElementById('enableTwitter')?.checked) {
    config.optional.x = {
      clientId: document.getElementById('xClientId').value,
      clientSecret: document.getElementById('xClientSecret').value,
      callbackUrl: 'http://localhost:3000/api/xauth/callback'
    };
  }
  
  try {
    const response = await fetch('/api/wizard/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config })
    });
    
    const result = await response.json();
    
    if (result.success) {
      clearAlert('step7');
      nextStep(); // Go to success screen
    } else {
      showAlert('step7', 'error', 'Save Failed: ' + (result.error || 'Unknown error'), result.details);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '💾 Save Configuration';
    }
  } catch (error) {
    showAlert('step7', 'error', 'Save Failed: ' + error.message);
    saveBtn.disabled = false;
    saveBtn.innerHTML = '💾 Save Configuration';
  }
}

function showAlert(step, type, message, errors = []) {
  const alertDiv = document.getElementById(`alert-${step}`);
  if (!alertDiv) return;
  
  let html = `<div class="alert alert-${type}">`;
  html += `<strong>${message}</strong>`;
  
  if (errors.length > 0) {
    html += '<ul class="validation-errors">';
    errors.forEach(err => {
      html += `<li>${err}</li>`;
    });
    html += '</ul>';
  }
  
  html += '</div>';
  alertDiv.innerHTML = html;
}

function clearAlert(step) {
  const alertDiv = document.getElementById(`alert-${step}`);
  if (alertDiv) {
    alertDiv.innerHTML = '';
  }
}

function maskValue(value) {
  if (!value || value.length < 12) return '***';
  return value.substring(0, 8) + '***' + value.substring(value.length - 4);
}
