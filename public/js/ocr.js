// LibroVoz - OCR Processing con paralelismo
const OCR = {
  // Procesar páginas en lotes paralelos para mayor velocidad
  async processAllPages(onProgress) {
    const pages = App.state.bookPages;
    const texts = new Array(pages.length).fill('');
    const BATCH_SIZE = 3;
    let completed = 0;

    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      const promises = batch.map((page, j) => {
        const idx = i + j;
        return API.ocr(page)
          .then(result => {
            texts[idx] = result.text || '';
          })
          .catch(err => {
            console.error(`Error OCR página ${idx + 1}:`, err);
            texts[idx] = '';
          })
          .finally(() => {
            completed++;
            if (onProgress) onProgress(completed, pages.length);
          });
      });

      await Promise.all(promises);
    }

    return texts.join('\n\n');
  },

  // Procesar índice en paralelo
  async processIndex(indexPages) {
    if (indexPages.length === 0) return '';

    const texts = new Array(indexPages.length).fill('');

    const promises = indexPages.map((page, i) =>
      API.ocr(page)
        .then(result => { texts[i] = result.text || ''; })
        .catch(err => {
          console.error(`Error OCR índice ${i + 1}:`, err);
          texts[i] = '';
        })
    );

    await Promise.all(promises);
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
