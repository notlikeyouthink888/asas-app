// محرك الاستوديو: التعليمات، قراءة ردود النموذج، تطبيق التعديلات على كود اللعبة،
// الاختبار التلقائي، ومراحل العمل الثلاث: صنع لعبة من وصف، تعديل بطلب، وتطوير تلقائي على جولات.

import { complete, StopError } from './llm.js';
import { addVersion, projects, settings } from './store.js';

/* ── التعليمات ──────────────────────────────────────────── */

const LIBS = `Allowed libraries (bundled in the app, work offline) - use exactly these tags, nothing else external:
- <script src="lib/phaser.min.js"></script>  Phaser 3.90 (global \`Phaser\`) for 2D games with scenes, arcade/matter physics, tweens, particles.
- <script src="lib/three.min.js"></script>  three.js r159 (global \`THREE\`, classic script, NOT an ES module) for 3D games.
For simple games prefer plain Canvas 2D with no library.`;

export const DEFAULT_RULES = `You are a senior HTML5 game developer and game designer. You build complete, polished, fun mobile games
that run inside an Android WebView, fully offline. The game owner describes what they want (usually in Arabic, often Iraqi dialect);
you design it and write all the code yourself.

TECHNICAL RULES
- The game is ONE self-contained HTML file: inline <style> and <script>. No ES module imports, no fetch/XHR, no external URLs,
  no external images, fonts or audio files.
- ${LIBS}
- Draw all art procedurally (canvas shapes, gradients, generated textures, particle effects; emoji are fine) and make all sound
  effects and music with the Web Audio API (create/resume ONE AudioContext on the first user gesture and reuse it).
- Mobile first: fill the whole viewport (100vw x 100vh), handle resize and orientation change, cap devicePixelRatio at 2,
  set touch-action:none and prevent scrolling, zooming and text selection. Provide on-screen touch controls (pointer events,
  multitouch, big targets >= 48px, placed for thumbs) and also support the keyboard.
- Required UX: a title/start screen, a clear goal, a HUD (score, lives/health, level), a pause button, win/game-over screens with
  restart, and rising difficulty or several levels. Save best score and progress with localStorage (it works here).
- Never use alert(), confirm() or prompt(). Don't open windows or navigate.
- Game loop with requestAnimationFrame and delta time (clamp dt to 0.05 s); pool objects when there are many; keep 55-60 fps on
  mid-range phones.
- Text shown to the player uses the owner's language. For Arabic use dir="rtl" on HTML text; canvas fillText renders Arabic correctly.
- Write clean, organised code ('use strict', named functions/classes, constants at the top). Keep it under ~2500 lines.

CORRECTNESS (the game must work the first time - test it in your head before answering)
- Every variable, function, class and method you use must be defined in the file with exactly that name. Re-read your code for
  typos, wrong argument order, missing semicolons in tricky places, and code that runs before the elements it needs exist.
- Start the game from one init function after the page loaded; check every element and API exists before using it.
- One bad frame must never stop the game loop: keep update/render free of exceptions, guard against NaN and empty arrays.
- Runtime errors, frame rate and a screenshot of each version are reported back to you automatically; fix every reported problem.

3D WITH three.js ON PHONES
- Use only three.js r159 core classes (global THREE). OrbitControls, GLTFLoader, EffectComposer and other examples/addons are
  NOT available - write simple equivalents yourself (camera follow, touch drag, etc).
- Create the renderer inside try/catch: new THREE.WebGLRenderer({ antialias: false, powerPreference: 'default' }). If it fails,
  draw a 2D fallback or show a clear message with a "retry" button in the player's language - never a blank screen.
- On renderer.domElement listen for 'webglcontextlost' (call event.preventDefault() and pause) and 'webglcontextrestored'
  (rebuild materials/renderer and resume).
- renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); shadows off, or one directional light shadow with a 1024 map;
  at most one hemisphere/ambient light + one directional light; low-poly geometry; reuse geometries and materials;
  InstancedMesh for many copies; dispose() what you remove. Prefer MeshLambertMaterial/MeshStandardMaterial.
- No custom GLSL unless essential (it must compile on mobile GPUs with precision mediump).
- On resize update camera.aspect, call camera.updateProjectionMatrix() and renderer.setSize(innerWidth, innerHeight).`;

