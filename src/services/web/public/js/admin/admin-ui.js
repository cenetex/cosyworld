// admin-ui.js: UI helpers (toasts, loaders, minor DOM utils)
const TOAST_ROOT_ID = 'admin-toasts';

function ensureToastRoot() {
  let root = document.getElementById(TOAST_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = TOAST_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, { type = 'info', timeout = 4000 } = {}) {
  // Log to console for debugging
  const logFn = type === 'error' ? console.error : type === 'success' ? console.info : console.log;
  logFn(`[Admin UI - ${type}]`, message);
  
  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div style="flex:1;">${escapeHtml(message)}</div>`;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 320); }, timeout);
  return el;
}

export function success(msg, opts) { return toast(msg, { type: 'success', ...(opts||{}) }); }
export function error(msg, opts) { return toast(msg, { type: 'error', ...(opts||{}) }); }

export function loaderDots() {
  const span = document.createElement('span');
  span.className = 'loader-inline';
  span.innerHTML = '<span class="loader-dot"></span><span class="loader-dot"></span><span class="loader-dot"></span>';
  return span;
}

export function withButtonLoading(btn, fn) {
  return async (...args) => {
    if (!btn) return fn(...args);
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '';
    const dots = loaderDots();
    btn.appendChild(dots);
    try { return await fn(...args); }
    catch (e) { throw e; }
    finally { btn.disabled = false; btn.innerHTML = original; };
  };
}

export function activateNav(pathname = window.location.pathname) {
  const links = document.querySelectorAll('.nav-link');
  links.forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if (href === '/admin' && pathname === '/admin') a.classList.add('active');
    else if (href !== '/admin' && pathname.startsWith(href)) a.classList.add('active');
    else a.classList.remove('active');
  });
}

function escapeHtml(str='') {
  return str.replace(/[&<>'"`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;','`':'&#96;'}[c]));
}
