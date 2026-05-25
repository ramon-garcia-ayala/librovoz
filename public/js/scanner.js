// LibroVoz - Scanner con cámara nativa, captura rápida y galería
const Scanner = {
  stream: null,
  phase: 'cover', // 'cover' | 'index' | 'pages'
  video: null,
  capturing: false,
  cameraAvailable: false,
  spreadMode: false, // false = 1 página; true = libro abierto, splittear en 2

  async init() {
    // Chequeo de cuota: si no hay libros disponibles, redirigir a paywall
    if (!(await Quota.canProcessBook())) {
      App.go('paywall');
      return;
    }

    this.phase = 'cover';
    this.video = document.getElementById('camera-feed');
    this.capturing = false;

    this.setupFileInputs();
    await this.requestCamera();
  },

  // ── Cámara ──────────────────────────────────────────────────────────
  async requestCamera() {
    const permScreen = document.getElementById('scanner-permission');
    const cameraEl = document.getElementById('scanner-camera');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      if (this.video) {
        this.video.srcObject = this.stream;
      }
      // Cámara OK — mostrar UI normal
      this.cameraAvailable = true;
      if (permScreen) permScreen.style.display = 'none';
      if (cameraEl) cameraEl.style.display = 'flex';
      this.updatePhaseUI();
    } catch (err) {
      console.warn('Cámara no disponible:', err.message);
      // Mostrar pantalla de permiso
      if (permScreen) permScreen.style.display = 'flex';
      if (cameraEl) cameraEl.style.display = 'none';
      // Ocultar guía y controles
      const guide = document.getElementById('scanner-guide');
      if (guide) guide.style.display = 'none';
    }
  },

  // ── File inputs ─────────────────────────────────────────────────────
  setupFileInputs() {
    const inputSingle = document.getElementById('file-input');
    if (inputSingle) {
      inputSingle.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const base64 = await this.fileToBase64(file);
          const resized = await Utils.resizeImage(base64);
          await this.processCapture(resized);
        }
        inputSingle.value = '';
      });
    }

    const inputCamera = document.getElementById('file-input-camera');
    if (inputCamera) {
      inputCamera.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const base64 = await this.fileToBase64(file);
          const resized = await Utils.resizeImage(base64);
          await this.processCapture(resized);
        }
        inputCamera.value = '';
      });
    }

    const inputMulti = document.getElementById('file-input-multi');
    if (inputMulti) {
      inputMulti.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        this.setPhaseCount(`Procesando ${files.length}...`);

        const results = await Promise.all(
          files.map(f => this.fileToBase64(f).then(b64 => Utils.resizeImage(b64)))
        );

        for (const base64 of results) {
          await this.processCapture(base64);
        }

        inputMulti.value = '';
      });
    }
  },

  openGallery() {
    if (this.phase === 'cover') {
      document.getElementById('file-input')?.click();
    } else {
      document.getElementById('file-input-multi')?.click();
    }
  },

  openNativeCamera() {
    document.getElementById('file-input-camera')?.click();
  },

  openPdfPicker() {
    const input = document.getElementById('file-input-pdf');
    if (!input) return;
    // Setup handler una sola vez
    if (!input._handlerAttached) {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await this.processPdfFile(file);
        input.value = '';
      });
      input._handlerAttached = true;
    }
    input.click();
  },

  async processPdfFile(file) {
    App.showToast('Procesando PDF...', 'info');
    try {
      const result = await PDFExtract.extract(file, (current, total) => {
        // Toast simple — pdf.js es rápido
        if (current === total) App.showToast(`PDF leído: ${total} páginas`, 'info');
      });

      // Aplicar a App.state como si hubiese escaneado
      App.state.coverImage = result.coverBase64;
      App.state.indexPages = [];
      App.state.bookPages = result.pages.map(p => p.image || '');

      // Si todas las páginas tenían texto extraíble, saltamos Tesseract en processor:
      // guardamos el fullText pre-extraído. Si no, dejamos que Tesseract corra sobre las imágenes.
      const allHaveText = result.pages.every(p => p.text && p.text.length > 30);
      if (allHaveText) {
        App.state._prefetchedFullText = result.pages.map(p => p.text).join('\n\n');
      } else {
        App.state._prefetchedFullText = null;
      }

      App.go('processing');
    } catch (err) {
      console.error('Error extrayendo PDF:', err);
      App.showToast('No se pudo leer el PDF', 'error');
    }
  },

  fileToBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
    });
  },

  // ── Captura desde cámara ────────────────────────────────────────────
  async capture() {
    if (this.capturing) return;

    if (!this.cameraAvailable || !this.video || this.video.readyState < 2) {
      this.openNativeCamera();
      return;
    }

    this.capturing = true;

    // Flash
    const flash = document.getElementById('scanner-flash');
    if (flash) {
      flash.classList.add('flash-active');
      setTimeout(() => flash.classList.remove('flash-active'), 200);
    }

    // Feedback haptic si disponible
    if (navigator.vibrate) navigator.vibrate(30);

    const base64 = Utils.captureVideoFrame(this.video);
    const resized = await Utils.resizeImage(base64);
    await this.processCapture(resized);

    setTimeout(() => { this.capturing = false; }, 250);
  },

  // ── Procesar captura ────────────────────────────────────────────────
  async processCapture(base64) {
    if (this.phase === 'cover') {
      // Portada: nunca se splittea
      App.state.coverImage = base64;
      this.addThumbnailFast(base64);
      this.showNextButton();
      this.setPhaseTitle('Portada capturada');
      return;
    }

    // Para index y pages: si modo spread, dividir en 2
    if (this.spreadMode) {
      try {
        const halves = await Utils.splitPageSpread(base64);
        for (const half of halves) {
          const added = this.pushPage(half);
          if (!added) break; // límite alcanzado a mitad del spread
        }
      } catch (err) {
        console.error('Error split:', err);
        this.pushPage(base64);
      }
    } else {
      this.pushPage(base64);
    }
  },

  // Push una imagen individual a la fase actual (index o pages).
  // Retorna true si se agregó, false si el límite estaba alcanzado.
  pushPage(base64) {
    if (this.phase === 'index') {
      if (App.state.indexPages.length >= LIMITS.MAX_INDEX_PAGES) {
        App.showToast(`Máximo ${LIMITS.MAX_INDEX_PAGES} páginas de índice. Toca Siguiente para continuar.`, 'error');
        return false;
      }
      App.state.indexPages.push(base64);
      this.addThumbnailFast(base64);
      this.updatePhaseCounter();
      this.showNextButton();
      return true;
    }
    if (this.phase === 'pages') {
      if (App.state.bookPages.length >= LIMITS.MAX_CONTENT_PAGES) {
        App.showToast(`Límite alcanzado: ${LIMITS.MAX_CONTENT_PAGES} páginas. Toca Siguiente para procesar.`, 'error');
        return false;
      }
      App.state.bookPages.push(base64);
      this.addThumbnailFast(base64);
      this.updatePhaseCounter();
      this.showNextButton();
      return true;
    }
    return false;
  },

  // ── Toggle modo 2 páginas (spread) ────────────────────────────────────
  toggleSpreadMode() {
    this.spreadMode = !this.spreadMode;
    this.updateSpreadToggleUI();
    if (navigator.vibrate) navigator.vibrate(15);
  },

  updateSpreadToggleUI() {
    const btn = document.getElementById('btn-spread-mode');
    const label = document.getElementById('spread-mode-label');
    if (!btn) return;
    btn.classList.toggle('spread-active', this.spreadMode);
    if (label) label.textContent = this.spreadMode ? '2 páginas' : '1 página';

    // Visible solo en fases pages e index
    const visible = this.phase === 'pages' || this.phase === 'index';
    btn.style.display = visible ? 'inline-flex' : 'none';
  },

  // ── Contador con estado warning/error según % usado ────────────────
  updatePhaseCounter() {
    const el = document.getElementById('scanner-phase-count');
    const captureBtn = document.getElementById('btn-capture');
    if (!el) return;

    let current = 0;
    let max = 0;

    if (this.phase === 'index') {
      current = App.state.indexPages.length;
      max = LIMITS.MAX_INDEX_PAGES;
    } else if (this.phase === 'pages') {
      current = App.state.bookPages.length;
      max = LIMITS.MAX_CONTENT_PAGES;
    }

    el.textContent = `${current} / ${max}`;
    el.style.display = 'inline';

    el.classList.remove('warning', 'danger');
    const pct = current / max;
    if (pct >= 1) {
      el.classList.add('danger');
      if (captureBtn) captureBtn.classList.add('disabled');
    } else if (pct >= 0.9) {
      el.classList.add('warning');
      if (captureBtn) captureBtn.classList.remove('disabled');
    } else {
      if (captureBtn) captureBtn.classList.remove('disabled');
    }
  },

  // ── Thumbnails ──────────────────────────────────────────────────────
  addThumbnailFast(base64) {
    const container = document.getElementById('scanner-thumbnails');
    if (!container) return;

    Utils.createThumbnail(base64).then(thumbUrl => {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.className = 'scanner-thumb fade-in';
      container.appendChild(img);
      container.scrollLeft = container.scrollWidth;
    });
  },

  // ── UI helpers ──────────────────────────────────────────────────────
  setPhaseTitle(text) {
    const el = document.getElementById('scanner-phase-title');
    if (el) el.textContent = text;
  },

  setPhaseCount(text) {
    const el = document.getElementById('scanner-phase-count');
    if (el) {
      el.textContent = text;
      el.style.display = 'inline';
    }
  },

  showNextButton() {
    const btn = document.getElementById('btn-next-phase');
    const placeholder = document.getElementById('btn-placeholder');
    if (btn) btn.style.display = 'flex';
    if (placeholder) placeholder.style.display = 'none';
  },

  hideNextButton() {
    const btn = document.getElementById('btn-next-phase');
    const placeholder = document.getElementById('btn-placeholder');
    if (btn) btn.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  },

  updatePhaseUI() {
    const thumbs = document.getElementById('scanner-thumbnails');
    const countEl = document.getElementById('scanner-phase-count');
    const guideLabel = document.getElementById('scanner-guide-label');

    if (thumbs) thumbs.innerHTML = '';
    if (countEl) countEl.style.display = 'none';
    this.hideNextButton();
    this.updateSpreadToggleUI();

    // Steps indicator
    const stepCover = document.getElementById('step-cover');
    const stepIndex = document.getElementById('step-index');
    const stepPages = document.getElementById('step-pages');

    [stepCover, stepIndex, stepPages].forEach(s => {
      if (s) { s.classList.remove('active', 'done'); }
    });

    switch (this.phase) {
      case 'cover':
        if (stepCover) stepCover.classList.add('active');
        this.setPhaseTitle('Fotografía la portada');
        if (guideLabel) guideLabel.textContent = 'Encuadra la portada';
        break;
      case 'index':
        if (stepCover) stepCover.classList.add('done');
        if (stepIndex) stepIndex.classList.add('active');
        this.setPhaseTitle('Fotografía el índice (opcional)');
        if (guideLabel) guideLabel.textContent = 'Encuadra el índice';
        this.updatePhaseCounter();
        // Mostrar next inmediatamente (índice es opcional)
        this.showNextButton();
        break;
      case 'pages':
        if (stepCover) stepCover.classList.add('done');
        if (stepIndex) stepIndex.classList.add('done');
        if (stepPages) stepPages.classList.add('active');
        this.setPhaseTitle('Fotografía las páginas');
        if (guideLabel) guideLabel.textContent = 'Encuadra la página';
        this.updatePhaseCounter();
        break;
    }
  },

  // ── Navegación entre fases ──────────────────────────────────────────
  nextPhase() {
    switch (this.phase) {
      case 'cover':
        if (!App.state.coverImage) {
          App.showToast('Captura la portada primero', 'error');
          return;
        }
        this.phase = 'index';
        this.updatePhaseUI();
        break;

      case 'index':
        this.phase = 'pages';
        this.updatePhaseUI();
        break;

      case 'pages':
        if (App.state.bookPages.length === 0) {
          App.showToast('Captura al menos una página', 'error');
          return;
        }
        App.go('processing');
        break;
    }
  },

  destroy() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
};
