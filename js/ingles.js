/* ============================================================
   INGLÉS · diseño de la plantilla integrado al cuadernillo
   - Parser de texto (PARTE 1 … PARTE 7) y renderizado de cada Parte
     (mismo diseño del generador de inglés: 1 Parte = 1 página A4).
   - Conversor: toma la sección «Inglés» del Word y la deja en ese formato.
   - La numeración de página la pone layout.js (continúa la del cuadernillo).
   ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------- guía de formato */
  const GUIDE = `Cada «Parte» sale en 1 sola página A4. Estructura del texto (palabras clave en MAYÚSCULAS):

PARTE 1  (avisos · 3 opciones)
INSTRUCCIONES: ...
EJEMPLO
0. texto del aviso
A. opción
B. opción
C. opción
RESPUESTA: A
PREGUNTAS
80. texto del aviso
A. opción ...

PARTE 2  (emparejamiento)
TITULO: ANIMALS
EJEMPLO: 0. descripción de ejemplo
RESPUESTA: H
DESCRIPCIONES
85. descripción...
PALABRAS
A. palabra ...

PARTE 3  (diálogos · 3 opciones)
INSTRUCCIONES: ...
EJEMPLO
Q: pregunta de ejemplo
A. opción ...
RESPUESTA: A
PREGUNTAS
90. pregunta
A. opción ...

PARTE 4A, 4B, 7, 7A, 7B  (texto con espacios)
TITULO: Perfume
TEXTO:
Párrafo con los espacios marcados así: (0) (97) (98)...
EJEMPLO
A. opción ...
RESPUESTA: A
PREGUNTAS
97.
A. opción ... (3 o 4 opciones, se detecta solo)

PARTE 5 y 6  (lectura)
TITULO: (opcional)
TEXTO:
Texto de lectura.
PREGUNTAS
113. pregunta
A. opción ... (la Parte 6 usa 4 opciones)

Notas:
- Los números de pregunta se muestran tal cual los escribas.
- Si falta una Parte, simplemente no se genera esa página.
- Si hay mucho contenido, el texto se reduce solo para caber en 1 página.`;

  /* ---------------------------------------------------------- 1) parser texto → datos */
  function parseTemplate(raw) {
    const data = {};
    const lines = raw.split(/\r?\n/);
    let partKey = null, section = null, curItem = null, textAccum = [];

    function ensure(key) {
      if (data[key]) return;
      if (key === 'p1' || key === 'p3') {
        data[key] = { instructions: '', example: { label: '', q: '', options: [], correct: null }, items: [] };
      } else if (key === 'p2') {
        data[key] = { title: '', instructions: '', exampleLabel: '', exampleLetter: '', descriptions: [], words: [] };
      } else if (key === 'p4a' || key === 'p4b' || key === 'p7' || key === 'p7a' || key === 'p7b') {
        data[key] = { title: '', photo: '', paragraph: '', example: { options: [], correct: null }, items: [] };
      } else if (key === 'p5' || key === 'p6') {
        data[key] = { title: '', photo: '', passage: '', items: [] };
      }
    }
    function flushText() {
      if (section === 'text' && partKey && data[partKey]) {
        const txt = textAccum.join('\n').trim();
        if (/^p(4a|4b|7|7a|7b)$/.test(partKey)) data[partKey].paragraph = txt;
        if (partKey === 'p5' || partKey === 'p6') data[partKey].passage = txt;
      }
      textAccum = [];
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line === '') {
        if (section === 'text') textAccum.push('');
        continue;
      }

      const mPart = line.match(/^PARTE\s*(4A|4B|7A|7B|[1-7])\b/i);
      if (mPart) {
        flushText();
        partKey = 'p' + mPart[1].toLowerCase();
        ensure(partKey);
        section = null; curItem = null;
        continue;
      }
      if (!partKey || !data[partKey]) continue;

      if (/^INSTRUCCIONES\s*:/i.test(line)) { data[partKey].instructions = line.replace(/^INSTRUCCIONES\s*:/i, '').trim(); section = 'meta'; continue; }
      if (/^TITULO\s*:/i.test(line)) { data[partKey].title = line.replace(/^TITULO\s*:/i, '').trim(); section = 'meta'; continue; }
      if (/^FOTO\s*:/i.test(line)) { data[partKey].photo = line.replace(/^FOTO\s*:/i, '').trim(); section = 'meta'; continue; }
      if (/^TEXTO\s*:?/i.test(line)) {
        flushText(); section = 'text';
        const rest = line.replace(/^TEXTO\s*:?/i, '').trim();
        if (rest) textAccum.push(rest);
        continue;
      }
      if (/^EJEMPLO/i.test(line)) {
        flushText(); section = 'example'; curItem = null;
        const rest = line.replace(/^EJEMPLO\s*:?/i, '').trim();
        if (partKey === 'p2' && rest) data.p2.exampleLabel = rest;
        continue;
      }
      if (/^PREGUNTAS/i.test(line)) { flushText(); section = 'items'; curItem = null; continue; }
      if (/^DESCRIPCIONES/i.test(line)) { flushText(); section = 'descriptions'; curItem = null; continue; }
      if (/^PALABRAS/i.test(line)) { flushText(); section = 'words'; curItem = null; continue; }
      if (/^RESPUESTA\s*:/i.test(line)) {
        const letter = line.replace(/^RESPUESTA\s*:/i, '').trim().toUpperCase();
        const idx = letter.charCodeAt(0) - 65;
        if (partKey === 'p2') { data.p2.exampleLetter = letter; }
        else if (section === 'example' && data[partKey] && data[partKey].example && /^[A-H]$/.test(letter))
          data[partKey].example.correct = idx;
        continue;
      }

      if (section === 'text') { textAccum.push(rawLine); continue; }

      const mNum = line.match(/^(\d+)[.)]\s*(.*)$/);
      const mLet = line.match(/^([A-H])[.)]\s*(.*)$/);
      const mQ = line.match(/^Q\s*:\s*(.*)$/i);

      if (section === 'example') {
        if (!data[partKey].example) continue;
        if (mQ) { data[partKey].example.q = mQ[1]; continue; }
        if (mNum && partKey === 'p1') { data.p1.example.label = mNum[0].trim(); continue; }
        if (mLet) { data[partKey].example.options.push(mLet[2]); continue; }
        if (partKey === 'p1' && !data.p1.example.label) { data.p1.example.label = line; }
        continue;
      }

      if (section === 'items') {
        if (mNum) {
          curItem = { num: mNum[1], text: '', q: '', options: [] };
          const rest = mNum[2];
          const mq = rest.match(/^Q\s*:\s*(.*)$/i);
          if (mq) { curItem.q = mq[1]; }
          else if (rest) { curItem.text = rest; curItem.q = rest; }
          data[partKey].items.push(curItem);
          continue;
        }
        if (mQ && curItem) { curItem.q = mQ[1]; curItem.text = mQ[1]; continue; }
        if (mLet && curItem) { curItem.options.push(mLet[2]); continue; }
        continue;
      }

      if (section === 'descriptions' && mNum) { data.p2.descriptions.push({ num: mNum[1], text: mNum[2] }); continue; }
      if (section === 'words' && mLet) { data.p2.words.push({ letter: mLet[1], text: mLet[2] }); continue; }
    }
    flushText();
    return data;
  }

  /* ---------------------------------------------------------- 2) renderizado de cada Parte */
  function esc(s) { return (s === undefined || s === null) ? '' : String(s); }

  const CAMERA_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h1.2l1-1.6h7.6l1 1.6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"/><circle cx="12" cy="13" r="3.3"/></svg>`;

  function photoBox(src) {
    if (src) return `<div class="photo-box"><img src="${esc(src)}" alt=""></div>`;
    return `<div class="photo-box placeholder">${CAMERA_SVG}</div>`;
  }

  function L(i) { return String.fromCharCode(65 + i); }
  function B(t) { return esc(t).replace(/^(\d+\.)/, '<b>$1</b>'); }
  function opts(o) { return o.map((t, i) => `<b>${L(i)}.</b> ${esc(t)}`); }
  function range(it) { return it.length ? [it[0].num, it[it.length - 1].num] : ['', '']; }
  function head(t, a, b, end) { return `<div class="pt">PARTE ${t}</div><div class="ins">RESPONDA LAS PREGUNTAS ${a} A ${b} DE ACUERDO CON ${end}</div>`; }
  function renderRespPill(options, correctIdx, n) {
    const validAnswer = Number.isInteger(correctIdx) && correctIdx >= 0 && correctIdx < options.length;
    return `<div class="rp">Respuesta:<span class="bx">${n !== undefined ? `<b>${n}.</b>` : ''}${options.map((o, i) => `<span class="rc${validAnswer && i === correctIdx ? ' on' : ''}">${L(i)}</span>`).join('')}</span></div>`;
  }
  function cols(items, k) {
    const f = it => `<div class="qi"><div><b>${it.num}.</b> ${esc(it.q)}</div>${opts(it.options).join('<br>')}</div>`;
    return `<div class="qc"><div>${items.slice(0, k).map(f).join('')}</div><div class="gv"></div><div>${items.slice(k).map(f).join('')}</div></div>`;
  }

  function renderP1(d, label) {
    const [a, b] = range(d.items);
    let h = head(label || '1', a, b, 'EL EJEMPLO.') + '<div class="p1w">';
    if (d.example.label) {
      h += `<div class="gb exb"><div>${esc(d.instructions)}</div><div><b>Example:</b></div>
      <div class="exr"><div>${B(d.example.label)}</div><div>${opts(d.example.options).join('<br>')}</div></div></div>
      <div class="rrow">${renderRespPill(d.example.options, d.example.correct, '0')}</div><div class="gl" style="margin-bottom:8mm"></div>`;
    }
    d.items.forEach(it => {
      h += `<div class="p1i"><div class="gb sm p1s"><b>${it.num}.</b> ${esc(it.text).toUpperCase()}</div><div class="p1o">${opts(it.options).join('<br>')}</div></div>`;
    });
    return h + '</div>';
  }

  function renderP2(d, label) {
    const [a, b] = range(d.descriptions);
    const ls = d.words.map(w => w.letter).filter(l => l !== d.exampleLetter);
    const rg = `${ls[0]}–${ls[ls.length - 1]}`;
    const left = Math.max(d.words.length - d.descriptions.length - 1, 0);
    return head(label || '2', a, b, 'EL EJEMPLO.') +
      `<div class="sub">Lea las descripciones de la columna de la izquierda (${a}–${b}). ¿Cuál palabra de la columna de la derecha (${rg}) concuerda con cada descripción?</div>
   <div class="sub">La opción ${esc(d.exampleLetter)} se usa para el ejemplo.${left ? ` ${left === 1 ? 'Sobra una palabra' : `Sobran ${left === 2 ? 'dos' : left} palabras`} más.` : ''}</div>
   <div class="sub">En las preguntas ${a}–${b}, marque la letra correcta ${rg} en su hoja de respuestas.</div>
   <div class="tt">${esc(d.title)}</div><div><b>EJEMPLO:</b></div>
   <div style="margin-top:2mm">${B(d.exampleLabel)}</div>
   <div class="rrow">${renderRespPill(d.words.map(w => w.text), d.words.findIndex(w => w.letter === d.exampleLetter), '0')}</div><div class="gl"></div>
   <div class="p2c"><div class="p2l"><div class="h">Descripciones:</div><div class="ls">${d.descriptions.map(x => `<div><b>${x.num}.</b> ${esc(x.text)}</div>`).join('')}</div></div>
   <div class="gv"></div>
   <div class="p2r"><div class="h">Palabras:</div><div class="ls">${d.words.map(w => `<div><span class="${w.letter === d.exampleLetter ? 'hl' : ''}"><b>${w.letter}.</b> ${esc(w.text)}</span></div>`).join('')}</div></div></div>`;
  }

  function renderP3(d, label) {
    const [a, b] = range(d.items);
    let h = head(label || '3', a, b, 'EL EJEMPLO') + `<div class="sub">${esc(d.instructions)}</div>`;
    if (d.example.q) {
      h += `<div class="ex3"><b>Ejemplo</b>:<div class="bub-row"><div class="gb bub">${esc(d.example.q)}</div>
      <div class="bcol">${d.example.options.map((o, i) => `<div class="gb bub">${L(i)}. ${esc(o)}</div>`).join('')}${renderRespPill(d.example.options, d.example.correct, '0')}</div></div></div><div class="gl"></div>`;
    }
    return h + cols(d.items, Math.ceil(d.items.length / 2));
  }

  function renderCloze(d, partLabel) {
    const [a, b] = range(d.items);
    const n = d.items.length ? Math.max(...d.items.map(it => it.options.length)) : 3;
    const lt = n === 4 ? 'A, B, C o D' : 'A, B o C';
    const txt = esc(d.paragraph).replace(/\((\d+)\)/g, '($1)&nbsp;______');
    let h = head(partLabel, a, b, 'EL SIGUIENTE TEXTO.') +
      `<div class="sub">Lea el texto y seleccione la palabra correcta para cada espacio.</div>
   <div class="sub">En las preguntas ${a}–${b}, marque ${lt} en su hoja de respuestas.</div>
   <div class="gb cbx">${photoBox(d.photo)}<div class="ct">${esc(d.title)}</div><div class="cp">${txt}</div></div>`;
    if (d.example.options.length) {
      h += `<div><b>Ejemplo</b></div><div class="exl"><span><b>0.</b>&nbsp; ${opts(d.example.options).join('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;')}</span>${renderRespPill(d.example.options, d.example.correct, '0')}</div><div class="gl"></div>`;
    }
    h += `<div class="ctb" style="${n === 4 ? 'grid-template-columns:17mm repeat(4,1fr);margin-left:2mm' : `grid-template-columns:17mm repeat(${n},46mm)`}">`;
    d.items.forEach(it => { h += `<div><b>${it.num}.</b></div>` + opts(it.options).map(o => `<div>${o}</div>`).join(''); });
    return h + '</div>';
  }

  function renderRead(d, partLabel, showPhotoSlot, six) {
    if (six === undefined) six = partLabel === '6';
    const [a, b] = range(d.items);
    const n = d.items.length ? Math.max(...d.items.map(it => it.options.length)) : 3;
    let h = head(partLabel, a, b, 'EL SIGUIENTE TEXTO.');
    if (!six) h += `<div class="sub">Lea el texto y responda las preguntas.</div><div class="sub">En las preguntas ${a}–${b}, marque ${n === 4 ? 'A, B, C o D' : 'A, B o C'} en su hoja de respuestas.</div>`;
    h += `<div class="gb rbx">${(d.photo || showPhotoSlot) ? photoBox(d.photo) : ''}${d.title ? `<div class="ct">${esc(d.title)}</div>` : ''}<div class="cp">${esc(d.passage)}</div></div>`;
    if (six) {
      h += `<div class="qg">${d.items.map((it, i) => `<div${(i === d.items.length - 1 && i % 2 === 0) ? ' class="wide"' : ''}><b>${it.num}.</b> ${esc(it.q)}<br>${opts(it.options).join('<br>')}</div>`).join('')}</div>`;
    } else h += cols(d.items, Math.floor(d.items.length / 2));
    return h;
  }

  /* orden de las Partes en el cuadernillo (solo se generan las que existan) */
  const ORDER = [
    ['p1', d => renderP1(d.p1)],
    ['p2', d => renderP2(d.p2)],
    ['p3', d => renderP3(d.p3)],
    ['p4a', d => renderCloze(d.p4a, '4A')],
    ['p4b', d => renderCloze(d.p4b, '4B')],
    ['p5', d => renderRead(d.p5, '5', true)],
    ['p6', d => renderRead(d.p6, '6', false)],
    ['p7', d => renderCloze(d.p7, '7')],
    ['p7a', d => renderCloze(d.p7a, '7A')],
    ['p7b', d => renderCloze(d.p7b, '7B')]
  ];
  const PHOTO_KEYS = ['p4a', 'p4b', 'p5', 'p7', 'p7a', 'p7b'];

  /* ---------------------------------------------------------- 3) autoajuste a 1 página */
  function fitPageToOnePage(pageEl) {
    const pad = pageEl.querySelector('.page-pad');
    const inner = pageEl.querySelector('.page-inner');
    const cs = getComputedStyle(pad);
    const padTop = parseFloat(cs.paddingTop);
    const padBottom = parseFloat(cs.paddingBottom);
    const available = pad.clientHeight - padTop - padBottom - 18;   // deja espacio al número de página

    inner.style.setProperty('--s', '1');
    if (inner.scrollHeight <= available) return;

    let lo = 0.5, hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      inner.style.setProperty('--s', mid.toFixed(3));
      if (inner.scrollHeight > available) { hi = mid; } else { lo = mid; }
    }
    inner.style.setProperty('--s', lo.toFixed(3));

    if (inner.scrollHeight > available + 3) {
      const warn = document.createElement('div');
      warn.className = 'overflow-warn';
      warn.textContent = '⚠ Demasiado contenido para 1 página: reduce preguntas o acorta textos.';
      pad.appendChild(warn);
    }
  }

  /* Crea una página de Inglés (marco, marca de agua, contenido, nº) y la ajusta a 1 hoja */
  function makePage(idx, body, stage, wm, colors) {
    const page = document.createElement('section');
    page.className = 'page ing-page';
    if (colors) { page.style.setProperty('--p', colors.c1); page.style.setProperty('--k', colors.c2); }
    const headerHtml = idx === 0 ? '<div class="hp">INGLES</div>' : '';
    page.innerHTML = `${wm && wm.src ? `<img class="wm" src="${wm.src}" alt="" style="opacity:${wm.opacity}">` : ''}<i class="fb t"></i><i class="fb b"></i><i class="fb l"></i><i class="fb r"></i>
      <div class="page-pad"><div class="page-inner" style="--s:1">${headerHtml}${body}</div></div>
      <div class="page-num-badge"></div>`;
    stage.appendChild(page);
    fitPageToOnePage(page);
    return { el: page, numEl: page.querySelector('.page-num-badge') };
  }

  /* Construye las páginas de Inglés dentro de `stage`.
     Devuelve { pages: [{el, numEl}], parts: [claves], error } */
  function build(text, photos, stage, wm) {
    let data;
    try { data = parseTemplate(text || ''); } catch (e) { return { pages: [], parts: [], error: e.message }; }
    PHOTO_KEYS.forEach(k => { if (data[k] && photos && photos[k]) data[k].photo = photos[k]; });

    const keys = ORDER.filter(([k]) => data[k]);
    const pages = [];
    keys.forEach(([k, fn], idx) => {
      let body;
      try { body = fn(data); } catch (e) { body = `<p>(No se pudo armar la ${k.toUpperCase()}: revisa su formato)</p>`; }
      pages.push(makePage(idx, body, stage, wm, null));
    });
    return { pages, parts: keys.map(x => x[0]) };
  }

  /* ---- Compilado: tarjetas libres (varias Partes del mismo tipo, en el orden que quieras)
     cards: [{type:'p1'|'p2'|'p3'|'cloze'|'read3'|'read4', label:'1A', body:'texto sin la línea PARTE', photo}] */
  const CARD_KEY = { p1: '1', p2: '2', p3: '3', cloze: '4A', read3: '5', read4: '5' };
  function buildCards(cards, stage, wm, colors) {
    const pages = []; let count = 0;
    cards.forEach((c, idx) => {
      let body;
      try {
        const key = CARD_KEY[c.type];
        const d = parseTemplate('PARTE ' + key + '\n' + (c.body || ''))['p' + key.toLowerCase()];
        if (c.photo) d.photo = c.photo;
        count += d.items ? d.items.length : (d.descriptions ? d.descriptions.length : 0);
        if (c.type === 'p1') body = renderP1(d, c.label);
        else if (c.type === 'p2') body = renderP2(d, c.label);
        else if (c.type === 'p3') body = renderP3(d, c.label);
        else if (c.type === 'cloze') body = renderCloze(d, c.label);
        else body = renderRead(d, c.label, c.type === 'read3', c.type === 'read4');
      } catch (e) { body = `<p>(No se pudo armar la Parte ${esc(c.label)}: revisa su formato)</p>`; }
      pages.push(makePage(idx, body, stage, wm, colors));
    });
    return { pages, count };
  }

  /* Plantillas vacías para una Parte nueva */
  const SKELETON = {
    p1: "INSTRUCCIONES: Marque A, B o C en la hoja de respuestas.\nEJEMPLO\n0. texto del aviso\nA. opción\nB. opción\nC. opción\nRESPUESTA: A\n\nPREGUNTAS\n1. texto del aviso\nA. opción\nB. opción\nC. opción\n",
    p2: "TITULO: TÍTULO\nINSTRUCCIONES: Lea las descripciones...\nEJEMPLO: 0. descripción de ejemplo\nRESPUESTA: H\nDESCRIPCIONES\n1. descripción\nPALABRAS\nA. palabra\nB. palabra\n",
    p3: "INSTRUCCIONES: Complete las siguientes conversaciones eligiendo la mejor respuesta (A, B o C).\nEJEMPLO\nQ: pregunta de ejemplo\nA. opción\nB. opción\nC. opción\nRESPUESTA: A\n\nPREGUNTAS\n1. Q: pregunta\nA. opción\nB. opción\nC. opción\n",
    cloze3: "TITULO: Título del texto\nTEXTO:\nEscribe el párrafo marcando cada espacio así: (0) (1) (2)...\nEJEMPLO\nA. opción\nB. opción\nC. opción\nRESPUESTA: A\n\nPREGUNTAS\n1.\nA. opción\nB. opción\nC. opción\n",
    cloze4: "TITULO: Título del texto\nTEXTO:\nEscribe el párrafo marcando cada espacio así: (0) (1) (2)...\nEJEMPLO\nA. opción\nB. opción\nC. opción\nD. opción\nRESPUESTA: A\n\nPREGUNTAS\n1.\nA. opción\nB. opción\nC. opción\nD. opción\n",
    read3: "TITULO: (opcional)\nTEXTO:\nEscribe aquí el texto de lectura.\n\nPREGUNTAS\n1. Q: pregunta\nA. opción\nB. opción\nC. opción\n",
    read4: "TITULO: (opcional)\nTEXTO:\nEscribe aquí el texto de lectura.\n\nPREGUNTAS\n1. Q: pregunta\nA. opción\nB. opción\nC. opción\nD. opción\n"
  };

  /* Parte (1…7) → tipo de tarjeta */
  const GROUP_TYPE = { '1': 'p1', '2': 'p2', '3': 'p3', '4': 'cloze', '5': 'read3', '6': 'read4', '7': 'cloze' };

  /* Texto con «PARTE x» (salida de fromWord) → lista de tarjetas {group, type, body} */
  function splitParts(text) {
    const out = []; let cur = null;
    String(text || '').split(/\r?\n/).forEach(line => {
      const m = line.match(/^PARTE\s+(4A|4B|7A|7B|[1-7])\s*$/i);
      if (m) { cur = { group: m[1][0], type: GROUP_TYPE[m[1][0]], lines: [] }; out.push(cur); }
      else if (cur) cur.lines.push(line);
    });
    return out.map(c => ({ group: c.group, type: c.type, body: c.lines.join('\n').trim() + '\n' }));
  }

  /* ---------------------------------------------------------- 4) Word → formato de texto */
  const ROMAN = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7' };
  const VALID = ['1', '2', '3', '4A', '4B', '5', '6', '7', '7A', '7B'];
  const normLabel = x => {
    x = String(x).toUpperCase();
    if (ROMAN[x]) x = ROMAN[x];
    if (x === '4') x = '4A';
    return VALID.includes(x) ? x : null;
  };

  function cleanLine(s) {
    s = String(s || '')
      .replace(/[\u2000-\u200a\u00a0\u202f\u3000]+/g, ' ')
      .replace(/\\par(?![a-zA-Z])\s*/g, ' ')
      .replace(/\\vspace\{[^}]*\}/g, '')
      .replace(/\\bloquetxt\{([^}]*)\}/g, '$1')
      .replace(/[\s\\]+$/, '')
      .replace(/\s+/g, ' ').trim();
    return s.replace(/</g, '&lt;');
  }

  /* Separa «A. x B. y C. z» en opciones. want = letra esperada primero (0 = A).
     implicitA: la «A.» se perdió en el Word («. across B. at C. during»). */
  function inlineSplit(str, want, implicitA) {
    const re = /(?:^|\s)([A-Ha-h])\s*[.)]\s+/g, marks = []; let m;
    while ((m = re.exec(str))) {
      const idx = m[1].toUpperCase().charCodeAt(0) - 65;
      const start = m.index + m[0].indexOf(m[1]);
      const end = m.index + m[0].length;
      if (idx === want) { marks.push({ idx, start, end }); want++; }
      else if (implicitA && !marks.length && idx === want + 1) {
        marks.push({ idx: want, start: 0, end: 0, implicit: true });
        marks.push({ idx, start, end }); want = idx + 1;
      }
    }
    const options = marks.map((mk, k) => {
      const to = k + 1 < marks.length ? marks[k + 1].start : str.length;
      let t = str.slice(mk.end, to).trim();
      if (mk.implicit) t = t.replace(/^[.)]\s*/, '').trim();
      return t;
    });
    const before = marks.length && !marks[0].implicit ? str.slice(0, marks[0].start).trim() : '';
    return { before, options };
  }

  function parseBody(lines) {
    const r = { pre: [], example: { stem: '', extra: [], options: [], answer: null, paren: '' }, items: [] };
    let sec = 'pre', cur = null;
    for (const line of lines) {
      if (/^opciones\s*:?$/i.test(line)) continue;
      if (/^(ejemplo|example)\s*:?$/i.test(line)) { sec = 'example'; cur = null; continue; }
      const ma = line.match(/^\(?\s*respuesta\s*:\s*([A-Ha-h])\b\.?\s*(.*?)\)?$/i);
      if (ma) { r.example.answer = ma[1].toUpperCase(); r.example.paren = (ma[2] || '').replace(/^\(|\)$/g, '').trim(); continue; }

      const mn = line.match(/^(\d{1,3})\s*[.)]\s*(.*)$/);
      if (mn) {
        const num = parseInt(mn[1], 10), rest = mn[2];
        if (num === 0) { sec = 'example'; cur = null; if (rest) r.example.stem = rest; continue; }
        sec = 'items'; cur = { num: mn[1], stem: '', options: [] }; r.items.push(cur);
        if (/^[.)]\s+\S/.test(rest)) {
          const res = inlineSplit(rest, 0, true);
          if (res.options.length >= 2) cur.options = res.options; else cur.stem = rest;
        } else {
          const res = inlineSplit(rest, 0, false);
          if (res.options.length >= 2) { cur.stem = res.before; cur.options = res.options; } else cur.stem = rest;
        }
        continue;
      }

      const mo = line.match(/^([A-Ha-h])\s*[.)]\s+/);
      if (mo) {
        const idx = mo[1].toUpperCase().charCodeAt(0) - 65;
        const res = inlineSplit(line, idx, false);
        const got = res.options.length ? res.options : [line.replace(/^[A-Ha-h]\s*[.)]\s*/, '')];
        if (sec === 'items' && cur) cur.options.push(...got);
        else if (sec === 'example') r.example.options.push(...got);
        else r.pre.push(line);
        continue;
      }

      if (sec === 'pre') r.pre.push(line);
      else if (sec === 'example') {
        if (!r.example.options.length && !r.example.stem) r.example.stem = line; else r.example.extra.push(line);
      } else if (sec === 'items' && cur) {
        if (cur.options.length) cur.options[cur.options.length - 1] += '<br>' + line;
        else cur.stem += (cur.stem ? ' ' : '') + line;
      }
    }
    return r;
  }

  const cap = s => s.replace(/^(\P{L}*)(\p{Ll})/u, (m, a, b) => a + b.toUpperCase());
  const isInstr = l => /^(lea\b|en las preguntas\b)/i.test(l);

  /* lines: líneas de texto de la sección «Inglés» del Word.
     Devuelve { text, warnings, parts } */
  function fromWord(lines) {
    const W = [];
    const all = (lines || []).map(cleanLine).filter(Boolean);
    all.filter(line => /^respuesta\s*:/i.test(line)).forEach(line => {
      if (!/^respuesta\s*:\s*[A-H](?:\s|$|[.(])/i.test(line))
        W.push(`Inglés: respuesta dudosa o incompleta («${line.slice(0, 90)}»); revisa el Word.`);
    });

    /* 1) bloques: cada «RESPONDA LAS PREGUNTAS…» abre uno; «PARTE x» le pone etiqueta */
    const blocks = []; let curB = null, pendingLabel = null, sawParte = false;
    for (const line of all) {
      const mp = line.match(/^PARTE\s+(\w+)\s*$/i);
      if (mp) { pendingLabel = normLabel(mp[1]); sawParte = true; curB = { label: pendingLabel, header: null, lines: [] }; blocks.push(curB); continue; }
      if (/^RESPONDA\s+LAS?\s+PREGUNTAS?/i.test(line)) {
        if (curB && curB.header === null && !curB.lines.length) curB.header = line;
        else { curB = { label: null, header: line, lines: [] }; blocks.push(curB); }
        continue;
      }
      if (curB) curB.lines.push(line);
    }
    const real = blocks.filter(b => b.lines.length);
    if (!real.length) {
      return { text: '', warnings: [sawParte || blocks.length ? 'Inglés: no encontré preguntas dentro de las Partes.' : 'Inglés: no encontré las Partes («RESPONDA LAS PREGUNTAS…» o «PARTE n»). Escribe el texto en el cuadro de Inglés.'], parts: [] };
    }

    /* 2) cada bloque → clave de Parte + texto */
    const used = {}, out = [];
    for (const b of real) {
      const body = parseBody(b.lines);
      const full = b.lines.join(' ');
      const nOpts = body.items.length ? Math.max(...body.items.map(i => i.options.length)) : 0;
      let kind;
      if (/columna de la izquierda|descripciones/i.test(full)) kind = 'match';
      else if (/\(\d+\)\s*_{2,}/.test(full)) kind = 'cloze';
      else if (body.pre.some(l => l.length > 110)) kind = 'read';
      else if (/avisos/i.test(full)) kind = 'p1';
      else if (/conversaci/i.test(full)) kind = 'p3';
      else kind = used['1'] ? 'p3' : 'p1';

      const allowed = { p1: ['1'], match: ['2'], p3: ['3'], cloze: ['4A', '4B', '7', '7A', '7B'], read: ['5', '6'] }[kind];
      const fallback = { p1: ['1'], match: ['2'], p3: ['3'],
        cloze: nOpts === 4 ? ['7', '7A', '7B', '4A', '4B'] : ['4A', '4B', '7', '7A', '7B'],
        read: nOpts === 4 ? ['6', '5'] : ['5', '6'] }[kind];
      let key = (b.label && allowed.includes(b.label) && !used[b.label]) ? b.label : fallback.find(k => !used[k]);
      if (!key) { W.push(`Inglés: un bloque (${(b.header || '').slice(0, 60)}…) no cupo en ninguna Parte y se omitió.`); continue; }
      used[key] = true;

      const lines = ['PARTE ' + key];
      const ex = body.example;
      if (kind === 'p1') {
        lines.push('INSTRUCCIONES: ' + body.pre.map(cap).join(' '));
        if (ex.stem) {
          lines.push('EJEMPLO', '0. ' + ex.stem);
          ex.options.forEach((o, i) => lines.push(String.fromCharCode(65 + i) + '. ' + o));
          if (ex.answer) lines.push('RESPUESTA: ' + ex.answer);
          else W.push(`Inglés, Parte ${key}: el ejemplo no trae una respuesta correcta; no se marcó ninguna opción.`);
        }
        lines.push('', 'PREGUNTAS');
        body.items.forEach(it => { lines.push(it.num + '. ' + it.stem); it.options.forEach((o, i) => lines.push(String.fromCharCode(65 + i) + '. ' + o)); lines.push(''); });
      } else if (kind === 'match') {
        const descs = body.items.filter(i => i.stem);
        const words = [].concat(...body.items.map(i => i.options));
        let title = '', label = ex.stem;
        if (ex.stem && ex.extra.length) { title = ex.stem; label = ex.extra[0]; }
        lines.push('TITULO: ' + title, 'INSTRUCCIONES: ' + (body.pre[0] || ''));
        lines.push('EJEMPLO: 0. ' + label);
        if (ex.answer) lines.push('RESPUESTA: ' + ex.answer);
        else W.push(`Inglés, Parte ${key}: el ejemplo no trae una respuesta correcta.`);
        lines.push('DESCRIPCIONES'); descs.forEach(d => lines.push(d.num + '. ' + d.stem));
        lines.push('PALABRAS'); words.forEach((w, i) => lines.push(String.fromCharCode(65 + i) + '. ' + w));
        if (!words.length) W.push(`Inglés, Parte ${key}: no encontré la lista de palabras (A, B, C…).`);
        if (ex.answer && ex.paren && words[ex.answer.charCodeAt(0) - 65] &&
          !words[ex.answer.charCodeAt(0) - 65].toLowerCase().includes(ex.paren.toLowerCase())) {
          W.push(`Inglés, Parte ${key}: el ejemplo dice «${ex.answer} (${ex.paren})», pero en la lista ${ex.answer} es «${words[ex.answer.charCodeAt(0) - 65]}». Revisa el Word.`);
        }
        if (ex.answer && !words[ex.answer.charCodeAt(0) - 65])
          W.push(`Inglés, Parte ${key}: la respuesta ${ex.answer} del ejemplo no existe en la lista de palabras.`);
      } else if (kind === 'p3') {
        lines.push('INSTRUCCIONES: ' + body.pre.map(cap).join(' '));
        if (ex.stem) {
          lines.push('EJEMPLO', 'Q: ' + ex.stem);
          ex.options.forEach((o, i) => lines.push(String.fromCharCode(65 + i) + '. ' + o));
          if (ex.answer) lines.push('RESPUESTA: ' + ex.answer);
          else W.push(`Inglés, Parte ${key}: el ejemplo no trae una respuesta correcta; no se marcó ninguna opción.`);
        }
        lines.push('', 'PREGUNTAS');
        body.items.forEach(it => { lines.push(it.num + '. ' + it.stem); it.options.forEach((o, i) => lines.push(String.fromCharCode(65 + i) + '. ' + o)); lines.push(''); });
      } else {                                         // cloze y read: título + texto
        const rest = body.pre.filter(l => !isInstr(l));
        let title = '';
        if (rest.length && rest[0].length < 70 && !/_/.test(rest[0]) && !/[.!?]$/.test(rest[0])) title = rest.shift();
        if (title) lines.push('TITULO: ' + title);
        lines.push('TEXTO:');
        rest.forEach(p => lines.push(kind === 'cloze' ? p.replace(/\((\d+)\)\s*_+/g, '($1)') : p));
        if (kind === 'cloze') {
          if (ex.options.length) {
            lines.push('EJEMPLO');
            ex.options.forEach((o, i) => lines.push(String.fromCharCode(65 + i) + '. ' + o));
            if (ex.answer) lines.push('RESPUESTA: ' + ex.answer);
            else W.push(`Inglés, Parte ${key}: el ejemplo no trae una respuesta correcta; no se marcó ninguna opción.`);
          }
          lines.push('', 'PREGUNTAS');
          body.items.forEach(it => { lines.push(it.num + '.'); it.options.forEach((o, i) => lines.push(String.fromCharCode(65 + i) + '. ' + o)); lines.push(''); });
        } else {
          lines.push('', 'PREGUNTAS');
          body.items.forEach(it => { lines.push(it.num + '. ' + it.stem); it.options.forEach((o, i) => lines.push(String.fromCharCode(65 + i) + '. ' + o)); lines.push(''); });
        }
      }

      const want = (b.header || '').match(/PREGUNTAS?\s+(\d+)\s+A\s+(?:LA\s+)?(\d+)/i);
      if (want && body.items.length) {
        const first = parseInt(body.items[0].num, 10), last = parseInt(body.items[body.items.length - 1].num, 10);
        if (first !== +want[1] || last !== +want[2])
          W.push(`Inglés, Parte ${key}: el encabezado dice preguntas ${want[1]} a ${want[2]}, pero leí de la ${first} a la ${last}.`);
      }
      const few = body.items.filter(i => i.options.length < 3).map(i => i.num);
      if (few.length && kind !== 'match') W.push(`Inglés, Parte ${key}: preguntas con menos de 3 opciones (${few.join(', ')}). Revisa el Word.`);
      out.push(lines.join('\n'));
    }
    return { text: out.join('\n\n'), warnings: W, parts: Object.keys(used) };
  }

  window.CatalystIngles = { GUIDE, parseTemplate, build, buildCards, fromWord, splitParts, SKELETON, GROUP_TYPE, PHOTO_KEYS };
})();
