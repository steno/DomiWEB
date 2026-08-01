import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Lead, NicheConfig } from "../types/index.js";
import { buildWhatsAppUrl, toWhatsAppDigits } from "../outreach/phone.js";
import { dataDir, publicDir } from "../utils/paths.js";
import type { MenuData } from "./menu.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function escapeJsString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** Claim CTA → editor panel on the claim page (not the public menu). */
export function relativeEditMenuHref(_slug: string): string {
  return `#editar-menu`;
}

export function buildInlineMenuEditCss(): string {
  return `
body.menu-editing .hero {
  min-height: 28vh;
  min-height: 28svh;
}
body.menu-editing .order-hint { display: none; }
body.menu-editing .pick { display: none; }
body.menu-editing .order-bar { display: none !important; }
body.menu-editing .wrap { padding-bottom: 5.5rem; }
.edit-hint {
  display: none;
  margin: 0 0 1.25rem;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.88rem;
  color: var(--muted);
}
body.menu-editing .edit-hint { display: block; }
body.menu-editing .item {
  grid-template-columns: 1fr auto auto;
  align-items: start;
  gap: 0.55rem;
}
body.menu-editing .item-main { display: grid; gap: 0.35rem; }
body.menu-editing .item input {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(10, 143, 138, 0.28);
  color: inherit;
  font: inherit;
  padding: 0.35rem 0.25rem;
  border-radius: 0;
  cursor: text;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}
body.menu-editing .item input::placeholder {
  color: rgba(61, 92, 88, 0.65);
  font-weight: 400;
}
body.menu-editing .item input:hover {
  border-bottom-color: rgba(10, 143, 138, 0.7);
  background: rgba(10, 143, 138, 0.06);
}
body.menu-editing .item input:focus {
  outline: none;
  border-bottom-color: var(--accent);
  background: rgba(10, 143, 138, 0.1);
  box-shadow: 0 1px 0 0 var(--accent);
}
body.menu-editing .item input:focus-visible {
  outline: 2px solid rgba(10, 143, 138, 0.4);
  outline-offset: 2px;
}
body.menu-editing .item input.item-name {
  font-size: 1.08rem;
  font-weight: 650;
}
body.menu-editing .item input.item-note {
  color: var(--muted);
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.82rem;
}
body.menu-editing .item input.item-price {
  width: 4.75rem;
  text-align: right;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  color: var(--accent);
  white-space: nowrap;
}
body.menu-editing .price-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 6.5rem;
  justify-content: flex-end;
}
body.menu-editing .price-prefix {
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.92rem;
  color: var(--accent);
  opacity: 0.85;
  user-select: none;
  pointer-events: none;
  flex-shrink: 0;
}
body.menu-editing .item-rm {
  background: none;
  border: none;
  color: #c97858;
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
  padding: 0.2rem 0.35rem;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  border-radius: 2px;
  transition: color 0.15s ease, background-color 0.15s ease;
}
body.menu-editing .item-rm:hover {
  color: #f0a090;
  background: rgba(201, 120, 88, 0.12);
}
body.menu-editing .item-rm:focus-visible {
  outline: 2px solid rgba(201, 120, 88, 0.5);
  outline-offset: 2px;
}
.add-line {
  display: none;
  margin: 0.35rem 0 0;
  padding: 0.65rem 0;
  width: 100%;
  background: none;
  border: none;
  border-top: 1px dashed rgba(10, 143, 138, 0.35);
  color: var(--accent);
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  text-align: left;
}
body.menu-editing .add-line { display: block; }
body.menu-editing .add-line:hover {
  color: #066661;
  border-top-color: rgba(10, 143, 138, 0.7);
}
body.menu-editing .add-line:focus-visible {
  outline: 2px solid rgba(10, 143, 138, 0.4);
  outline-offset: 2px;
}
.add-cat {
  display: none;
  margin: 0.5rem 0 1.5rem;
  padding: 0.75rem 0;
  width: 100%;
  background: none;
  border: 1px dashed rgba(10, 143, 138, 0.4);
  color: var(--muted);
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.88rem;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}
body.menu-editing .add-cat { display: block; }
body.menu-editing .add-cat:hover {
  color: var(--accent);
  border-color: rgba(10, 143, 138, 0.75);
  background: rgba(10, 143, 138, 0.06);
}
body.menu-editing .add-cat:focus-visible {
  outline: 2px solid rgba(10, 143, 138, 0.4);
  outline-offset: 2px;
}
body.menu-editing .cat h2[contenteditable="true"] {
  outline: none;
  cursor: text;
  padding: 0.15rem 0.25rem;
  margin: 0 0 0.85rem;
  border-radius: 2px;
  transition: color 0.15s ease, background-color 0.15s ease;
}
body.menu-editing .cat h2[contenteditable="true"]:hover {
  background: rgba(10, 143, 138, 0.07);
  color: var(--ink);
}
body.menu-editing .cat h2[contenteditable="true"]:focus {
  color: var(--accent);
  background: rgba(10, 143, 138, 0.12);
}
.edit-bar {
  display: none;
  position: fixed;
  left: 0; right: 0; bottom: 0;
  padding: 0.85rem 1.15rem calc(0.85rem + env(safe-area-inset-bottom));
  background: rgba(12, 22, 18, 0.92);
  border-top: 1px solid var(--line);
  gap: 0.65rem;
  justify-content: center;
  flex-wrap: wrap;
  backdrop-filter: blur(10px);
  z-index: 20;
}
body.menu-editing .edit-bar { display: flex; }
.edit-bar .btn {
  border: none;
  cursor: pointer;
}
.edit-bar .btn-ghost {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
}
.edit-status {
  width: 100%;
  text-align: center;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.8rem;
  color: var(--accent);
  min-height: 1.1em;
}
.send-modal {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 40;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
  background: rgba(8, 16, 12, 0.72);
  backdrop-filter: blur(6px);
}
.send-modal.open { display: flex; }
.send-modal-card {
  width: min(26rem, 100%);
  background: var(--panel, #132019);
  border: 1px solid var(--line, rgba(238, 243, 239, 0.12));
  border-radius: 1rem;
  padding: 1.15rem 1.15rem 1.25rem;
  color: var(--ink, #eef3ef);
  box-shadow: 0 18px 40px rgba(0,0,0,0.4);
}
.send-modal-card h2 {
  margin: 0 0 0.45rem;
  font-size: 1.25rem;
  letter-spacing: -0.02em;
}
.send-modal-card p {
  margin: 0 0 1rem;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.92rem;
  color: var(--muted, #8fa399);
  line-height: 1.4;
}
.send-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}
.send-modal-actions .btn {
  flex: 1 1 8rem;
  border: none;
  cursor: pointer;
  text-align: center;
}
.send-modal-actions .btn-ghost {
  background: transparent;
  color: var(--ink, #eef3ef);
  border: 1px solid var(--line, rgba(238, 243, 239, 0.12));
}
@media (max-width: 520px) {
  body.menu-editing .item {
    grid-template-columns: 1fr auto;
  }
  body.menu-editing .item-rm {
    grid-column: 2;
    grid-row: 1;
  }
  body.menu-editing .item input.item-price {
    grid-column: auto;
    width: 4.75rem;
  }
  body.menu-editing .price-wrap {
    grid-column: 1 / -1;
    justify-content: flex-start;
    min-width: 0;
    width: 100%;
  }
}
`;
}

