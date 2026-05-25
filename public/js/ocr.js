// LibroVoz - OCR Processing (Hybrid: Tesseract local + auto-fallback a Claude)
const OCR = {
  // pageMetadata[i] = { text, confidence, source: 'tesseract'|'claude', needsReview }
  pageMetadata: [],

  // Umbral: bajo confianza → auto-fallback a Claude
  AUTO_FALLBACK_CONFIDENCE: 70,
  AUTO_FALLBACK_MIN_CHARS: 50,

  // Procesar páginas con Tesseract + auto-fallback a Claude si la calidad es baja
  async processAllPages(onProgress) {
    const pages = App.state.bookPages;
    this.pageMetadata = new Array(pages.length).fill(null);
    let completed = 0;
    let fallbackCount = 0;

    for (let i = 0; i < pages.length; i++) {
      // 1. Intento Tesseract (gratis)
      const tess = await TesseractOCR.recognize(pages[i]);
      let meta = {
        text: tess.text,
        confidence: tess.confidence,
        source: 'tesseract',
        needsReview: false
      };

      // 2. Si la confianza es baja → auto-fallback a Claude (paga)
      const lowQuality = tess.confidence < this.AUTO_FALLBACK_CONFIDENCE
                      || tess.text.length < this.AUTO_FALLBACK_MIN_CHARS;

      if (lowQuality) {
        try {
          const ai = await API.ocr(pages[i]);
          if (ai.text && ai.text.length > tess.text.length) {
            meta = {
              text: ai.text,
              confidence: 99,
              source: 'claude',
              needsReview: false
            };
            fallbackCount++;
          } else {
            // Claude tampoco devolvió nada útil → marcar para revisión manual
            meta.needsReview = true;
          }
        } catch (err) {
          console.warn(`Auto-fallback Claude falló para página ${i + 1}:`, err.message);
          meta.needsReview = true;
        }
      }

      this.pageMetadata[i] = meta;
      completed++;
      if (onProgress) onProgress(completed, pages.length, meta, fallbackCount);
    }

    return this.pageMetadata.map(m => m.text).join('\n\n');
  },

  // Cuántas páginas usaron Claude (auto-fallback o manual)
  getAIFallbackCount() {
    return this.pageMetadata.filter(m => m && m.source === 'claude').length;
  },

  // Re-procesar una página específica con Claude (cuando el usuario hace tap "reescanear con IA")
  async reprocessPageWithAI(pageIndex) {
    const image = App.state.bookPages[pageIndex];
    if (!image) return null;
    try {
      const result = await API.ocr(image);
      this.pageMetadata[pageIndex] = {
        text: result.text || '',
        confidence: 99,
        needsReview: false
      };
      // Reconstruir fullText
      App.state.fullText = this.pageMetadata.map(m => m.text).join('\n\n');
      return result.text;
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
