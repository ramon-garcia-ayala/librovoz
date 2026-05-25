// LibroVoz - Scanner con 3 fases
const Scanner = {
  stream: null,
  phase: 'cover', // 'cover' | 'index' | 'pages'
  video: null,
  usingFallback: false,

  async init() {
    this.phase = 'cover';
    this.video = document.getElementById('camera-feed');
    this.usingFallback = false;

    await this.startCamera();
    this.updatePhaseUI();
    this.setupFileInput();
  },

  async startCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      if (this.video) {
        this.video.srcObject = this.stream;
      }
    } catch (err) {
      console.warn('Cámara no disponible, usando fallback:', err.message);
      this.usingFallback = true;
      this.showFallback();
    }
  },

  showFallback() {
    const cameraDiv = document.querySelector('.scanner-camera');
    if (cameraDiv) {
      cameraDiv.innerHTML = `
        <div class="scanner-fallback">
          <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
            <rect x="8" y="14" width="48" height="36" rx="4" stroke="#007AFF" stroke-width="3" fill="#007AFF" opacity="0.1"/>
            <circle cx="32" cy="32" r="10" stroke="#007AFF" stroke-width="3" fill="none"/>
          </svg>
          <p>Toca para seleccionar una imagen</p>
        </div>
      `;
      cameraDiv.addEventListener('click', () => {
        document.getElementById('file-input')?.click();
      });
    }
  },

  setupFileInput() {
    const input = document.getElementById('file-input');
    if (!input) return;

    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        const base64 = await this.fileToBase64(file);
        await this.processCapture(base64);
      }
      input.value = '';
    });
  },

  fileToBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result.split(',')[1];
        resolve(result);
      };
      reader.readAsDataURL(file);
    });
  },

  async capture() {
    if (this.usingFallback) {
      document.getElementById('file-input')?.click();
      return;
    }

    if (!this.video || this.video.readyState < 2) {
      App.showToast('La cámara aún no está lista', 'error');
      return;
    }

    // Flash verde
    const flash = document.getElementById('scanner-flash');
    if (flash) {
      flash.classList.add('flash-active');
      setTimeout(() => flash.classList.remove('flash-active'), 300);
    }

    const base64 = Utils.captureVideoFrame(this.video);
    const resized = await Utils.resizeImage(base64);
    await this.processCapture(resized);
  },

  async processCapture(base64) {
    switch (this.phase) {
      case 'cover':
        App.state.coverImage = base64;
        await this.addThumbnail(base64);
        App.showToast('Portada capturada', 'success');
        this.showPhaseAction('Siguiente paso');
        break;

      case 'index':
        App.state.indexPages.push(base64);
        await this.addThumbnail(base64);
        this.updateCount(App.state.indexPages.length);
        App.showToast(`Página de índice ${App.state.indexPages.length} capturada`, 'success');
        this.showPhaseAction('Índice completo');
        break;

      case 'pages':
        App.state.bookPages.push(base64);
        await this.addThumbnail(base64);
        this.updateCount(App.state.bookPages.length);
        App.showToast(`Página ${App.state.bookPages.length} capturada`, 'success');
        this.showPhaseAction('Terminé');
        break;
    }
  },

  async addThumbnail(base64) {
    const container = document.getElementById('scanner-thumbnails');
    if (!container) return;

    const thumbUrl = await Utils.createThumbnail(base64);
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.className = 'scanner-thumb fade-in';
    container.appendChild(img);
    container.scrollLeft = container.scrollWidth;
  },

  showPhaseAction(text) {
    const btn = document.getElementById('btn-phase-action');
    if (btn) {
      btn.textContent = text;
      btn.style.display = 'block';
    }
  },

  updateCount(count) {
    const badge = document.getElementById('scanner-count');
    if (badge) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    }
  },

  updatePhaseUI() {
    const phaseEl = document.getElementById('scanner-phase');
    const badge = document.getElementById('scanner-count');
    const btn = document.getElementById('btn-phase-action');
    const thumbs = document.getElementById('scanner-thumbnails');

    if (thumbs) thumbs.innerHTML = '';
    if (btn) btn.style.display = 'none';
    if (badge) badge.style.display = 'none';

    switch (this.phase) {
      case 'cover':
        if (phaseEl) phaseEl.textContent = 'Paso 1/3: Portada';
        break;
      case 'index':
        if (phaseEl) phaseEl.textContent = 'Paso 2/3: Índice';
        break;
      case 'pages':
        if (phaseEl) phaseEl.textContent = 'Paso 3/3: Páginas';
        break;
    }
  },

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
        if (App.state.indexPages.length === 0) {
          App.showToast('Captura al menos una página del índice', 'error');
          return;
        }
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
