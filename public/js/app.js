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
    landing: { partial: '/pages/landing.html', init: () => {
      if (typeof Microcopy !== 'undefined') Microcopy.render('landing-ambient', 'welcome');
    }},
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
    nav.setAttribute('aria-label', 'Navegación principal');
    nav.innerHTML = `
      <button class="nav-bar-item" data-nav="landing" onclick="App._navTo('landing', this)" aria-label="Inicio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span>Inicio</span>
      </button>
      <button class="nav-bar-item" data-nav="library" onclick="App._navTo('library', this)" aria-label="Mi biblioteca">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
        </svg>
        <span>Biblioteca</span>
      </button>
      <button class="nav-bar-item" data-nav="scanner" onclick="App._navTo('scanner', this)" aria-label="Escanear libro">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span>Escanear</span>
      </button>
    `;
    document.body.appendChild(nav);
  },

  // Handler centralizado para tap en nav bar: haptic + scale visual + go
  _navTo(screen, el) {
    if (navigator.vibrate) navigator.vibrate(12);
    if (el) {
      el.classList.add('tapping');
      setTimeout(() => el.classList.remove('tapping'), 200);
    }
    this.go(screen);
  },

  updateNavBar(screen) {
    // Se oculta en scanner (cámara fullscreen) y player (controls bottom
    // chocarían con la nav). En player el back arriba va a /library
    // y desde ahí accedes al resto.
    const hideOn = ['scanner', 'player'];
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

    // Highlight de la tab activa:
    // - landing → 'Inicio'
    // - library / player → 'Biblioteca' (player vino de library)
    // - tutorial / processing / voices → 'Escanear' (mid-flow)
    // - paywall → no highlight (es modal-like)
    const navItems = document.querySelectorAll('.nav-bar-item');
    navItems.forEach(item => {
      const target = item.dataset.nav;
      let isActive = false;
      if (target === 'landing') isActive = (screen === 'landing');
      else if (target === 'library') isActive = (screen === 'library' || screen === 'player');
      else if (target === 'scanner') isActive = ['tutorial', 'processing', 'voices'].includes(screen);
      item.classList.toggle('active', isActive);
    });
  },

  go(screen) {
    location.hash = `#/${screen}`;
  },

  // Helper centralizado: setea bookId activo y persiste para sobrevivir reload
  setLoadedBookId(id) {
    this.state._loadedBookId = id;
    try {
      if (id) localStorage.setItem('librovoz_last_book_id', id);
      else localStorage.removeItem('librovoz_last_book_id');
    } catch {}
  },

  getLastBookId() {
    try {
      return localStorage.getItem('librovoz_last_book_id');
    } catch {
      return null;
    }
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

// Sin warning de beforeunload: el procesamiento persiste a IndexedDB tras cada
// página, así que cerrar el tab es seguro. Se reanuda desde biblioteca.

document.addEventListener('DOMContentLoaded', () => App.init());
