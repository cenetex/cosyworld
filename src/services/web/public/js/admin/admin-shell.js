// admin-shell.js: inject shared navigation + footer if not already standardized
import { activateNav } from './admin-ui.js';

const NAV_ID = 'admin-shared-nav';

const NAV_HTML = `
<nav class="navbar" id="${NAV_ID}">
  <div class="navbar-inner">
    <div class="nav-left" style="display:flex; align-items:center; gap:.75rem;">
      <div class="nav-brand">RATi Admin</div>
      <div class="nav-links">
        <a class="nav-link" href="/admin">Dashboard</a>
        <a class="nav-link" href="/admin/bots/">Bots</a>
        <a class="nav-link" href="/admin/entity-management">Entities</a>
        <a class="nav-link" href="/admin/collections">Collections</a>
        <a class="nav-link" href="/admin/servers">Servers</a>
        <a class="nav-link" href="/admin/users">Users</a>
        <a class="nav-link" href="/admin/global-settings">Settings</a>
      </div>
    </div>
    <div class="nav-right" style="display:flex; align-items:center; gap:.5rem;">
      <button id="admin-logout" class="btn outline" style="--btn-bg:#4b5563; --btn-bg-hover:#374151; --btn-border:#4b5563;">Logout</button>
    </div>
  </div>
</nav>`;

const FOOTER_ID = 'admin-shared-footer';
const FOOTER_HTML = `<footer class="footer" id="${FOOTER_ID}">RATi Swarm Admin © 2025</footer>`;

function injectShell() {
  // Skip injection on login and setup pages
  const pathname = window.location.pathname;
  if (pathname === '/admin/login' || pathname === '/admin/setup') {
    return;
  }

  // Skip injection on v2 pages that have their own navigation (admin-v2 body class)
  if (document.body.classList.contains('admin-v2')) {
    return;
  }

  // Skip injection on dashboard (has its own custom nav)
  if (document.body.classList.contains('admin-v2-dashboard')) {
    return;
  }

  // Skip injection on bots pages (they use admin-v2 design)
  if (pathname.startsWith('/admin/bots')) {
    return;
  }

  // Skip injection on global-settings page
  if (pathname === '/admin/global-settings' || pathname === '/admin/global-settings.html') {
    return;
  }

  // Mark body for shared styling
  document.body.classList.add('admin-shell');

  // Replace existing nav heuristically if it lacks our ID
  const existingNav = document.querySelector('nav');
  if (!document.getElementById(NAV_ID)) {
    if (existingNav) {
      existingNav.insertAdjacentHTML('beforebegin', NAV_HTML);
      existingNav.remove();
    } else {
      document.body.insertAdjacentHTML('afterbegin', NAV_HTML);
    }
  }

  // Append footer if missing
  if (!document.getElementById(FOOTER_ID)) {
    document.body.appendChild(document.createElement('div')).outerHTML = FOOTER_HTML;
  }

  activateNav();

  // Wire logout button (idempotent)
  const btn = document.getElementById('admin-logout');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
      location.href = '/admin/login';
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectShell);
} else {
  injectShell();
}
