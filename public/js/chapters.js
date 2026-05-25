// LibroVoz - Detección + estructuración de capítulos con awareness de página
const Chapters = {
  // pages: array opcional [{num, text}] de páginas individuales (Tesseract output)
  async detect(fullText, indexText, pages) {
    try {
      const result = await API.detectChapters(fullText, indexText, pages);
      const chapters = result.chapters || [];
      const junkPatterns = result.junkPatterns || [];
      if (chapters.length > 0) {
        return { chapters, junkPatterns };
      }
    } catch (err) {
      console.error('Error detectando capítulos:', err);
    }
    return { chapters: this.fallbackChapters(fullText), junkPatterns: [] };
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
        name: `Parte ${num}`,
        startIndex: start,
        endIndex: end
      });
      start = end;
      num++;
    }
    return chapters;
  },

  // Construye los capítulos finales:
  // - Si vienen con startPage/endPage y tenemos `pages`, sliceamos por página.
  // - Si vienen con startChar/endChar, sliceamos el fullText.
  // - Si vienen con startIndex/endIndex (fallback), sliceamos por palabras.
  // Aplica junkPatterns como cleanup regex sobre cada chapter text.
  splitText(fullText, chapters, pages, junkPatterns) {
    const cleanupRegexes = this.compilePatterns(junkPatterns || []);

    const built = chapters.map((ch, i) => {
      const title = (ch.name || ch.title || `Capítulo ${i + 1}`).trim();
      let text = '';

      // 1. Por página (preferido cuando viene)
      if (ch.startPage && Array.isArray(pages) && pages.length > 0) {
        const end = ch.endPage || pages[pages.length - 1].num;
        text = pages
          .filter(p => p.num >= ch.startPage && p.num <= end)
          .map(p => p.text)
          .join('\n\n');
      }
      // 2. Por offset de char en fullText
      else if (ch.startChar !== undefined && ch.endChar !== undefined) {
        text = fullText.substring(ch.startChar, ch.endChar);
      }
      // 3. Por palabras
      else if (ch.startIndex !== undefined && ch.endIndex !== undefined) {
        const words = fullText.split(/\s+/);
        text = words.slice(ch.startIndex, ch.endIndex).join(' ');
      }
      // 4. Marker de texto
      else if (ch.startMarker) {
        const startPos = fullText.indexOf(ch.startMarker);
        const nextCh = chapters[i + 1];
        const endPos = nextCh?.startMarker
          ? fullText.indexOf(nextCh.startMarker)
          : fullText.length;
        if (startPos !== -1) {
          text = fullText.substring(startPos, endPos !== -1 ? endPos : fullText.length);
        }
      }

      // Fallback final: dividir equitativamente
      if (!text) {
        const words = fullText.split(/\s+/);
        const chunkSize = Math.ceil(words.length / chapters.length);
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, words.length);
        text = words.slice(start, end).join(' ');
      }

      // Cleanup: aplicar regex de junk patterns por línea
      text = this.cleanText(text, cleanupRegexes);

      return { title, text };
    }).filter(ch => ch.text && ch.text.length > 20);

    return built;
  },

  compilePatterns(patterns) {
    const compiled = [];
    for (const p of patterns) {
      try {
        compiled.push(new RegExp(p, 'gm'));
      } catch (err) {
        console.warn('Patrón inválido descartado:', p);
      }
    }
    return compiled;
  },

  cleanText(text, regexes) {
    let out = text;
    for (const re of regexes) {
      out = out.replace(re, '');
    }
    // Normalizar espacios y saltos sobrantes
    return out
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join('\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
};
