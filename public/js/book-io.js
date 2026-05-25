// LibroVoz - Export/Import de libros en formato JSON portable
const BookIO = {
  FORMAT: 'librovoz-book',
  EXPORT_VERSION: 1,

  // Límites de seguridad al importar (para evitar payloads abusivos)
  MAX_TITLE: 300,
  MAX_AUTHOR: 200,
  MAX_THUMB_SIZE: 200 * 1024,  // 200 KB base64
  MAX_CHAPTERS: 500,
  MAX_TEXT_CHARS: 2_000_000,   // ~2 MB de texto

  // ── Exportar ─────────────────────────────────────────────────────────
  buildExportPayload(book) {
    return {
      _format: this.FORMAT,
      _version: this.EXPORT_VERSION,
      title: book.title || 'Sin título',
      author: book.author || '',
      subtitle: book.subtitle || '',
      coverThumbnail: book.coverThumbnail || null,
      chapters: (book.chapters || []).map(c => ({
        title: c.title || '',
        text: c.text || ''
      })),
      fullText: book.fullText || '',
      processingMode: book.processingMode || 'literal',
      voiceName: book.voiceName || '',
      voiceLang: book.voiceLang || 'es-ES',
      exportedAt: new Date().toISOString(),
      exportedFrom: 'LibroVoz v1.0'
    };
  },

  exportBook(book) {
    if (!book) return;
    const payload = this.buildExportPayload(book);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const filename = `${this.sanitizeFilename(book.title || 'libro')}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return filename;
  },

  sanitizeFilename(title) {
    return String(title)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'libro';
  },

  // ── Importar ─────────────────────────────────────────────────────────
  async importFromFile(file) {
    if (!file) throw new Error('No se seleccionó ningún archivo');
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Archivo demasiado grande (máximo 5 MB)');
    }

    const text = await this.readAsText(file);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('El archivo no es un JSON válido');
    }

    const validation = this.validate(data);
    if (!validation.ok) throw new Error(validation.error);

    const book = this.normalizeToBook(data);
    await DB.save(book);
    return book;
  },

  readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsText(file);
    });
  },

  validate(data) {
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Archivo vacío o inválido' };
    }
    if (data._format !== this.FORMAT) {
      return { ok: false, error: 'Este no es un archivo de LibroVoz' };
    }
    if (typeof data._version === 'number' && data._version > this.EXPORT_VERSION) {
      return { ok: false, error: 'Archivo de una versión más nueva. Actualiza la app.' };
    }
    if (!data.title || typeof data.title !== 'string') {
      return { ok: false, error: 'El archivo no tiene título' };
    }
    if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
      return { ok: false, error: 'El archivo no tiene capítulos' };
    }
    if (data.chapters.length > this.MAX_CHAPTERS) {
      return { ok: false, error: `Demasiados capítulos (máximo ${this.MAX_CHAPTERS})` };
    }
    const allHaveText = data.chapters.every(c => c && typeof c.text === 'string' && c.text.length > 0);
    if (!allHaveText) {
      return { ok: false, error: 'Algún capítulo está vacío' };
    }
    return { ok: true };
  },

  // Convierte payload validado en objeto book listo para DB
  normalizeToBook(data) {
    const now = new Date().toISOString();
    const title = String(data.title).slice(0, this.MAX_TITLE);
    const author = String(data.author || '').slice(0, this.MAX_AUTHOR);
    const subtitle = String(data.subtitle || '').slice(0, this.MAX_AUTHOR);

    let coverThumbnail = data.coverThumbnail || null;
    if (coverThumbnail && (typeof coverThumbnail !== 'string' || !coverThumbnail.startsWith('data:image/'))) {
      coverThumbnail = null;
    }
    if (coverThumbnail && coverThumbnail.length > this.MAX_THUMB_SIZE) {
      coverThumbnail = null;
    }

    const chapters = data.chapters.map(c => ({
      title: String(c.title || '').slice(0, 300),
      text: String(c.text).slice(0, this.MAX_TEXT_CHARS / data.chapters.length)
    }));
    const fullText = (typeof data.fullText === 'string')
      ? data.fullText.slice(0, this.MAX_TEXT_CHARS)
      : chapters.map(c => c.text).join('\n\n');

    return {
      id: 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      title,
      author,
      subtitle,
      coverThumbnail,
      chapters,
      fullText,
      processingMode: data.processingMode === 'summary' ? 'summary' : 'literal',
      voiceName: String(data.voiceName || ''),
      voiceLang: String(data.voiceLang || 'es-ES'),
      currentChapter: 0,
      speed: 1,
      tier: 'imported',
      summaryAvailable: false,
      chatHistory: [],
      savedAt: now,
      lastPlayedAt: now,
      importedAt: now,
      importedFrom: String(data.exportedFrom || 'desconocido').slice(0, 100)
    };
  }
};