export function buildInlineMenuEditBarHtml(): string {
  return `<div class="edit-bar" id="edit-bar" hidden>
  <p class="edit-status" id="edit-status" role="status"></p>
  <button type="button" class="btn btn-ghost" id="btn-cancel-edit">Cancelar</button>
  <button type="button" class="btn btn-primary" id="btn-finish-edit">Listo</button>
</div>
<div class="send-modal" id="send-modal" hidden aria-hidden="true">
  <div class="send-modal-card" role="dialog" aria-modal="true" aria-labelledby="send-modal-title">
    <h2 id="send-modal-title">¿Listo para enviar?</h2>
    <p>Te abrimos WhatsApp para mandarnos tu carta. Cuando la envíes, te mostramos el QR para imprimir.</p>
    <div class="send-modal-actions">
      <button type="button" class="btn btn-ghost" id="btn-keep-editing">Seguir editando</button>
      <button type="button" class="btn btn-primary" id="btn-send-draft">Enviar por WhatsApp</button>
    </div>
  </div>
</div>`;
}

export function buildInlineMenuEditScript(
  lead: Lead,
  menuData: MenuData,
  opts: { menuJsonUrl?: string } = {},
): string {
  const slug = lead.slug;
  const name = lead.place.name;
  const claimWa = process.env.CLAIM_WHATSAPP?.trim() ?? "";
  const waDigits = toWhatsAppDigits(claimWa) ?? "";
  const menuJsonUrl = opts.menuJsonUrl ?? "menu.json";
  const waDraftMessage = [
    `Hola — soy de ${name}.`,
    "",
    "Te mando mi menú actualizado (archivo JSON).",
    "Si no se adjuntó solo, pégalo con el clip 📎 desde Descargas:",
    `menu-${slug}.json`,
    "",
    "¿Me lo publican en el menú digital?",
  ].join("\n");
  const waHref = claimWa ? buildWhatsAppUrl(claimWa, waDraftMessage) : null;
  const seedJson = JSON.stringify(menuData);

  return `<script>
(function () {
  var SLUG = '${escapeJsString(slug)}';
  var NAME = '${escapeJsString(name)}';
  var STORAGE_KEY = 'domiweb-menu-draft-' + SLUG;
  var MENU_JSON_URL = '${escapeJsString(menuJsonUrl)}';
  var WA_HREF = ${waHref ? `'${escapeJsString(waHref)}'` : "null"};
  var WA_DIGITS = '${escapeJsString(waDigits)}';
  var seed = ${seedJson};
  var state = null;
  var list = document.getElementById('menu-list');
  var bar = document.getElementById('edit-bar');
  var statusEl = document.getElementById('edit-status');
  var panel = document.getElementById('editar-menu');
  var stage = document.querySelector('.stage');
  var bottom = document.querySelector('.bottom');
  var sendModal = document.getElementById('send-modal');
  var started = false;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }
  function slugify(label, fallback) {
    var s = String(label || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return s || fallback || 'cat';
  }
  function escAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripRdPrefix(raw) {
    var s = String(raw || '').trim();
    while (s.length >= 3 && s.slice(0, 3).toUpperCase() === 'RD$') {
      s = s.slice(3).trim();
    }
    return s;
  }

  function priceAmount(hint) {
    var s = stripRdPrefix(hint);
    if (!s || s === '—' || s === '–' || s === '-' || s === '--' || s === '−') return '';
    s = s.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    var parts = s.split('.');
    if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
    if (!s || s === '.') return '';
    return s;
  }

  function formatPriceHint(amount) {
    var a = priceAmount(amount);
    if (!a) return 'RD$ —';
    return 'RD$ ' + a;
  }

  function sanitizePriceInput(el) {
    if (!el || !el.classList.contains('item-price')) return;
    var start = el.selectionStart;
    var before = el.value;
    var next = priceAmount(before);
    if (next !== before) {
      el.value = next;
      if (typeof start === 'number') {
        var pos = Math.min(start, next.length);
        try { el.setSelectionRange(pos, pos); } catch (e) {}
      }
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.categories)) {
          state = parsed;
          return;
        }
      }
    } catch (e) {}
    state = clone(seed);
  }

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function render() {
    if (!list) return;
    list.innerHTML = state.categories.map(function (cat, ci) {
      var items = (cat.items || []).map(function (it, ii) {
        return (
          '<li class="item" data-ci="' + ci + '" data-ii="' + ii + '">' +
            '<div class="item-main">' +
              '<input class="item-name" data-f="name" aria-label="Plato" value="' + escAttr(it.name || '') + '" />' +
              '<input class="item-note" data-f="note" aria-label="Nota" placeholder="Nota (opcional)" value="' + escAttr(it.note || '') + '" />' +
            '</div>' +
            '<div class="price-wrap">' +
              '<span class="price-prefix" aria-hidden="true">RD$</span>' +
              '<input class="item-price" data-f="priceHint" type="text" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" aria-label="Precio en pesos" placeholder="—" autocomplete="off" value="' + escAttr(priceAmount(it.priceHint)) + '" />' +
            '</div>' +
            '<button type="button" class="item-rm" data-act="rm" aria-label="Quitar plato">&times;</button>' +
          '</li>'
        );
      }).join('');
      return (
        '<section class="cat" data-ci="' + ci + '" id="' + escAttr(cat.id || ('cat-' + ci)) + '">' +
          '<h2 contenteditable="true" spellcheck="false" data-f="label"></h2>' +
          '<ul class="items">' + items + '</ul>' +
          '<button type="button" class="add-line" data-act="add-item">+ Plato</button>' +
        '</section>'
      );
    }).join('') +
    '<button type="button" class="add-cat" id="btn-add-cat">+ Categoría</button>';

    list.querySelectorAll('.cat').forEach(function (sec) {
      var ci = Number(sec.getAttribute('data-ci'));
      var h = sec.querySelector('h2');
      if (h && state.categories[ci]) h.textContent = state.categories[ci].label || 'Categoría';
    });
  }

  function readDom() {
    if (!list) return;
    list.querySelectorAll('.cat').forEach(function (sec) {
      var ci = Number(sec.getAttribute('data-ci'));
      if (!state.categories[ci]) return;
      var h = sec.querySelector('h2');
      if (h) {
        if (!(h.dataset.session === '1' && h.dataset.edited !== '1')) {
          var labelText = (h.textContent || '').trim();
          if (h.dataset.session === '1' && h.dataset.edited === '1' && labelText) {
            state.categories[ci].label = labelText;
          } else if (h.dataset.session !== '1') {
            state.categories[ci].label = labelText || state.categories[ci].label;
          }
          state.categories[ci].id = slugify(state.categories[ci].label, 'cat-' + (ci + 1));
        }
      }
      sec.querySelectorAll('.item').forEach(function (row) {
        var ii = Number(row.getAttribute('data-ii'));
        if (!state.categories[ci].items[ii]) return;
        row.querySelectorAll('input[data-f]').forEach(function (inp) {
          if (inp.dataset.session === '1' && inp.dataset.edited !== '1') return;
          var f = inp.getAttribute('data-f');
          if (f === 'priceHint') {
            state.categories[ci].items[ii][f] = formatPriceHint(inp.value);
          } else {
            state.categories[ci].items[ii][f] = inp.value;
          }
        });
      });
    });
  }

  function buildDraft() {
    readDom();
    return {
      slug: SLUG,
      owned: false,
      updatedAt: new Date().toISOString(),
      source: 'owner-draft',
      categories: state.categories
        .map(function (c) {
          return {
            id: c.id || slugify(c.label, 'cat'),
            label: String(c.label || '').trim(),
            items: (c.items || [])
              .map(function (it) {
                return {
                  name: String(it.name || '').trim(),
                  note: String(it.note || '').trim(),
                  priceHint: formatPriceHint(it.priceHint),
                };
              })
              .filter(function (it) { return it.name.length > 0; }),
          };
        })
        .filter(function (c) { return c.label && c.items.length > 0; }),
    };
  }

  function draftFile(draft) {
    var text = JSON.stringify(draft, null, 2) + '\\n';
    var filename = 'menu-' + SLUG + '.json';
    try {
      return new File([text], filename, { type: 'application/json' });
    } catch (e) {
      var blob = new Blob([text], { type: 'application/json' });
      blob.name = filename;
      return blob;
    }
  }

  function downloadJson(draft) {
    var file = draftFile(draft);
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'menu-' + SLUG + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function openWhatsAppFallback() {
    var href = WA_HREF;
    if (!href && WA_DIGITS) {
      var msg = 'Hola — soy de ' + NAME + '.\\n\\nTe mando mi menú (menu-' + SLUG + '.json).\\nAdjúntalo con el clip 📎 desde Descargas.\\n\\n¿Me lo publican?';
      href = 'https://wa.me/' + WA_DIGITS + '?text=' + encodeURIComponent(msg);
    }
    if (href) window.open(href, '_blank', 'noopener');
  }

  function openSendModal() {
    if (!sendModal) return;
    sendModal.hidden = false;
    sendModal.classList.add('open');
    sendModal.setAttribute('aria-hidden', 'false');
  }

  function closeSendModal() {
    if (!sendModal) return;
    sendModal.classList.remove('open');
    sendModal.hidden = true;
    sendModal.setAttribute('aria-hidden', 'true');
  }

  function finishAndShowQr() {
    closeSendModal();
    exitEdit({ showQr: true });
  }

  function sendDraft(draft) {
    var file = draftFile(draft);
    var shareData = {
      files: [file],
      title: 'Menú · ' + NAME,
      text: 'Hola — soy de ' + NAME + '. Te mando mi menú actualizado (menu-' + SLUG + '.json). ¿Me lo publican?',
    };
    if (navigator.canShare && navigator.canShare(shareData)) {
      navigator.share(shareData)
        .then(function () {
          setStatus('Enviado — aquí tienes tu QR.');
          finishAndShowQr();
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') {
            setStatus('Envío cancelado.');
            return;
          }
          downloadJson(draft);
          setStatus('Archivo descargado — ábrelo en WhatsApp con el clip 📎.');
          openWhatsAppFallback();
          setTimeout(finishAndShowQr, 600);
        });
      return;
    }
    downloadJson(draft);
    setStatus('Archivo descargado — en WhatsApp toca 📎 y elige menu-' + SLUG + '.json');
    openWhatsAppFallback();
    setTimeout(finishAndShowQr, 600);
  }

  function exitEdit(opts) {
    var showQr = opts && opts.showQr;
    closeSendModal();
    document.body.classList.remove('menu-editing');
    if (panel) panel.hidden = true;
    if (bar) bar.hidden = true;
    if (stage) stage.style.display = '';
    if (bottom) bottom.style.display = '';
    if (location.hash === '#editar-menu' || location.hash === '#edit') {
      history.replaceState(null, '', location.pathname + location.search);
    }
    setTimeout(function () {
      var target = showQr
        ? document.getElementById('qr-permanente')
        : document.querySelector('.stage') || document.querySelector('.top');
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  }

  function defaultPlaceholder(el) {
    if (el.classList.contains('item-note')) return 'Nota (opcional)';
    if (el.classList.contains('item-price')) return '—';
    return '';
  }

  function beginFieldEdit(el) {
    if (!el || el.dataset.session === '1') return;
    var current = el.tagName === 'INPUT' ? el.value : (el.textContent || '');
    if (el.classList.contains('item-price')) {
      current = priceAmount(current);
    }
    el.dataset.orig = current;
    el.dataset.edited = '0';
    el.dataset.session = '1';
    if (el.tagName === 'INPUT') {
      el.placeholder = current || defaultPlaceholder(el);
      el.value = '';
    } else {
      el.textContent = '';
    }
  }

  function endFieldEdit(el) {
    if (!el || el.dataset.session !== '1') return;
    var orig = el.dataset.orig || '';
    var edited = el.dataset.edited === '1';
    var raw = el.tagName === 'INPUT' ? el.value : (el.textContent || '');
    var next = String(raw).trim();
    if (el.classList.contains('item-price')) {
      next = priceAmount(next);
    }
    if (!edited || !next) {
      if (el.tagName === 'INPUT') el.value = orig;
      else el.textContent = orig || 'Categoría';
    } else if (el.tagName !== 'INPUT') {
      el.textContent = next;
    } else {
      el.value = next;
    }
    el.dataset.session = '0';
    if (el.tagName === 'INPUT') {
      el.placeholder = defaultPlaceholder(el);
    }
    delete el.dataset.orig;
    delete el.dataset.edited;
  }

  function bindOnce() {
    if (started || !list) return;
    started = true;

    list.addEventListener('focusin', function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.tagName === 'INPUT' && t.getAttribute('data-f')) beginFieldEdit(t);
      if (t.getAttribute && t.getAttribute('data-f') === 'label') beginFieldEdit(t);
    });

    list.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t && t.classList && t.classList.contains('item-price')) {
        sanitizePriceInput(t);
      }
      if (t && t.dataset && t.dataset.session === '1') {
        var raw = t.tagName === 'INPUT' ? t.value : (t.textContent || '');
        t.dataset.edited = String(raw).length > 0 ? '1' : '0';
      }
      readDom();
      saveLocal();
      setStatus('Borrador en este teléfono');
    });

    list.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (ev.key === 'Escape') {
        t.dataset.edited = '0';
        t.value = '';
        t.blur();
        ev.preventDefault();
        return;
      }
      if (t.classList.contains('item-price')) {
        var allow = ev.key.length !== 1 || /[0-9.,]/.test(ev.key);
        if (!allow && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          ev.preventDefault();
        }
      }
    });

    list.addEventListener('focusout', function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.tagName === 'INPUT' && t.getAttribute('data-f')) {
        endFieldEdit(t);
        readDom();
        saveLocal();
        return;
      }
      if (t.getAttribute && t.getAttribute('data-f') === 'label') {
        endFieldEdit(t);
        readDom();
        saveLocal();
        render();
      }
    });

    list.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var act = t.getAttribute('data-act');
      if (!act) return;
      readDom();
      if (act === 'add-item') {
        var sec = t.closest('.cat');
        var ci = sec ? Number(sec.getAttribute('data-ci')) : -1;
        if (ci >= 0) {
          state.categories[ci].items.push({ name: '', note: '', priceHint: 'RD$ ' });
          saveLocal();
          render();
          var rows = list.querySelectorAll('.cat[data-ci="' + ci + '"] .item');
          var last = rows[rows.length - 1];
          if (last) {
            var focus = last.querySelector('input.item-name');
            if (focus) focus.focus();
          }
        }
        return;
      }
      if (act === 'rm') {
        var row = t.closest('.item');
        var sec2 = t.closest('.cat');
        var ci2 = sec2 ? Number(sec2.getAttribute('data-ci')) : -1;
        var ii = row ? Number(row.getAttribute('data-ii')) : -1;
        if (ci2 >= 0 && ii >= 0) {
          state.categories[ci2].items.splice(ii, 1);
          saveLocal();
          render();
        }
      }
    });

    list.addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'btn-add-cat') {
        readDom();
        var n = state.categories.length + 1;
        state.categories.push({
          id: 'cat-' + n,
          label: 'Nueva categoría',
          items: [{ name: '', note: '', priceHint: 'RD$ ' }],
        });
        saveLocal();
        render();
      }
    });

    var sendBtn = document.getElementById('btn-send-draft');
    if (sendBtn) sendBtn.addEventListener('click', function () {
      var draft = buildDraft();
      if (!draft.categories.length) {
        setStatus('Agrega al menos un plato con nombre.');
        closeSendModal();
        return;
      }
      saveLocal();
      sendDraft(draft);
    });

    var finishBtn = document.getElementById('btn-finish-edit');
    if (finishBtn) finishBtn.addEventListener('click', function () {
      readDom();
      saveLocal();
      var draft = buildDraft();
      if (!draft.categories.length) {
        setStatus('Agrega al menos un plato con nombre.');
        return;
      }
      setStatus('Borrador en este teléfono');
      openSendModal();
    });

    var keepBtn = document.getElementById('btn-keep-editing');
    if (keepBtn) keepBtn.addEventListener('click', closeSendModal);

    if (sendModal) {
      sendModal.addEventListener('click', function (ev) {
        if (ev.target === sendModal) closeSendModal();
      });
    }

    var cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      exitEdit({ showQr: false });
    });
  }

  function enterEdit() {
    if (!list) return;
    bindOnce();
    document.body.classList.add('menu-editing');
    if (panel) panel.hidden = false;
    if (bar) bar.hidden = false;
    if (stage) stage.style.display = 'none';
    if (bottom) bottom.style.display = 'none';
    if (location.hash !== '#editar-menu') {
      history.replaceState(null, '', location.pathname + location.search + '#editar-menu');
    }
    loadState();
    render();
    fetch(MENU_JSON_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (remote && Array.isArray(remote.categories)) {
          var local = null;
          try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) {}
          var localIsOwnerDraft = local && local.source === 'owner-draft';
          if (!local || (remote.owned && !localIsOwnerDraft)) {
            state = remote;
          } else if (
            remote.owned &&
            local &&
            remote.updatedAt &&
            local.updatedAt &&
            String(remote.updatedAt) > String(local.updatedAt)
          ) {
            state = remote;
          }
        }
        render();
      })
      .catch(function () { render(); });
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.querySelectorAll('a[href="#editar-menu"]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      enterEdit();
    });
  });

  window.addEventListener('hashchange', function () {
    if (location.hash === '#editar-menu' || location.hash === '#edit') enterEdit();
    else if (document.body.classList.contains('menu-editing')) exitEdit({ showQr: false });
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (sendModal && sendModal.classList.contains('open')) {
      closeSendModal();
      return;
    }
    if (document.body.classList.contains('menu-editing')) exitEdit({ showQr: false });
  });

  if (location.hash === '#editar-menu' || location.hash === '#edit') enterEdit();
})();
</script>`;
}

