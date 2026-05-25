// LibroVoz - Reproductor estilo Spotify Lyrics + Karaoke
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

  // Scroll state
  autoScroll: true,
  scrollTimer: null,

  // Chrome bug fix
  chromeBugInterval: null,

  init() {
    this.currentChapter = App.state.currentChapter || 0;

    // Restaurar velocidad si viene de libro guardado
    const savedSpeed = App.state._savedSpeed || 1;
    this.speedIndex = this.speeds.indexOf(savedSpeed);
    if (this.speedIndex < 0) this.speedIndex = 1;
    this.speed = this.speeds[this.speedIndex];

    this.setupCover();
    this.setupChapterTabs();
    this.loadChapter(this.currentChapter);
    this.setupScrollDetection();
    this.startChromeBugFix();

    // Mostrar velocidad restaurada
    const btn = document.getElementById('btn-speed');
    if (btn) btn.textContent = this.speed + 'x';
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
    // Detener reproducción actual
    this.stop();

    // Milestone microcopy al cambiar de capítulo (no en la carga inicial)
    if (typeof Microcopy !== 'undefined' && this.currentChapter !== index && index > 0) {
      const phrase = Microcopy.pickSync('milestone');
      if (phrase && App && App.showToast) App.showToast(phrase, 'info');
    }

    this.currentChapter = index;
    App.state.currentChapter = index;

    // Guardar progreso si es libro guardado
    this.saveProgress();

    const chapter = App.state.chapters[index];
    if (!chapter) return;

    this.chapterText = chapter.text;

    // Actualizar info
    const chapterEl = document.getElementById('player-chapter');
    if (chapterEl) {
      chapterEl.textContent = `Cap. ${index + 1} de ${App.state.chapters.length} — ${chapter.title}`;
    }

    // Actualizar tabs activas
    document.querySelectorAll('.player-chapter-tab').forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
    });

    // Construir karaoke
    this.buildLyrics(this.chapterText);

    // Reset progreso
    this.updateProgress(0);
    this.updatePlayIcon(false);
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

      // Si la oración completa es un marcador de figura → estilizar como bloque distinto
      const isFigure = FIGURE_RE.test(sentence.trim());
      const lineClass = isFigure ? 'lyric-line lyric-figure future' : 'lyric-line future';

      return `<div class="${lineClass}" data-sentence="${si}">${wordsHtml}</div>`;
    }).join('');

    this.totalChars = text.length;

    // Click en palabra para saltar
    container.addEventListener('click', (e) => {
      const wordEl = e.target.closest('.word');
      if (wordEl) {
        const wordIndex = parseInt(wordEl.dataset.wordIndex);
        this.jumpToWord(wordIndex);
      }
    });
  },

  createUtterance(text, startOffset) {
    const utt = new SpeechSynthesisUtterance(text);

    if (App.state.selectedVoice) {
      utt.voice = App.state.selectedVoice;
    }
    utt.lang = 'es-ES';
    utt.rate = this.speed;

    utt.onboundary = (e) => {
      if (e.name === 'word') {
        const charPos = (startOffset || 0) + e.charIndex;
        this.highlightByCharIndex(charPos);
      }
    };

    utt.onend = () => {
      if (this.isPlaying) {
        // Capítulo terminado, ir al siguiente si hay
        if (this.currentChapter < App.state.chapters.length - 1) {
          this.loadChapter(this.currentChapter + 1);
          setTimeout(() => this.play(), 500);
        } else {
          this.isPlaying = false;
          this.updatePlayIcon(false);
          this.markAllPast();
        }
      }
    };

    utt.onerror = (e) => {
      if (e.error !== 'canceled') {
        console.error('Speech error:', e.error);
        this.isPlaying = false;
        this.updatePlayIcon(false);
      }
    };

    return utt;
  },

  highlightByCharIndex(charPos) {
    // Encontrar la palabra más cercana
    let wordIdx = 0;
    for (let i = 0; i < this.words.length; i++) {
      if (this.words[i].charIndex <= charPos) {
        wordIdx = i;
      } else {
        break;
      }
    }

    this.currentWordIndex = wordIdx;
    const sentenceIdx = this.words[wordIdx]?.sentenceIndex ?? 0;
    this.currentSentenceIndex = sentenceIdx;

    // Actualizar clases de palabras
    document.querySelectorAll('.word').forEach((el, i) => {
      el.classList.remove('active', 'past');
      if (i < wordIdx) el.classList.add('past');
      else if (i === wordIdx) el.classList.add('active');
    });

    // Actualizar clases de líneas
    document.querySelectorAll('.lyric-line').forEach((el, i) => {
      el.classList.remove('active', 'past', 'future');
      if (i < sentenceIdx) el.classList.add('past');
      else if (i === sentenceIdx) el.classList.add('active');
      else el.classList.add('future');
    });

    // Auto-scroll
    if (this.autoScroll) {
      const activeLine = document.querySelector('.lyric-line.active');
      if (activeLine) {
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
    }

    // Actualizar progreso
    if (this.words.length > 0) {
      this.updateProgress((wordIdx / this.words.length) * 100);
    }
  },

  jumpToWord(wordIndex) {
    const word = this.words[wordIndex];
    if (!word) return;

    // Cancelar speech actual
    this.synth.cancel();

    // Obtener texto desde esta palabra en adelante
    const remainingText = this.chapterText.substring(word.charIndex);

    this.utterance = this.createUtterance(remainingText, word.charIndex);
    this.isPlaying = true;
    this.updatePlayIcon(true);
    this.synth.speak(this.utterance);
  },

  play() {
    if (this.synth.paused) {
      this.synth.resume();
      this.isPlaying = true;
      this.updatePlayIcon(true);
      return;
    }

    // Iniciar desde la posición actual
    const startWord = this.words[this.currentWordIndex];
    const startOffset = startWord ? startWord.charIndex : 0;
    const text = this.chapterText.substring(startOffset);

    this.utterance = this.createUtterance(text, startOffset);
    this.isPlaying = true;
    this.updatePlayIcon(true);
    this.synth.speak(this.utterance);
  },

  pause() {
    this.synth.pause();
    this.isPlaying = false;
    this.updatePlayIcon(false);
  },

  stop() {
    this.synth.cancel();
    this.isPlaying = false;
    this.updatePlayIcon(false);
  },

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  },

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

  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % this.speeds.length;
    this.speed = this.speeds[this.speedIndex];

    const btn = document.getElementById('btn-speed');
    if (btn) btn.textContent = this.speed + 'x';

    // Guardar velocidad
    this.saveProgress();

    // Si está reproduciendo, reiniciar con nueva velocidad
    if (this.isPlaying) {
      const currentWord = this.words[this.currentWordIndex];
      const startOffset = currentWord ? currentWord.charIndex : 0;

      this.synth.cancel();
      const text = this.chapterText.substring(startOffset);
      this.utterance = this.createUtterance(text, startOffset);
      this.synth.speak(this.utterance);
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

  // Detección de scroll manual
  setupScrollDetection() {
    const lyricsEl = document.getElementById('player-lyrics');
    if (!lyricsEl) return;

    let userScrolling = false;

    lyricsEl.addEventListener('touchstart', () => {
      userScrolling = true;
      this.autoScroll = false;
      this.showLiveButton(true);
    }, { passive: true });

    lyricsEl.addEventListener('wheel', () => {
      userScrolling = true;
      this.autoScroll = false;
      this.showLiveButton(true);
    }, { passive: true });

    // No ocultar automáticamente - el botón "Volver al en vivo" lo hace
  },

  showLiveButton(show) {
    const btn = document.getElementById('btn-live');
    if (btn) btn.classList.toggle('visible', show);
  },

  scrollToLive() {
    this.autoScroll = true;
    this.showLiveButton(false);

    const activeLine = document.querySelector('.lyric-line.active');
    if (activeLine) {
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

  // Chrome bug: speech se detiene después de ~15 segundos
  startChromeBugFix() {
    this.chromeBugInterval = setInterval(() => {
      if (this.synth.speaking && !this.synth.paused) {
        this.synth.pause();
        this.synth.resume();
      }
    }, 14000);
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
    this.synth.cancel();
    this.isPlaying = false;

    if (this.chromeBugInterval) {
      clearInterval(this.chromeBugInterval);
      this.chromeBugInterval = null;
    }

    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
  }
};
