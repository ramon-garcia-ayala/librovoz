// LibroVoz - Detección y división de capítulos
const Chapters = {
  async detect(fullText, indexText) {
    try {
      const result = await API.detectChapters(fullText, indexText);
      if (result.chapters && result.chapters.length > 0) {
        return result.chapters;
      }
    } catch (err) {
      console.error('Error detectando capítulos:', err);
    }

    // Fallback: dividir en bloques de ~3000 palabras
    return this.fallbackChapters(fullText);
  },

  fallbackChapters(fullText) {
    const words = fullText.split(/\s+/);
    const chunkSize = 3000;
    const chapters = [];
    let start = 0;
    let num = 1;

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length);
      chapters.push({
        title: `Parte ${num}`,
        startIndex: start,
        endIndex: end
      });
      start = end;
      num++;
    }

    return chapters;
  },

  splitText(fullText, chapters) {
    const words = fullText.split(/\s+/);

    return chapters.map((ch, i) => {
      // Si tiene startIndex/endIndex, usar esos
      if (ch.startIndex !== undefined && ch.endIndex !== undefined) {
        return {
          title: ch.title,
          text: words.slice(ch.startIndex, ch.endIndex).join(' ')
        };
      }

      // Si tiene marcadores de texto, buscar en el texto completo
      if (ch.startMarker) {
        const startPos = fullText.indexOf(ch.startMarker);
        const nextCh = chapters[i + 1];
        const endPos = nextCh?.startMarker
          ? fullText.indexOf(nextCh.startMarker)
          : fullText.length;

        if (startPos !== -1) {
          return {
            title: ch.title,
            text: fullText.substring(startPos, endPos !== -1 ? endPos : fullText.length).trim()
          };
        }
      }

      // Fallback: dividir equitativamente
      const chunkSize = Math.ceil(words.length / chapters.length);
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, words.length);
      return {
        title: ch.title || `Parte ${i + 1}`,
        text: words.slice(start, end).join(' ')
      };
    }).filter(ch => ch.text.length > 0);
  }
};