const FORMAT = `RESPONSE FORMAT (the app parses this - always follow it; no markdown code fences anywhere):
<summary>1-2 short sentences for the owner, in their language, saying what you did.</summary>
<roadmap>Only when the roadmap changed: the FULL updated roadmap as a markdown checklist ("- [x] done", "- [ ] todo").</roadmap>
Then EITHER the complete file:
<file>
<!DOCTYPE html>
...
</file>
OR one or more targeted edits to the current file:
<edit>
<<<<<<< SEARCH
exact lines copied from the current file (enough context to be unique)
=======
the new lines
>>>>>>> REPLACE
</edit>
Use edits for focused changes and <file> for new games or large rewrites. SEARCH text must match the current file exactly,
character for character, and appear only once.`;

/**
 * التعليمات المرسلة للنموذج. صاحب اللعبة يختار من الإعدادات:
 * default = تعليماتنا، extra = تعليماتنا + إضافاته، custom = تعليماته هو فقط.
 * صيغة الرد تُضاف دائمًا لأن التطبيق يحتاجها ليقرأ الكود، ومعها مواصفات الجهاز.
 */
export function systemPrompt() {
  const mode = settings.get('prompt.mode', 'default');
  const extra = (settings.get('prompt.extra') || '').trim();
  const custom = (settings.get('prompt.custom') || '').trim();
  let rules = mode === 'custom' && custom ? custom : DEFAULT_RULES;
  if (mode === 'extra' && extra) rules += `\n\nEXTRA INSTRUCTIONS FROM THE OWNER (follow them; they win over the rules above):\n${extra}`;
  const device = settings.get('device');
  return `${rules}\n\n${FORMAT}${device ? `\n\nTHE OWNER'S PHONE (the game runs and is tested on it):\n${device}` : ''}`;
}

const PLAN_TASK = (desc, o, instructions) => `Design a mobile game.

${desc ? `Owner's description:\n"""\n${desc}\n"""` : 'The owner left the description empty: invent an original, polished, very fun mobile game that fits the preferences below. Surprise them.'}
Preferences: dimension=${o.dim || 'auto'}, orientation=${o.orientation || 'portrait'}, visual style=${o.style || 'auto'},
player-facing language=${o.lang || 'same as the description'}.
${instructions ? `Owner's special instructions for this game (follow them):\n${instructions}\n` : ''}
Reply in ${desc ? "the owner's language" : (o.lang === 'English' ? 'English' : 'Arabic')} with exactly:
<name>short catchy game title</name>
<design>
A compact game design document in markdown: concept and goal, core loop, controls (touch and keyboard), player, enemies/obstacles,
levels and progression, scoring, visual style and palette, sounds/music, screens (title, HUD, pause, win, game over).
Choose the best tech: Canvas 2D, Phaser, or three.js, and say which.
</design>
<roadmap>
8 to 14 checklist items "- [ ] ...", ordered from the core playable loop to polish and extra content.
</roadmap>`;

const BUILD_TASK = `Build version 1 of this game now as a complete <file>. Implement the first roadmap items (the core loop and
everything needed for a fun, complete, polished first playable: start screen, controls, HUD, win/lose, sounds) and mark them
[x] in an updated <roadmap>.`;

const AUTO_TASK = (round, total, focus, history) => `AUTO-DEVELOPMENT round ${round} of ${total}. You are improving this game on your own.
${focus ? `The owner asked to focus on: ${focus}\n` : ''}${history ? `Previous rounds:\n${history}\n` : ''}
Steps:
1. If the test report shows errors, a stopped game loop, a blank screen or broken layout, fix that first.
2. Then implement the next 1-3 most valuable unchecked roadmap items (or, when the roadmap is done, the best new improvement
   for the focus areas: add it to the roadmap first). Make each change complete and polished, not a stub.
