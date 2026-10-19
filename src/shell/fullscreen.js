// Full screen: the standard API on laptops and Android, the webkit prefix on Safari for Mac.
// iPhone Safari offers no element full screen; there, the installed home-screen app is the full-screen mode.
const el = document.documentElement;
const req = el.requestFullscreen || el.webkitRequestFullscreen;
export const fsSupported = !!req;
export const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

export async function toggleFs() {
  if (!fsSupported) return false;
  try {
    if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await req.call(el, { navigationUI: 'hide' });
  } catch (e) { return false; }
  return true;
}
export function onFsChange(cb) {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
}
