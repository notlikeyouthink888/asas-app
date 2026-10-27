// أدوات صغيرة مشتركة للواجهة

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function money(v) {
  if (!v) return '$0';
  return v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(v < 1 ? 3 : 2);
}

export function tokens(n) {
  if (!n) return '0';
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
}

export function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'الآن';
  if (s < 3600) return `قبل ${Math.floor(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`;
  return new Date(t).toLocaleDateString('ar');
}

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** نافذة تأكيد بدل confirm() (لا تعمل جيدًا داخل WebView). */
export function ask(message, { ok = 'نعم', cancel = 'إلغاء', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="sheet small"><p>${esc(message)}</p>
      <div class="row end"><button class="btn ghost" data-v="0">${esc(cancel)}</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(ok)}</button></div></div>`;
    const done = (v) => { wrap.remove(); modalStack.pop(); resolve(v); };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) done(b.dataset.v === '1');
      else if (e.target === wrap) done(false);
    });
    modalStack.push(() => done(false));
    document.body.appendChild(wrap);
  });
}

/** النوافذ المفتوحة (زر الرجوع يغلق آخرها). */
export const modalStack = [];

export function sheet(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="sheet">${html}</div>`;
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    const i = modalStack.indexOf(close);
    if (i >= 0) modalStack.splice(i, 1);
    onClose?.();
  };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  modalStack.push(close);
  document.body.appendChild(wrap);
  return { el: wrap.firstElementChild, close };
}

/** ماركداون مبسط للخطة: عناوين، قوائم، مربعات اختيار، عريض. */
export function md(text) {
  const lines = String(text || '').split('\n');
  let html = '', list = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const item = line.match(/^\s*[-*]\s+(\[( |x|X)\]\s+)?(.*)$/);
    if (item) {
      if (!list) { html += '<ul>'; list = true; }
      const box = item[1] ? `<span class="chk ${item[2].trim() ? 'on' : ''}">${item[2].trim() ? '✓' : ''}</span>` : '';
      html += `<li>${box}${inline(item[3])}</li>`;
      continue;
    }
    if (list) { html += '</ul>'; list = false; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) html += `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}

/** عدد بنود الخطة المنجزة من أصل الكل. */
export function roadmapProgress(roadmap) {
  const all = String(roadmap || '').match(/^\s*[-*]\s+\[( |x|X)\]/gm) || [];
  const done = all.filter((l) => /\[(x|X)\]/.test(l)).length;
  return { done, total: all.length };
}

export const android = window.Android || null;

/** وصف الهاتف للنموذج: الشاشة، المعالج، الذاكرة، ودعم WebGL والمعالج الرسومي. ثابت لكل جهاز فلا يفسد التخزين المؤقت. */
export function deviceInfo() {
  let gl = null, gl2 = false, gpu = '', maxTex = 0;
  try {
    const c = document.createElement('canvas');
    gl = c.getContext('webgl2');
    gl2 = !!gl;
    if (!gl) gl = c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* بلا WebGL */ }
  const chrome = (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || '?';
  const webgl = gl
    ? `${gl2 ? 'WebGL2 + WebGL1 available' : 'WebGL1 only (no WebGL2)'}${gpu ? `, GPU: ${gpu}` : ''}${maxTex ? `, max texture ${maxTex}` : ''}`
    : 'NOT available on this phone: do not use three.js/WebGL, use Canvas 2D';
  return `- Screen ${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)} CSS px, devicePixelRatio ${devicePixelRatio}, ${navigator.hardwareConcurrency || '?'} CPU cores, ${navigator.deviceMemory || '?'} GB RAM\n`
    + `- WebGL: ${webgl}\n- Android WebView, Chromium ${chrome}`;
}
