// LibroVoz - OCR Processing (Hybrid: Tesseract local + auto-fallback a Claude)
const OCR = {
  pageMetadata: [],

  AUTO_FALLBACK_CONFIDENCE: 70,
  AUTO_FALLBACK_MIN_CHARS: 150,
  QUALITY_THRESHOLD_FOR_POST_CLEAN: 0.85,

  FIGURE_REGEX: /\[Figura\s+\d+:[^\]]+\]/g,

  // Detecta si el texto de Tesseract es probablemente basura (símbolos random,
  // palabras imposibles, sombras de tabla, etc.) — para forzar fallback a Claude
  isLikelyGarbage(text) {
    if (!text || text.length < 20) return false;
    const t = text.replace(/\s/g, '');
    if (t.length === 0) return false;

    // % de chars no esperables en texto en español
    const validChars = (t.match(/[a-záéíóúñüA-ZÁÉÍÓÚÑÜ0-9.,;:¡!¿?'"()\[\]\-—]/g) || []).length;
    const garbageRatio = 1 - (validChars / t.length);
    if (garbageRatio > 0.30) return true;

    // Runs de símbolos de tabla/borde
    if (/[|│┌┘─•▪░▒▓█@#%^&*]{3,}/.test(text)) return true;

    // Palabras "imposibles" en español: muchas consonantes seguidas
    const tokens = text.split(/\s+/).filter(w => w.length > 3);
    if (tokens.length > 5) {
      const weird = tokens.filter(w => /[bcdfghjklmnpqrstvwxz]{5,}/i.test(w)).length;
      if (weird / tokens.length > 0.20) return true;
    }

    return false;
  },

  // Score 0-1 de calidad agregada del OCR. <0.85 → vale la pena post-clean
  computeQualityScore() {
    if (this.pageMetadata.length === 0) return 1;
    let totalScore = 0;
    for (const m of this.pageMetadata) {
      let pageScore;
      if (!m) {
        pageScore = 0;
      } else if (m.source === 'claude') {
        pageScore = 0.99;
      } else {
        pageScore = Math.min(1, (m.confidence || 0) / 100);
        if (this.isLikelyGarbage(m.text)) pageScore *= 0.5;
      }
      totalScore += pageScore;
    }
    return totalScore / this.pageMetadata.length;
  },

  // Pase 1: Tesseract de TODAS las páginas (local, gratis, rápido)
  // startIndex: para resumir desde donde se interrumpió previamente
  async tesseractPass(onProgress, startIndex) {
    const pages = App.state.bookPages;
    const start = Math.max(0, startIndex || 0);
    // Si pageMetadata no existe o es de otro libro, crearlo
    if (!Array.isArray(this.pageMetadata) || this.pageMetadata.length !== pages.length) {
      this.pageMetadata = new Array(pages.length).fill(null);
    }
    for (let i = start; i < pages.length; i++) {
      // Si ya tenía un meta (resume), respetarlo si tiene texto
      if (this.pageMetadata[i] && this.pageMetadata[i].text && this.pageMetadata[i].score > 0) {
        if (onProgress) await onProgress(i + 1, pages.length);
        continue;
      }
      const tess = await TesseractOCR.recognize(pages[i]);
      this.pageMetadata[i] = {
        text: tess.text,
        confidence: tess.confidence,
        source: 'tesseract',
        needsReview: false,
        figures: 0,
        score: this._scorePage(tess.text, tess.confidence)
      };
      if (onProgress) await onProgress(i + 1, pages.length);
    }
  },

  // Reprocesar una página solo con Tesseract (después de un re-take del usuario)
  async tesseractReprocessPage(index) {
    const image = App.state.bookPages[index];
    if (!image) return null;
    const tess = await TesseractOCR.recognize(image);
    this.pageMetadata[index] = {
      text: tess.text,
      confidence: tess.confidence,
      source: 'tesseract',
      needsReview: false,
      figures: 0,
      score: this._scorePage(tess.text, tess.confidence)
    };
    return this.pageMetadata[index];
  },

  // Pase 2: para páginas con baja calidad, escalar a Claude vision (con context)
  async claudeFallbackPass(onProgress) {
    const pages = App.state.bookPages;
    let fallbackCount = 0;
    let figuresCount = 0;

    for (let i = 0; i < pages.length; i++) {
      const meta = this.pageMetadata[i];
      if (!meta) continue;

      // Si ya viene de Claude (re-procesado manual), skip
      if (meta.source === 'claude') {
        fallbackCount++;
        figuresCount += meta.figures || 0;
        if (onProgress) onProgress(i + 1, pages.length, meta, fallbackCount, figuresCount);
        continue;
      }

      const lowQuality = meta.confidence < this.AUTO_FALLBACK_CONFIDENCE
                      || meta.text.length < this.AUTO_FALLBACK_MIN_CHARS
                      || this.isLikelyGarbage(meta.text);

      if (lowQuality) {
        try {
          const prev = i > 0 ? (this.pageMetadata[i - 1]?.text || '') : '';
          const next = i < pages.length - 1 ? (this.pageMetadata[i + 1]?.text || '') : '';
          const ai = await API.ocr(pages[i], { prev, next });
          if (ai.text && ai.text.length > meta.text.length) {
            const figs = (ai.text.match(this.FIGURE_REGEX) || []).length;
            this.pageMetadata[i] = {
              text: ai.text,
              confidence: 99,
              source: 'claude',
              needsReview: false,
              figures: figs,
              score: 0.99
            };
            fallbackCount++;
            figuresCount += figs;
          } else {
            this.pageMetadata[i].needsReview = true;
          }
        } catch (err) {
          console.warn(`Auto-fallback Claude falló para página ${i + 1}:`, err.message);
          this.pageMetadata[i].needsReview = true;
        }
      }
      if (onProgress) onProgress(i + 1, pages.length, this.pageMetadata[i], fallbackCount, figuresCount);
    }

    return this.pageMetadata.map(m => m?.text || '').join('\n\n');
  },

  // Pipeline completo (wrapper): tesseract + claude fallback. Devuelve fullText.
  async processAllPages(onProgress) {
    await this.tesseractPass();
    return this.claudeFallbackPass(onProgress);
  },

  // Score 0-1 individual de una página (basado en confianza Tesseract + garbage check)
  _scorePage(text, confidence) {
    let score = Math.min(1, (confidence || 0) / 100);
    if (this.isLikelyGarbage(text)) score *= 0.5;
    if (!text || text.length < 30) score *= 0.6;
    return score;
  },

  // Páginas con score bajo (para mostrar en quality gate)
  getBadPages(threshold) {
    const t = threshold !== undefined ? threshold : 0.55;
    return this.pageMetadata
      .map((m, i) => ({ index: i, score: m?.score ?? 0, text: m?.text || '' }))
      .filter(p => p.score < t);
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
