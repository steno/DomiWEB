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

/** Claim CTA → same menu page, inline edit mode. */
export function relativeEditMenuHref(slug: string): string {
  return `../../menus/${slug}/?edit=1`;
}

export function buildInlineMenuEditCss(): string {
  return `
body.menu-editing .hero {
  min-height: 28vh;
  min-height: 28svh;
}
body.menu-editing .qr-block { display: none; }
body.menu-editing .banner { display: none; }
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
  border-bottom: 1px solid rgba(226,164,90,0.28);
  color: inherit;
  font: inherit;
  padding: 0.35rem 0.25rem;
  border-radius: 0;
  cursor: text;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}
body.menu-editing .item input::placeholder {
  color: rgba(183, 168, 148, 0.75);
  font-weight: 400;
}
body.menu-editing .item input:hover {
  border-bottom-color: rgba(226,164,90,0.75);
  background: rgba(226,164,90,0.07);
}
body.menu-editing .item input:focus {
  outline: none;
  border-bottom-color: var(--accent);
  background: rgba(226,164,90,0.12);
  box-shadow: 0 1px 0 0 var(--accent);
}
body.menu-editing .item input:focus-visible {
  outline: 2px solid rgba(226,164,90,0.45);
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
  border-top: 1px dashed rgba(226,164,90,0.35);
  color: var(--accent);
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  text-align: left;
}
body.menu-editing .add-line { display: block; }
body.menu-editing .add-line:hover {
  color: #f0c080;
  border-top-color: rgba(226,164,90,0.7);
}
body.menu-editing .add-line:focus-visible {
  outline: 2px solid rgba(226,164,90,0.45);
  outline-offset: 2px;
}
.add-cat {
  display: none;
  margin: 0.5rem 0 1.5rem;
  padding: 0.75rem 0;
  width: 100%;
  background: none;
  border: 1px dashed rgba(226,164,90,0.4);
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
  border-color: rgba(226,164,90,0.75);
  background: rgba(226,164,90,0.06);
}
body.menu-editing .add-cat:focus-visible {
  outline: 2px solid rgba(226,164,90,0.45);
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
  background: rgba(226,164,90,0.07);
  color: #f3e7d4;
}
body.menu-editing .cat h2[contenteditable="true"]:focus {
  color: var(--accent);
  background: rgba(226,164,90,0.12);
}
.edit-bar {
  display: none;
  position: fixed;
  left: 0; right: 0; bottom: 0;
  padding: 0.85rem 1.15rem calc(0.85rem + env(safe-area-inset-bottom));
  background: rgba(20,15,10,0.94);
  border-top: 1px solid var(--line);
  gap: 0.65rem;
  justify-content: center;
  flex-wrap: wrap;
  backdrop-filter: blur(8px);
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
  <button type="button" class="btn btn-ghost" id="btn-cancel-edit">Salir</button>
  <button type="button" class="btn" id="btn-send-draft">Enviar cambios</button>
</div>`;
}

