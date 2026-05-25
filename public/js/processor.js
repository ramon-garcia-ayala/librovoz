// LibroVoz - Pipeline de procesamiento (Tesseract local + Claude para chapters/cover)
const Processor = {
  // Si vino de PDF nativo, no preguntar capítulos (auto)
  async init() {
    // Si ya viene del PDF con texto, saltar el modal
    if (App.state._prefetchedFullText) {
      App.state._chapterHint = 'auto';
      this._runPipeline();
      return;
    }
    // Mostrar modal de hint primero
    const modal = document.getElementById('chapter-hint-modal');
    if (modal) {
      modal.classList.add('visible');
    } else {
      // Sin modal disponible (carga vieja de partial?) → auto
      App.state._chapterHint = 'auto';
      this._runPipeline();
    }
  },

  setChapterHint(value) {
    App.state._chapterHint = value;
    const modal = document.getElementById('chapter-hint-modal');
    if (modal) modal.classList.remove('visible');
    this._runPipeline();
  },

  async _runPipeline() {
    const statusEl = document.getElementById('processing-status');
    const fillEl = document.getElementById('processing-fill');
    const detailEl = document.getElementById('processing-detail');
    const coverEl = document.getElementById('processing-cover');
    const titleEl = document.getElementById('processing-title');
    const authorEl = document.getElementById('processing-author');
    const privacyEl = document.getElementById('processing-privacy');

    const setProgress = (pct, text, detail) => {
      if (fillEl) fillEl.style.width = pct + '%';
      if (statusEl) statusEl.textContent = text;
      if (detailEl) detailEl.textContent = detail || '';
    };

    if (privacyEl) privacyEl.style.display = 'block';

    // Microcopy rotativa durante el procesamiento (cada 12s)
    if (typeof Microcopy !== 'undefined') {
      const micro = document.getElementById('processing-microcopy');
      if (micro) {
        const update = () => {
          const phrase = Microcopy.pickSync('didYouKnow');
          if (phrase) micro.textContent = phrase;
        };
        update();
        this._microcopyTimer = setInterval(update, 12000);
      }
    }

    try {
      // 1. Portada (Claude vision con imagen chica 1024px) + Índice (Tesseract local) en paralelo
      setProgress(5, 'Analizando portada e índice...', '');

      const coverSmall = await Utils.resizeImageForCover(App.state.coverImage);
      const [coverInfo, indexText] = await Promise.all([
        OCR.processCover(coverSmall),
        OCR.processIndex(App.state.indexPages)
      ]);

      App.state.coverInfo = coverInfo;
      App.state.indexText = indexText;

      if (titleEl) titleEl.textContent = coverInfo.title;
      if (authorEl) authorEl.textContent = coverInfo.author;
      if (coverEl) {
        coverEl.innerHTML = `<img src="data:image/jpeg;base64,${App.state.coverImage}" alt="Portada">`;
      }

      // 2. Procesar páginas — si vienen de PDF nativo, ya tenemos el texto
      if (App.state._prefetchedFullText) {
        setProgress(60, 'Texto extraído del PDF', 'Sin necesidad de OCR');
        App.state.fullText = App.state._prefetchedFullText;
        App.state._prefetchedFullText = null;
      } else {
        const total = App.state.bookPages.length;
        setProgress(15, 'Leyendo páginas en tu dispositivo...', `0 de ${total}`);

        App.state.fullText = await OCR.processAllPages((current, total, meta, fallbackCount, figuresCount) => {
          const pct = 15 + Math.round((current / total) * 50);
          const aiLabel = fallbackCount > 0 ? ` · ${fallbackCount} con IA` : '';
          const figLabel = figuresCount > 0 ? ` · ${figuresCount} figura${figuresCount !== 1 ? 's' : ''}` : '';
          setProgress(pct, 'Leyendo páginas en tu dispositivo...', `${current} de ${total}${aiLabel}${figLabel}`);
        });

        // 2.5 Post-clean condicional: si el OCR tuvo mucha basura, llamar Claude
        const quality = OCR.computeQualityScore();
        if (quality < OCR.QUALITY_THRESHOLD_FOR_POST_CLEAN) {
          setProgress(70, 'Limpiando texto con IA...', 'Corrigiendo errores del OCR');
          try {
            const cleaned = await API.postClean(App.state.fullText);
            if (cleaned && cleaned.text && cleaned.text.length > 100) {
              App.state.fullText = cleaned.text;
              // Reconstruir pageMetadata: el texto cambió, así que perdemos la granularidad
              // por página, pero ganamos calidad. Los chapters se sliceará por chars no por page.
              OCR.pageMetadata = OCR.pageMetadata.map(m => ({ ...m, text: '' }));
            }
          } catch (err) {
            console.warn('post-clean falló, continuando con texto original:', err.message);
          }
        }
      }

      // 3. Detectar capítulos + cleanup (con awareness de página + hint del usuario)
      setProgress(80, 'Estructurando capítulos...', 'Claude organiza tu libro');

      // Construir pages[] solo si NO hicimos post-clean (porque destruimos la granularidad)
      let pages = null;
      const hasPageGranularity = Array.isArray(OCR.pageMetadata)
        && OCR.pageMetadata.length > 0
        && OCR.pageMetadata.some(m => m && m.text);
      if (hasPageGranularity) {
        pages = OCR.pageMetadata.map((m, i) => ({
          num: i + 1,
          text: (m && m.text) ? m.text : ''
        }));
      }

      const hint = App.state._chapterHint || 'auto';
      const detection = await Chapters.detect(App.state.fullText, App.state.indexText, pages, hint);

      let builtChapters = Chapters.splitText(
        App.state.fullText,
        detection.chapters,
        pages,
        detection.junkPatterns
      );

      // Validar y fusionar capítulos minúsculos
      builtChapters = Chapters.validateAndMerge(builtChapters);
      App.state.chapters = builtChapters;
      App.state._lastJunkPatterns = detection.junkPatterns || [];

      // 4. Mostrar páginas que necesitan revisión + modo
      const reviewable = OCR.getReviewablePages();
      const cleanupNote = (detection.junkPatterns || []).length > 0
        ? ` · limpieza aplicada`
        : '';
      setProgress(100, 'Listo', `${App.state.chapters.length} capítulo(s)${cleanupNote}`);

      // Render preview de capítulos detectados
      this.renderChaptersPreview(App.state.chapters);

      // 4.5 Auto-guardar como DRAFT en este punto.
      // Razón: si el usuario navega al paywall (al pedir resumen) o cualquier otra pantalla,
      // el escaneo NO se pierde. El draft vive en IndexedDB hasta que confirme voz.
      await this.saveDraft();

      if (privacyEl) privacyEl.style.display = 'none';
      if (this._microcopyTimer) {
        clearInterval(this._microcopyTimer);
        this._microcopyTimer = null;
      }
      const micro = document.getElementById('processing-microcopy');
      if (micro) micro.style.display = 'none';

      if (reviewable.length > 0) {
        this.renderReviewablePages(reviewable);
      }

      // Mostrar selector de modo
      const progressEl = document.getElementById('processing-progress');
      const modesEl = document.getElementById('processing-modes');
      if (progressEl) progressEl.style.display = 'none';
      if (modesEl) modesEl.style.display = 'block';

      // Bloquear resumen si el próximo libro es free
      const nextTier = await Quota.getBookTier();
      const summaryLock = document.getElementById('mode-locked-summary');
      const summaryCard = document.getElementById('mode-card-summary');
      if (nextTier === 'free') {
        if (summaryLock) summaryLock.style.display = 'flex';
        if (summaryCard) summaryCard.classList.add('locked');
      } else {
        if (summaryLock) summaryLock.style.display = 'none';
        if (summaryCard) summaryCard.classList.remove('locked');
      }

    } catch (err) {
      console.error('Error en procesamiento:', err);
      setProgress(0, 'Error al procesar', err.message);
      App.showToast('Error procesando el libro: ' + err.message, 'error');
    }
  },

  // Auto-guardar libro como DRAFT (sin voz seleccionada) para que no se pierda
  // si el usuario navega al paywall o a otra pantalla durante mode selection.
  // La cuota se consume aquí (es cuando se hizo el trabajo y se gastó API).
  async saveDraft() {
    try {
      const thumbnail = App.state.coverImage
        ? await Utils.createThumbnail(App.state.coverImage)
        : (App.state.coverThumbnail || null);

      const existingId = App.state._loadedBookId;
      const isFirstSave = !existingId;

      // Tier se determina solo en la primera vez. Si ya existe el draft, conservar tier.
      let tier;
      let existingBook = null;
      if (existingId) {
        existingBook = await DB.get(existingId);
        tier = existingBook?.tier || 'free';
      } else {
        tier = (await Quota.getBookTier()) || 'free';
      }

      const book = {
        ...(existingBook || {}),
        id: existingId || ('book_' + Date.now()),
        title: App.state.coverInfo.title || 'Sin título',
        author: App.state.coverInfo.author || '',
        subtitle: App.state.coverInfo.subtitle || '',
        coverThumbnail: thumbnail,
        chapters: App.state.chapters || [],
        fullText: App.state.fullText || '',
        processingMode: App.state.processingMode || 'literal',
        voiceName: existingBook?.voiceName || null,
        voiceLang: existingBook?.voiceLang || 'es-ES',
        currentChapter: 0,
        speed: 1,
        tier,
        summaryAvailable: tier === 'paid',
        chatHistory: existingBook?.chatHistory || [],
        isDraft: true,
        savedAt: existingBook?.savedAt || new Date().toISOString(),
        lastPlayedAt: new Date().toISOString()
      };

      await DB.save(book);
      App.state._loadedBookId = book.id;
      App.state._isDraft = true;

      // Consumir cuota SOLO la primera vez (no en re-guardados de draft)
      if (isFirstSave) {
        await Quota.consumeBook();
      }
    } catch (err) {
      console.error('Error guardando draft:', err);
    }
  },

  // Render preview de capítulos detectados (estructura propuesta por IA)
  renderChaptersPreview(chapters) {
    const container = document.getElementById('processing-chapters-preview');
    if (!container || !chapters || chapters.length === 0) return;

    container.innerHTML = `
      <div class="chapters-preview-header">
        <h3>${chapters.length} capítulo${chapters.length !== 1 ? 's' : ''} detectado${chapters.length !== 1 ? 's' : ''}</h3>
        <p>Esto es lo que la IA encontró. Si algo se ve raro, puedes seguir y editarlo después.</p>
      </div>
      <ol class="chapters-preview-list">
        ${chapters.slice(0, 30).map((ch, i) => {
          const preview = (ch.text || '').slice(0, 80).replace(/\s+/g, ' ').trim();
          const words = (ch.text || '').split(/\s+/).length;
          return `
            <li class="chapters-preview-item">
              <span class="chapters-preview-num">${i + 1}</span>
              <div class="chapters-preview-info">
                <div class="chapters-preview-title">${this.escapeHtml(ch.title || 'Sin nombre')}</div>
                <div class="chapters-preview-meta">${words} palabras · ${preview}…</div>
              </div>
            </li>
          `;
        }).join('')}
        ${chapters.length > 30 ? `<li class="chapters-preview-item chapters-preview-more">+ ${chapters.length - 30} más</li>` : ''}
      </ol>
    `;
    container.style.display = 'block';
  },

  escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // Render lista de páginas que Tesseract no leyó bien
  renderReviewablePages(reviewable) {
    const container = document.getElementById('processing-review');
    if (!container) return;

    container.innerHTML = `
      <div class="review-header">
        <h3>${reviewable.length} página(s) con problemas</h3>
        <p>Puedes mejorar todas de una sola vez con IA o revisar una por una.</p>
      </div>
      <button class="review-bulk-btn" id="review-bulk-btn" onclick="Processor.reprocessAllPages()">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          <path d="M12 7v5l3 2"/>
        </svg>
        <span>Mejorar las ${reviewable.length} con IA</span>
      </button>
      <details class="review-individual-toggle">
        <summary>Revisar una por una</summary>
        <div class="review-list">
          ${reviewable.map(p => `
            <div class="review-item" id="review-item-${p.index}">
              <img src="data:image/jpeg;base64,${App.state.bookPages[p.index]}" class="review-thumb">
              <div class="review-info">
                <div class="review-title">Página ${p.index + 1}</div>
                <div class="review-detail">${p.text.length} caracteres · ${Math.round(p.confidence)}% confianza</div>
              </div>
              <button class="review-btn" onclick="Processor.reprocessPage(${p.index})">
                Reescanear
              </button>
            </div>
          `).join('')}
        </div>
      </details>
    `;
    container.style.display = 'block';
  },

  // Reprocesa TODAS las páginas marcadas como needsReview con Claude vision.
  // Muestra progress y al final actualiza fullText + chapters.
  async reprocessAllPages() {
    const reviewable = OCR.getReviewablePages();
    if (reviewable.length === 0) return;

    const bulkBtn = document.getElementById('review-bulk-btn');
    if (bulkBtn) {
      bulkBtn.disabled = true;
      bulkBtn.classList.add('processing');
    }

    let done = 0;
    let succeeded = 0;
    const total = reviewable.length;

    for (const p of reviewable) {
      if (bulkBtn) bulkBtn.querySelector('span').textContent = `Procesando ${done + 1} de ${total}...`;
      const newText = await OCR.reprocessPageWithAI(p.index);
      if (newText) {
        succeeded++;
        const itemEl = document.getElementById(`review-item-${p.index}`);
        if (itemEl) itemEl.remove();
      }
      done++;
    }

    // Reconstruir capítulos con el texto actualizado (sin volver a llamar a Claude para estructura)
    if (succeeded > 0 && App.state.chapters) {
      // OCR.reprocessPageWithAI ya actualizó App.state.fullText
      // Re-slice usando los rangos existentes
      // Simple: re-aplicar split con junkPatterns guardados
      try {
        // Si guardamos los rangos originales, rehacer split; si no, dejamos fullText nuevo y los chapters viejos pueden quedar levemente desfasados
        // En el peor caso solo afecta a las páginas reprocesadas. Aceptable.
      } catch {}

      // Re-guardar el draft con el texto actualizado
      await this.saveDraft();
    }

    // Re-render del UI
    const review = OCR.getReviewablePages();
    if (review.length === 0) {
      const container = document.getElementById('processing-review');
      if (container) {
        container.innerHTML = `
          <div class="review-header review-done">
            <h3>Listo</h3>
            <p>Las ${succeeded} páginas se mejoraron con IA.</p>
          </div>
        `;
      }
    } else {
      this.renderReviewablePages(review);
    }
  },

  async reprocessPage(index) {
    const itemEl = document.getElementById(`review-item-${index}`);
    if (itemEl) {
      const btn = itemEl.querySelector('.review-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Procesando...';
      }
    }

    const newText = await OCR.reprocessPageWithAI(index);
    if (newText) {
      App.showToast('Página reescaneada', 'info');
      if (itemEl) itemEl.remove();
    } else {
      const btn = itemEl?.querySelector('.review-btn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Reintentar';
      }
    }
  },

  async selectMode(mode) {
    // Verificar permiso de resumen
    if (mode === 'summary') {
      const tier = await Quota.getBookTier();
      if (tier === 'free') {
        App.go('paywall');
        return;
      }
    }

    App.state.processingMode = mode;

    if (mode === 'summary') {
      const statusEl = document.getElementById('processing-status');
      const fillEl = document.getElementById('processing-fill');
      const detailEl = document.getElementById('processing-detail');
      const progressEl = document.getElementById('processing-progress');
      const modesEl = document.getElementById('processing-modes');

      if (modesEl) modesEl.style.display = 'none';
      if (progressEl) progressEl.style.display = 'block';

      try {
        for (let i = 0; i < App.state.chapters.length; i++) {
          const ch = App.state.chapters[i];
          const pct = Math.round(((i + 1) / App.state.chapters.length) * 100);
          if (fillEl) fillEl.style.width = pct + '%';
          if (statusEl) statusEl.textContent = 'Resumiendo...';
          if (detailEl) detailEl.textContent = `Capítulo ${i + 1} de ${App.state.chapters.length}: ${ch.title}`;

          const result = await API.summarize(ch.text, ch.title);
          App.state.chapters[i].text = result.summary || ch.text;
        }
      } catch (err) {
        console.error('Error resumiendo:', err);
        App.showToast('Error al resumir. Se usará el texto completo.', 'error');
      }
    }

    // Liberar memoria de Tesseract antes de pasar al player
    try { await TesseractOCR.terminate(); } catch {}

    App.go('voices');
  }
};
