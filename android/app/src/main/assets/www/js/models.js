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
  const free = [];
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
    if (id.endsWith(':free')) { free.push(entry); continue; }
    const prev = picked.get(fam);
    if (!prev || entry.created > prev.created) picked.set(fam, entry);
  }
  const all = [...picked.values()].sort((a, b) => b.score - a.score);
  const tierOf = (m) => (m.out >= 8 ? 'best' : m.out >= 1.6 ? 'balanced' : 'cheap');
  for (const m of all) m.tier = tierOf(m);
  // أقوى نموذج متوسط السعر يصعد للفئة الأولى إن كانت فارغة
  if (!all.some((m) => m.tier === 'best') && all[0]) all[0].tier = 'best';
  if (all[0]) all[0].recommended = true;
  free.sort((a, b) => b.score - a.score);
  for (const m of free.slice(0, 3)) all.push({ ...m, tier: 'free', note: 'مجاني لكن بحدود طلبات منخفضة' });
  return all;
}

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
  if (list.length) settings.set(CACHE_KEY, { at: Date.now(), list });
  return list;
}

export function allModels() {
  return [...CLAUDE_MODELS, ...openRouterModels()];
}

export function findModel(ref) {
  if (!ref) return null;
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
  { id: 'free', label: '🆓 مجاني' },
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
