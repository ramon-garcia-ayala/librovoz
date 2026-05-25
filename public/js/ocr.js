// LibroVoz - OCR Processing (Hybrid: Tesseract local + auto-fallback a Claude)
const OCR = {
  // pageMetadata[i] = { text, confidence, source: 'tesseract'|'claude', needsReview }
  pageMetadata: [],

  // Umbral: bajo confianza o poco texto → auto-fallback a Claude
  // MIN_CHARS subido a 150 para capturar páginas con figuras (poco texto, mucho dibujo)
  AUTO_FALLBACK_CONFIDENCE: 70,
  AUTO_FALLBACK_MIN_CHARS: 150,

  // Regex para detectar marcadores de figura insertados por Claude
  FIGURE_REGEX: /\[Figura\s+\d+:[^\]]+\]/g,

  // Procesar páginas con Tesseract + auto-fallback a Claude si la calidad es baja
  async processAllPages(onProgress) {
    const pages = App.state.bookPages;
    this.pageMetadata = new Array(pages.length).fill(null);
    let completed = 0;
    let fallbackCount = 0;
    let figuresCount = 0;

    // Pre-pase: Tesseract de TODAS las páginas primero, para tener context next disponible
    const tessResults = new Array(pages.length);
    for (let i = 0; i < pages.length; i++) {
      tessResults[i] = await TesseractOCR.recognize(pages[i]);
    }

    // Segundo pase: para cada página decidir si necesita Claude (con context)
    for (let i = 0; i < pages.length; i++) {
      const tess = tessResults[i];
      let meta = {
        text: tess.text,
        confidence: tess.confidence,
        source: 'tesseract',
        needsReview: false,
        figures: 0
      };

      const lowQuality = tess.confidence < this.AUTO_FALLBACK_CONFIDENCE
                      || tess.text.length < this.AUTO_FALLBACK_MIN_CHARS;

      if (lowQuality) {
        try {
          // Construir contexto desde texto de Tesseract de páginas vecinas
          const prev = i > 0 ? (tessResults[i - 1]?.text || '') : '';
          const next = i < pages.length - 1 ? (tessResults[i + 1]?.text || '') : '';
          const ctx = { prev, next };

          const ai = await API.ocr(pages[i], ctx);
          if (ai.text && ai.text.length > tess.text.length) {
            const figs = (ai.text.match(this.FIGURE_REGEX) || []).length;
            meta = {
              text: ai.text,
              confidence: 99,
              source: 'claude',
              needsReview: false,
              figures: figs
            };
            fallbackCount++;
            figuresCount += figs;
          } else {
            meta.needsReview = true;
          }
        } catch (err) {
          console.warn(`Auto-fallback Claude falló para página ${i + 1}:`, err.message);
          meta.needsReview = true;
        }
      }

      this.pageMetadata[i] = meta;
      completed++;
      if (onProgress) onProgress(completed, pages.length, meta, fallbackCount, figuresCount);
    }

    return this.pageMetadata.map(m => m.text).join('\n\n');
  },

  // Cuántas páginas usaron Claude (auto-fallback o manual)
  getAIFallbackCount() {
    return this.pageMetadata.filter(m => m && m.source === 'claude').length;
  },

  // Total de figuras detectadas en el libro
  getFiguresCount() {
    return this.pageMetadata.reduce((sum, m) => sum + (m?.figures || 0), 0);
  },

  // Re-procesar una página específica con Claude (cuando el usuario hace tap "reescanear con IA")
  async reprocessPageWithAI(pageIndex) {
    const image = App.state.bookPages[pageIndex];
    if (!image) return null;
    try {
      const prev = pageIndex > 0 ? (this.pageMetadata[pageIndex - 1]?.text || '') : '';
      const next = pageIndex < this.pageMetadata.length - 1 ? (this.pageMetadata[pageIndex + 1]?.text || '') : '';
      const result = await API.ocr(image, { prev, next });
      const text = result.text || '';
      const figs = (text.match(this.FIGURE_REGEX) || []).length;
      this.pageMetadata[pageIndex] = {
        text,
        confidence: 99,
        source: 'claude',
        needsReview: false,
        figures: figs
      };
      App.state.fullText = this.pageMetadata.map(m => m.text).join('\n\n');
      return text;
    } catch (err) {
      console.error('Error reprocesando con IA:', err);
      App.showToast('Error al reescanear esta página', 'error');
      return null;
    }
  },

  // Procesar índice con Tesseract también (pocas páginas, baratos)
  async processIndex(indexPages) {
    if (indexPages.length === 0) return '';
    const texts = [];
    for (const page of indexPages) {
      const result = await TesseractOCR.recognize(page);
      texts.push(result.text);
    }
    return texts.join('\n');
  },

  // Cover SÍ usa Claude (Tesseract no lee bien títulos estilizados)
  async processCover(coverImage) {
    try {
      const result = await API.detectCover(coverImage);
      return {
        title: result.title || 'Libro sin título',
        author: result.author || 'Autor desconocido',
        subtitle: result.subtitle || ''
      };
    } catch (err) {
      console.error('Error detectando portada:', err);
      return { title: 'Libro sin título', author: 'Autor desconocido', subtitle: '' };
    }
  },

  // Cuántas páginas necesitan revisión manual
  getReviewablePages() {
    return this.pageMetadata
      .map((m, i) => ({ ...m, index: i }))
      .filter(m => m && m.needsReview);
  }
};
