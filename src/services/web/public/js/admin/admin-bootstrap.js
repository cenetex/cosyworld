// admin-bootstrap.js: single entry to load shared admin modules
// Note: Removed css-fallback (no file). Removed direct CSS import to avoid MIME issues when served statically without bundling.
// All admin pages include <link href="/css/admin-common.css" rel="stylesheet" /> in HTML.
import './admin-shell.js';
import * as auth from './admin-auth.js';
import * as polling from './admin-polling.js';
import * as api from './admin-api.js';
import * as ui from './admin-ui.js';

// Provide limited globals for legacy inline scripts (non-module pages)
window.AdminAPI = api;
window.AdminUI = ui;
window.AdminAuth = auth;
window.AdminPolling = polling;

// Dispatch a readiness event so dependent scripts can wait for globals
try {
	window.dispatchEvent(new CustomEvent('admin:bootstrapReady', { detail: { at: Date.now() } }));
} catch (e) {
	console.warn('[admin-bootstrap] failed to dispatch readiness event', e);
}
