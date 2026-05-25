// LibroVoz - Cliente API
const API = {
  BASE: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `${window.location.protocol}//${window.location.host}/api`
    : '/api',

  async _fetch(endpoint, body, timeout = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${this.BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error del servidor' }));
        throw new Error(err.error || `Error ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Intenta de nuevo.');
      throw err;
    }
  },

  async ocr(imageBase64) {
    return this._fetch('/ocr', { image: imageBase64 });
  },

  async detectCover(imageBase64) {
    return this._fetch('/detect-cover', { image: imageBase64 });
  },

  async detectChapters(text, indexText) {
    return this._fetch('/detect-chapters', { text, indexText });
  },

  async summarize(text, chapterName) {
    return this._fetch('/summarize', { text, chapterName });
  },

  async health() {
    try {
      const res = await fetch(`${this.BASE}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
};
