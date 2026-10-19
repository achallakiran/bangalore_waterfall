// Map slots (N1): maps you are working on, kept on this device in IndexedDB so you can leave and come back.
// Two stores: 'meta' (small: name, time, picture) and 'maps' (the map text), so listing slots never loads big maps.
const DB = 'hl2-editor', VER = 1;
let dbp = null;

export const available = () => { try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; } };

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!available()) { rej(new Error('no storage')); return; }
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' }); if (!d.objectStoreNames.contains('maps')) d.createObjectStore('maps'); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('storage error'));
    rq.onblocked = () => rej(new Error('storage blocked'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Ask the browser not to throw our slots away when space is short (it may say no).
export async function persist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; } }
export async function usage() { try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } } catch (e) {} return null; }

// info: { name, thumb, cam, bytes }. The map is stored as text so it comes back exactly as saved.
export async function saveSlot(id, map, info = {}) {
  const d = await db(), text = JSON.stringify(map), now = Date.now();
  const tx = d.transaction(['meta', 'maps'], 'readwrite');
  const old = await reqP(tx.objectStore('meta').get(id));
  const meta = { id, name: info.name || (old && old.name) || map.meta.name || 'My map', updated: now, created: (old && old.created) || now, thumb: info.thumb !== undefined ? info.thumb : (old && old.thumb) || '', cam: info.cam !== undefined ? info.cam : (old && old.cam) || null, bytes: text.length, size: map.slab ? [map.slab.x1 - map.slab.x0, map.slab.z1 - map.slab.z0] : null };
  tx.objectStore('meta').put(meta); tx.objectStore('maps').put(text, id);
  await done(tx);
  return meta;
}
export async function listSlots() {
  const d = await db(), tx = d.transaction('meta', 'readonly');
  const all = await reqP(tx.objectStore('meta').getAll());
  return all.sort((a, b) => b.updated - a.updated);
}
export async function loadSlot(id) {
  const d = await db(), tx = d.transaction(['meta', 'maps'], 'readonly');
  const [meta, text] = await Promise.all([reqP(tx.objectStore('meta').get(id)), reqP(tx.objectStore('maps').get(id))]);
  if (!meta || typeof text !== 'string') return null;
  return { meta, text };
}
export async function deleteSlot(id) {
  const d = await db(), tx = d.transaction(['meta', 'maps'], 'readwrite');
  tx.objectStore('meta').delete(id); tx.objectStore('maps').delete(id);
  await done(tx);
}
export async function renameSlot(id, name) {
  const d = await db(), tx = d.transaction('meta', 'readwrite'), st = tx.objectStore('meta');
  const m = await reqP(st.get(id)); if (!m) { await done(tx); return null; }
  m.name = name; st.put(m); await done(tx); return m;
}
export async function duplicateSlot(id, name) {
  const got = await loadSlot(id); if (!got) return null;
  const nid = newId(), map = JSON.parse(got.text);
  return saveSlot(nid, map, { name: name || got.meta.name + ' copy', thumb: got.meta.thumb, cam: got.meta.cam });
}
