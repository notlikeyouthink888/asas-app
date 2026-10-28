// اختيار النماذج: قائمة كلود ثابتة (مفتاح Anthropic مباشر)، وقائمة OpenRouter تُجلب حيّة وتُفرز تلقائيًا
// حسب قوتها في البرمجة وحداثتها وسعرها.

import { settings, keys } from './store.js';

/** أسعار الدولار لكل مليون رمز. cacheRead = سعر القراءة من الذاكرة المؤقتة. */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', in: 4, out: 20, cacheRead: 0.2, ctx: 1e6, tier: 'best', recommended: true,
    note: 'الأفضل للتطوير: يبني ويصلح ألعاب كاملة بثبات. الافتراضي.' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', in: 10, out: 50, cacheRead: 0.25, ctx: 1e6, tier: 'best',
    note: 'أقوى نموذج من Anthropic، لأصعب الألعاب. غالي وأبطأ.' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', in: 2, out: 10, cacheRead: 0.2, ctx: 1e6, tier: 'balanced',
    note: 'أسرع وبنصف السعر. ممتاز للتعديلات والتطوير التلقائي الطويل.' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', in: 0.1, out: 0.5, cacheRead: 0.01, ctx: 1e6, tier: 'cheap',
    note: 'رخيص جدًا. للإصلاحات الصغيرة والتجارب.' },
].map((m) => ({ ...m, provider: 'anthropic', vision: true }));

