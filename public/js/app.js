// LibroVoz - Controlador principal SPA
const App = {
  state: {
    coverImage: null,
    coverInfo: { title: '', author: '', subtitle: '' },
    indexPages: [],
    bookPages: [],
    fullText: '',
    indexText: '',
    processingMode: null, // 'literal' | 'summary'
    chapters: [],
    selectedVoice: null,
    currentChapter: 0,
    isPlaying: false
  },

  currentScreen: null,

  screens: {
    landing: { partial: null, init: null },
    tutorial: { partial: '/pages/tutorial.html', init: () => Tutorial.init() },
    scanner: { partial: '/pages/scanner.html', init: () => Scanner.init() },
    processing: { partial: '/pages/processing.html', init: () => Processor.init() },
    voices: { partial: '/pages/voices.html', init: () => Voices.init() },
    player: { partial: '/pages/player.html', init: () => Player.init() }
  },

  async init() {
    // Registrar service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  async route() {
    const hash = location.hash.slice(2) || 'landing';
    await this.navigateTo(hash);
  },

  async navigateTo(screen) {
    // Limpiar pantalla anterior
    if (this.currentScreen === 'scanner') Scanner.destroy?.();
    if (this.currentScreen === 'player') Player.destroy?.();

    this.currentScreen = screen;
    const container = document.getElementById('app');
    const config = this.screens[screen];

    if (!config) {
      location.hash = '#/landing';
      return;
    }

    if (config.partial) {
      try {
        const res = await fetch(config.partial);
        const html = await res.text();
        container.innerHTML = html;
      } catch {
        container.innerHTML = '<p style="padding:2rem;text-align:center">Error cargando la pantalla</p>';
        return;
      }
    }

    // Transición suave
    container.style.opacity = '0';
    requestAnimationFrame(() => {
      container.style.transition = 'opacity 0.3s ease';
      container.style.opacity = '1';
    });

    config.init?.();
  },

  go(screen) {
    location.hash = `#/${screen}`;
  },

  showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

// Advertir si hay datos sin guardar
window.addEventListener('beforeunload', (e) => {
  if (App.state.bookPages.length > 0 && App.state.chapters.length === 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('DOMContentLoaded', () => App.init());