3. Keep everything that already works working. Prefer targeted edits.
Return <summary>, the updated <roadmap>, and your edits or the full file.`;

const FIX_TASK = `The current file fails its automatic test (report below). Find the real cause of every error and fix it so the game
starts and runs correctly. If an error is caused by the environment (for example WebGL could not be created or was lost), make the
game handle it gracefully instead. Change only what is needed. Return <summary> and edits (or the full file).`;

/* ── قراءة الرد وتطبيق التعديلات ────────────────────────── */

function tag(text, name) {
  const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function unfence(s) {
  return s.replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/i, '');
}

export function parseReply(text) {
  const out = { summary: tag(text, 'summary'), roadmap: tag(text, 'roadmap'), name: tag(text, 'name'), design: tag(text, 'design'), file: null, edits: [], truncated: false };
  const f = text.match(/<file>\s*([\s\S]*?)\s*<\/file>/i);
  if (f) out.file = unfence(f[1]).trim();
  else if (/<file>/i.test(text)) out.truncated = true;
  const re = /<{5,9} ?SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[^\n]*\n([\s\S]*?)\n?>{5,9} ?REPLACE/g;
  let m;
  while ((m = re.exec(text))) out.edits.push({ search: m[1], replace: m[2] });
  // نموذج نسي الوسوم وكتب الملف مباشرة
  if (!out.file && !out.edits.length && !out.truncated) {
    const start = text.search(/<!DOCTYPE html|<html[\s>]/i);
    const end = text.lastIndexOf('</html>');
    if (start >= 0 && end > start) out.file = text.slice(start, end + 7);
  }
  return out;
}

function applyOne(code, search, replace) {
  if (!search.trim()) return null;
  const i = code.indexOf(search);
  if (i >= 0) return code.indexOf(search, i + 1) < 0 ? code.slice(0, i) + replace + code.slice(i + search.length) : null;
  // مطابقة سطرية تتجاهل المسافات في أطراف الأسطر (النماذج تخطئ أحيانًا في الإزاحة)
  const lines = code.split('\n');
  const trimmed = lines.map((l) => l.trim());
  const s = search.split('\n').map((l) => l.trim());
  while (s.length && !s[0]) s.shift();
  while (s.length && !s[s.length - 1]) s.pop();
  if (!s.length) return null;
  let at = -1, count = 0;
  for (let a = 0; a + s.length <= trimmed.length; a++) {
    let ok = true;
    for (let b = 0; b < s.length; b++) if (trimmed[a + b] !== s[b]) { ok = false; break; }
    if (ok) { if (at < 0) at = a; count++; }
  }
  if (count !== 1) return null;
  return [...lines.slice(0, at), replace, ...lines.slice(at + s.length)].join('\n');
}

export function applyEdits(code, edits) {
  let out = code;
  const failed = [];
  for (const e of edits) {
    const r = applyOne(out, e.search, e.replace);
    if (r == null) failed.push(e); else out = r;
  }
  return { code: out, failed };
}

export function looksLikeGame(code) {
  return typeof code === 'string' && code.length > 300 && /<script|<canvas/i.test(code);
}

/* ── تشغيل اللعبة داخل iframe ───────────────────────────── */

let probeSrc = '';
export async function loadProbe() {
  if (probeSrc) return;
  const raw = await (await fetch('js/probe.js')).text();
  // سطر واحد حتى تبقى أرقام أسطر أخطاء اللعبة مطابقة لكودها
  probeSrc = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, ' ');
}

const BASE = new URL('./', location.href).href;
const CDN = {
  'lib/phaser.min.js': 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js',
  'lib/three.min.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js',
};

/** اللعبة كما تعمل داخل التطبيق: مع المكتبات المحلية والمِجس. */
export function buildDoc(code, cfg = {}) {
  const inject = `<base href="${BASE}"><script>window.__GS_CFG__=${JSON.stringify(cfg).replace(/</g, '\\u003c')};${probeSrc}</script>`;
  // دالة بدل نص الاستبدال: بيانات الحفظ قد تحتوي $& أو $' فتفسد اللعبة
  const head = code.match(/<head[^>]*>/i);
  if (head) return code.replace(head[0], () => head[0] + inject);
  const html = code.match(/<html[^>]*>/i);
  if (html) return code.replace(html[0], () => html[0] + '<head>' + inject + '</head>');
  return inject + code;
}

/** نسخة مستقلة للمشاركة: تعمل بأي متصفح (المكتبات من الإنترنت). */
export function exportDoc(code) {
  let out = code;
  for (const [local, cdn] of Object.entries(CDN)) out = out.split(`src="${local}"`).join(`src="${cdn}"`);
  return out;
}

/** أخطاء الصياغة في سكربتات اللعبة دون تشغيلها (تعمل حتى والتطبيق بالخلفية). */
export function syntaxErrors(code) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(code))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs) || /type\s*=\s*["']?(?!text\/javascript|application\/javascript)[\w/-]+/i.test(attrs)) continue;
    try {
      // eslint-disable-next-line no-new-func
      new Function(m[2]);
    } catch (e) {
      if (e instanceof SyntaxError) {
        const line = code.slice(0, m.index).split('\n').length;
        out.push({ kind: 'syntax', msg: `SyntaxError: ${e.message} (inside the <script> that starts at line ${line})`, line: 0, col: 0, count: 1, t: 0 });
      }
    }
  }
  return out;
}

/** يحول تقرير الاختبار إلى نص يفهمه النموذج، مع مقطع الكود حول كل خطأ. */
export function describeReport(r, code) {
  if (!r) return 'No test report available.';
  const lines = code.split('\n');
  const out = [];
  if (r.hidden) out.push('- NOTE: the app was in the background during this test, so the game could not render: only the static syntax check ran. Frame count and screenshot are not meaningful.');
  if (r.timeout) out.push('- The page did not respond to the test probe (it may be frozen in an infinite loop).');
  out.push(`- Runtime errors: ${r.errors.length}`);
  r.errors.slice(0, 8).forEach((e, i) => {
    out.push(`  ${i + 1}. [${e.kind}] ${e.msg}${e.line ? ` (line ${e.line}:${e.col})` : ''}${e.count > 1 ? ` x${e.count}` : ''} at ${e.t}ms`);
    if (e.line && lines[e.line - 1] !== undefined) {
      for (let n = Math.max(1, e.line - 2); n <= Math.min(lines.length, e.line + 2); n++) {
        out.push(`     ${n === e.line ? '>' : ' '}${n}| ${lines[n - 1].slice(0, 160)}`);
      }
    } else if (e.stack) out.push('     ' + e.stack.split('\n').slice(0, 3).join(' | '));
  });
  if (r.errors.some((e) => e.kind === 'webgl')) {
    out.push('  (WebGL errors can come from the phone limiting GPU contexts: the game must recover - retry creating the renderer, handle context loss, or fall back - not crash or show a blank screen.)');
  }
  if (!r.hidden) {
    const secs = (r.uptime || 1) / 1000;
    const fps = r.frames / secs;
    out.push(r.frames > 0
      ? `- requestAnimationFrame loop: running, about ${Math.round(fps)} fps over ${secs.toFixed(1)}s`
      : '- requestAnimationFrame loop: NO frames (if the game uses rAF, its loop never started or stopped)');
    if (r.canvases?.length) {
      out.push('- Canvases: ' + r.canvases.map((c) => `${c.type || '?'} ${c.w}x${c.h} shown ${c.cw}x${c.ch}${c.blank ? ' (BLANK, single color)' : ''}`).join('; '));
    } else out.push('- No <canvas> on the page.');
    out.push(`- Viewport ${r.vw}x${r.vh}, page scroll size ${r.scrollW}x${r.scrollH}${r.scrollH > r.vh + 4 || r.scrollW > r.vw + 4 ? ' (OVERFLOWS the screen)' : ''}`);
    out.push(`- Buttons: ${r.buttons}. Visible text: "${r.text || ''}"`);
    out.push('- Simulated input during the test: taps at center and bottom corners, Enter, Space, arrows.');
  }
  out.push(`- Screenshot: ${r.shot ? 'attached (taken after the simulated input)' : 'not available'}`);
  return out.join('\n');
}

/** هل اللعبة معطلة فعلًا؟ (تحذيرات console وفشل تحميل ملف لا تكفي وحدها) */
export function isBroken(r) {
  if (!r) return false;
  const serious = r.errors.filter((e) => e.kind !== 'console' && e.kind !== 'resource' && !(r.hidden && e.kind === 'webgl'));
  return (!r.hidden && r.timeout) || serious.length > 0 || r.errors.length >= 3;
}

/** تشغيل الاختبار مع فحص الصياغة الثابت (يفيد عندما لا تُشغَّل اللعبة لأن التطبيق بالخلفية). */
async function runTest(ctx, code, opts) {
  const report = await ctx.runner.test(code, opts);
  if (!report.errors.some((e) => /SyntaxError/.test(e.msg))) report.errors = [...syntaxErrors(code), ...report.errors];
  return report;
}

/* ── مراحل العمل ────────────────────────────────────────── */

/**
 * ctx: { model, runner, effort, budget, signal, ui }
 * ui: { phase(text), text(delta), thinking(delta), spent(total), log(text), retry(n, max, why) }
 * runner: { test(code, {capture}) → report }
 */
async function call(ctx, project, parts, label, { effort } = {}) {
  if (ctx.signal?.aborted) throw new StopError();
  if (ctx.budget && ctx.spent >= ctx.budget) throw Object.assign(new Error(`وصلت حد الصرف لهذه العملية (${ctx.budget}$).`), { budget: true });
  ctx.ui.phase?.(label);
  const r = await complete({
    model: ctx.model, system: systemPrompt(), parts, effort: effort || ctx.effort, signal: ctx.signal,
    onText: ctx.ui.text, onThinking: ctx.ui.thinking,
    onRetry: (n, max, why) => { ctx.ui.retry?.(n, max, why); ctx.ui.phase?.(`${label} (إعادة الاتصال ${n}/${max})`); },
  });
  ctx.spent = (ctx.spent || 0) + r.cost;
  project.spent = (project.spent || 0) + r.cost;
  project.tokens = (project.tokens || 0) + r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheWrite;
  ctx.ui.spent?.(ctx.spent, project.spent);
  return r;
}

function cutOff(text, stop) {
  if (/<file>/i.test(text) && !/<\/file>/i.test(text)) return true;
  return stop === 'max_tokens';
}

/** يصل نهاية الرد المقطوع ببداية التكملة دون تكرار الجزء المشترك. */
export function joinContinuation(a, b) {
  b = b.replace(/^\s*```[a-z]*\s*\n/i, '');
  // النموذج أعاد كتابة الملف كاملًا بدل التكملة
  if (/<file>[\s\S]*<\/file>/i.test(b)) return b;
  for (let n = Math.min(600, a.length, b.length); n >= 12; n--) {
    if (a.endsWith(b.slice(0, n))) return a + b.slice(n);
  }
  return a + b;
}

