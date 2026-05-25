// LibroVoz - OCR Processing (Tesseract client-side + fallback manual a Claude)
const OCR = {
  // pageMetadata[i] = { text, needsReview, confidence } por cada página
  pageMetadata: [],

  // Procesar páginas con Tesseract (gratis, client-side)
  async processAllPages(onProgress) {
    const pages = App.state.bookPages;
    this.pageMetadata = new Array(pages.length).fill(null);
    let completed = 0;

    // Tesseract no se puede paralelizar fácilmente (1 worker), así que secuencial
    for (let i = 0; i < pages.length; i++) {
      const result = await TesseractOCR.recognize(pages[i]);
      this.pageMetadata[i] = {
        text: result.text,
        confidence: result.confidence,
        needsReview: result.needsReview
      };
      completed++;
      if (onProgress) onProgress(completed, pages.length, this.pageMetadata[i]);
    }

    return this.pageMetadata.map(m => m.text).join('\n\n');
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
