// LibroVoz - Selector de voces
const Voices = {
  voices: [],
  selectedIndex: -1,

  init() {
    this.selectedIndex = -1;
    this.loadVoices();

    // speechSynthesis.getVoices() puede tardar
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  },

  loadVoices() {
    const allVoices = speechSynthesis.getVoices();
    const spanishVoices = allVoices.filter(v => v.lang.startsWith('es'));

    if (spanishVoices.length === 0 && allVoices.length === 0) {
      return; // todavía cargando
    }

    let pool = spanishVoices.length > 0 ? spanishVoices : allVoices;
    if (spanishVoices.length === 0) {
      App.showToast('No se encontraron voces en español. Mostrando todas las disponibles.', 'info');
    }

    // Rankear por calidad: premium/neural/google/natural primero, locales después
    const ranked = pool
      .map(v => ({ voice: v, score: this._qualityScore(v) }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.voice);

    // De-duplicar por nombre (algunos motores reportan duplicados)
    const seen = new Set();
    this.voices = ranked.filter(v => {
      const key = (v.name || '') + '|' + (v.lang || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.renderVoices();
  },

  // Heurística para ordenar voces de mejor a peor calidad
  _qualityScore(voice) {
    const name = (voice.name || '').toLowerCase();
    let score = 0;

    // Calidad alta: Google neural, premium, natural, enhanced
    if (/(neural|premium|natural|enhanced|wavenet|studio|hd)/i.test(name)) score += 10;
    if (/google/i.test(name)) score += 5;
    if (/(microsoft|samsung)/i.test(name)) score += 3;

    // Locales suelen ser mejores que remotos
    if (voice.localService) score += 2;

    // Penalizar voces "compact" (suelen ser peores en iOS)
    if (/compact/i.test(name)) score -= 3;

    // Priorizar es-MX, es-US (más comunes en LATAM) ligeramente sobre otros
    const lang = (voice.lang || '').toLowerCase();
    if (lang === 'es-mx' || lang === 'es-us') score += 1;

    return score;
  },

  // Etiqueta amigable para mostrar en cada card
  _voiceTags(voice) {
    const name = (voice.name || '').toLowerCase();
    const tags = [];
    if (/(neural|wavenet|natural|studio|premium|enhanced|hd)/i.test(name)) tags.push('Alta calidad');
    if (voice.localService) tags.push('Local');
    return tags;
  },

  // Devuelve la voz top-ranked sin requerir UI (para pipeline auto)
  async getBestVoice() {
    // Esperar a que cargue si aún no
    let voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      await new Promise(resolve => {
        let tries = 0;
        const check = () => {
          voices = speechSynthesis.getVoices();
          if (voices.length > 0 || tries > 20) return resolve();
          tries++;
          setTimeout(check, 100);
        };
        check();
      });
      voices = speechSynthesis.getVoices();
    }
    const es = voices.filter(v => (v.lang || '').startsWith('es'));
    const pool = es.length > 0 ? es : voices;
    if (pool.length === 0) return null;
    const ranked = pool
      .map(v => ({ voice: v, score: this._qualityScore(v) }))
      .sort((a, b) => b.score - a.score);
    return ranked[0].voice;
  },

  // Etiqueta de género por nombre (heurística simple)
  _voiceGender(voice) {
    const name = (voice.name || '').toLowerCase();
    if (/female|mujer|mónica|paulina|elena|lucia|carmen|rosa|maria|conchita|penelope|sofia|esperanza|helena|laura|isabela|camila/i.test(name)) return 'F';
    if (/male|hombre|jorge|carlos|pablo|diego|andrés|enrique|juan|miguel|pedro|antonio|alvaro|raul|sebastian/i.test(name)) return 'M';
    return null;
  },

  renderVoices() {
    const grid = document.getElementById('voices-grid');
    if (!grid) return;

    if (this.voices.length === 0) {
      grid.innerHTML = `
        <div class="voices-empty">
          <p>No se encontraron voces disponibles en este dispositivo.</p>
          <button class="btn btn-primary" onclick="App.go('player')">Continuar sin voz</button>
        </div>
      `;
      return;
    }

    const colors = ['#8BA3B8', '#A89BB8', '#9AB0A0', '#B8A28B'];
    grid.innerHTML = this.voices.map((voice, i) => {
      const cleanName = (voice.name || '').replace(/\(.*\)/, '').trim() || 'Voz';
      const gender = this._voiceGender(voice);
      const tags = this._voiceTags(voice);
      const color = colors[i % colors.length];

      return `
        <div class="card voice-card" id="voice-${i}" onclick="Voices.select(${i})">
          <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
            <circle cx="24" cy="16" r="10" fill="${color}" opacity="0.25"/>
            <circle cx="24" cy="16" r="6" fill="${color}" opacity="0.55"/>
            <path d="M12 38c0-6 5-10 12-10s12 4 12 10" fill="${color}" opacity="0.18"/>
          </svg>
          <h4 class="voice-name">${cleanName}</h4>
          <p class="voice-lang">${voice.lang}${gender ? ' · ' + gender : ''}</p>
          ${tags.length > 0
            ? `<div class="voice-tags">${tags.map(t => `<span class="voice-tag">${t}</span>`).join('')}</div>`
            : ''}
          <button class="btn voice-preview" onclick="event.stopPropagation(); Voices.preview(${i})">Escuchar</button>
        </div>
      `;
    }).join('');

    document.getElementById('btn-voices-continue').style.display = 'none';
  },

  select(index) {
    this.selectedIndex = index;

    // Actualizar UI
    document.querySelectorAll('.voice-card').forEach((card, i) => {
      card.classList.toggle('voice-selected', i === index);
    });

    const btn = document.getElementById('btn-voices-continue');
    if (btn) btn.style.display = 'block';
  },

  preview(index) {
    speechSynthesis.cancel();
    const voice = this.voices[index];
    const utterance = new SpeechSynthesisUtterance(
      'Hola, esta es una muestra de cómo suena esta voz para tu audiolibro.'
    );
    utterance.voice = voice;
    utterance.lang = voice.lang || 'es-ES';
    utterance.rate = 1;
    speechSynthesis.speak(utterance);
  },

  async confirm() {
    if (this.selectedIndex < 0) {
      App.showToast('Selecciona una voz primero', 'error');
      return;
    }

    speechSynthesis.cancel();
    App.state.selectedVoice = this.voices[this.selectedIndex];

    // Actualizar libro existente (el draft ya fue creado por Processor.saveDraft)
    try {
      const voice = this.voices[this.selectedIndex];
      const thumbnail = App.state.coverImage
        ? await Utils.createThumbnail(App.state.coverImage)
        : (App.state.coverThumbnail || null);

      const existingId = App.state._loadedBookId;
      let existingBook = existingId ? await DB.get(existingId) : null;

      // Si por alguna razón no hay draft (edge case), crear libro nuevo y consumir cuota
      if (!existingBook) {
        const tier = (await Quota.getBookTier()) || 'free';
        existingBook = {
          id: 'book_' + Date.now(),
          title: App.state.coverInfo.title || 'Sin título',
          author: App.state.coverInfo.author || '',
          subtitle: App.state.coverInfo.subtitle || '',
          coverThumbnail: thumbnail,
          chapters: App.state.chapters,
          fullText: App.state.fullText || '',
          processingMode: App.state.processingMode || 'literal',
          tier,
          summaryAvailable: tier === 'paid',
          chatHistory: [],
          savedAt: new Date().toISOString()
        };
        await Quota.consumeBook();
      }

      const book = {
        ...existingBook,
        coverThumbnail: thumbnail || existingBook.coverThumbnail,
        voiceName: voice.name,
        voiceLang: voice.lang,
        currentChapter: 0,
        speed: 1,
        isDraft: false,
        lastPlayedAt: new Date().toISOString()
      };

      await DB.save(book);
      App.setLoadedBookId(book.id);
      App.state._isDraft = false;
    } catch (err) {
      console.error('Error guardando libro:', err);
    }

    App.go('player');
  }
};