/** طلب قد يكون رده طويلًا جدًا: إن انقطع عند حد الإخراج يُطلب إكماله (حتى 3 مرات) بدل البدء من الصفر. */
async function callLong(ctx, project, parts, label, opts) {
  let r = await call(ctx, project, parts, label, opts);
  let text = r.text;
  for (let k = 1; k <= 3 && cutOff(text, r.stop); k++) {
    ctx.ui.log?.(`✂️ الرد طويل وانقطع، أطلب تكملته (${k})`);
    r = await call(ctx, project, [...parts, {
      text: `YOUR PREVIOUS REPLY WAS CUT OFF by the output length limit. It ended with:\n<cut_tail>\n${text.slice(-2500)}\n</cut_tail>\n`
        + 'Continue EXACTLY from the character where it stopped. Do not repeat anything, do not restart, no preface: output only the '
        + 'remaining text and finish with the closing tags.',
    }], `${label} (تكملة ${k})`, opts);
    text = joinContinuation(text, r.text);
  }
  return { ...r, text };
}

function context(project, code) {
  return `GAME DESIGN:\n${project.design || '(none yet - infer it from the code)'}\n\nROADMAP:\n${project.roadmap || '(none yet)'}\n\n`
    + (project.instructions ? `OWNER'S SPECIAL INSTRUCTIONS FOR THIS GAME (always follow):\n${project.instructions}\n\n` : '')
    + `CURRENT FILE (${code.split('\n').length} lines):\n<current_file>\n${code}\n</current_file>`;
}

