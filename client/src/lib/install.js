// PWA install helper. Chrome on Android fires `beforeinstallprompt` once, early, so the listener is registered
// at import time (main.jsx imports this module before rendering) and the event is kept for InstallBanner.
let deferred = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own banner instead of Chrome's mini-infobar
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** Chrome/Edge/Samsung on Android: the native install dialog is available. */
export const canPrompt = () => !!deferred;
export const wasInstalled = () => installed;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Opens the browser's install dialog. Resolves 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const event = deferred;
  deferred = null; // the event is single-use
  notify();
  event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

/** Already running as an installed app (Android or iOS home-screen icon). */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** 'ios' | 'android' | null (desktop and others: no banner). */
export function devicePlatform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return null;
}
