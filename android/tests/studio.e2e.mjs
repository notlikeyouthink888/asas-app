// اختبار شامل لواجهة الاستوديو في Chromium مع ردود وهمية من Claude وOpenRouter (بلا مفاتيح حقيقية وبلا صرف).
// التشغيل: node android/tests/studio.e2e.mjs   (يحتاج playwright)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const WWW = join(here, '../app/src/main/assets/www');
const OUT = process.env.SHOTS || join(here, 'shots');
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const body = await readFile(join(WWW, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

/* ── ردود وهمية ── */

const GAME_V1 = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title>
<style>html,body{margin:0;height:100%;background:#123}canvas{display:block}</style>
<script src="lib/phaser.min.js"></script></head><body><canvas id="c"></canvas><script>
'use strict';
if (typeof Phaser === 'undefined') throw new Error('phaser missing');
const c = document.getElementById('c'), x = c.getContext('2d');
function resize() { c.width = innerWidth; c.height = innerHeight; }
resize(); addEventListener('resize', resize);
let t = 0, best = +localStorage.getItem('best') || 0;
function loop() {
  t++;
  x.fillStyle = '#234'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fc3'; x.beginPath(); x.arc(c.width / 2 + Math.sin(t / 20) * 80, c.height / 2, 30, 0, 7); x.fill();
  updateEnemies();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script></body></html>`;

const calls = [];
function claudeReply(body) {
  const user = JSON.stringify(body.messages);
  if (user.includes('Design a mobile game')) {
    return `<name>نجمة الفضاء</name><design>## الفكرة\nكرة ذهبية تتحرك.\n- اللعب باللمس</design><roadmap>- [ ] حلقة اللعب\n- [ ] أعداء\n- [ ] نقاط</roadmap>`;
  }
  if (user.includes('Build version 1')) {
    return `<summary>بنيت الإصدار الأول.</summary><roadmap>- [x] حلقة اللعب\n- [ ] أعداء\n- [ ] نقاط</roadmap><file>\n${GAME_V1}\n</file>`;
  }
  if (user.includes('fails its automatic test')) {
    return `<summary>صلحت دالة الأعداء.</summary><edit>\n<<<<<<< SEARCH\n  updateEnemies();\n=======\n  /* enemies later */\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('did NOT apply')) {
    return `<summary>أضفت النقاط.</summary><edit>\n<<<<<<< SEARCH\nlet t = 0, best = +localStorage.getItem('best') || 0;\n=======\nlet t = 0, best = +localStorage.getItem('best') || 0; /* score */\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('The owner asks')) {
    // الأول بمسافات خاطئة عمدًا (المطابقة المرنة تنجح)، والثاني غير موجود (يُطلب تصحيحه مرة ثانية)
    return `<summary>أضفت النقاط.</summary><edit>\n<<<<<<< SEARCH\n      t++;\n=======\n  t++; localStorage.setItem('best', String(Math.max(best, t)));\n>>>>>>> REPLACE\n</edit><edit>\n<<<<<<< SEARCH\nlet t = 1;\n=======\nlet t = 0;\n>>>>>>> REPLACE\n</edit>`;
  }
  return '<summary>لا شيء</summary>';
}

function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

function claudeStream(text) {
  const chunks = text.match(/[\s\S]{1,80}/g) || [''];
  return sse([
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 800, cache_creation_input_tokens: 400 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'أفكر بتصميم ممتع…' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ...chunks.map((c) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: c } })),
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3000 } },
    { type: 'message_stop' },
  ]);
}