/** يطلب تغييرًا ويطبقه، مع إعادة محاولة واحدة إن لم تنطبق بعض التعديلات. */
async function change(ctx, project, code, task, { report, shot, label }) {
  const parts = [{ text: context(project, code), cache: true }];
  if (shot && ctx.model.vision) parts.push({ image: shot });
  parts.push({ text: (report ? `TEST REPORT OF THE CURRENT FILE:\n${report}\n\n` : '') + 'TASK:\n' + task });
  let r = await callLong(ctx, project, parts, label);
  let p = parseReply(r.text);
  let next = code;
  if (p.file) next = p.file;
  else if (p.edits.length) {
    const a = applyEdits(code, p.edits);
    next = a.code;
    if (a.failed.length) {
      const failedText = a.failed.map((e) => '<<<<<<< SEARCH\n' + e.search.slice(0, 1200) + '\n=======').join('\n\n');
      const retry = [{ text: context(project, next), cache: true }, {
        text: `TASK:\n${task}\n\nYou already sent edits; the ones below did NOT apply because their SEARCH text was not found exactly once in `
          + `the current file (the other edits were applied and are in the file above). Re-send only these changes with SEARCH text `
          + `copied exactly from the current file, or send the complete <file>.\n\n${failedText}`,
      }];
      r = await callLong(ctx, project, retry, 'إعادة محاولة تطبيق التعديلات');
      const p2 = parseReply(r.text);
      if (p2.file) next = p2.file;
      else {
        const b = applyEdits(next, p2.edits);
        if (b.failed.length) throw new Error('تعذر تطبيق تعديلات النموذج على الكود.');
        next = b.code;
      }
      p = { ...p, summary: p2.summary || p.summary, roadmap: p2.roadmap || p.roadmap };
    }
  } else {
    throw new Error('النموذج لم يرجع كودًا. ' + (p.summary || r.text.slice(0, 200)));
  }
  if (!looksLikeGame(next)) throw new Error('الكود الناتج لا يبدو لعبة صالحة.');
  return { code: next, summary: p.summary, roadmap: p.roadmap };
}

