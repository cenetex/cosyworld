// admin-bootstrap.js: single entry to load shared admin modules
import '../css-fallback.js'; // (placeholder if needed later)
import '../../css/admin-common.css'; // Ensure CSS loads when using bundlers (static <link> also added for non-bundled)
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
