// Install as an app. Chrome, Edge and Android offer a prompt we can trigger; iPhone and Safari on Mac need a hint.
let deferred = null;
const subs = new Set();
const notify = () => subs.forEach(f => f());

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify(); });
window.addEventListener('appinstalled', () => { deferred = null; notify(); });

export const isStandalone = () =>
  (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;

const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);

export function hintText() {
  if (isIOS) return 'Tap the Share button, then Add to Home Screen.';
  if (isMacSafari) return 'In the File menu, choose Add to Dock.';
  return null;
}
export const canInstall = () => !isStandalone() && (!!deferred || !!hintText());
export const onInstallChange = f => { subs.add(f); return () => subs.delete(f); };

// Returns 'accepted' | 'dismissed' | 'hint'.
export async function promptInstall() {
  if (deferred) {
    const d = deferred; deferred = null; notify();
    try { d.prompt(); const r = await d.userChoice; return r.outcome; } catch (e) { return 'dismissed'; }
  }
  return 'hint';
}
