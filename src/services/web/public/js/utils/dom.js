/**
 * Shared DOM helpers to reduce duplication across tab scripts.
 */

export function setLoading(el, { message = 'Loading...' } = {}) {
  if (!el) return;
  el.innerHTML = `<div class="flex justify-center py-12"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div><span class="sr-only">${escapeHtml(message)}</span></div>`;
}

export function setError(el, error, { retryFnName } = {}) {
  if (!el) return;
  const msg = typeof error === 'string' ? error : (error?.message || 'Unexpected error');
  el.innerHTML = `<div class="text-center py-12 text-red-500">${escapeHtml(msg)}${retryFnName ? `<button class="block mx-auto mt-4 px-4 py-2 bg-gray-700 rounded" data-retry="${retryFnName}">Retry</button>` : ''}</div>`;
}

export function setEmpty(el, { title = 'Nothing Found', description = 'No data available.' } = {}) {
  if (!el) return;
  el.innerHTML = `<div class="max-w-4xl mx-auto px-4"><div class="text-center py-12"><h2 class="text-2xl font-bold mb-4">${escapeHtml(title)}</h2><p class="text-gray-400 mb-6">${escapeHtml(description)}</p></div></div>`;
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"]+/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[s]));
}

/**
 * Attach a delegated click handler for retry buttons across tabs.
 * Call once on main page init.
 */
export function installGlobalRetryHandler() {
  if (window.__retryHandlerInstalled) return;
  window.__retryHandlerInstalled = true;
  document.addEventListener('click', e => {
    const btn = e.target.closest('button[data-retry]');
    if (!btn) return;
    const fnName = btn.getAttribute('data-retry');
    const fn = window[fnName];
    if (typeof fn === 'function') fn();
  });
}
