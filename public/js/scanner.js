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
    this.setupOrientationListener();
    await this.requestCamera();
  },

  setupOrientationListener() {
    if (this._orientationWired) return;
    this._orientationWired = true;
    const handler = () => this.updateRotateHint();
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    // También al rotar pantalla con screen.orientation API
    if (screen && screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', handler);
    }
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
    const guide = document.getElementById('scanner-guide');
    const guideLabel = document.getElementById('scanner-guide-label');

    if (btn) {
      btn.classList.toggle('spread-active', this.spreadMode);
      if (label) label.textContent = this.spreadMode ? '2 páginas' : '1 página';
      const btnVisible = this.phase === 'pages' || this.phase === 'index';
      btn.style.display = btnVisible ? 'inline-flex' : 'none';
    }

    // Guía: marco horizontal + label distinta cuando spread activo
    if (guide) {
      guide.classList.toggle('spread-mode', this.spreadMode);
    }
    if (guideLabel) {
      if (this.spreadMode && (this.phase === 'pages' || this.phase === 'index')) {
        guideLabel.textContent = 'Encuadra las 2 páginas dentro del marco';
      }
      // Si no es spread, el label se actualiza en updatePhaseUI
    }

    this.updateRotateHint();
  },

  // Mostrar/ocultar hint de "gira el celular" según orientación del dispositivo
  updateRotateHint() {
    const hint = document.getElementById('scanner-rotate-hint');
    if (!hint) return;

    const isSpread = this.spreadMode;
    const inRelevantPhase = this.phase === 'pages' || this.phase === 'index';
    const isPortrait = window.innerHeight > window.innerWidth;

    // Mostrar solo si: spread activo + fase relevante + portrait actual
    const show = isSpread && inRelevantPhase && isPortrait;
    hint.classList.toggle('visible', show);
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

  // Volver — robusto: limpia cámara, orientación, fullscreen y va a biblioteca
  async goBack() {
    await this.destroy();
    // Si tienes algún libro guardado o estás navegando, vas a biblioteca.
    // Es el lugar más útil al cancelar un escaneo.
    App.go('library');
  },

  // Rotar pantalla a landscape / vuelta a portrait
  async toggleRotation() {
    if (this._isLandscape) {
      await this._exitLandscape();
    } else {
      await this._enterLandscape();
    }
  },

  async _enterLandscape() {
    try {
      // Algunos navegadores requieren fullscreen antes de bloquear orientación
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        try { await el.requestFullscreen({ navigationUI: 'hide' }); } catch {}
      }
      if (screen && screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
        this._isLandscape = true;
        document.body.classList.add('scanner-landscape');
        this._updateRotateButton();
        if (navigator.vibrate) navigator.vibrate(20);
        return;
      }
      // Fallback: navegador no soporta lock → mostrar hint
      App.showToast('Tu navegador no permite forzar rotación. Gira el celular manualmente.', 'info');
    } catch (err) {
      console.warn('No se pudo forzar landscape:', err.message);
      App.showToast('Gira el celular manualmente para horizontal', 'info');
    }
  },

  async _exitLandscape() {
    try {
      if (screen && screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch {}
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch {}
      }
    } catch {}
    this._isLandscape = false;
    document.body.classList.remove('scanner-landscape');
    this._updateRotateButton();
  },

  _updateRotateButton() {
    const btn = document.getElementById('btn-rotate');
    if (btn) btn.classList.toggle('rotated', !!this._isLandscape);
  },

  async destroy() {
    // 1. Detener stream de cámara
    if (this.stream) {
      try { this.stream.getTracks().forEach(t => t.stop()); } catch {}
      this.stream = null;
    }
    // 2. Limpiar video element
    if (this.video) {
      try { this.video.srcObject = null; } catch {}
    }
    // 3. Liberar orientación si estaba bloqueada
    if (this._isLandscape) {
      await this._exitLandscape();
    }
    // 4. Reset estado interno
    this.capturing = false;
  }
};
