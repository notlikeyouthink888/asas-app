// التخزين: الألعاب في IndexedDB (مساحة كبيرة)، والإعدادات والمفاتيح في localStorage. كلها داخل الجهاز فقط.

const DB_NAME = 'gamestudio';
const STORE = 'projects';
let dbPromise;

function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  }));
}

export const projects = {
  all: () => tx('readonly', (s) => s.getAll()).then((l) => (l || []).sort((a, b) => b.updatedAt - a.updatedAt)),
  get: (id) => tx('readonly', (s) => s.get(id)),
  put: (p) => { p.updatedAt = Date.now(); return tx('readwrite', (s) => s.put(p)); },
  del: (id) => tx('readwrite', (s) => s.delete(id)),
};

export const MAX_VERSIONS = 40;

/** يضيف إصدارًا جديدًا للعبة ويحتفظ بآخر 40 (والأول دائمًا). */
export function addVersion(p, code, note, cost = 0) {
  p.versions ||= [];
  const n = (p.versions.at(-1)?.n || 0) + 1;
  p.versions.push({ n, code, note, at: Date.now(), cost });
  if (p.versions.length > MAX_VERSIONS) p.versions.splice(1, p.versions.length - MAX_VERSIONS);
  p.code = code;
  return n;
}

const PREFIX = 'gs.';
export const settings = {
  get(key, def = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch { /* الذاكرة ممتلئة: الإعدادات غير حرجة */ }
  },
};

export const keys = {
  get openrouter() { return (settings.get('key.openrouter') || '').trim(); },
  set openrouter(v) { settings.set('key.openrouter', (v || '').trim() || null); },
  get anthropic() { return (settings.get('key.anthropic') || '').trim(); },
  set anthropic(v) { settings.set('key.anthropic', (v || '').trim() || null); },
};
