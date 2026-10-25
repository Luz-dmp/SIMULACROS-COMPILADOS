/* ============================================================
   Lector de Word (.docx) → modelo del simulacro
   Sin servidor, sin Python: solo JavaScript + JSZip (incluido).
   Es el equivalente a convertir.py, pero corre en el navegador.
   ============================================================ */
(function () {
  'use strict';

  const NS = {
    w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
    mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    v: 'urn:schemas-microsoft-com:vml',
    rel: 'http://schemas.openxmlformats.org/package/2006/relationships'
  };

  /* ---------------------------------------------------------- utilidades XML */
  const kids = (el, ns, name) =>
    Array.from(el ? el.childNodes : []).filter(n => n.nodeType === 1 && n.namespaceURI === ns && (!name || n.localName === name));
  const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
  const attr = (el, ns, name) => (el && (el.getAttributeNS(ns, name) || el.getAttribute((ns === NS.w ? 'w:' : '') + name))) || null;
  const descendants = (el, ns, name) => Array.from(el.getElementsByTagNameNS(ns, name));

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  /* ---------------------------------------------------------- Run */
  function Run(o) { Object.assign(this, { text: '', b: false, i: false, u: false, sup: false, sub: false, img: null, br: false, html: null }, o || {}); }

  /* ---------------------------------------------------------- OMML (ecuaciones de Word) → HTML */
  function mathChildren(el) { return Array.from(el.childNodes).filter(n => n.nodeType === 1); }
  function mprop(el, tag, ns = NS.m) {
    const pr = kid(el, NS.m, tag + 'Pr'); return pr;
  }
  function mval(pr, tag) {
    if (!pr) return null; const e = kid(pr, NS.m, tag); return e ? attr(e, NS.m, 'val') : null;
  }
  function mm(el) {                       // devuelve [html, texto]
    const ln = el.localName; let h = '', t = '';
    const cat = nodes => { let H = '', T = ''; nodes.forEach(n => { const [a, b] = mm(n); H += a; T += b; }); return [H, T]; };
    const sub = (name) => { const e = kid(el, NS.m, name); return e ? cat(mathChildren(e)) : ['', '']; };
    switch (ln) {
      case 'oMath': case 'oMathPara': case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim': case 'fName': case 'oMathParaPr':
        if (ln === 'oMathParaPr') return ['', '']; return cat(mathChildren(el));
      case 'r': {
        let s = ''; kids(el, NS.m, 't').concat(kids(el, NS.w, 't')).forEach(x => s += x.textContent);
        const sty = mval(kid(el, NS.m, 'rPr'), 'sty');
        const plain = mval(kid(el, NS.m, 'rPr'), 'nor') !== null || sty === 'p';
        return ['<span class="mt' + (plain ? ' mp' : '') + '">' + esc(s) + '</span>', s];
      }
      case 'f': {
        const n = sub('num'), d = sub('den'); const type = mval(mprop(el, 'f'), 'type');
        if (type === 'lin') return [n[0] + '/' + d[0], n[1] + '/' + d[1]];
        return ['<span class="frac"><span class="fn">' + n[0] + '</span><span class="fd">' + d[0] + '</span></span>', '(' + n[1] + ')/(' + d[1] + ')'];
      }
      case 'sSup': { const e = sub('e'), s = sub('sup'); return [e[0] + '<sup>' + s[0] + '</sup>', e[1] + '^' + s[1]]; }
      case 'sSub': { const e = sub('e'), s = sub('sub'); return [e[0] + '<sub>' + s[0] + '</sub>', e[1] + '_' + s[1]]; }
      case 'sSubSup': {
        const e = sub('e'), a = sub('sub'), b = sub('sup');
        return [e[0] + '<span class="ss"><sup>' + b[0] + '</sup><sub>' + a[0] + '</sub></span>', e[1] + '_' + a[1] + '^' + b[1]];
      }
      case 'sPre': {
        const e = sub('e'), a = sub('sub'), b = sub('sup');
        return ['<span class="ss"><sup>' + b[0] + '</sup><sub>' + a[0] + '</sub></span>' + e[0], e[1]];
      }
      case 'rad': {
        const e = sub('e'), d = sub('deg'); const hide = mval(mprop(el, 'rad'), 'degHide');
        const deg = (!hide || hide === '0') && d[1] ? '<sup class="rdeg">' + d[0] + '</sup>' : '';
        return [deg + '<span class="rad">√<span class="rb">' + e[0] + '</span></span>', '√(' + e[1] + ')'];
      }
      case 'd': {
        const pr = mprop(el, 'd');
        const beg = pr && kid(pr, NS.m, 'begChr') ? attr(kid(pr, NS.m, 'begChr'), NS.m, 'val') : '(';
        const end = pr && kid(pr, NS.m, 'endChr') ? attr(kid(pr, NS.m, 'endChr'), NS.m, 'val') : ')';
        const sep = pr && kid(pr, NS.m, 'sepChr') ? attr(kid(pr, NS.m, 'sepChr'), NS.m, 'val') : '|';
        const parts = kids(el, NS.m, 'e').map(e => cat(mathChildren(e)));
        return [esc(beg || '') + parts.map(p => p[0]).join(esc(sep || '')) + esc(end || ''), (beg || '') + parts.map(p => p[1]).join(sep || '') + (end || '')];
      }
      case 'nary': {
        const pr = mprop(el, 'nary'); const chr = pr && kid(pr, NS.m, 'chr') ? attr(kid(pr, NS.m, 'chr'), NS.m, 'val') : '∫';
        const s = sub('sub'), u = sub('sup'), e = sub('e');
        return ['<span class="nary"><span class="nu">' + u[0] + '</span><span class="nc">' + esc(chr) + '</span><span class="nl">' + s[0] + '</span></span>' + e[0], chr + e[1]];
      }
      case 'func': { const n = sub('fName'), e = sub('e'); return [n[0] + e[0], n[1] + e[1]]; }
      case 'limLow': { const e = sub('e'), l = sub('lim'); return ['<span class="nary"><span class="nc">' + e[0] + '</span><span class="nl">' + l[0] + '</span></span>', e[1] + '_' + l[1]]; }
      case 'limUpp': { const e = sub('e'), l = sub('lim'); return ['<span class="nary"><span class="nu">' + l[0] + '</span><span class="nc">' + e[0] + '</span></span>', e[1]]; }
      case 'bar': { const e = sub('e'); return ['<span class="ovl">' + e[0] + '</span>', e[1]]; }
      case 'acc': {
        const pr = mprop(el, 'acc'); const chr = pr && kid(pr, NS.m, 'chr') ? attr(kid(pr, NS.m, 'chr'), NS.m, 'val') : '̂';
        const e = sub('e'); return ['<span class="acc" data-c="' + esc(chr) + '">' + e[0] + '</span>', e[1]];
      }
      case 'groupChr': case 'borderBox': case 'box': case 'phant': { const e = sub('e'); return [e[0], e[1]]; }
      case 'eqArr': {
        const rows = kids(el, NS.m, 'e').map(e => cat(mathChildren(e)));
        return [rows.map(r => r[0]).join('<br>'), rows.map(r => r[1]).join('; ')];
      }
      case 'm': {
        const rows = kids(el, NS.m, 'mr').map(mr => kids(mr, NS.m, 'e').map(e => cat(mathChildren(e))));
        return ['<table class="mx">' + rows.map(r => '<tr>' + r.map(c => '<td>' + c[0] + '</td>').join('') + '</tr>').join('') + '</table>',
          rows.map(r => r.map(c => c[1]).join(' ')).join('; ')];
      }
      default: return cat(mathChildren(el));
    }
  }

  /* ---------------------------------------------------------- contexto del documento */
  class Doc {
    constructor() { this.images = {}; this.numFmt = {}; this.warn = []; }

    /* ---- corridas de un párrafo ---- */
    runs(p) {
      const out = [];
      const self = this;
      const props = r => {
        const rpr = kid(r, NS.w, 'rPr'); let b = false, i = false, u = false, sup = false, sub = false;
        if (rpr) {
          const on = tag => { const e = kid(rpr, NS.w, tag); if (!e) return false; const v = attr(e, NS.w, 'val'); return !['0', 'false', 'none'].includes(v); };
          b = on('b'); i = on('i'); u = on('u');
          const va = kid(rpr, NS.w, 'vertAlign');
          if (va) { const v = attr(va, NS.w, 'val'); sup = v === 'superscript'; sub = v === 'subscript'; }
        }
        return { b, i, u, sup, sub };
      };
      const imgFromBlip = (blip, extCx) => {
        const rid = blip.getAttributeNS(NS.r, 'embed') || blip.getAttribute('r:embed');
        const im = self.images[rid];
        if (!im) return null;
        return { rid, src: im.src, nw: im.nw, nh: im.nh, unsupported: im.unsupported, wIn: extCx ? extCx / 914400 : (im.nw ? im.nw / 96 : 3) };
      };
      const runChildren = (parent, pr) => {
        for (const ch of Array.from(parent.childNodes)) {
          if (ch.nodeType !== 1) continue;
          const ns = ch.namespaceURI, ln = ch.localName;
          if (ns === NS.w) {
            if (ln === 't') out.push(new Run(Object.assign({ text: ch.textContent }, pr)));
            else if (ln === 'tab') out.push(new Run(Object.assign({ text: ' ' }, pr)));
            else if (ln === 'noBreakHyphen') out.push(new Run(Object.assign({ text: '‑' }, pr)));
            else if (ln === 'sym') {
              let c = parseInt(attr(ch, NS.w, 'char') || '0', 16); if (c >= 0xF000) c -= 0xF000;
              out.push(new Run(Object.assign({ text: c ? String.fromCharCode(c) : '' }, pr)));
            }
            else if (ln === 'br') { const t = attr(ch, NS.w, 'type'); if (!t || t === 'textWrapping') out.push(new Run({ br: true })); }
            else if (ln === 'drawing') {
              const blip = ch.getElementsByTagNameNS(NS.a, 'blip')[0];
              const ext = ch.getElementsByTagNameNS(NS.wp, 'extent')[0];
              if (blip) { const im = imgFromBlip(blip, ext ? parseInt(ext.getAttribute('cx')) : 0); if (im) out.push(new Run({ img: im })); }
            }
            else if (ln === 'pict' || ln === 'object') {
              const idata = ch.getElementsByTagNameNS(NS.v, 'imagedata')[0];
              if (idata) {
                const rid = idata.getAttributeNS(NS.r, 'id') || idata.getAttribute('r:id');
                const im = self.images[rid];
                if (im) {
                  let wIn = im.nw ? im.nw / 96 : 3;
                  const shape = ch.getElementsByTagNameNS(NS.v, 'shape')[0];
                  const st = shape && shape.getAttribute('style'); const mw = st && st.match(/width:([\d.]+)pt/);
                  if (mw) wIn = parseFloat(mw[1]) / 72;
                  out.push(new Run({ img: { rid, src: im.src, nw: im.nw, nh: im.nh, unsupported: im.unsupported, wIn } }));
                }
              }
            }
          } else if (ns === NS.mc && ln === 'AlternateContent') {
            const choice = kid(ch, NS.mc, 'Choice') || kid(ch, NS.mc, 'Fallback');
            if (choice) runChildren(choice, pr);
          } else if (ns === NS.m && ln === 'oMath') {
            const [h, t] = mm(ch); out.push(new Run({ text: t, html: h }));
          }
        }
      };
      (function walk(node) {
        for (const ch of Array.from(node.childNodes)) {
          if (ch.nodeType !== 1) continue;
          const ns = ch.namespaceURI, ln = ch.localName;
          if (ns === NS.w) {
            if (ln === 'r') runChildren(ch, props(ch));
            else if (['pPr', 'del', 'moveFrom', 'rPr', 'proofErr', 'bookmarkStart', 'bookmarkEnd'].includes(ln)) continue;
            else walk(ch);                                   // hyperlink, ins, smartTag, sdt…
          } else if (ns === NS.m) {
            if (ln === 'oMath') { const [h, t] = mm(ch); out.push(new Run({ text: t, html: h })); }
            else walk(ch);                                   // oMathPara
          } else if (ns === NS.mc && ln === 'AlternateContent') {
            const choice = kid(ch, NS.mc, 'Choice') || kid(ch, NS.mc, 'Fallback'); if (choice) walk(choice);
          }
        }
      })(p);
      return out;
    }

    /* ---- bloques del cuerpo en orden ---- */
    *blocks() {
      const self = this;
      function* it(parent) {
        for (const ch of Array.from(parent.childNodes)) {
          if (ch.nodeType !== 1 || ch.namespaceURI !== NS.w) continue;
          if (ch.localName === 'p') {
            const runs = self.runs(ch);
            let li = null;
            const ppr = kid(ch, NS.w, 'pPr'); const np = ppr && kid(ppr, NS.w, 'numPr');
            if (np) {
              const nid = attr(kid(np, NS.w, 'numId'), NS.w, 'val'); const lv = kid(np, NS.w, 'ilvl');
              if (nid && nid !== '0') {
                const lvl = lv ? attr(lv, NS.w, 'val') : '0';
                li = { id: nid, lvl, fmt: (self.numFmt[nid] && (self.numFmt[nid][lvl] || self.numFmt[nid]['0'])) || 'bullet' };
              }
            }
            yield { kind: 'p', runs, li };
          } else if (ch.localName === 'tbl') {
            const rows = [];
            for (const tr of kids(ch, NS.w, 'tr')) {
              const row = [];
              for (const tc of kids(tr, NS.w, 'tc')) {
                let span = 1; const tcPr = kid(tc, NS.w, 'tcPr'); const gs = tcPr && kid(tcPr, NS.w, 'gridSpan');
                if (gs) span = parseInt(attr(gs, NS.w, 'val')) || 1;
                const cell = [];
                for (const p of kids(tc, NS.w, 'p')) { cell.push(...self.runs(p)); cell.push(new Run({ text: ' ' })); }
                row.push({ runs: cell, span });
              }
              rows.push(row);
            }
            yield { kind: 'tbl', rows };
          } else if (ch.localName === 'sdt') {
            const c = kid(ch, NS.w, 'sdtContent'); if (c) yield* it(c);
          }
        }
      }
      yield* it(this.body);
    }
  }

  /* ---------------------------------------------------------- texto → HTML */
  function textHtml(t) {
    return esc(t).replace(/_{3,}/g, '<span class="blank"></span>');
  }
  const plain = runs => runs.reduce((s, r) => s + (r.img ? '' : r.br ? '\n' : r.text), '');

  function runsToHtml(runs, keepBold) {
    const txt = runs.filter(r => !r.img && !r.br && r.text.trim());
    if (!keepBold && txt.length && txt.every(r => r.b)) txt.forEach(r => { r.b = false; });
    const merged = [];
    for (const r of runs) {
      if (r.img) continue;
      if (r.html !== null) { merged.push({ key: 'M', html: ' ' + r.html + ' ', raw: true }); continue; }
      const t = r.br ? '\n' : r.text;
      const key = [r.b, r.i, r.u, r.sup, r.sub].join();
      const last = merged[merged.length - 1];
      if (last && !last.raw && last.key === key && !r.br && last.t !== '\n') last.t += t;
      else merged.push({ key, t, b: r.b, i: r.i, u: r.u, sup: r.sup, sub: r.sub, br: r.br });
    }
    let s = '';
    for (const m of merged) {
      if (m.raw) { s += m.html; continue; }
      if (m.t === '\n') { s += '<br>'; continue; }
      if (!m.t.trim()) { s += textHtml(m.t); continue; }
      const lead = m.t.slice(0, m.t.length - m.t.trimStart().length), trail = m.t.slice(m.t.trimEnd().length);
      let core = textHtml(m.t.trim());
      if (m.b) core = '<b>' + core + '</b>';
      if (m.i) core = '<i>' + core + '</i>';
      if (m.u) core = '<u>' + core + '</u>';
      if (m.sup) core = '<sup>' + core + '</sup>';
      if (m.sub) core = '<sub>' + core + '</sub>';
      s += textHtml(lead) + core + textHtml(trail);
    }
    s = s.trim().replace(/(<br>\s*)+$/, '');
    return s.replace(/^(<br>\s*)+/, '').replace(/\s{2,}/g, ' ').trim();
  }

  function stripPrefix(runs, n) {
    const out = []; let left = n;
    for (const r of runs) {
      if (r.img || r.br || left <= 0) { out.push(r); continue; }
      if (r.html !== null) { out.push(r); left = 0; continue; }
      if (r.text.length <= left) { left -= r.text.length; continue; }
      out.push(new Run({ text: r.text.slice(left), b: r.b, i: r.i, u: r.u, sup: r.sup, sub: r.sub })); left = 0;
    }
    return out;
  }
  function sliceRuns(runs, a, b) {
    const out = []; let pos = 0;
    for (const r of runs) {
      if (r.img) continue;
      const t = r.br ? '\n' : r.text; const s = pos, e = pos + t.length; pos = e;
      if (e <= a || s >= b) continue;
      if (r.html !== null) { out.push(r); continue; }
      const lo = Math.max(a, s) - s, hi = Math.min(b, e) - s;
      out.push(new Run({ text: t.slice(lo, hi), b: r.b, i: r.i, u: r.u, sup: r.sup, sub: r.sub, br: r.br && hi > lo }));
    }
    return out;
  }

  /* ---------------------------------------------------------- reconocimiento */
  const RE_Q = /^\s*(?:(?:PREGUNTA|PREG\.?|QUESTION)\s*(?:N[ÚU]M(?:ERO)?\.?\s*)?)?(\d{1,3})(?:\s*(?:[.)º°:]|[-–])\s*|\s+(?=[A-ZÁÉÍÓÚ¿¡])|$)/i;
  const RE_OPT = /^\s*\(?([A-Ga-g])\s*[.)]\s+/;
  const RE_RESP = /^\s*RESPONDA\s+LAS?\s+PREGUNTAS?/i;
  const RE_PARTE = /^\s*PARTE\s+\w+\s*$/i;
  const RE_SESION = /^\s*(?:(PRIMERA|SEGUNDA)\s+SESI[ÓO]N|SESI[ÓO]N\s+(1|2|UNO|DOS|I|II))\s*$/i;

  function inlineOptions(text) {
    const marks = []; let want = 'A';
    const re = /(?:(?<=\s)|^)([A-Da-d])\s*[.)]\s+(?=\S)/g; let m;
    while ((m = re.exec(text))) {
      if (m[1].toUpperCase() === want) { marks.push({ letter: m[1], start: m.index, end: m.index + m[0].length }); want = String.fromCharCode(want.charCodeAt(0) + 1); }
    }
    return marks;
  }

  function areaFromHeading(text, aliases) {
      let value = norm(text.replace(/ /g, ' ').trim().replace(/:$/, ''));
      value = value.replace(/^(?:area|asignatura|materia|prueba)\s*(?:icfes)?\s*(?:de\s+)?(?:[:\-–]\s*)?/, '').trim();
      value = value.replace(/\s*[-–]\s*\d+\s*(?:preguntas?)?$/, '').replace(/\s*\(\d+\s*preguntas?\)$/, '').trim();
      return aliases[value] || null;
    }

    const WORDS = {
      en: new Set('the a an and or but if then than of in on at to from for with by as is are was were be been being it its this that these those which who whom whose what when where why how can could may might must should would do does did have has had not no yes you your they their them we our he she his her i me my one two'.split(' ')),
      es: new Set('el la los las un una unos unas y o pero si entonces de del en sobre para por con como es son fue eran ser estar esto esta estos estas que quien quienes cual cuales cuando donde porque como puede pueden debe deben hacer tiene hay no sí usted ustedes ellos ellas nosotros nuestro'.split(' '))
    };

  function classifyQuestion(text, contextText, explicitCode, sectionText) {
      if (explicitCode) return { code: explicitCode, confidence: 1, reason: 'Encabezado explícito del área.' };
      const evidence = `${text || ''} ${contextText || ''}`;
      const languageContent = norm(`${text || ''} ${sectionText || contextText || ''}`).replace(/[^a-z0-9%√π+−×÷=<>.,\s]/g, ' ');
      const tokens = languageContent.match(/[a-z]{2,}/g) || [];
      const counts = { en: 0, es: 0 };
      tokens.forEach(token => { if (WORDS.en.has(token)) counts.en++; if (WORDS.es.has(token)) counts.es++; });
      const englishRatio = counts.en / Math.max(tokens.length, 1);
      const spanishRatio = counts.es / Math.max(tokens.length, 1);
      const englishStructure = /(?:\bpart\s+(?:i|ii|iii|iv|[1-7])\b|\bmark\s+[abc]\b|\bchoose\s+the\s+correct\b|\bread\s+the\s+text\b)/i.test(languageContent);

      const patterns = {
        Mat: [
          /(?:ecuaci[oó]n|funci[oó]n|variable|inc[oó]gnita|factoriz|polinom|proporci[oó]n|porcentaje|probabilidad|estad[ií]stic|per[ií]metro|[aá]rea de un|radio|di[aá]metro|pendiente|coordenad|fracci[oó]n|expresi[oó]n algebraica)/i,
          /(?:calcula|calcular|determina el valor|resuelve|cu[aá]nto mide|cu[aá]ntos|cu[aá]l es el resultado|representa num[eé]ricamente)/i,
          /(?:[=<>±×÷√∑π]|\b\d+\s*[%×÷+\-]\s*\d+|\bx\s*(?:\^|²|³)\s*\d*)/i
        ],
        Nat: [
          /(?:c[eé]lula|organismo|especie|ecosistema|biodivers|gen[eé]tic|[aá]tomo|mol[eé]cula|reacci[oó]n qu[ií]mica|concentraci[oó]n|fuerza|energ[ií]a|velocidad|masa|temperatura|electricidad|gravedad|[oó]rgano|tejido)/i,
          /(?:experimento|hip[oó]tesis|variable independiente|variable dependiente|observaci[oó]n|grupo de control|muestra|evidencia experimental|proceso biol[oó]gico)/i,
          /(?:gr[aá]fica|tabla|datos|resultados|conclu(?:si[oó]n|ye)|tendencia)/i
        ],
        Soc: [
          /(?:constituci[oó]n|gobierno|estado colombiano|rama judicial|democracia|ciudadan|derechos?|deberes?|ley|partido pol[ií]tico|instituci[oó]n|presidente|congreso|conflicto armado|soberan[ií]a)/i,
          /(?:colonia|independencia|revoluci[oó]n|migraci[oó]n|econom[ií]a|mercado|producci[oó]n|desigualdad|conflicto social|cultura pol[ií]tica)/i,
          /(?:actor social|causa y consecuencia|participaci[oó]n ciudadana|extralimitaci[oó]n|autonom[ií]a judicial|fuente hist[oó]rica)/i
        ],
        Lec: [
          /(?:narrador|poema|novela|art[ií]culo|discurso|met[aá]fora|iron[ií]a|argumento|tesis|intenci[oó]n comunicativa|cr[oó]nica|figura ret[oó]rica)/i,
          /(?:se infiere|puede inferirse|prop[oó]sito principal|sentido de la expresi[oó]n|idea principal|tema central|relaci[oó]n entre|funci[oó]n del|conclusi[oó]n del texto|contenido y estilo|tipo de publicaci[oó]n|significado opuesto|qu[eé] prejuicio|actitud.{0,60}(?:refleja|revela)|comportamiento se critica)/i,
          /(?:el autor sostiene|la postura del autor|significado de la palabra|subt[ií]tulo|complemento apropiado para el t[ií]tulo|conector|cohesi[oó]n textual|seg[uú]n la historia|seg[uú]n el texto|en ese contexto|la autora|fragmento tomado|enunciado que hace parte)/i
        ]
      };
      const scores = {};
      Object.entries(patterns).forEach(([code, groups]) => {
        scores[code] = groups.reduce((score, pattern) => score + (pattern.test(evidence) ? 1 : 0), 0);
      });
      const hasPassage = (contextText || '').trim().length >= 160;
      if (hasPassage && scores.Mat < 2 && scores.Nat < 2 && scores.Soc < 2 &&
        /(?:qu[eé] prejuicio|qu[eé] significa|actitud.{0,60}(?:refleja|revela)|seg[uú]n (?:la historia|el texto)|prop[oó]sito principal|premisa principal|significado opuesto|en ese contexto|tipo de publicaci[oó]n|subt[ií]tulo|complemento apropiado para el t[ií]tulo|comportamiento se critica|la autora|fragmento tomado|enunciado que hace parte|sentido de la expresi[oó]n)/i.test(text || '')) {
        scores.Lec = Math.max(scores.Lec, 2);
      }
      if (englishStructure && englishRatio >= 0.18 && englishRatio > spanishRatio) scores.Ing = 4;
      else if (tokens.length >= 8 && englishRatio >= 0.24 && englishRatio - spanishRatio >= 0.1) scores.Ing = 3;

      const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      const [code, score] = ranked[0] || [null, 0];
      const margin = score - (ranked[1]?.[1] || 0);
      if (score < 2 || margin < 1) return { code: null, confidence: score / 4, reason: 'La evidencia del enunciado no distingue un área con suficiente confianza.' };
      const reason = code === 'Lec' && hasPassage
        ? 'Inferencia por tipo de pregunta de comprensión y asociación con un texto base extenso.'
        : 'Inferencia por contenido y estructura; verificar si el material es interdisciplinario.';
      return { code, confidence: Math.min(0.95, 0.55 + score * 0.1 + margin * 0.05), reason };
    }

  function htmlText(html) {
      return String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    }

  function atomText(atom) {
      if (atom.html) return htmlText(atom.html);
      if (atom.t === 'tbl') return atom.rows.flat().map(cell => htmlText(cell.html)).join(' ');
      if (atom.t === 'bloque' || atom.t === 'par' || atom.t === 'op' || atom.t === 'opc' || atom.t === 'ctitle') return htmlText(atom.html);
      return '';
    }

  function classifySessions(sessions, warnings, areaDefs) {
      const questionBlocks = [], rebuilt = { 1: [], 2: [] };
      [1, 2].forEach(session => {
        let sourceOrder = 0;
        for (const [sourceIndex, source] of sessions[session].entries()) {
          const contextGroupId = `s${session}-source-${sourceIndex}`;
          const starts = [];
          source.atoms.forEach((atom, index) => { if (atom.t === 'preg') starts.push(index); });
          if (!starts.length) {
            if (source.explicit && source.atoms.length) rebuilt[session].push(source);
            continue;
          }
          const leading = source.atoms.slice(0, starts[0]);
          const rawText = (source.raw || []).join(' ');
          const sectionText = `${rawText} ${source.atoms.map(atomText).join(' ')}`;
          starts.forEach((start, index) => {
            const end = starts[index + 1] ?? source.atoms.length;
            const atoms = (index === 0 ? leading : []).concat(source.atoms.slice(start, end));
            const question = atoms.find(atom => atom.t === 'preg');
            const text = atomText(question);
            const contextText = leading.map(atomText).join(' ');
            const result = classifyQuestion(text, contextText, source.explicit ? source.code : null, sectionText);
            const id = `s${session}-q${sourceOrder++}-${question.n}`;
            const block = {
              id, session, number: question.n, code: result.code, confidence: result.confidence,
              contextGroupId,
              reason: result.reason, explicit: !!source.explicit, atoms,
              raw: index === 0 ? (source.raw || []).slice() : []
            };
            questionBlocks.push(block);
          });
        }
      });
      const rebuild = () => {
        rebuilt[1] = []; rebuilt[2] = [];
        questionBlocks.forEach(block => {
          const code = block.code;
          let area = rebuilt[block.session][rebuilt[block.session].length - 1];
          if (!area || area.code !== code) {
            area = { code, name: areaDefs[code]?.name || 'POR REVISAR', atoms: [], raw: [] };
            rebuilt[block.session].push(area);
          }
          area.atoms.push(...block.atoms);
          area.raw.push(...block.raw);
        });
      };
      rebuild();
      questionBlocks.filter(block => !block.code).forEach(block => {
        warnings.push(`Sesión ${block.session}, pregunta ${block.number}: área «Por revisar». ${block.reason}`);
      });
      return { sessions: rebuilt, questionBlocks, rebuild };
  }

  /* ---------------------------------------------------------- conversión principal */
  function convert(doc, config) {
    const AREAS = config.areaAliases, AREADEF = config.areas;
    const W = [];                                    // advertencias
    const sessions = { 1: [], 2: [] };
    const st = { ses: null, last_q: 0, in_q: false, opt: null, in_passage: false, optCount: 0, letterCount: {}, questionStart: 0 };
    let cur = null;
    const pendingList = [];

    const blocks = Array.from(doc.blocks());
    const hasSessionMarkers = blocks.some(b => b.kind === 'p' && RE_SESION.test(plain(b.runs).replace(/ /g, ' ').trim()));
    if (!hasSessionMarkers) st.ses = 1;               // Word sin marcas de sesión → todo es sesión 1

    const emit = a => { if (cur) cur.atoms.push(a); };
    function startArea(code, explicit = true) {
      if (st.ses === null) return;
      cur = { code, name: AREADEF[code]?.name || 'POR REVISAR', atoms: [], raw: [], explicit };
      sessions[st.ses].push(cur);
      st.last_q = 0; st.in_q = false; st.opt = null; st.in_passage = false; st.optCount = 0;
    }
    function moveQuestionToArea(code) {
      if (!cur || !st.in_q || cur.code === code) return;
      const moved = cur.atoms.splice(st.questionStart);
      cur = { code, name: AREADEF[code]?.name || 'POR REVISAR', atoms: moved, raw: [], explicit: true };
      sessions[st.ses].push(cur);
      st.questionStart = 0;
    }

    function flushList() {
      if (!pendingList.length) return;
      emit({ t: 'list', fmt: pendingList[0][0], items: pendingList.map(x => x[1]) });
      pendingList.length = 0;
    }
    function closeQuestion() {
      if (st.in_q) {
        flushList();
        if (st.optCount < 3 && !st.hasFig && !(cur && cur.code === 'Ing')) W.push(`Sesión ${st.ses}, pregunta ${st.last_q}: se detectaron solo ${st.optCount} opciones (revisa el Word).`);
        emit({ t: 'sep' });
        st.in_q = false;
      }
      st.opt = null;
    }
    function emitFigure(img) {
      st.hasFig = true;
      if (img.unsupported) { W.push(`Sesión ${st.ses}, pregunta ${st.last_q}: hay una imagen en formato no compatible (${img.unsupported}); pégala como PNG/JPG en el Word.`); emit({ t: 'par', html: '<i>[imagen no compatible]</i>' }); return; }
      emit({ t: 'fig', src: img.src, nw: img.nw, nh: img.nh, frac: Math.max(0.25, Math.min(1, img.wIn / 3.3)) });
    }
    function handleOptions(runs, marks) {
      const full = plain(runs);
      marks.forEach((mk, k) => {
        const end = k + 1 < marks.length ? marks[k + 1].start : full.length;
        emit({ t: 'op', l: mk.letter.toUpperCase(), html: runsToHtml(sliceRuns(runs, mk.end, end)) });
        st.opt = mk.letter.toUpperCase(); st.optCount++;
      });
    }

    for (let idx = 0; idx < blocks.length; idx++) {
      const b = blocks[idx];
      if (b.kind === 'tbl') {
        flushList();
        const cellText = b.rows.flat().map(c => plain(c.runs).trim()).filter(Boolean);
        const tableArea = cellText.map(text => areaFromHeading(text, AREAS)).find(Boolean);
        if (tableArea && !st.in_q) {
          closeQuestion(); flushList(); startArea(tableArea);
        }
        if (!cur) startArea(null, false);
        const ncols = Math.max(...b.rows.map(r => r.reduce((s, c) => s + c.span, 0)));
        emit({
          t: 'tbl', ncols, rows: b.rows.map((row, ri) => row.map(c => ({
            span: c.span, head: ri === 0,
            html: runsToHtml(c.runs, ri === 0).replace(/^<b>([\s\S]*)<\/b>$/, '$1'),
            imgs: c.runs.filter(r => r.img && !r.img.unsupported).map(r => r.img)
          })))
        });
        continue;
      }

      let runs = b.runs, li = b.li;
      const full0 = plain(runs).replace(/ /g, ' ');
      const stripped = full0.trim();
      const imgs = runs.filter(r => r.img).map(r => r.img);
      if (/\b(Nota|NOTA)\s*:/.test(stripped) || /\[(imagen|gráfica|figura)/i.test(stripped))
        W.push(`REVISAR nota del transcriptor (sesión ${st.ses}, pregunta ${st.last_q}): ${stripped.slice(0, 110)}`);

      /* ---- sesión */
      const ms = RE_SESION.exec(stripped);
      if (ms) {
        const word = (ms[1] || ms[2]).toUpperCase();
        const idxS = ['PRIMERA', '1', 'UNO', 'I'].includes(word) ? 1 : 2;
        if (idxS === 1 && st.ses === null && idx < 40) continue;      // índice de la portada del Word
        closeQuestion(); flushList();
        st.ses = idxS; st.last_q = 0; cur = null;
        continue;
      }
      if (st.ses === null) continue;

      /* ---- área */
      const areaCode = areaFromHeading(stripped, AREAS);
      if (areaCode && stripped.length < 100 && !imgs.length) {
        if (st.in_q) moveQuestionToArea(areaCode);
        else { closeQuestion(); flushList(); startArea(areaCode); }
        continue;
      }
      if (!cur) startArea(null, false);

      /* ---- viñetas/numeración automática de Word con letras → opciones A. B. C. */
      if (li && st.in_q && ['upperLetter', 'lowerLetter'].includes(li.fmt) && !RE_OPT.test(full0)) {
        const k = (st.letterCount[li.id] = (st.letterCount[li.id] || 0));
        if (k < 7) {
          st.letterCount[li.id]++;
          runs = [new Run({ text: String.fromCharCode(65 + k) + '. ' }), ...runs];
          li = null;
        }
      }
      const full = plain(runs).replace(/ /g, ' ');
      const str = full.trim();
      (cur.raw || (cur.raw = [])).push(str);   // texto crudo (lo usa el diseño de Inglés)

      /* ---- párrafo vacío */
      if (!str && !imgs.length) { if (st.opt === 'D') st.opt = 'END'; continue; }

      /* ---- encabezado de bloque (RESPONDA…) / PARTE */
      if (RE_RESP.test(str) || RE_PARTE.test(str)) {
        closeQuestion(); flushList();
        st.in_passage = true;
        emit({ t: 'bloque', html: runsToHtml(runs, true).replace(/<\/?b>/g, '') });
        continue;
      }

      /* ---- inicio de pregunta */
      const mq = RE_Q.exec(full);
      if (mq && !imgs.length && !(li && li.fmt !== 'decimal' && li.fmt !== 'bullet')) {
        const num = parseInt(mq[1]); const expected = st.last_q + 1;
        if (num > 0 && (num === expected || (st.last_q === 0 && num <= 200) || (expected < num && num <= expected + 2))) {
          if (num !== expected && st.last_q !== 0 && cur.code !== 'Ing') W.push(`Sesión ${st.ses}: salto de numeración ${st.last_q} → ${num}`);
          closeQuestion(); flushList();
          if (st.in_passage) { emit({ t: 'sep' }); st.in_passage = false; }
          st.last_q = num; st.in_q = true; st.opt = null; st.optCount = 0; st.hasFig = false; st.letterCount = {};
          st.questionStart = cur.atoms.length;
          const rest = stripPrefix(runs, mq[0].length);
          const fr = plain(rest);
          const marks = /[?:.]\s+A\s*[.)]\s/.test(fr) ? inlineOptions(fr) : [];
          if (marks.length && marks[0].start > 0) {
            emit({ t: 'preg', n: num, html: runsToHtml(sliceRuns(rest, 0, marks[0].start)) });
            handleOptions(rest, marks);
          } else emit({ t: 'preg', n: num, html: runsToHtml(rest) });
          rest.filter(r => r.img).forEach(r => emitFigure(r.img));
          continue;
        }
      }

      /* ---- opciones */
      if (RE_OPT.test(full) && st.in_q) {
        flushList();
        const inl = inlineOptions(full);
        if (inl.length >= 2) handleOptions(runs, inl);
        else {
          const m = RE_OPT.exec(full);
          const body = stripPrefix(runs, m[0].length);
          emit({ t: 'op', l: m[1].toUpperCase(), html: runsToHtml(body) });
          st.opt = m[1].toUpperCase(); st.optCount++;
          body.filter(r => r.img).forEach(r => emitFigure(r.img));
        }
        continue;
      }

      /* ---- listas */
      if (li && !imgs.length) {
        if (pendingList.length && pendingList[0][0] !== li.fmt) flushList();
        const item = runsToHtml(runs);
        const mq2 = /\s(¿[^¿]*\?)\s*$/.exec(item);
        if (mq2 && item.length > 40) {
          pendingList.push([li.fmt, item.slice(0, mq2.index)]); flushList();
          emit({ t: 'par', html: mq2[1], q: st.in_q });
        } else pendingList.push([li.fmt, item]);
        continue;
      }
      flushList();

      /* ---- imágenes en párrafo propio */
      if (imgs.length) {
        const t = runsToHtml(runs);
        if (t) emit({ t: 'par', html: t, q: st.in_q });
        imgs.forEach(emitFigure);
        continue;
      }

      /* ---- continuación de opción o texto normal */
      const t = runsToHtml(runs);
      if (st.opt && st.opt !== 'END' && st.in_q) emit({ t: 'opc', html: t });
      else if (/^\s*(Tomado|Adaptado|Fuente|Recuperado)/i.test(str) && str.length < 400) emit({ t: 'fuente', html: t });
      else if (st.in_passage && str.length < 70 && str === str.toUpperCase() && !str.endsWith('.')) emit({ t: 'ctitle', html: runsToHtml(runs, true).replace(/<\/?b>/g, '') });
      else emit({ t: 'par', html: t, q: st.in_q });
    }
    closeQuestion(); flushList();

    /* limpiar áreas vacías y contar */
    const classified = classifySessions(sessions, W, AREADEF);
    const englishQuestionKeys = new Set(classified.questionBlocks.filter(q => q.code === 'Ing').map(q => `${q.session}:${q.number}`));
    const filteredWarnings = W.filter(w => {
      const match = /^Sesión (\d+), pregunta (\d+): se detectaron solo \d+ opciones/.exec(w);
      return !match || !englishQuestionKeys.has(`${match[1]}:${match[2]}`);
    });
    const stats = {};
    for (const s of [1, 2]) {
      classified.sessions[s] = classified.sessions[s].filter(a => a.atoms.length);
      stats[s] = classified.questionBlocks.filter(question => question.session === s && question.code).length;
    }
    return {
      sessions: classified.sessions, stats, warnings: Array.from(new Set(filteredWarnings)),
      questionBlocks: classified.questionBlocks,
      setQuestionArea(result, id, code) {
        const block = result.questionBlocks.find(question => question.id === id);
        if (!block || (code !== null && !AREADEF[code])) return false;
        block.code = code;
        block.reason = code ? 'Área revisada manualmente por administración.' : 'Marcada para revisión manual.';
        block.explicit = !!code;
        const updated = classifySessions({ 1: [], 2: [] }, [], AREADEF);
        updated.questionBlocks.splice(0, updated.questionBlocks.length, ...result.questionBlocks);
        updated.rebuild();
        result.sessions = updated.sessions;
        result.stats = { 1: 0, 2: 0 };
        [1, 2].forEach(session => { result.stats[session] = result.questionBlocks.filter(question => question.session === session && question.code).length; });
        const englishQuestions = new Set(result.questionBlocks.filter(question => question.code === 'Ing').map(question => `${question.session}:${question.number}`));
        result.warnings = result.warnings.filter(w => {
          if (/área «Por revisar»/.test(w)) return false;
          const match = /^Sesión (\d+), pregunta (\d+): se detectaron solo \d+ opciones/.exec(w);
          return !match || !englishQuestions.has(`${match[1]}:${match[2]}`);
        });
        result.questionBlocks.filter(question => !question.code).forEach(question => {
          result.warnings.push(`Sesión ${question.session}, pregunta ${question.number}: área «Por revisar». ${question.reason}`);
        });
        result.warnings = Array.from(new Set(result.warnings));
        return true;
      }
    };
  }

  /* ---------------------------------------------------------- carga del archivo */
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };

  async function parse(arrayBuffer, config) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Este archivo no parece un Word (.docx). Si es .doc antiguo, ábrelo en Word y guárdalo como .docx.');
    const dp = new DOMParser();
    const xml = async name => { const f = zip.file(name); return f ? dp.parseFromString(await f.async('string'), 'application/xml') : null; };

    const doc = new Doc();
    const document_ = await xml('word/document.xml');
    doc.body = document_.getElementsByTagNameNS(NS.w, 'body')[0];

    /* numeración (listas) */
    const numXml = await xml('word/numbering.xml');
    if (numXml) {
      const abs = {};
      descendants(numXml, NS.w, 'abstractNum').forEach(a => {
        const id = attr(a, NS.w, 'abstractNumId'); abs[id] = {};
        kids(a, NS.w, 'lvl').forEach(l => { const f = kid(l, NS.w, 'numFmt'); abs[id][attr(l, NS.w, 'ilvl')] = f ? attr(f, NS.w, 'val') : 'bullet'; });
      });
      descendants(numXml, NS.w, 'num').forEach(n => {
        const nid = attr(n, NS.w, 'numId'); const an = kid(n, NS.w, 'abstractNumId');
        if (an && abs[attr(an, NS.w, 'val')]) doc.numFmt[nid] = abs[attr(an, NS.w, 'val')];
      });
    }

    /* imágenes */
    const relsXml = await xml('word/_rels/document.xml.rels');
    if (relsXml) {
      const rels = descendants(relsXml, NS.rel, 'Relationship').filter(r => /\/image$/.test(r.getAttribute('Type')));
      for (const rel of rels) {
        const id = rel.getAttribute('Id'); let target = rel.getAttribute('Target');
        target = target.startsWith('/') ? target.slice(1) : 'word/' + target;
        const f = zip.file(target) || zip.file(decodeURIComponent(target));
        if (!f) continue;
        const ext = target.split('.').pop().toLowerCase();
        if (!MIME[ext]) { doc.images[id] = { src: null, unsupported: ext.toUpperCase() }; continue; }
        const blob = new Blob([await f.async('uint8array')], { type: MIME[ext] });
        const src = URL.createObjectURL(blob);
        const dims = await new Promise(res => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([0, 0]); im.src = src; });
        doc.images[id] = { src, nw: dims[0], nh: dims[1] };
      }
    }
    return convert(doc, config);
  }

  window.DocxParser = { parse };
})();
