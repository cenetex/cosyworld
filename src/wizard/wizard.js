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
document.addEventListener('DOMContentLoaded', () => {
  generateKey();
  updateProgress();
  
  // Check current configuration status
  fetch('/api/wizard/status')
    .then(r => r.json())
    .then(data => {
      if (data.configured) {
        showAlert('step1', 'success', 'Application is already configured! You can proceed to update settings or start fresh.');
      }
    })
    .catch(err => console.error('Status check failed:', err));
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
      data = {
        key: document.getElementById('encryptionKey').value
      };
      configData.encryption = data;
      break;
      
    case 'mongo':
      data = {
        uri: document.getElementById('mongoUri').value,
        dbName: document.getElementById('mongoDbName').value
      };
      configData.mongo = data;
      break;
      
    case 'discord':
      data = {
        botToken: document.getElementById('discordBotToken').value,
        clientId: document.getElementById('discordClientId').value
      };
      configData.discord = data;
      break;
      
    case 'ai':
      const service = document.getElementById('aiService').value;
      data = {
        service: service,
        openrouter: {
          apiKey: document.getElementById('openrouterApiKey').value,
          model: document.getElementById('openrouterModel').value
        },
        google: {
          apiKey: document.getElementById('googleApiKey').value,
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
