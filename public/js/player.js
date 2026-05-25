// LibroVoz - Reproductor estilo Spotify Lyrics + Karaoke
//
// Arquitectura robusta:
// - El capítulo se divide en SEGMENTOS de ~180 chars (por oración).
// - Cada segmento es su propia SpeechSynthesisUtterance.
// - Al terminar uno, dispara el siguiente. Esto evita el freeze por utterance larga.
// - Karaoke usa onboundary; si no dispara (Android común), un timer estima la posición
//   con base en velocidad asumida de 150 wpm * speed.
// - jumpToWord / rewind reconstruyen segmentos desde la posición target.
const Player = {
  synth: window.speechSynthesis,
  utterance: null,
  currentChapter: 0,
  isPlaying: false,
  speed: 1,
  speeds: [0.75, 1, 1.25, 1.5],
  speedIndex: 1,

  // Karaoke state
  sentences: [],
  words: [],
  currentWordIndex: 0,
  currentSentenceIndex: 0,
  totalChars: 0,
  chapterText: '',

  // Playback state
  segments: [],
  currentSegmentIndex: 0,
  segmentStartTime: 0,
  lastBoundaryAt: 0,
  fallbackTimer: null,
  watchdogTimer: null,

  // Scroll state
  autoScroll: true,

  // Tunables
  SEGMENT_MAX_CHARS: 180,
  BASE_WPM: 150,
  WATCHDOG_INTERVAL: 1500, // ms para detectar speech atascado

  async init() {
    // Si recargamos la página, App.state puede estar vacío. Restaurar del último libro.
    if (!App.state.chapters || App.state.chapters.length === 0) {
      const restored = await this.restoreFromStorage();
      if (!restored) {
        // No hay libro que restaurar → ir a biblioteca
        App.go('library');
        return;
      }
    }

    this.currentChapter = App.state.currentChapter || 0;

    const savedSpeed = App.state._savedSpeed || 1;
    this.speedIndex = this.speeds.indexOf(savedSpeed);
    if (this.speedIndex < 0) this.speedIndex = 1;
    this.speed = this.speeds[this.speedIndex];

    this.setupCover();
    this.setupChapterTabs();
    this._updateVoiceLabel();
    this.loadChapter(this.currentChapter);
    this.setupScrollDetection();
    this.startWatchdog();

    const btn = document.getElementById('btn-speed');
    if (btn) btn.textContent = this.speed + 'x';
  },

  // Restaura App.state desde IndexedDB usando el último libro abierto.
  // Devuelve true si encontró y cargó libro, false si no hay nada.
  async restoreFromStorage() {
    let book = null;

    // 1. Intentar por bookId persistido
    const lastId = App.getLastBookId();
    if (lastId) {
      try { book = await DB.get(lastId); } catch {}
    }

    // 2. Fallback: el libro más reciente (DB.getAll ya viene sorted por lastPlayedAt desc)
    if (!book) {
      try {
        const all = await DB.getAll();
        book = (all && all.length > 0) ? all[0] : null;
      } catch {}
    }

    if (!book || !book.chapters || book.chapters.length === 0) return false;

    // Si el libro es un draft (sin voz seleccionada), mejor mandarlo a voices
    if (book.isDraft === true) {
      App.state.coverThumbnail = book.coverThumbnail || null;
      App.state.coverInfo = { title: book.title, author: book.author, subtitle: book.subtitle || '' };
      App.state.chapters = book.chapters;
      App.state.fullText = book.fullText || '';
      App.state.processingMode = book.processingMode;
      App.state._isDraft = true;
      App.setLoadedBookId(book.id);
      App.go('voices');
      return false;
    }

    // Cargar al state (mismo patrón que Library.open)
    App.state.coverImage = null;
    App.state.coverThumbnail = book.coverThumbnail || null;
    App.state.coverInfo = { title: book.title, author: book.author, subtitle: book.subtitle || '' };
    App.state.chapters = book.chapters;
    App.state.fullText = book.fullText || '';
    App.state.processingMode = book.processingMode;
    App.state.currentChapter = book.currentChapter || 0;
    App.state._savedSpeed = book.speed || 1;
    App.state._isDraft = false;
    App.setLoadedBookId(book.id);

    // Re-resolver voz por nombre (puede tardar si voces no cargaron aún)
    try {
      App.state.selectedVoice = await Library.resolveVoice(book.voiceName, book.voiceLang);
    } catch {}

    return true;
  },

  setupCover() {
    const coverEl = document.getElementById('player-cover');
    const titleEl = document.getElementById('player-title');

    if (coverEl) {
      if (App.state.coverImage) {
        coverEl.innerHTML = `<img src="data:image/jpeg;base64,${App.state.coverImage}" alt="Portada">`;
      } else if (App.state.coverThumbnail) {
        coverEl.innerHTML = `<img src="${App.state.coverThumbnail}" alt="Portada">`;
      }
    }

    if (titleEl) {
      titleEl.textContent = App.state.coverInfo.title || 'Sin título';
    }
  },

  setupChapterTabs() {
    const tabsEl = document.getElementById('player-chapters-tabs');
    if (!tabsEl || !App.state.chapters.length) return;

    tabsEl.innerHTML = App.state.chapters.map((ch, i) => `
      <button class="player-chapter-tab ${i === this.currentChapter ? 'active' : ''}"
              onclick="Player.loadChapter(${i})" data-chapter="${i}">
        ${ch.title || 'Cap. ' + (i + 1)}
      </button>
    `).join('');
  },

  loadChapter(index) {
    this.stop();

    if (typeof Microcopy !== 'undefined' && this.currentChapter !== index && index > 0) {
      const phrase = Microcopy.pickSync('milestone');
      if (phrase && App && App.showToast) App.showToast(phrase, 'info');
    }

    this.currentChapter = index;
    App.state.currentChapter = index;
    this.saveProgress();

    const chapter = App.state.chapters[index];
    if (!chapter) return;

    this.chapterText = chapter.text;

    const chapterEl = document.getElementById('player-chapter');
    if (chapterEl) {
      chapterEl.textContent = `Cap. ${index + 1} de ${App.state.chapters.length} — ${chapter.title}`;
    }

    document.querySelectorAll('.player-chapter-tab').forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
    });

    this.buildLyrics(this.chapterText);
    this.segments = this.splitIntoSegments(this.chapterText);
    this.currentSegmentIndex = 0;
    this.currentWordIndex = 0;
    this.updateProgress(0);
    this.updatePlayIcon(false);
  },

  // Divide el texto en segmentos pequeños para utterances cortas.
  // Cada segment: { text, charStart } (charStart = offset en chapterText)
  splitIntoSegments(text, maxLen) {
    const max = maxLen || this.SEGMENT_MAX_CHARS;
    // Romper por oración (preserva puntuación)
    const sentences = text.match(/[^.!?\n]+[.!?]+["»']?|\S+[^.!?\n]*/g) || [text];

    const result = [];
    let current = '';

    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;

      // Si la oración SOLA ya excede el máximo, hay que partirla por palabras
      if (trimmed.length > max) {
        if (current) {
          result.push(current.trim());
          current = '';
        }
        const words = trimmed.split(/\s+/);
        let chunk = '';
        for (const w of words) {
          if ((chunk + ' ' + w).length > max && chunk) {
            result.push(chunk.trim());
            chunk = w;
          } else {
            chunk = chunk ? chunk + ' ' + w : w;
          }
        }
        if (chunk) current = chunk;
        continue;
      }

      if ((current + ' ' + trimmed).length > max && current) {
        result.push(current.trim());
        current = trimmed;
      } else {
        current = current ? current + ' ' + trimmed : trimmed;
      }
    }
    if (current.trim()) result.push(current.trim());

    // Calcular charStart de cada segmento dentro del texto original
    let pos = 0;
    return result.map(segText => {
      const idx = text.indexOf(segText, pos);
      const charStart = idx !== -1 ? idx : pos;
      pos = charStart + segText.length;
      return { text: segText, charStart };
    });
  },

  buildLyrics(text) {
    const container = document.getElementById('lyrics-container');
    if (!container) return;

    this.sentences = Utils.splitIntoSentences(text);
    this.words = [];
    this.currentWordIndex = 0;
    this.currentSentenceIndex = 0;

    let globalCharIndex = 0;
    let globalWordIndex = 0;

    const FIGURE_RE = /^\[Figura\s+\d+:.+\]$/;

    container.innerHTML = this.sentences.map((sentence, si) => {
      const sentenceWords = Utils.splitIntoWords(sentence);
      const wordsHtml = sentenceWords.map((w) => {
        const charIdx = text.indexOf(w.word, globalCharIndex);
        const actualCharIdx = charIdx !== -1 ? charIdx : globalCharIndex;

        this.words.push({
          word: w.word,
          charIndex: actualCharIdx,
          sentenceIndex: si,
          globalIndex: globalWordIndex
        });

        globalWordIndex++;
        if (charIdx !== -1) globalCharIndex = charIdx + w.word.length;

        return `<span class="word" data-word-index="${globalWordIndex - 1}" data-char-index="${actualCharIdx}">${w.word}</span>`;
      }).join(' ');

      const isFigure = FIGURE_RE.test(sentence.trim());
      const lineClass = isFigure ? 'lyric-line lyric-figure future' : 'lyric-line future';

      return `<div class="${lineClass}" data-sentence="${si}">${wordsHtml}</div>`;
    }).join('');

    this.totalChars = text.length;

    // Click en palabra para saltar (delegación)
    if (!container._clickWired) {
      container.addEventListener('click', (e) => {
        const wordEl = e.target.closest('.word');
        if (wordEl) {
          const wordIndex = parseInt(wordEl.dataset.wordIndex);
          this.jumpToWord(wordIndex);
        }
      });
      container._clickWired = true;
    }
  },

  // ══════════════════════════════════════════════════════════════════════
  // PLAYBACK
  // ══════════════════════════════════════════════════════════════════════

  play() {
    // Resume from pause sin reiniciar el segmento
    if (this.synth.paused && this.utterance) {
      this.synth.resume();
      this.isPlaying = true;
      this.updatePlayIcon(true);
      return;
    }

    // Iniciar desde la palabra actual: encontrar segmento que la contiene
    const startWord = this.words[this.currentWordIndex] || this.words[0];
    const startChar = startWord ? startWord.charIndex : 0;

    // Reconstruir segmentos desde la posición actual
    const remainingText = this.chapterText.substring(startChar);
    const newSegments = this.splitIntoSegments(remainingText);
    // Ajustar charStart al offset global del capítulo
    for (const s of newSegments) {
      s.charStart += startChar;
    }
    this.segments = newSegments;
    this.currentSegmentIndex = 0;

    this.isPlaying = true;
    this.updatePlayIcon(true);
    this.playSegment(0);
  },

  playSegment(idx) {
    if (!this.isPlaying) return;

    if (idx >= this.segments.length) {
      // Fin del capítulo
      this.stopFallbackTimer();
      this.markAllPast();
      if (this.currentChapter < App.state.chapters.length - 1) {
        this.loadChapter(this.currentChapter + 1);
        setTimeout(() => this.play(), 400);
      } else {
        this.isPlaying = false;
        this.updatePlayIcon(false);
      }
      return;
    }

    const seg = this.segments[idx];
    this.currentSegmentIndex = idx;

    const utt = new SpeechSynthesisUtterance(seg.text);
    if (App.state.selectedVoice) utt.voice = App.state.selectedVoice;
    utt.lang = (App.state.selectedVoice && App.state.selectedVoice.lang) || 'es-ES';
    utt.rate = this.speed;
    utt.pitch = 1;
    utt.volume = 1;

    this.segmentStartTime = Date.now();
    this.lastBoundaryAt = Date.now();

    utt.onboundary = (e) => {
      if (e.name === 'word') {
        this.lastBoundaryAt = Date.now();
        this.highlightByCharIndex(seg.charStart + e.charIndex);
      }
    };

    utt.onend = () => {
      this.stopFallbackTimer();
      if (!this.isPlaying) return;
      // Pequeño breath entre segmentos para evitar choque en algunos motores
      setTimeout(() => {
        if (this.isPlaying) this.playSegment(idx + 1);
      }, 30);
    };

    utt.onerror = (e) => {
      this.stopFallbackTimer();
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      console.warn('Speech error en segmento', idx, ':', e.error);
      // Auto-recovery: saltar al siguiente segmento
      setTimeout(() => {
        if (this.isPlaying) this.playSegment(idx + 1);
      }, 200);
    };

    this.utterance = utt;
    this.synth.speak(utt);
    this.startFallbackTimer(seg);
  },

  pause() {
    try { this.synth.pause(); } catch {}
    this.isPlaying = false;
    this.stopFallbackTimer();
    this.updatePlayIcon(false);
  },

  stop() {
    try { this.synth.cancel(); } catch {}
    this.isPlaying = false;
    this.stopFallbackTimer();
    this.updatePlayIcon(false);
  },

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  },

  // ══════════════════════════════════════════════════════════════════════
  // NAVEGACIÓN POR TIEMPO/PALABRA
  // ══════════════════════════════════════════════════════════════════════

  jumpToWord(wordIndex) {
    const word = this.words[wordIndex];
    if (!word) return;

    this.stop();
    this.currentWordIndex = wordIndex;
    this.highlightByCharIndex(word.charIndex);
    this.isPlaying = true;
    this.updatePlayIcon(true);
    // Pequeño delay para que cancel termine completamente
    setTimeout(() => {
      const startChar = word.charIndex;
      const remainingText = this.chapterText.substring(startChar);
      const newSegments = this.splitIntoSegments(remainingText);
      for (const s of newSegments) s.charStart += startChar;
      this.segments = newSegments;
      this.currentSegmentIndex = 0;
      this.playSegment(0);
    }, 80);
  },

  // Retroceder N segundos basado en velocidad asumida
  rewind(seconds) {
    const sec = seconds || 10;
    const wpm = this.BASE_WPM * this.speed;
    const wordsBack = Math.max(1, Math.floor((sec * wpm) / 60));
    const newIndex = Math.max(0, this.currentWordIndex - wordsBack);
    this.jumpToWord(newIndex);
  },

  forward(seconds) {
    const sec = seconds || 10;
    const wpm = this.BASE_WPM * this.speed;
    const wordsForward = Math.max(1, Math.floor((sec * wpm) / 60));
    const newIndex = Math.min(this.words.length - 1, this.currentWordIndex + wordsForward);
    this.jumpToWord(newIndex);
  },

  // ══════════════════════════════════════════════════════════════════════
  // KARAOKE HIGHLIGHT
  // ══════════════════════════════════════════════════════════════════════

  highlightByCharIndex(charPos) {
    let wordIdx = 0;
    for (let i = 0; i < this.words.length; i++) {
      if (this.words[i].charIndex <= charPos) wordIdx = i;
      else break;
    }
    this.setActiveWord(wordIdx);
  },

  setActiveWord(wordIdx) {
    if (wordIdx === this.currentWordIndex && this._lastHighlightedIdx === wordIdx) return;
    this._lastHighlightedIdx = wordIdx;

    this.currentWordIndex = wordIdx;
    const sentenceIdx = this.words[wordIdx]?.sentenceIndex ?? 0;
    const sentenceChanged = sentenceIdx !== this.currentSentenceIndex;
    this.currentSentenceIndex = sentenceIdx;

    // Actualizar clases palabra-a-palabra usando query directo y rangos
    const allWords = document.querySelectorAll('.word');
    for (let i = 0; i < allWords.length; i++) {
      const el = allWords[i];
      if (i < wordIdx) {
        if (!el.classList.contains('past')) {
          el.classList.add('past');
          el.classList.remove('active');
        }
      } else if (i === wordIdx) {
        el.classList.add('active');
        el.classList.remove('past');
      } else {
        el.classList.remove('active', 'past');
      }
    }

    if (sentenceChanged) {
      const allLines = document.querySelectorAll('.lyric-line');
      for (let i = 0; i < allLines.length; i++) {
        const el = allLines[i];
        el.classList.remove('active', 'past', 'future');
        if (i < sentenceIdx) el.classList.add('past');
        else if (i === sentenceIdx) el.classList.add('active');
        else el.classList.add('future');
      }

      if (this.autoScroll) this.scrollActiveIntoView();
    }

    if (this.words.length > 0) {
      this.updateProgress((wordIdx / this.words.length) * 100);
    }
  },

  scrollActiveIntoView() {
    const activeLine = document.querySelector('.lyric-line.active');
    if (!activeLine) return;
    // scrollIntoView nativo: respeta scroll-padding del container y scroll-margin
    // del elemento. Funciona bien en edges (primeras/últimas líneas no se atascan).
    try {
      activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // Fallback para browsers viejos
      const lyricsContainer = document.getElementById('player-lyrics');
      if (lyricsContainer) {
        const lineTop = activeLine.offsetTop;
        const containerHeight = lyricsContainer.clientHeight;
        lyricsContainer.scrollTo({
          top: lineTop - containerHeight / 3,
          behavior: 'smooth'
        });
      }
    }
  },

  // Timer que estima posición si onboundary no dispara (común en Android)
  startFallbackTimer(segment) {
    this.stopFallbackTimer();
    const segWords = segment.text.split(/\s+/).filter(Boolean);
    const totalWords = segWords.length;
    if (totalWords === 0) return;

    // Estimar duración del segmento en ms con base en velocidad
    const wpm = this.BASE_WPM * this.speed;
    const estimatedDurationMs = (totalWords / wpm) * 60 * 1000;
    const msPerWord = estimatedDurationMs / totalWords;

    // Posiciones char de cada palabra dentro del segmento
    const wordCharOffsets = [];
    let cursor = 0;
    for (const w of segWords) {
      const idx = segment.text.indexOf(w, cursor);
      const actualIdx = idx !== -1 ? idx : cursor;
      wordCharOffsets.push(actualIdx);
      cursor = actualIdx + w.length;
    }

    this.fallbackTimer = setInterval(() => {
      // Si onboundary disparó hace menos de 1.5s, no interferir
      if (Date.now() - this.lastBoundaryAt < 1500) return;

      const elapsedMs = Date.now() - this.segmentStartTime;
      const elapsedWords = Math.min(totalWords - 1, Math.floor(elapsedMs / msPerWord));
      const charOffset = wordCharOffsets[elapsedWords] ?? 0;
      this.highlightByCharIndex(segment.charStart + charOffset);
    }, 250);
  },

  stopFallbackTimer() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  },

  // Watchdog que detecta speech "muerto" (sin progreso por mucho tiempo) y reinicia
  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (!this.isPlaying) return;
      // Si pasaron 6 segundos desde el último boundary Y synth dice que no está hablando
      const idleMs = Date.now() - this.lastBoundaryAt;
      if (idleMs > 6000 && !this.synth.speaking && !this.synth.paused) {
        console.warn('Watchdog: speech atascado, reiniciando segmento', this.currentSegmentIndex);
        this.playSegment(this.currentSegmentIndex);
      }
    }, 2000);
  },

  // ══════════════════════════════════════════════════════════════════════
  // CHAPTERS / SPEED / UI
  // ══════════════════════════════════════════════════════════════════════

  nextChapter() {
    if (this.currentChapter < App.state.chapters.length - 1) {
      this.loadChapter(this.currentChapter + 1);
    }
  },

  prevChapter() {
    if (this.currentChapter > 0) {
      this.loadChapter(this.currentChapter - 1);
    }
  },

  // ── Voice picker (sheet desde el player) ──────────────────────────────
  openVoicePicker() {
    const sheet = document.getElementById('voice-sheet');
    if (!sheet) return;
    this._renderVoicePicker();
    sheet.classList.add('visible');
  },

  closeVoicePicker() {
    const sheet = document.getElementById('voice-sheet');
    if (sheet) sheet.classList.remove('visible');
  },

  _renderVoicePicker() {
    const list = document.getElementById('voice-sheet-list');
    if (!list) return;

    // Obtener todas las voces disponibles y rankearlas como hace Voices
    let voices = [];
    if (typeof Voices !== 'undefined' && typeof Voices.loadVoices === 'function') {
      // Si Voices ya cargó, reutilizar
      if (!Voices.voices || Voices.voices.length === 0) {
        Voices.loadVoices();
      }
      voices = Voices.voices || [];
    }
    if (voices.length === 0) {
      // Fallback: rawget del navegador
      voices = (speechSynthesis.getVoices() || []).filter(v => (v.lang || '').startsWith('es'));
    }

    const currentName = App.state.selectedVoice ? App.state.selectedVoice.name : '';

    if (voices.length === 0) {
      list.innerHTML = '<p class="voice-sheet-empty">No se encontraron voces disponibles.</p>';
      return;
    }

    list.innerHTML = voices.map((v, i) => {
      const cleanName = (v.name || '').replace(/\(.*\)/, '').trim() || 'Voz';
      const tags = (typeof Voices !== 'undefined' && Voices._voiceTags) ? Voices._voiceTags(v) : [];
      const gender = (typeof Voices !== 'undefined' && Voices._voiceGender) ? Voices._voiceGender(v) : null;
      const isCurrent = v.name === currentName;
      return `
        <button class="voice-sheet-item ${isCurrent ? 'is-current' : ''}" onclick="Player.selectVoice(${i})">
          <div class="voice-sheet-item-info">
            <div class="voice-sheet-item-name">${cleanName}</div>
            <div class="voice-sheet-item-meta">${v.lang}${gender ? ' · ' + gender : ''}${tags.length > 0 ? ' · ' + tags.join(' · ') : ''}</div>
          </div>
          ${isCurrent
            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<button class="voice-sheet-preview" onclick="event.stopPropagation(); Player.previewVoiceFromPicker(' + i + ')">Escuchar</button>'}
        </button>
      `;
    }).join('');
  },

  previewVoiceFromPicker(index) {
    const voice = (typeof Voices !== 'undefined' && Voices.voices) ? Voices.voices[index] : null;
    if (!voice) return;
    try { speechSynthesis.cancel(); } catch {}
    const utt = new SpeechSynthesisUtterance('Hola, esta es mi voz para tu audiolibro.');
    utt.voice = voice;
    utt.lang = voice.lang || 'es-ES';
    utt.rate = 1;
    speechSynthesis.speak(utt);
  },

  async selectVoice(index) {
    const voice = (typeof Voices !== 'undefined' && Voices.voices) ? Voices.voices[index] : null;
    if (!voice) return;

    // Detener preview si hay
    try { speechSynthesis.cancel(); } catch {}

    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.stop();

    App.state.selectedVoice = voice;

    // Persistir en el libro guardado
    if (App.state._loadedBookId) {
      try {
        const book = await DB.get(App.state._loadedBookId);
        if (book) {
          book.voiceName = voice.name;
          book.voiceLang = voice.lang;
          await DB.save(book);
        }
      } catch (err) {
        console.warn('No se pudo guardar la voz en el libro:', err);
      }
    }

    // Actualizar label en el botón
    this._updateVoiceLabel();

    // Toast + cerrar sheet
    if (App.showToast) App.showToast(`Voz cambiada a ${voice.name.replace(/\(.*\)/, '').trim()}`, 'info');
    this.closeVoicePicker();

    // Si estaba reproduciendo, reanudar con la nueva voz desde la palabra actual
    if (wasPlaying) {
      setTimeout(() => this.play(), 200);
    }
  },

  _updateVoiceLabel() {
    const label = document.getElementById('btn-voice-label');
    if (!label) return;
    const v = App.state.selectedVoice;
    if (!v) {
      label.textContent = 'Voz';
      return;
    }
    const name = (v.name || '').replace(/\(.*\)/, '').trim();
    // Truncar a 12 chars para no romper el layout
    label.textContent = name.length > 12 ? name.slice(0, 11) + '…' : name;
  },

  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % this.speeds.length;
    this.speed = this.speeds[this.speedIndex];

    const btn = document.getElementById('btn-speed');
    if (btn) btn.textContent = this.speed + 'x';

    this.saveProgress();

    if (this.isPlaying) {
      // Reiniciar segmento actual con nueva velocidad
      this.synth.cancel();
      setTimeout(() => {
        if (this.isPlaying) this.playSegment(this.currentSegmentIndex);
      }, 80);
    }
  },

  updateProgress(pct) {
    const fill = document.getElementById('player-progress-fill');
    if (fill) fill.style.width = Math.min(100, pct) + '%';
  },

  updatePlayIcon(playing) {
    const icon = document.getElementById('icon-play');
    if (!icon) return;
    if (playing) {
      icon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    } else {
      icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
  },

  markAllPast() {
    document.querySelectorAll('.word').forEach(el => {
      el.classList.remove('active');
      el.classList.add('past');
    });
    document.querySelectorAll('.lyric-line').forEach(el => {
      el.classList.remove('active', 'future');
      el.classList.add('past');
    });
    this.updateProgress(100);
  },

  setupScrollDetection() {
    const lyricsEl = document.getElementById('player-lyrics');
    if (!lyricsEl) return;
    const onUserScroll = () => {
      this.autoScroll = false;
      this.showLiveButton(true);
    };
    lyricsEl.addEventListener('touchstart', onUserScroll, { passive: true });
    lyricsEl.addEventListener('wheel', onUserScroll, { passive: true });
  },

  showLiveButton(show) {
    const btn = document.getElementById('btn-live');
    if (btn) btn.classList.toggle('visible', show);
  },

  scrollToLive() {
    this.autoScroll = true;
    this.showLiveButton(false);
    this.scrollActiveIntoView();
  },

  saveProgress() {
    if (!App.state._loadedBookId) return;
    DB.updatePlaybackState(App.state._loadedBookId, {
      currentChapter: this.currentChapter,
      speed: this.speed
    }).catch(() => {});
  },

  destroy() {
    this.saveProgress();
    try { this.synth.cancel(); } catch {}
    this.isPlaying = false;
    this.stopFallbackTimer();
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
};
