// LibroVoz - OCR Processing
const OCR = {
  async processAllPages(onProgress) {
    const pages = App.state.bookPages;
    const texts = [];

    for (let i = 0; i < pages.length; i++) {
      if (onProgress) onProgress(i + 1, pages.length);
      try {
        const result = await API.ocr(pages[i]);
        texts.push(result.text || '');
      } catch (err) {
        console.error(`Error OCR página ${i + 1}:`, err);
        texts.push('');
        App.showToast(`Error leyendo página ${i + 1}`, 'error');
      }
    }

    return texts.join('\n\n');
  },

  async processIndex(indexPages) {
    const texts = [];

    for (let i = 0; i < indexPages.length; i++) {
      try {
        const result = await API.ocr(indexPages[i]);
        texts.push(result.text || '');
      } catch (err) {
        console.error(`Error OCR índice ${i + 1}:`, err);
        texts.push('');
      }
    }

    return texts.join('\n');
  },

  async processCover(coverImage) {
    try {
      const result = await API.detectCover(coverImage);
      return {
        title: result.title || 'Libro sin título',
        author: result.author || 'Autor desconocido',
        subtitle: result.subtitle || ''
      };
    } catch (err) {
      console.error('Error detectando portada:', err);
      return { title: 'Libro sin título', author: 'Autor desconocido', subtitle: '' };
    }
  }
};
