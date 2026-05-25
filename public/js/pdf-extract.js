// LibroVoz - Extracción de PDF (texto seleccionable + páginas como imagen para Tesseract fallback)
const PDFExtract = {
  ready: false,

  // pdf.js se carga vía CDN cuando se necesite (no en boot)
  async ensureLoaded() {
    if (this.ready) return;
    if (typeof pdfjsLib === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.min.mjs';
        script.type = 'module';
        script.onload = resolve;
        script.onerror = () => reject(new Error('No se pudo cargar pdf.js'));
        document.head.appendChild(script);
      });
    }
    // Configurar worker
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.mjs';
    }
    this.ready = true;
  },

  // Extraer del PDF: primera página como imagen (cover) + texto de páginas siguientes
  // Returns: { coverBase64, pages: [{text, image?}] }
  async extract(file, onProgress) {
    await this.ensureLoaded();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const totalPages = Math.min(pdf.numPages, LIMITS.MAX_CONTENT_PAGES + 1);
    const result = { coverBase64: null, pages: [] };

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);

      // Página 1 = portada → render como imagen
      if (i === 1) {
        result.coverBase64 = await this.renderPageAsImage(page, 1024);
        if (onProgress) onProgress(i, totalPages);
        continue;
      }

      // Resto: intentar extraer texto primero
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ').trim();

      if (text.length > 30) {
        // PDF nativo con texto seleccionable → solo guardamos el texto
        result.pages.push({ text, image: null });
      } else {
        // PDF escaneado (sin texto) → render como imagen para Tesseract
        const image = await this.renderPageAsImage(page, 1500);
        result.pages.push({ text: '', image });
      }

      if (onProgress) onProgress(i, totalPages);
    }

    return result;
  },

  // Renderizar una página de PDF a canvas y devolver base64
  async renderPageAsImage(page, maxWidth) {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
};
