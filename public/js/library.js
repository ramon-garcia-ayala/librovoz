// LibroVoz - Biblioteca de libros guardados
const Library = {
  async init() {
    const books = await DB.getAll();
    const grid = document.getElementById('library-grid');
    const empty = document.getElementById('library-empty');

    await this.renderQuotaBadge();
    if (typeof Microcopy !== 'undefined') {
      await Microcopy.render('library-ambient', 'welcome');
    }

    if (books.length === 0) {
      if (grid) grid.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (grid) grid.style.display = 'flex';
    if (empty) empty.style.display = 'none';

    this.renderBooks(books);
  },

  async renderQuotaBadge() {
    const badge = document.getElementById('library-quota');
    if (!badge) return;

    const status = await Quota.getStatus();
    const label = await Quota.getBookLabel();

    badge.classList.remove('warning', 'danger');

    if (status.atBookLimit) {
      badge.classList.add('danger');
      badge.innerHTML = `
        <span class="library-quota-text">${label}</span>
        <button class="library-quota-cta" onclick="App.go('paywall')">Comprar más</button>
      `;
    } else if (status.paidBooksRemaining === 0 && status.freeBooksRemaining === 1) {
      badge.classList.add('warning');
      badge.innerHTML = `<span class="library-quota-text">${label}</span>`;
    } else {
      badge.innerHTML = `<span class="library-quota-text">${label}</span>`;
    }
    badge.style.display = 'flex';
  },

  renderBooks(books) {
    const grid = document.getElementById('library-grid');
    if (!grid) return;

    grid.innerHTML = books.map(book => {
      const chapters = book.chapters ? book.chapters.length : 0;
      const progress = book.currentChapter || 0;
      const pct = chapters > 0 ? Math.round((progress / chapters) * 100) : 0;

      return `
        <div class="library-book" onclick="Library.open('${book.id}')">
          <div class="library-book-cover">
            ${book.coverThumbnail
              ? `<img src="${book.coverThumbnail}" alt="Portada">`
              : `<div class="library-book-cover-placeholder">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#999" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
                </div>`
            }
          </div>
          <div class="library-book-info">
            <h3 class="library-book-title">${book.title || 'Sin título'}</h3>
            <p class="library-book-author">${book.author || ''}</p>
            <p class="library-book-meta">${chapters} capítulo${chapters !== 1 ? 's' : ''}</p>
            ${pct > 0 ? `
              <div class="library-book-progress">
                <div class="library-book-progress-fill" style="width:${pct}%"></div>
              </div>
            ` : ''}
          </div>
          <button class="library-book-delete" onclick="event.stopPropagation(); Library.confirmDelete('${book.id}', '${(book.title || '').replace(/'/g, '\\&#39;')}')">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  },

  confirmDelete(bookId, title) {
    if (confirm(`¿Eliminar "${title}"?`)) {
      this.deleteBook(bookId);
    }
  },

  async deleteBook(bookId) {
    await DB.delete(bookId);
    App.showToast('Libro eliminado');
    this.init();
  },

  async open(bookId) {
    const book = await DB.get(bookId);
    if (!book) {
      App.showToast('No se encontró el libro', 'error');
      return;
    }

    // Cargar datos en App.state
    App.state.coverImage = null;
    App.state.coverThumbnail = book.coverThumbnail || null;
    App.state.coverInfo = { title: book.title, author: book.author, subtitle: book.subtitle || '' };
    App.state.chapters = book.chapters;
    App.state.processingMode = book.processingMode;
    App.state.currentChapter = book.currentChapter || 0;
    App.state._loadedBookId = book.id;
    App.state._savedSpeed = book.speed || 1;

    // Re-resolver voz
    App.state.selectedVoice = await this.resolveVoice(book.voiceName, book.voiceLang);

    // Actualizar lastPlayedAt
    await DB.updatePlaybackState(book.id, {});

    App.go('player');
  },

  resolveVoice(name, lang) {
    return new Promise((resolve) => {
      const tryResolve = () => {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) return false;

        // Buscar por nombre exacto
        let voice = voices.find(v => v.name === name);
        // Fallback: mismo idioma
        if (!voice && lang) {
          voice = voices.find(v => v.lang === lang);
        }
        // Fallback: cualquier español
        if (!voice) {
          voice = voices.find(v => v.lang.startsWith('es'));
        }
        // Último fallback
        if (!voice) voice = voices[0];

        resolve(voice);
        return true;
      };

      if (tryResolve()) return;

      // Esperar a que carguen las voces
      speechSynthesis.onvoiceschanged = () => {
        tryResolve();
        speechSynthesis.onvoiceschanged = null;
      };

      // Timeout por si nunca dispara el evento
      setTimeout(() => {
        if (!tryResolve()) resolve(null);
      }, 2000);
    });
  }
};
