// LibroVoz - Pipeline de procesamiento (Tesseract local + Claude para chapters/cover)
const Processor = {
  async init() {
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
        setProgress(75, 'Texto extraído del PDF', 'Sin necesidad de OCR');
        App.state.fullText = App.state._prefetchedFullText;
        App.state._prefetchedFullText = null;
      } else {
        const total = App.state.bookPages.length;
        setProgress(15, 'Leyendo páginas en tu dispositivo...', `0 de ${total}`);

        App.state.fullText = await OCR.processAllPages((current, total, meta, fallbackCount) => {
          const pct = 15 + Math.round((current / total) * 60);
          const aiLabel = fallbackCount > 0 ? ` · ${fallbackCount} mejoradas con IA` : '';
          setProgress(pct, 'Leyendo páginas en tu dispositivo...', `${current} de ${total}${aiLabel}`);
        });
      }

      // 3. Detectar capítulos (Claude, text-only, barato)
      setProgress(80, 'Detectando capítulos...', '');
      const rawChapters = await Chapters.detect(App.state.fullText, App.state.indexText);
      App.state.chapters = Chapters.splitText(App.state.fullText, rawChapters);

      // 4. Mostrar páginas que necesitan revisión + modo
      const reviewable = OCR.getReviewablePages();
      setProgress(100, 'Listo', `${App.state.chapters.length} capítulo(s)`);

      if (privacyEl) privacyEl.style.display = 'none';

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

  // Render lista de páginas que Tesseract no leyó bien
  renderReviewablePages(reviewable) {
    const container = document.getElementById('processing-review');
    if (!container) return;

    container.innerHTML = `
      <div class="review-header">
        <h3>${reviewable.length} página(s) con problemas</h3>
        <p>Estas páginas no se pudieron leer bien. Puedes reintentar o continuar sin ellas.</p>
      </div>
      <div class="review-list">
        ${reviewable.map(p => `
          <div class="review-item" id="review-item-${p.index}">
            <img src="data:image/jpeg;base64,${App.state.bookPages[p.index]}" class="review-thumb">
            <div class="review-info">
              <div class="review-title">Página ${p.index + 1}</div>
              <div class="review-detail">${p.text.length} caracteres · ${Math.round(p.confidence)}% confianza</div>
            </div>
            <button class="review-btn" onclick="Processor.reprocessPage(${p.index})">
              Reescanear con IA
            </button>
          </div>
        `).join('')}
      </div>
    `;
    container.style.display = 'block';
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
