/* ============================================================
   Portada de cada sesión (réplica de portada.tex, medidas en px)
   ============================================================ */
(function () {
  'use strict';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const icon = name => {
    const i = window.ICONS && window.ICONS[name]; if (!i) return '';
    return `<svg class="ico" viewBox="0 0 ${i.w} ${i.h}" aria-hidden="true"><path fill="currentColor" d="${i.d}"/></svg>`;
  };

  function build(opts) {
    /* opts: {code, nQuestions, sessionName, centralImage, qrImage, tenEnCuenta[], comoRealizar[], contactoA[], contactoB[], tags:{horas,extra}} */
    const up = s => esc(String(s).toUpperCase());
    const li = arr => arr.filter(x => x.trim()).map(x => `<li>${up(x)}</li>`).join('');
    const central = opts.centralImage
      ? `<img class="cv-img" src="${opts.centralImage}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cv-ph',textContent:'SUBE AQUÍ LA ILUSTRACIÓN DE TU PORTADA (assets/imagen-central.png)'}))">`
      : `<div class="cv-ph">SUBE AQUÍ LA ILUSTRACIÓN DE TU PORTADA (assets/imagen-central.png)</div>`;
    const qr = opts.qrImage
      ? `<img src="${opts.qrImage}" alt="QR" onerror="this.replaceWith(document.createTextNode('QR'))">` : 'QR';
    const row = (ic, t) => `<div>${icon(ic)}<span>${up(t)}</span></div>`;
    const A = opts.contactoA, B = opts.contactoB;

    const page = document.createElement('section');
    page.className = 'page cover';
    page.innerHTML = `
      <div class="cv-band"><span>${esc(opts.code)}</span></div>
      <div class="cv-title"><span class="sh">CATALYST</span><span class="mn">CATAL<i>Y</i><em>ST</em></span></div>
      <div class="cv-sub"><span class="tri l"></span><span class="edu">EDUCATION</span><span class="tri r"></span></div>
      <div class="cv-div" style="top:238.2px"></div>
      <div class="cv-tags">
        <span>${icon('stopwatch')}${up(opts.tags.horas)}</span><b>|</b>
        <span>${icon('file-lines')}${esc(opts.nQuestions)} PREGUNTAS</span><b>|</b>
        <span>${icon('graduation-cap')}${up(opts.sessionName)}</span><b>|</b>
        <span>${icon('brain')}${up(opts.tags.extra)}</span>
      </div>
      <div class="cv-div" style="top:310.2px"></div>
      <div class="cv-art">${central}</div>
      <div class="cv-low"><div class="cv-boxes">
        <div class="cv-box o"><h3>TEN EN CUENTA</h3><ul>${li(opts.tenEnCuenta)}</ul></div>
        <div class="cv-box p"><h3>${esc(opts.comoTitle || '¿CÓMO REALIZAR ESTE SIMULACRO?')}</h3><ul>${li(opts.comoRealizar)}</ul></div>
      </div>
      <div class="cv-foot">
        <div class="colA">${row('camera', A[0] || '')}${row('phone', A[1] || '')}</div>
        <div class="colB">${row('music', B[0] || '')}${row('book', B[1] || '')}</div>
        <div class="qr">${qr}</div>
      </div></div>`;
    if (opts.colors) {
      const c = opts.colors;
      page.style.setProperty('--rosa', c.rosa); page.style.setProperty('--naranja', c.naranja);
      page.style.setProperty('--rosaclaro', c.rosaclaro); page.style.setProperty('--rojonaranja', c.rojonaranja);
    }
    return page;
  }
  window.CatalystCover = { build };
})();
