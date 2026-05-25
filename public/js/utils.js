// LibroVoz - Utilidades
const Utils = {
  // Resize chico para vision calls (cover) — menos tokens
  resizeImageForCover(base64) {
    return this.resizeImage(base64, 1024);
  },

  // Redimensionar imagen a max width, devolver base64 JPEG
  resizeImage(base64, maxWidth = 1500) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const result = canvas.toDataURL('image/jpeg', 0.85);
        resolve(result.split(',')[1]); // solo la parte base64
      };
      img.src = `data:image/jpeg;base64,${base64}`;
    });
  },

  // Capturar frame de video como base64
  captureVideoFrame(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl.split(',')[1];
  },

  // Crear thumbnail pequeño
  createThumbnail(base64, size = 80) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(size / img.width, size / img.height);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = `data:image/jpeg;base64,${base64}`;
    });
  },

  // Dividir texto en oraciones para el karaoke
  splitIntoSentences(text) {
    return text
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  },

  // Dividir texto en palabras con sus offsets
  splitIntoWords(text) {
    const words = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    }
    return words;
  },

  // Debounce
  debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  },

  // Extraer color dominante de imagen (simplificado)
  getDominantColor(base64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        resolve(`${r}, ${g}, ${b}`);
      };
      img.onerror = () => resolve('30, 30, 30');
      img.src = `data:image/jpeg;base64,${base64}`;
    });
  }
};
