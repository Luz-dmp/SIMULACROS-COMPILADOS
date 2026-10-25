(function () {
  'use strict';

  function safeFileName(value) {
    return String(value || 'Catalyst')
      .replace(/\.pdf$/i, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 120) || 'Catalyst';
  }

  function normalizeComputedColors(root) {
    const colorFunction = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i;
    const elements = [root, ...root.querySelectorAll('*')];
    elements.forEach(element => {
      const style = getComputedStyle(element);
      for (let index = 0; index < style.length; index++) {
        const property = style[index];
        const value = style.getPropertyValue(property).trim();
        const match = value.match(colorFunction);
        if (!match) continue;
        const channels = match.slice(1, 4).map(channel =>
          Math.round(Math.max(0, Math.min(1, Number(channel))) * 255));
        const color = match[4] === undefined
          ? `rgb(${channels.join(', ')})`
          : `rgba(${channels.join(', ')}, ${Math.max(0, Math.min(1, Number(match[4])))})`;
        element.style.setProperty(property, color, 'important');
      }
    });
  }

  async function generate(stage, fileName) {
    if (!window.html2pdf) throw new Error('No se pudo cargar el generador de PDF.');
    const pages = [...stage.querySelectorAll('.page')];
    if (!pages.length) throw new Error('No hay páginas diseñadas para generar el PDF.');
    if (document.fonts?.ready) await document.fonts.ready;

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '210mm',
      zIndex: '10000',
      pointerEvents: 'none',
      background: '#fff'
    });
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.textContent = 'Generando PDF…';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '10001',
      display: 'grid',
      placeItems: 'center',
      background: 'rgba(255,255,255,.94)',
      color: '#123d88',
      font: '700 18px Segoe UI, sans-serif'
    });
    document.body.append(container, overlay);

    const options = {
      filename: `${safeFileName(fileName)}.pdf`,
      margin: 0,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff'
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }
    };

    let pdf = null;
    try {
      for (const [index, page] of pages.entries()) {
        overlay.textContent = `Generando PDF… Página ${index + 1} de ${pages.length}`;
        const clone = page.cloneNode(true);
        clone.style.margin = '0';
        clone.style.boxShadow = 'none';
        container.replaceChildren(clone);
        normalizeComputedColors(clone);
        try {
          await Promise.all([...clone.querySelectorAll('img')].map(image => {
            if (image.complete) return Promise.resolve();
            return new Promise((resolve, reject) => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', () => reject(new Error('No se pudo cargar una imagen del PDF.')), { once: true });
            });
          }));
          if (index === 0) {
            pdf = await window.html2pdf().set(options).from(clone).toPdf().get('pdf');
          } else {
            const canvas = await window.html2pdf().set(options).from(clone).toCanvas().get('canvas');
            pdf.addPage('a4', 'portrait');
            pdf.addImage(
              canvas.toDataURL('image/jpeg', 0.98),
              'JPEG',
              0,
              0,
              pdf.internal.pageSize.getWidth(),
              pdf.internal.pageSize.getHeight()
            );
            canvas.width = 0;
            canvas.height = 0;
          }
        } finally {
          clone.remove();
        }
      }
      if (pdf.internal.getNumberOfPages() !== pages.length) {
        throw new Error(`El PDF generado no conserva todas las páginas (${pdf.internal.getNumberOfPages()} de ${pages.length}).`);
      }
      const blob = pdf.output('blob');
      if (!(blob instanceof Blob) || blob.size < 1) throw new Error('El PDF generado está vacío.');
      return blob;
    } finally {
      container.remove();
      overlay.remove();
    }
  }

  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(fileName)}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.PdfGenerator = { generate, download };
})();
