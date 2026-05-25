// LibroVoz - Detección + estructuración de capítulos con awareness de página
const Chapters = {
  MIN_CHAPTER_CHARS: 500,

  // hint: 'auto' | number (1, 3, 5, 10) — cantidad esperada de capítulos
  async detect(fullText, indexText, pages, hint) {
    // Atajo: si el usuario dijo que solo escaneó 1 capítulo, no llamar API
    if (hint === 1) {
      return {
        chapters: [{ name: 'Libro completo', startChar: 0, endChar: fullText.length }],
        junkPatterns: []
      };
    }

    try {
      const result = await API.detectChapters(fullText, indexText, pages, hint);
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

  // Fusionar capítulos minúsculos. Si la mayoría son fragmentos, unificar todo.
  validateAndMerge(chapters) {
    if (!chapters || chapters.length <= 1) return chapters;

    const tinyCount = chapters.filter(c => (c.text || '').length < this.MIN_CHAPTER_CHARS).length;
    if (tinyCount / chapters.length > 0.5) {
      return [{
        title: chapters[0].title || 'Libro completo',
        text: chapters.map(c => c.text || '').filter(Boolean).join('\n\n')
      }];
    }

    const result = [];
    let pending = null;
    for (const ch of chapters) {
      const textLen = (ch.text || '').length;
      if (textLen < this.MIN_CHAPTER_CHARS) {
        pending = pending
          ? { title: pending.title, text: pending.text + '\n\n' + (ch.text || '') }
          : { title: ch.title, text: ch.text || '' };
      } else {
        if (pending) {
          result.push({ title: pending.title, text: pending.text + '\n\n' + (ch.text || '') });
          pending = null;
        } else {
          result.push(ch);
        }
      }
    }
    if (pending) {
      if (result.length > 0) {
        const last = result[result.length - 1];
        result[result.length - 1] = { title: last.title, text: last.text + '\n\n' + pending.text };
      } else {
        result.push(pending);
      }
    }
    return result;
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
