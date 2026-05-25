// LibroVoz - Controlador principal SPA
const App = {
  state: {
    coverImage: null,
    coverThumbnail: null,
    coverInfo: { title: '', author: '', subtitle: '' },
    indexPages: [],
    bookPages: [],
    fullText: '',
    indexText: '',
    processingMode: null, // 'literal' | 'summary'
    chapters: [],
    selectedVoice: null,
    currentChapter: 0,
    isPlaying: false,
    _loadedBookId: null,
    _savedSpeed: 1
  },

  currentScreen: null,

  screens: {
    landing: { partial: null, init: null },
    library: { partial: '/pages/library.html', init: () => Library.init() },
    tutorial: { partial: '/pages/tutorial.html', init: () => Tutorial.init() },
    scanner: { partial: '/pages/scanner.html', init: () => Scanner.init() },
    processing: { partial: '/pages/processing.html', init: () => Processor.init() },
    voices: { partial: '/pages/voices.html', init: () => Voices.init() },
    player: { partial: '/pages/player.html', init: () => Player.init() },
    paywall: { partial: '/pages/paywall.html', init: () => Paywall.init() }
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
    // Microcopy en landing
    if (hash === 'landing' && typeof Microcopy !== 'undefined') {
      Microcopy.render('landing-ambient', 'welcome');
    }
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
    this.updateNavBar(screen);
  },

  renderNavBar() {
    // Remove existing nav bar
    const existing = document.getElementById('nav-bar');
    if (existing) existing.remove();

    const nav = document.createElement('nav');
    nav.id = 'nav-bar';
    nav.className = 'nav-bar';
    nav.innerHTML = `
      <button class="nav-bar-item" data-nav="landing" onclick="App.go('landing')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span>Inicio</span>
      </button>
      <button class="nav-bar-item" data-nav="library" onclick="App.go('library')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
        </svg>
        <span>Biblioteca</span>
      </button>
      <button class="nav-bar-item" data-nav="scanner" onclick="App.go('tutorial')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span>Escanear</span>
      </button>
    `;
    document.body.appendChild(nav);
  },

  updateNavBar(screen) {
    const hideOn = ['player', 'scanner'];
    const nav = document.getElementById('nav-bar');

    if (hideOn.includes(screen)) {
      if (nav) nav.style.display = 'none';
      return;
    }

    if (!nav) {
      this.renderNavBar();
    } else {
      nav.style.display = 'flex';
    }

    // Highlight active tab
    const navItems = document.querySelectorAll('.nav-bar-item');
    navItems.forEach(item => {
      const target = item.dataset.nav;
      const isActive = target === screen ||
        (target === 'scanner' && ['tutorial', 'processing', 'voices'].includes(screen));
      item.classList.toggle('active', isActive);
    });
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
