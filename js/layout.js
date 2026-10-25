/* ============================================================
   Maquetación: reparte las preguntas en páginas A4 de 2 columnas,
   con borde degradado por área, marca de agua y número de página.
   Corta párrafos por líneas (con control de viudas/huérfanas) y
   equilibra las columnas de la última página de cada área.
   ============================================================ */
(function () {
  'use strict';

  const MM = 96 / 25.4;
  const $ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* ---------------------------------------------------------- átomos → elementos */
  const LIST_TYPE = { decimal: 'decimal', upperRoman: 'upper-roman', lowerRoman: 'lower-roman', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha' };

  function atomEl(a) {
    switch (a.t) {
      case 'preg': return $('p', 'a preg split', '<b>' + a.n + '.</b> ' + a.html);
      case 'op': return $('p', 'a op split', '<b>' + a.l + '.</b> ' + a.html);
      case 'opc': return $('p', 'a opc split', a.html);
      case 'par': return $('p', 'a par split' + (a.q ? ' inq' : ''), a.html);
      case 'fuente': return $('p', 'a fuente', a.html);
      case 'bloque': { const e = $('p', 'a bloque', a.html); e.dataset.keep = '1'; return e; }
      case 'ctitle': { const e = $('p', 'a ctitle', a.html); e.dataset.keep = '1'; return e; }
      case 'sep': return $('div', 'a sep');
      case 'fig': {
        const d = $('div', 'a fig'); const im = new Image();
        if (a.nw) { im.width = a.nw; im.height = a.nh; }
        im.src = a.src; im.style.width = (a.frac * 100).toFixed(1) + '%'; im.alt = '';
        d.appendChild(im); return d;
      }
      case 'list': {
        const bullet = !LIST_TYPE[a.fmt];
        const l = $(bullet ? 'ul' : 'ol', 'a lst');
        if (!bullet) l.style.listStyleType = LIST_TYPE[a.fmt];
        a.items.forEach(h => l.appendChild($('li', null, h))); return l;
      }
      case 'tbl': {
        const wrap = $('div', 'a tblw'); const t = $('table', 'tbl');
        a.rows.forEach(row => {
          const tr = $('tr');
          row.forEach(c => {
            const td = $(c.head ? 'th' : 'td', null, c.html);
            if (c.span > 1) td.colSpan = c.span;
            c.imgs.forEach(im => { const i = new Image(); i.src = im.src; td.appendChild(i); });
            tr.appendChild(td);
          });
          t.appendChild(tr);
        });
        wrap.appendChild(t); return wrap;
      }
    }
    return $('div', 'a');
  }

  /* ---------------------------------------------------------- páginas */
  function makePage(area, cfg, first) {
    const page = $('section', 'page body-page');
    page.style.setProperty('--A', area.A); page.style.setProperty('--B', area.B);
    const wm = $('img', 'wm'); wm.src = cfg.watermarkSrc; wm.alt = ''; wm.style.opacity = cfg.watermarkOpacity;
    const body = $('div', 'pbody');
    let head = null;
    if (first) { head = $('div', 'phead'); head.appendChild($('span', 'pill', area.name)); body.appendChild(head); }
    const cols = $('div', 'cols'); const c1 = $('div', 'col'), c2 = $('div', 'col');
    cols.append(c1, c2); body.appendChild(cols);
    const num = $('div', 'pnum', '<span></span>');
    page.append($('div', 'frame'), wm, body, num);
    return { el: page, cols, c: [c1, c2], head, first, numEl: num.firstChild };
  }

  const fits = col => {
    const last = col.lastElementChild; if (!last) return true;
    return last.getBoundingClientRect().bottom <= col.getBoundingClientRect().bottom + 0.6;
  };

  /* ---- líneas de un rango de texto ---- */
  function textNodes(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const out = []; let n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }
  function lineCount(rects, lh) {
    const tops = Array.from(rects).map(r => r.top).sort((a, b) => a - b); let n = 0, last = -1e9;
    for (const t of tops) if (t - last > lh * 0.55) { n++; last = t; }
    return n;
  }
  function rangeBetween(nodes, aNode, aOff, bNode, bOff) {
    const r = document.createRange(); r.setStart(aNode, aOff); r.setEnd(bNode, bOff); return r;
  }

  /* Corta `el` (ya dentro de `col`, desbordado) para que la cabeza quepa en `limit` (px, bottom).
     Devuelve el elemento cola o null si no se puede cortar con ≥2 líneas a cada lado. */
  function splitAt(el, limit) {
    const nodes = textNodes(el); if (!nodes.length) return null;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
    /* candidatos: finales de palabra */
    const cand = [];
    nodes.forEach((n, ni) => {
      const s = n.data;
      for (let k = 1; k <= s.length; k++) {
        if (s[k - 1] !== ' ' && s[k - 1] !== ' ' && (k === s.length || s[k] === ' ')) cand.push([ni, k]);
      }
    });
    if (cand.length < 3) return null;
    const first = nodes[0], lastN = nodes[nodes.length - 1];
    const total = lineCount(rangeBetween(nodes, first, 0, lastN, lastN.length).getClientRects(), lh);
    if (total < 4) return null;
    const headRange = i => rangeBetween(nodes, first, 0, nodes[cand[i][0]], cand[i][1]);
    const bottomOf = r => { let b = -1e9; for (const x of r.getClientRects()) b = Math.max(b, x.bottom); return b; };
    let lo = 0, hi = cand.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bottomOf(headRange(mid)) <= limit + 0.6) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) return null;
    /* viudas y huérfanas: ≥2 líneas arriba y ≥2 abajo */
    for (let i = best; i >= 0; i--) {
      const hl = lineCount(headRange(i).getClientRects(), lh);
      if (hl < 2) return null;
      if (total - hl >= 2) { best = i; break; }
      if (i === 0) return null;
    }
    const [ni, off] = cand[best];
    const r = document.createRange(); r.setStart(nodes[ni], off); r.setEndAfter(el.lastChild);
    const frag = r.extractContents();
    const tail = el.cloneNode(false); tail.appendChild(frag);
    /* quitar espacio inicial de la cola */
    const tn = textNodes(tail); if (tn.length) tn[0].data = tn[0].data.replace(/^[  ]+/, '');
    el.classList.add('cut-head'); tail.classList.add('cut-tail');
    return tail;
  }

  /* ---------------------------------------------------------- una sección (área) */
  function layoutArea(area, atoms, cfg, out) {
    const pages = [];
    let page = null, ci = 0;
    const keepEls = [];        // elementos "keep with next" al final de la columna actual

    const newPage = () => {
      page = makePage(area, cfg, pages.length === 0); pages.push(page); ci = 0;
      out.stage.appendChild(page.el);
      const bodyH = page.el.querySelector('.pbody').clientHeight;
      page.cols.style.height = (bodyH - page.cols.offsetTop) + 'px';
      keepEls.length = 0;
    };
    const advance = () => {
      if (ci === 0) { ci = 1; } else { newPage(); }
      keepEls.length = 0;
    };
    newPage();

    for (const a of atoms) {
      let el = atomEl(a);
      if (a.t === 'sep') {
        const col = page.c[ci];
        if (!col.children.length) continue;
        col.appendChild(el); if (!fits(col)) col.removeChild(el);
        keepEls.length = 0;
        continue;
      }
      const isKeep = el.dataset.keep === '1';
      let placedSomething = false;
      for (let guard = 0; guard < 200; guard++) {
        const col = page.c[ci];
        col.appendChild(el);
        if (fits(col)) { placedSomething = true; break; }
        /* ¿se puede cortar el párrafo? */
        let tail = null;
        if (el.classList.contains('split')) {
          tail = splitAt(el, col.getBoundingClientRect().bottom);
        }
        if (tail) {
          placedSomething = true; keepEls.length = 0;
          advance(); el = tail; continue;
        }
        col.removeChild(el);
        const nKeep = keepEls.filter(k => k.parentNode === col).length;
        if (col.children.length <= nKeep) {   // no cabe ni solo: forzar (se recorta)
          col.appendChild(el); placedSomething = true; break;
        }
        /* mover con el siguiente los títulos "keep" que quedaron al final */
        const carry = keepEls.slice();
        carry.forEach(k => { if (k.parentNode === col) col.removeChild(k); });
        advance();
        if (carry.length) { const ncol = page.c[ci]; carry.forEach(k => ncol.appendChild(k)); keepEls.length = 0; carry.forEach(k => keepEls.push(k)); }
      }
      if (isKeep) keepEls.push(el); else if (!el.classList.contains('cut-tail')) keepEls.length = 0;
    }

    /* equilibrar columnas de la última página */
    const last = pages[pages.length - 1];
    balance(last);
    return pages;
  }

  function balance(p) {
    const [c1, c2] = p.c;
    const h = c => { const l = c.lastElementChild; return l ? l.getBoundingClientRect().bottom - c.getBoundingClientRect().top : 0; };
    const total = h(c1) + h(c2);
    if (!c1.children.length || total < 40) { fitHeight(p); return; }
    const top = c1.getBoundingClientRect().top;
    const target = top + total / 2;
    const moved = [];
    /* elementos de c1 que sobrepasan el objetivo */
    const els = Array.from(c1.children);
    for (let i = 0; i < els.length; i++) {
      const e = els[i], r = e.getBoundingClientRect();
      if (r.bottom <= target + 0.6) continue;
      let rest = [e];
      if (e.classList.contains('split') && r.top < target - 20) {
        const tail = splitAt(e, target);
        if (tail) rest = [tail];
      }
      moved.push(...rest, ...els.slice(i + 1));
      els.slice(i + 1).forEach(x => c1.removeChild(x));
      if (rest[0] !== e) { /* e ya recortado, queda en c1 */ } else c1.removeChild(e);
      break;
    }
    /* mantener orden: lo movido va al inicio de c2 */
    const firstOld = c2.firstChild;
    moved.forEach(m => c2.insertBefore(m, firstOld));
    /* si la 2ª columna quedó más alta que la 1ª, deshacer a medias no es necesario: se ajusta altura */
    if (c2.firstElementChild && c2.firstElementChild.classList.contains('sep')) c2.removeChild(c2.firstElementChild);
    fitHeight(p);
  }
  function fitHeight(p) {
    const [c1, c2] = p.c;
    const h = c => { const l = c.lastElementChild; return l ? l.getBoundingClientRect().bottom - c.getBoundingClientRect().top : 0; };
    const H = Math.ceil(Math.max(h(c1), h(c2)));
    p.cols.style.height = H + 'px';
  }

  window.CatalystLayout = {
    /* areas: [{code,name,atoms}] ; devuelve las páginas (elementos) ya numeradas desde 1 */
    layoutSession(areas, cfg, stage) {
      const out = { stage };
      const all = [];
      areas.forEach(ar => {
        if (ar.code === 'Ing' && typeof cfg.renderIngles === 'function') {   // diseño propio de Inglés
          const ip = cfg.renderIngles(ar, all.length + 1, stage);
          if (ip && ip.length) { all.push(...ip); return; }
        }
        const def = cfg.areas[ar.code];
        const pages = layoutArea({ name: def.name, A: def.A, B: def.B }, ar.atoms, cfg, out);
        all.push(...pages);
      });
      all.forEach((p, i) => { p.numEl.textContent = i + 1; });
      return all;
    }
  };
})();
