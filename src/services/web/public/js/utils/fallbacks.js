/**
 * Shared fallback utilities for avatar/location images
 */

export function generateFallbackAvatar(initial = '?', size = 100) {
  const safeInitial = String(initial).charAt(0).toUpperCase().replace(/[^A-Z0-9]/g, '?');
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'%3E%3Crect fill='%23333' width='${size}' height='${size}'/%3E%3Ctext fill='%23FFF' x='50%25' y='50%25' font-size='${Math.floor(size/2)}' text-anchor='middle' dominant-baseline='middle'%3E${safeInitial}%3C/text%3E%3C/svg%3E`;
}

export function generateLocationFallback(text = 'Location Image Not Available', size = 100) {
  const fontSize = Math.max(8, Math.floor(size / 8));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'%3E%3Crect fill='%23444' width='${size}' height='${size}'/%3E%3Ctext fill='%23FFF' x='50%25' y='50%25' font-size='${fontSize}' text-anchor='middle' dominant-baseline='middle'%3E${text}%3C/text%3E%3C/svg%3E`;
}

export function addImageFallback(img, type = 'avatar', name = '') {
  if (!img) return;
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  const fallbackSrc = type === 'location' ? generateLocationFallback() : generateFallbackAvatar(initial);
  img.onerror = function() {
    this.onerror = null;
    this.src = fallbackSrc;
  };
}