/**
 * يختبر الكود ويصلحه حتى maxFixes مرات. لا يرمي أبدًا بسبب فشل الإصلاح نفسه:
 * يرجع أفضل كود وصل له حتى لا يضيع عمل طويل (فقط الإيقاف أو الحد المالي أو انقطاع النت الدائم يوقفه).
 */
async function testAndFix(ctx, project, code, { maxFixes = 2, capture = false } = {}) {
  ctx.ui.phase?.('اختبار اللعبة…');
  let report = await runTest(ctx, code, { capture });
  let fixes = 0;
  while (isBroken(report) && fixes < maxFixes) {
    fixes++;
    ctx.ui.log?.(`🔧 الاختبار لگى ${report.errors.length} مشكلة، إصلاح ${fixes}/${maxFixes}`);
    let r;
    try {
      r = await change(ctx, project, code, FIX_TASK, { report: describeReport(report, code), shot: report.shot, label: `إصلاح الأخطاء (${fixes}/${maxFixes})` });
    } catch (e) {
      if (e.stop || e.budget || e.network) throw e;
      ctx.ui.log?.('⚠️ محاولة الإصلاح ما نجحت: ' + e.message);
      continue;
    }
    if (r.roadmap) project.roadmap = r.roadmap;
    ctx.ui.phase?.('اختبار بعد الإصلاح…');
    const next = await runTest(ctx, r.code, { capture });
    // لا نقبل إصلاحًا يزيد الأخطاء
    if (!isBroken(next) || next.errors.length <= report.errors.length) { code = r.code; report = next; }
  }
  return { code, report, fixes };
}

