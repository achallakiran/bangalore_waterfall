// Offline support. The service worker is generated at build time (tools/sw-template.js) and only registered in the built site.
export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    const had = !!navigator.serviceWorker.controller;
    // A new version takes over by itself; on the title screen the page reloads so the new version shows at once.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had) return;
      const t = document.getElementById('scTitle');
      if (t && !t.hidden) location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