/** احتياط إن تعذر جلب قائمة OpenRouter (قد تكون بعض الأسماء قديمة؛ حدّث القائمة من الإعدادات). */
const OPENROUTER_FALLBACK = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', in: 3, out: 15, ctx: 1e6, vision: true, tier: 'best' },
  { id: 'openai/gpt-5', name: 'GPT-5', in: 1.25, out: 10, ctx: 400000, vision: true, tier: 'best' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', in: 1.25, out: 10, ctx: 1048576, vision: true, tier: 'best' },
  { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', in: 0.3, out: 1.2, ctx: 262144, tier: 'balanced' },
  { id: 'moonshotai/kimi-k2', name: 'Kimi K2', in: 0.6, out: 2.5, ctx: 131072, tier: 'balanced' },
  { id: 'z-ai/glm-4.6', name: 'GLM 4.6', in: 0.6, out: 2.2, ctx: 200000, tier: 'balanced' },
  { id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek V3.1', in: 0.25, out: 1, ctx: 163840, tier: 'cheap' },
  { id: 'x-ai/grok-code-fast-1', name: 'Grok Code Fast', in: 0.2, out: 1.5, ctx: 256000, tier: 'cheap' },
  { id: 'openrouter/auto', name: 'OpenRouter Auto', in: 0, out: 0, ctx: 2e6, tier: 'cheap', note: 'OpenRouter يختار النموذج' },
].map((m) => ({ ...m, provider: 'openrouter' }));

/** عائلات النماذج القوية بالبرمجة ووزن كل منها (من خبرتنا بتطوير الألعاب). */
const FAMILIES = [
  { re: /^anthropic\/claude-[\w.-]*opus/, w: 100, per: 1 },
  { re: /^anthropic\/claude-[\w.-]*sonnet/, w: 97, per: 1 },
  { re: /^openai\/gpt-5[\w.-]*codex/, w: 95, per: 1 },
  { re: /^openai\/gpt-5(\.\d+)?$/, w: 94, per: 1 },
  { re: /^google\/gemini-[\d.]+-pro/, w: 92, per: 1 },
  { re: /^x-ai\/grok-[\w.-]*code/, w: 84, per: 1 },
  { re: /^x-ai\/grok-\d/, w: 85, per: 1 },
  { re: /^qwen\/qwen[\w.-]*coder/, w: 86, per: 1 },
  { re: /^moonshotai\/kimi-k\d/, w: 85, per: 1 },
  { re: /^z-ai\/glm-\d/, w: 84, per: 1 },
  { re: /^deepseek\/deepseek-(v\d|chat|r\d|coder)/, w: 82, per: 1 },
  { re: /^minimax\/minimax-m\d/, w: 80, per: 1 },
  { re: /^mistralai\/(devstral|codestral)/, w: 76, per: 1 },
  { re: /^openai\/gpt-5[\w.]*-mini/, w: 78, per: 1 },
  { re: /^google\/gemini-[\d.]+-flash(?!-lite|-image)/, w: 77, per: 1 },
  { re: /^anthropic\/claude-[\w.-]*haiku/, w: 72, per: 1 },
];
const BAD = /(image|audio|tts|embed|search|online|realtime|guard|safety|vision-preview|-lite|nano|deep-research|transcribe)/i;

function perM(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n * 1e6 : null;
}

/**
 * يفرز قائمة OpenRouter الحية: يستبعد غير المناسب (صور، صوت، سياق قصير)، يأخذ أحدث نموذج من كل عائلة قوية،
 * ثم يوزعها على ثلاث فئات حسب السعر مع ترتيب بالقوة والحداثة.
 */
export function rankOpenRouter(list) {
  const now = Date.now() / 1000;
  const picked = new Map();
  for (const m of list || []) {
    const id = String(m.id || '');
    const outMods = m.architecture?.output_modalities || ['text'];
    if (!outMods.includes('text') || BAD.test(id)) continue;
    const ctx = m.context_length || m.top_provider?.context_length || 0;
    if (ctx < 64000) continue;
    const base = id.replace(/:free$/, '');
    const fam = FAMILIES.findIndex((f) => f.re.test(base));
    if (fam < 0) continue;
    const priceIn = perM(m.pricing?.prompt), priceOut = perM(m.pricing?.completion);
    if (priceIn == null || priceOut == null) continue;
    const ageDays = m.created ? (now - m.created) / 86400 : 365;
    const recency = Math.max(0, 12 - ageDays / 30); // حتى +12 للنماذج الجديدة
    const entry = {
      provider: 'openrouter', id, name: (m.name || id).replace(/^[^:]+:\s*/, ''),
      in: priceIn, out: priceOut, ctx,
      vision: (m.architecture?.input_modalities || []).includes('image'),
      maxOut: m.top_provider?.max_completion_tokens || null,
      created: m.created || 0,
      score: FAMILIES[fam].w + recency,
    };
    if (id.endsWith(':free')) continue;
    const prev = picked.get(fam);
    if (!prev || entry.created > prev.created) picked.set(fam, entry);
  }
  const all = [...picked.values()].sort((a, b) => b.score - a.score);
  const tierOf = (m) => (m.out >= 8 ? 'best' : m.out >= 1.6 ? 'balanced' : 'cheap');
  for (const m of all) m.tier = tierOf(m);
  // أقوى نموذج متوسط السعر يصعد للفئة الأولى إن كانت فارغة
  if (!all.some((m) => m.tier === 'best') && all[0]) all[0].tier = 'best';
  if (all[0]) all[0].recommended = true;
  return all;
}

/* ── النماذج المجانية ───────────────────────────────────── */

/** معرّف «سلسلة المجانية»: التطبيق يجرب المجانية بالترتيب ويتحول للتالي إن انشغل أحدها أو وصل حده أو اختفى. */
export const FREE_CHAIN = 'free/chain';

/** احتياط إن تعذر جلب القائمة الحية (الأسماء تتغير؛ غير الموجود يُتخطى تلقائيًا). */
const FREE_FALLBACK = [
  ['qwen/qwen3-coder:free', 'Qwen3 Coder', 262144],
  ['deepseek/deepseek-chat-v3.1:free', 'DeepSeek V3.1', 163840],
  ['moonshotai/kimi-k2:free', 'Kimi K2', 32768],
  ['z-ai/glm-4.5-air:free', 'GLM 4.5 Air', 131072],
  ['openai/gpt-oss-120b:free', 'GPT-OSS 120B', 131072],
  ['deepseek/deepseek-r1-0528:free', 'DeepSeek R1', 163840],
  ['tngtech/deepseek-r1t2-chimera:free', 'DeepSeek R1T2 Chimera', 163840],
  ['meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B', 131072],
  ['google/gemma-3-27b-it:free', 'Gemma 3 27B', 131072],
  ['mistralai/mistral-small-3.2-24b-instruct:free', 'Mistral Small 3.2', 131072],
].map(([id, name, ctx]) => ({ provider: 'openrouter', id, name, ctx, in: 0, out: 0, free: true, vision: false }));

/** كل النماذج المجانية من القائمة الحية، مرتبة بالقوة في البرمجة ثم الحداثة وطول السياق. */
export function rankFree(list) {
  const now = Date.now() / 1000;
  const out = [];
  for (const m of list || []) {
    const id = String(m.id || '');
    const zero = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
    if (!(id.endsWith(':free') || zero) || id.startsWith('openrouter/')) continue;
    const outMods = m.architecture?.output_modalities || ['text'];
    if (!outMods.includes('text') || BAD.test(id)) continue;
    const ctx = m.context_length || m.top_provider?.context_length || 0;
    if (ctx < 16000) continue;
    const fam = FAMILIES.findIndex((f) => f.re.test(id.replace(/:free$/, '')));
    const ageDays = m.created ? (now - m.created) / 86400 : 365;
    out.push({
      provider: 'openrouter', id, name: (m.name || id).replace(/^[^:]+:\s*/, '').replace(/\s*\(free\)\s*$/i, ''),
      in: 0, out: 0, ctx, free: true,
      vision: (m.architecture?.input_modalities || []).includes('image'),
      maxOut: m.top_provider?.max_completion_tokens || null,
      score: (fam >= 0 ? FAMILIES[fam].w : 55) + Math.max(0, 12 - ageDays / 30) + Math.min(8, ctx / 32768),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function freeModels() {
  const c = settings.get(CACHE_KEY);
  return c?.free?.length ? c.free : FREE_FALLBACK;
}

/** السلسلة حسب ترتيبك (المحفوظ أولًا، والجديد بعده بترتيبنا)، بدون اللي عطلتها. */
export function freeChain({ includeDisabled = false } = {}) {
  const all = freeModels();
  const order = settings.get('free.order') || [];
  const off = new Set(settings.get('free.off') || []);
  const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1e6 + all.findIndex((m) => m.id === id) : i; };
  return [...all].sort((a, b) => pos(a.id) - pos(b.id)).filter((m) => includeDisabled || !off.has(m.id));
}

export function setFreeOrder(ids) { settings.set('free.order', ids); }
export function setFreeEnabled(id, on) {
  const off = new Set(settings.get('free.off') || []);
  if (on) off.delete(id); else off.add(id);
  settings.set('free.off', [...off]);
}
export function isFreeEnabled(id) { return !(settings.get('free.off') || []).includes(id); }

/** بداية اليوم التالي بتوقيت UTC (يتجدد فيه الحد اليومي للمجانية في OpenRouter). */
export function nextUtcDay() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** حالة كل نموذج مجاني: موقوف مؤقتًا حتى وقت معين ولماذا. */
export function freeState(id) {
  const st = (settings.get('free.state') || {})[id];
  return st && st.until > Date.now() ? st : null;
}
export function markFree(id, ms, why) {
  const all = settings.get('free.state') || {};
  all[id] = { until: Date.now() + ms, why };
  settings.set('free.state', all);
}
export function clearFreeState() { settings.set('free.state', null); settings.set('free.dailyUntil', null); }

/** حد OpenRouter اليومي للحساب كله (كل المجانية معًا). */
export function freeDailyBlocked() {
  const u = settings.get('free.dailyUntil');
  return u && u > Date.now() ? u : 0;
}
export function blockFreeDaily() { settings.set('free.dailyUntil', nextUtcDay()); }

/** عداد طلبات اليوم المجانية (تقريبي، من هذا التطبيق فقط). */
export function freeUsage() {
  const day = new Date().toISOString().slice(0, 10);
  const u = settings.get('free.usage');
  return u?.day === day ? u : { day, total: 0, per: {} };
}
export function countFree(id) {
  const u = freeUsage();
  u.total++;
  u.per[id] = (u.per[id] || 0) + 1;
  settings.set('free.usage', u);
}

export const FREE_MODEL = {
  provider: 'openrouter', id: FREE_CHAIN, name: '🆓 النماذج المجانية (تبديل تلقائي)', in: 0, out: 0, free: true,
  // الصور تُرسل فقط للنموذج المجاني الذي يدعمها (llm.js يحذفها لغيره)
  vision: true,
  note: 'يجرب المجانية بالترتيب اللي تختاره، وإذا انشغل واحد أو وصل حده أو انحذف يتحول للتالي تلقائيًا.',
};

const CACHE_KEY = 'models.openrouter';

export function openRouterModels() {
  const c = settings.get(CACHE_KEY);
  return c?.list?.length ? c.list : OPENROUTER_FALLBACK;
}

export function openRouterUpdatedAt() {
  return settings.get(CACHE_KEY)?.at || 0;
}

/** يجلب القائمة الحية (لا تحتاج مفتاحًا) ويحفظ المفروز منها. */
export async function refreshOpenRouter({ force = false } = {}) {
  const c = settings.get(CACHE_KEY);
  if (!force && c?.at && Date.now() - c.at < 24 * 3600e3) return c.list;
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error('تعذر جلب قائمة النماذج: ' + res.status);
  const data = await res.json();
  const list = rankOpenRouter(data.data);
  const free = rankFree(data.data);
  if (list.length || free.length) settings.set(CACHE_KEY, { at: Date.now(), list: list.length ? list : openRouterModels(), free });
  return list;
}

export function allModels() {
  return [...CLAUDE_MODELS, ...openRouterModels(), ...freeModels()];
}

export function findModel(ref) {
  if (!ref) return null;
  if (ref.id === FREE_CHAIN) return FREE_MODEL;
  return allModels().find((m) => m.provider === ref.provider && m.id === ref.id)
    || (ref.provider === 'openrouter' ? { provider: 'openrouter', id: ref.id, name: ref.id, in: 0, out: 0, vision: false } : null);
}

export function hasKey(provider) {
  return provider === 'anthropic' ? !!keys.anthropic : !!keys.openrouter;
}

/**
 * النموذج المستخدم لمهمة: 'build' (الصنع والتعديل) أو 'auto' (التطوير التلقائي).
 * المختار من الإعدادات إن كان مفتاحه موجودًا، وإلا كلود Opus 5.5 بمفتاح كلود، وإلا أفضل نموذج في OpenRouter.
 */
export function modelFor(task) {
  const saved = settings.get('model.' + task);
  if (saved && hasKey(saved.provider)) return findModel(saved);
  if (keys.anthropic) return CLAUDE_MODELS[0];
  if (keys.openrouter) return openRouterModels().find((m) => m.recommended) || openRouterModels()[0];
  return null;
}

export function setModelFor(task, m) {
  settings.set('model.' + task, m ? { provider: m.provider, id: m.id } : null);
}

export const TIERS = [
  { id: 'best', label: '⭐ الأقوى للتطوير' },
  { id: 'balanced', label: '⚖️ متوازن' },
  { id: 'cheap', label: '💰 اقتصادي' },
];

/** التكلفة بالدولار من عدد الرموز. */
export function costOf(m, u) {
  if (!m || !u) return 0;
  let pin = m.in || 0, pout = m.out || 0;
  // Haiku 5.5: سعر أعلى للطلبات فوق 100 ألف رمز
  const prompt = (u.input || 0) + (u.cacheWrite || 0) + (u.cacheRead || 0);
  if (m.id === 'claude-haiku-5-5' && prompt > 100000) { pin = 0.5; pout = 2.5; }
  const cr = m.cacheRead ?? pin * 0.1;
  return ((u.input || 0) * pin + (u.cacheWrite || 0) * pin * 1.25 + (u.cacheRead || 0) * cr + (u.output || 0) * pout) / 1e6;
}
