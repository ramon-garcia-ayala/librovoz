// LibroVoz - Pipeline de procesamiento optimizado
const Processor = {
  async init() {
    const statusEl = document.getElementById('processing-status');
    const fillEl = document.getElementById('processing-fill');
    const detailEl = document.getElementById('processing-detail');
    const coverEl = document.getElementById('processing-cover');
    const titleEl = document.getElementById('processing-title');
    const authorEl = document.getElementById('processing-author');

    const setProgress = (pct, text, detail) => {
      if (fillEl) fillEl.style.width = pct + '%';
      if (statusEl) statusEl.textContent = text;
      if (detailEl) detailEl.textContent = detail || '';
    };

    try {
      // 1. Portada e índice en paralelo
      setProgress(5, 'Analizando portada e índice...', '');

      const [coverInfo, indexText] = await Promise.all([
        OCR.processCover(App.state.coverImage),
        OCR.processIndex(App.state.indexPages)
      ]);

      App.state.coverInfo = coverInfo;
      App.state.indexText = indexText;

      if (titleEl) titleEl.textContent = coverInfo.title;
      if (authorEl) authorEl.textContent = coverInfo.author;
      if (coverEl) {
        coverEl.innerHTML = `<img src="data:image/jpeg;base64,${App.state.coverImage}" alt="Portada">`;
      }

      // 2. Procesar páginas en paralelo (lotes de 3)
      setProgress(20, 'Leyendo páginas...', `0 de ${App.state.bookPages.length}`);
      App.state.fullText = await OCR.processAllPages((current, total) => {
        const pct = 20 + Math.round((current / total) * 50);
        setProgress(pct, 'Leyendo páginas...', `${current} de ${total}`);
      });

      // 3. Detectar capítulos
      setProgress(75, 'Detectando capítulos...', '');
      const rawChapters = await Chapters.detect(App.state.fullText, App.state.indexText);
      App.state.chapters = Chapters.splitText(App.state.fullText, rawChapters);

      setProgress(100, 'Listo', `${App.state.chapters.length} capítulo(s) detectado(s)`);

      // Mostrar selector de modo
      const progressEl = document.getElementById('processing-progress');
      const modesEl = document.getElementById('processing-modes');
      if (progressEl) progressEl.style.display = 'none';
      if (modesEl) modesEl.style.display = 'block';

    } catch (err) {
      console.error('Error en procesamiento:', err);
      setProgress(0, 'Error al procesar', err.message);
      App.showToast('Error procesando el libro: ' + err.message, 'error');
    }
  },

  async selectMode(mode) {
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

    App.go('voices');
  }
};