/** Claim page embeds this panel; public menu stays order-only. */
export function buildClaimMenuEditorMarkup(
  lead: Lead,
  menuData: MenuData,
): string {
  return `<style>
${buildInlineMenuEditCss()}
#editar-menu {
  display: none;
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.15rem 1.15rem 6rem;
}
body.menu-editing #editar-menu { display: block; }
body.menu-editing .stage,
body.menu-editing .bottom,
body.menu-editing .face-dock { display: none !important; }
body.menu-editing .quote { display: none; }
#editar-menu .edit-hint {
  display: block;
  margin: 0 0 1.25rem;
  color: var(--muted);
  font-family: system-ui, sans-serif;
  font-size: 0.9rem;
}
#editar-menu .cat { margin: 0 0 1.5rem; }
#editar-menu .cat h2 {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.35rem;
}
#editar-menu .items { list-style: none; margin: 0; padding: 0; }
#editar-menu .item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.55rem;
  align-items: start;
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(10, 143, 138, 0.14);
}
</style>
<section id="editar-menu" hidden aria-label="Editar menú">
  <p class="edit-hint">Edita platos y precios aquí (antes de pagar). Al enviar por WhatsApp, lo revisamos y lo publicamos en tu carta.</p>
  <div id="menu-list"></div>
</section>
${buildInlineMenuEditBarHtml()}
${buildInlineMenuEditScript(lead, menuData, {
  menuJsonUrl: `../../menus/${lead.slug}/menu.json`,
})}`;
}

/** Old /edit-menu/ URLs redirect into the claim-page editor. */
export function writeMenuEditorPage(
  lead: Lead,
  _config: NicheConfig,
  _menuData: MenuData,
): { publicPath: string; dataPath: string } {
  const target = `../../claim/${lead.slug}/#editar-menu`;
  const html = `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta http-equiv="refresh" content="0;url=${escapeAttr(target)}" />
<title>Editar menú · ${escapeHtml(lead.place.name)}</title>
<link rel="canonical" href="${escapeAttr(target)}" />
</head>
<body>
<p><a href="${escapeAttr(target)}">Abrir editor en la página de reclamo</a></p>
</body>
</html>`;
  const publicPath = join(publicDir("edit-menu"), lead.slug, "index.html");
  const dataPath = join(dataDir("edit-menu"), lead.slug, "index.html");
  mkdirSync(dirname(publicPath), { recursive: true });
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(publicPath, html, "utf8");
  writeFileSync(dataPath, html, "utf8");
  return { publicPath, dataPath };
}