/**
 * 1) صنع لعبة من وصف (أو بلا وصف): خطة ← بناء ← اختبار وإصلاح.
 * كل مرحلة تنحفظ فورًا، فإن انقطع شيء يكمل من حيث توقف بدل البدء من جديد.
 */
export async function createGame(ctx, project) {
  if (!project.design) {
    const plan = await call(ctx, project, [{ text: PLAN_TASK(project.description, project.options || {}, project.instructions) }], 'تصميم اللعبة وكتابة الخطة…', { effort: 'medium' });
    const p = parseReply(plan.text);
    project.name = p.name || project.name;
    project.design = p.design || plan.text.slice(0, 4000);
    project.roadmap = p.roadmap || '';
    await projects.put(project);
    ctx.ui.version?.(project);
    ctx.ui.log?.('📝 الخطة جاهزة: ' + project.name);
  } else ctx.ui.log?.('📝 الخطة محفوظة من قبل، أكمل منها');

  if (!project.draft?.code) {
    const parts = [{ text: `GAME DESIGN:\n${project.design}\n\nROADMAP:\n${project.roadmap}\n\n`
      + (project.instructions ? `OWNER'S SPECIAL INSTRUCTIONS FOR THIS GAME (always follow):\n${project.instructions}\n\n` : '')
      + `TASK:\n${BUILD_TASK}` }];
    const built = await callLong(ctx, project, parts, 'كتابة كود اللعبة…');
    const b = parseReply(built.text);
    if (!b.file || !looksLikeGame(b.file)) throw new Error('النموذج لم يكتب ملف اللعبة كاملًا. اضغط «أكمل» ليحاول مرة ثانية.');
    if (b.roadmap) project.roadmap = b.roadmap;
    project.draft = { code: b.file, summary: b.summary };
    await projects.put(project);
    ctx.ui.log?.(`💾 انكتب الكود (${b.file.split('\n').length} سطر)، الآن الاختبار`);
  } else ctx.ui.log?.('💾 الكود محفوظ من المحاولة السابقة، أكمل من الاختبار');

  const t = await testAndFix(ctx, project, project.draft.code, { capture: true, maxFixes: 3 });
  addVersion(project, t.code, project.draft.summary || 'الإصدار الأول', ctx.spent);
  delete project.draft;
  project.lastReport = slim(t.report);
  project.status = 'ready';
  await projects.put(project);
  return t;
}