export function buildInlineMenuEditScript(
  lead: Lead,
  menuData: MenuData,
): string {
  const slug = lead.slug;
  const name = lead.place.name;
  const claimWa = process.env.CLAIM_WHATSAPP?.trim() ?? "";
  const waDigits = toWhatsAppDigits(claimWa) ?? "";
  const waDraftMessage = [
    `Hola — soy de ${name}.`,
    "",
    "Te mando mi menú actualizado. Adjunto el archivo que descargué.",
    "",
    "¿Me lo publican en el menú digital?",
  ].join("\n");
  const waHref = claimWa ? buildWhatsAppUrl(claimWa, waDraftMessage) : null;
  const seedJson = JSON.stringify(menuData);

  return `<script>
(function () {
  var params = new URLSearchParams(location.search);
  var wantEdit = params.get('edit') === '1' || location.hash === '#edit';
  if (!wantEdit) return;

  var SLUG = '${escapeJsString(slug)}';
  var NAME = '${escapeJsString(name)}';
  var STORAGE_KEY = 'domiweb-menu-draft-' + SLUG;
  var WA_HREF = ${waHref ? `'${escapeJsString(waHref)}'` : "null"};
  var WA_DIGITS = '${escapeJsString(waDigits)}';
  var seed = ${seedJson};
  var state = null;
  var list = document.getElementById('menu-list');
  var bar = document.getElementById('edit-bar');
  var statusEl = document.getElementById('edit-status');

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

  function priceAmount(hint) {
    var s = String(hint || '').trim().replace(/^RD\$\s*/i, '').trim();
    if (!s || s === '—' || s === '-' || s === '--') return '';
    return s;
  }

  function formatPriceHint(amount) {
    var a = String(amount || '').trim().replace(/^RD\$\s*/i, '').trim();
    if (!a || a === '—' || a === '-') return 'RD$ —';
    return 'RD$ ' + a;
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
              '<input class="item-price" data-f="priceHint" inputmode="decimal" aria-label="Precio en pesos" placeholder="—" value="' + escAttr(priceAmount(it.priceHint)) + '" />' +
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

  function downloadJson(draft) {
    var blob = new Blob([JSON.stringify(draft, null, 2) + '\\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'menu-' + SLUG + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function exitEdit() {
    var u = new URL(location.href);
    u.searchParams.delete('edit');
    u.hash = '';
    location.href = u.pathname + u.search;
  }

  document.body.classList.add('menu-editing');
  if (bar) { bar.hidden = false; }

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

  list.addEventListener('focusin', function (ev) {
    var t = ev.target;
    if (!t) return;
    if (t.tagName === 'INPUT' && t.getAttribute('data-f')) beginFieldEdit(t);
    if (t.getAttribute && t.getAttribute('data-f') === 'label') beginFieldEdit(t);
  });

  list.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t && t.dataset && t.dataset.session === '1') {
      var raw = t.tagName === 'INPUT' ? t.value : (t.textContent || '');
      t.dataset.edited = String(raw).length > 0 ? '1' : '0';
    }
    readDom();
    saveLocal();
    setStatus('Borrador en este teléfono');
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

  list.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (!t || t.tagName !== 'INPUT') return;
    if (ev.key === 'Escape') {
      t.dataset.edited = '0';
      t.value = '';
      t.blur();
      ev.preventDefault();
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
      return;
    }
    saveLocal();
    downloadJson(draft);
    setStatus('Abriendo WhatsApp — adjunta el archivo descargado.');
    var href = WA_HREF;
    if (!href && WA_DIGITS) {
      var msg = 'Hola — soy de ' + NAME + '.\\n\\nTe mando mi menú actualizado. Adjunto el archivo que descargué.\\n\\n¿Me lo publican en el menú digital?';
      href = 'https://wa.me/' + WA_DIGITS + '?text=' + encodeURIComponent(msg);
    }
    if (href) setTimeout(function () { window.open(href, '_blank', 'noopener'); }, 400);
  });

  var cancelBtn = document.getElementById('btn-cancel-edit');
  if (cancelBtn) cancelBtn.addEventListener('click', exitEdit);

  loadState();
  fetch('menu.json', { cache: 'no-store' })
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
})();
</script>`;
}

/** Old /edit-menu/ URLs redirect into inline edit on the live menu. */
export function writeMenuEditorPage(
  lead: Lead,
  _config: NicheConfig,
  _menuData: MenuData,
): { publicPath: string; dataPath: string } {
  const target = `../../menus/${lead.slug}/?edit=1`;
  const html = `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta http-equiv="refresh" content="0;url=${escapeAttr(target)}" />
<title>Editar menú · ${escapeHtml(lead.place.name)}</title>
<link rel="canonical" href="${escapeAttr(target)}" />
</head>
<body>
<p><a href="${escapeAttr(target)}">Abrir editor en el menú</a></p>
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
