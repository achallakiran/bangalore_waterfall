// Map manager: the only place that fetches, parses and validates maps. Holds at most one map in memory.
// release() drops it, so leaving a game gives its map data back; the next load fetches the file again (from the offline cache).
import { validateMap, describeErrors, LIMITS } from './format.js';

export const BUILTIN = [
  { id: 'hill-loop', name: 'Hill Loop Track', url: './maps/hill-loop.json' }
];

export class MapError extends Error {
  constructor(message, details) { super(message); this.name = 'MapError'; this.details = details || []; }
}

export function parseMap(text) {
  if (typeof text !== 'string') throw new MapError('That is not a map file.');
  if (text.length > LIMITS.maxBytes) throw new MapError('This map file is too large (' + Math.round(text.length / 1000) + ' KB; the limit is ' + Math.round(LIMITS.maxBytes / 1000) + ' KB).');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new MapError('This file is not valid JSON, so it cannot be a map.'); }
  const res = validateMap(data);
  if (!res.ok) throw new MapError('This map cannot be used: ' + describeErrors(res), res.errors);
  return data;
}

export function createMapManager({ fetchImpl } = {}) {
  let current = null, source = null, loading = 0;
  const doFetch = fetchImpl || ((u) => fetch(u));

  async function loadBuiltin(id) {
    const entry = BUILTIN.find(b => b.id === id);
    if (!entry) throw new MapError('Unknown map "' + id + '".');
    let res;
    try { res = await doFetch(entry.url); } catch (e) { throw new MapError('The map could not be loaded. Check your connection and try again.'); }
    if (!res.ok) throw new MapError('The map could not be loaded (' + res.status + ').');
    return parseMap(await res.text());
  }

  return {
    // id of a built-in map, or { text } / { file } for a map the player opened.
    async load(src) {
      const token = ++loading;
      let map;
      if (typeof src === 'string') map = await loadBuiltin(src);
      else if (src && typeof src.text === 'string') map = parseMap(src.text);
      else if (src && src.file) {
        if (src.file.size > LIMITS.maxBytes) throw new MapError('This map file is too large.');
        map = parseMap(await src.file.text());
      } else throw new MapError('Nothing to load.');
      if (token !== loading) throw new MapError('Another map was requested first.');
      current = map; source = typeof src === 'string' ? src : 'file';
      return map;
    },
    release() { loading++; current = null; source = null; },
    get current() { return current; },
    get source() { return source; }
  };
}