/** 2) تعديل بطلب من صاحب اللعبة. */
export async function improveGame(ctx, project, request) {
  const before = await runTest(ctx, project.code, { capture: true });
  const r = await change(ctx, project, project.code, `The owner asks: """${request}"""\nImplement it fully and keep everything else working.`, {
    report: describeReport(before, project.code), shot: before.shot, label: 'تنفيذ طلبك…',
  });
  if (r.roadmap) project.roadmap = r.roadmap;
  const t = await testAndFix(ctx, project, r.code, { maxFixes: 3 });
  if (isBroken(t.report) && !isBroken(before)) {
    throw new Error('التعديل كسر اللعبة ولم ينجح إصلاحه، فبقيت النسخة السابقة كما هي. جرّب صياغة أخرى.');
  }
  addVersion(project, t.code, r.summary || request.slice(0, 80), ctx.spent);
  project.lastReport = slim(t.report);
  await projects.put(project);
  return { ...t, summary: r.summary };
}

/** إصلاح أخطاء ظهرت أثناء اللعب (يُستدعى تلقائيًا). */
export async function fixGame(ctx, project, errors) {
  const report = { errors, frames: 1, uptime: 1000, canvases: [], text: '', buttons: 0, vw: 0, vh: 0, scrollW: 0, scrollH: 0 };
  const r = await change(ctx, project, project.code, FIX_TASK + '\nThese errors appeared while the owner was playing.', {
    report: describeReport(report, project.code), label: 'إصلاح أخطاء ظهرت أثناء اللعب…',
  });
  const t = await testAndFix(ctx, project, r.code, { maxFixes: 2 });
  if (isBroken(t.report) && t.report.errors.length >= errors.length) throw new Error('ما گدرت أصلح الأخطاء تلقائيًا هالمرة. جرّب «اطلب إصلاحها» أو التطوير التلقائي.');
  addVersion(project, t.code, '🔧 ' + (r.summary || 'إصلاح تلقائي لأخطاء أثناء اللعب'), ctx.spent);
  project.lastReport = slim(t.report);
  await projects.put(project);
  return { ...t, summary: r.summary };
}

/** 3) التطوير التلقائي: جولات متتالية، كل جولة تختبر وتطور وتحفظ إصدارًا (أو تتراجع إن انكسرت اللعبة). */
export async function autoDevelop(ctx, project, { rounds, focus }) {
  const history = [];
  for (let i = 1; i <= rounds; i++) {
    if (ctx.signal?.aborted) break;
    ctx.ui.round?.(i, rounds);
    const before = await runTest(ctx, project.code, { capture: true });
    let r;
    try {
      r = await change(ctx, project, project.code, AUTO_TASK(i, rounds, focus, history.slice(-6).join('\n')), {
        report: describeReport(before, project.code), shot: before.shot, label: `الجولة ${i}/${rounds}: تطوير…`,
      });
    } catch (e) {
      if (e.stop || e.budget || e.network) throw e;
      ctx.ui.log?.(`⚠️ الجولة ${i}: ${e.message}`);
      history.push(`- round ${i}: failed (${e.message})`);
      continue;
    }
    const t = await testAndFix(ctx, project, r.code);
    if (isBroken(t.report) && !isBroken(before)) {
      ctx.ui.log?.(`↩️ الجولة ${i}: التغيير كسر اللعبة، تراجعت عنه.`);
      history.push(`- round ${i}: attempted "${r.summary || ''}" but it broke the game and was reverted; try a different approach`);
      continue;
    }
    if (r.roadmap) project.roadmap = r.roadmap;
    const n = addVersion(project, t.code, `🤖 ${r.summary || 'تطوير تلقائي'}`, ctx.spent);
    project.lastReport = slim(t.report);
    await projects.put(project);
    history.push(`- round ${i}: ${r.summary || 'improved the game'}`);
    ctx.ui.log?.(`✅ الجولة ${i} ← الإصدار ${n}: ${r.summary || ''}`);
    ctx.ui.version?.(project);
  }
}

function slim(r) {
  if (!r) return null;
  const { shot, ...rest } = r;
  return rest;
}
