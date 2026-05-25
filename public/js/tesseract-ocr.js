// LibroVoz - OCR client-side con Tesseract.js (sin costo de API)
const TesseractOCR = {
  worker: null,
  workerReady: false,
  workerLoading: null,

  // Inicializa el worker (singleton). Descarga WASM + traineddata español la 1ra vez (~13MB).
  async getWorker() {
    if (this.workerReady) return this.worker;
    if (this.workerLoading) return this.workerLoading;

    this.workerLoading = (async () => {
      // Tesseract.js v6 API
      this.worker = await Tesseract.createWorker('spa', 1, {
        // Logger opcional para debugging
        logger: m => {
          if (m.status === 'recognizing text' && m.progress > 0) {
            // Emitir progreso fino a quien escuche
            window.dispatchEvent(new CustomEvent('tesseract-progress', {
              detail: { progress: m.progress }
            }));
          }
        }
      });
      this.workerReady = true;
      return this.worker;
    })();

    return this.workerLoading;
  },

  // OCR de una imagen base64 (sin prefijo data:image/...).
  // Devuelve { text, confidence (0-100), needsReview (bool) }.
  async recognize(base64) {
    try {
      const worker = await this.getWorker();
      const imgUrl = `data:image/jpeg;base64,${base64}`;
      const { data } = await worker.recognize(imgUrl);

      const text = (data.text || '').trim();
      const confidence = data.confidence || 0;
      // Heurística: <50 caracteres o confianza <55 → marcar para revisión
      const needsReview = text.length < 50 || confidence < 55;

      return { text, confidence, needsReview };
    } catch (err) {
      console.error('Tesseract error:', err);
      return { text: '', confidence: 0, needsReview: true };
    }
  },

  // Liberar memoria cuando se termina de procesar un libro
  async terminate() {
    if (this.worker) {
      try { await this.worker.terminate(); } catch {}
      this.worker = null;
      this.workerReady = false;
      this.workerLoading = null;
    }
  }
};