const OR_MODELS = { data: [
  { id: 'anthropic/claude-opus-4.8', name: 'Anthropic: Claude Opus 4.8', created: Date.now() / 1000 - 86400 * 30, context_length: 1000000,
    pricing: { prompt: '0.000005', completion: '0.000025' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'anthropic/claude-opus-4.1', name: 'Anthropic: Claude Opus 4.1', created: Date.now() / 1000 - 86400 * 400, context_length: 200000,
    pricing: { prompt: '0.000015', completion: '0.000075' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'qwen/qwen3-coder-plus', name: 'Qwen: Qwen3 Coder Plus', created: Date.now() / 1000 - 86400 * 60, context_length: 262144,
    pricing: { prompt: '0.000001', completion: '0.000005' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek: V3.2', created: Date.now() / 1000 - 86400 * 20, context_length: 163840,
    pricing: { prompt: '0.00000027', completion: '0.0000011' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'google/gemini-3-pro-image', name: 'image model', created: Date.now() / 1000, context_length: 1000000,
    pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: { input_modalities: ['text'], output_modalities: ['image', 'text'] } },
  { id: 'some/tiny-model', name: 'tiny', created: Date.now() / 1000, context_length: 8000, pricing: { prompt: '0', completion: '0' }, architecture: {} },
] };

function orStream(text) {
  const chunks = text.match(/[\s\S]{1,60}/g);
  const lines = chunks.map((c) => `data: ${JSON.stringify({ model: 'qwen/qwen3-coder-plus', choices: [{ delta: { content: c } }] })}\n\n`);
  lines.unshift(': OPENROUTER PROCESSING\n\n');
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5000, completion_tokens: 400, cost: 0.0123 } })}\n\n`, 'data: [DONE]\n\n');
  return lines.join('');
}

/* ── التشغيل ── */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fulfill({ json: { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }], has_more: false, first_id: 'a', last_id: 'b' } });
  const body = req.postDataJSON();
  calls.push({ provider: 'anthropic', headers: req.headers(), body });
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: claudeStream(claudeReply(body)) });
});
await page.route('https://openrouter.ai/**', async (route) => {
  const url = route.request().url();
  if (url.endsWith('/models')) return route.fulfill({ json: OR_MODELS });
  if (url.endsWith('/credits')) return route.fulfill({ json: { data: { total_credits: 10, total_usage: 2.5 } } });
  const body = route.request().postDataJSON();
  calls.push({ provider: 'openrouter', body });
  const text = `<summary>غيرت اللون (جولة تلقائية).</summary><roadmap>- [x] حلقة اللعب\n- [x] أعداء\n- [ ] نقاط</roadmap><edit>\n<<<<<<< SEARCH\n  x.fillStyle = '#234'; x.fillRect(0, 0, c.width, c.height);\n=======\n  x.fillStyle = '#315'; x.fillRect(0, 0, c.width, c.height);\n>>>>>>> REPLACE\n</edit>`;
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: orStream(text) });
});

const readProject = () => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('gamestudio'); q.onsuccess = () => r(q.result); });
  return new Promise((r) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => r(q.result[0]); });
});
const check = (cond, msg) => { if (!cond) { console.error('❌ ' + msg); failures++; } else console.log('✅ ' + msg); };
let failures = 0;

await page.goto(base + 'index.html');
await page.waitForSelector('#new');
await page.screenshot({ path: join(OUT, '1-home.png') });

// الإعدادات: المفتاحان
await page.click('#set');
await page.fill('#kan', 'sk-ant-test-key');
await page.click('[data-save="kan"]');
await page.fill('#kor', 'sk-or-test-key');
await page.click('[data-save="kor"]');
await page.click('[data-test="kor"]');
await page.waitForFunction(() => document.querySelector('#kor-st').textContent.includes('$'));
check((await page.textContent('#kor-st')).includes('$7.50'), 'رصيد OpenRouter يظهر ($7.50)');
await page.click('[data-test="kan"]');
await page.waitForFunction(() => document.querySelector('#kan-st').textContent.includes('✅'));
await page.click('#refresh');
await page.waitForFunction(() => document.querySelector('#refst').textContent.includes('✅'));
const ranked = await page.evaluate(() => JSON.parse(localStorage.getItem('gs.models.openrouter')).list.map((m) => `${m.id}:${m.tier}`));
check(ranked.length === 3 && ranked[0].startsWith('anthropic/claude-opus-4.8') && !ranked.some((r) => r.includes('4.1') || r.includes('image') || r.includes('tiny')),
  'فرز OpenRouter: أحدث Opus أولًا، واستبعاد القديم والصور والسياق القصير → ' + ranked.join(', '));
await page.screenshot({ path: join(OUT, '2-settings.png'), fullPage: true });

// اختيار نموذج OpenRouter للتطوير التلقائي
await page.click('#pa');
await page.waitForSelector('.sheet .opt');
await page.screenshot({ path: join(OUT, '3-models.png') });
await page.click('.sheet .opt[data-id="qwen/qwen3-coder-plus"]');

// لعبة جديدة
await page.click('#back');
await page.click('#new');
await page.fill('#desc', 'لعبة كرة ذهبية تتحرك وتتجنب الأعداء وتجمع نقاط');
await page.click('[data-seg="orientation"] [data-v="landscape"]');
await page.screenshot({ path: join(OUT, '4-new.png'), fullPage: true });
await page.click('#make');
await page.waitForSelector('#busy:not([hidden])');
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, '5-building.png') });
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('جرّبها'), null, { timeout: 90000 });
await page.screenshot({ path: join(OUT, '6-built.png') });

let state = await readProject();
check(state.name === 'نجمة الفضاء', 'اسم اللعبة من الخطة');
check(state.versions.length === 1 && !state.code.includes('updateEnemies();') && state.code.includes('enemies later'), 'الإصدار الأول بعد إصلاح الخطأ تلقائيًا');
check(state.roadmap.includes('- [x] حلقة اللعب'), 'الخطة محدثة');
check(state.spent > 0, 'حساب التكلفة: ' + state.spent.toFixed(4));

const first = calls.find((c) => c.provider === 'anthropic');
check(first.headers['x-api-key'] === 'sk-ant-test-key', 'مفتاح كلود يُرسل');
check(first.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'رأس الاتصال من التطبيق');
check((first.headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01') && first.body.fallbacks === 'default', 'البديل التلقائي عند الرفض');
check(first.body.model === 'claude-opus-5-5' && first.body.thinking?.type === 'adaptive' && first.body.output_config?.effort === 'high', 'Opus 5.5 + تفكير تكيفي + عمق عالي');
check(first.body.system[0].cache_control?.type === 'ephemeral', 'التعليمات محفوظة مؤقتًا (caching)');
const fixCall = calls.find((c) => JSON.stringify(c.body.messages).includes('fails its automatic test'));
const fixText = JSON.stringify(fixCall.body.messages);
check(fixText.includes('updateEnemies is not defined') && fixText.includes('updateEnemies();'), 'تقرير الخطأ مع مقطع الكود يصل للنموذج');

// المعاينة تعمل بلا أخطاء
await page.click('#run');
await page.waitForTimeout(1500);
check(await page.isHidden('#errs'), 'اللعبة تعمل بلا أخطاء بعد الإصلاح');

// طلب تعديل (مع مطابقة مرنة للمسافات)
await page.fill('#req', 'ضيف نقاط');
await page.click('#send');
await page.waitForSelector('#busy:not([hidden])');
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('أضفت النقاط'), null, { timeout: 60000 });
state = await readProject();
check(state.versions.length === 2 && state.code.includes("localStorage.setItem('best'") && state.code.includes('/* score */'),
  'طلب التعديل طُبق كإصدار 2 (مطابقة مرنة + إعادة محاولة للتعديل الفاشل)');

// التطوير التلقائي بجولتين عبر OpenRouter
await page.$eval('#rounds', (el) => { el.value = '2'; el.dispatchEvent(new Event('input')); });
await page.click('#auto');
await page.waitForSelector('#busy:not([hidden])');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, '7-auto.png') });
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('خلص التطوير'), null, { timeout: 90000 });
// اللعبة تُحمَّل (Phaser بطيء في Chromium بلا GPU) ثم تحفظ أفضل نتيجة؛ ننتظر وصولها لقاعدة التطبيق
for (let i = 0; i < 40; i++) {
  state = await readProject();
  if (state.storage?.best) break;
  await page.waitForTimeout(500);
}
const orCalls = calls.filter((c) => c.provider === 'openrouter');
check(orCalls.length >= 2 && orCalls[0].body.models?.includes('openrouter/auto') && orCalls[0].body.stream, 'التطوير التلقائي يستخدم OpenRouter بالبث مع بديل تلقائي');
check(state.code.includes("'#315'") && state.versions.length >= 3, 'جولة التطوير التلقائي حفظت إصدارًا جديدًا');
check(state.storage && state.storage.best, 'حفظ اللعبة (localStorage) يصل للتطبيق: best=' + state.storage?.best);

// الخطة والإصدارات
await page.click('[data-tab="plan"]');
await page.screenshot({ path: join(OUT, '8-plan.png'), fullPage: true });
await page.click('[data-tab="versions"]');
await page.screenshot({ path: join(OUT, '9-versions.png'), fullPage: true });
await page.click('#fs');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, '10-play.png') });

// خطأ updateEnemies مقصود في الإصدار الأول الوهمي (من داخل اللعبة لا الواجهة)
const pageErrors = logs.filter((l) => l.startsWith('[pageerror]') && !l.includes('updateEnemies'));
check(!pageErrors.length, 'لا أخطاء في واجهة التطبيق' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
if (failures) console.log(logs.slice(-30).join('\n'));
await browser.close();
server.close();
console.log(failures ? `\n${failures} فشل` : '\nكل الفحوص نجحت');
process.exit(failures ? 1 : 0);
