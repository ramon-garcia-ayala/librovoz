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
      // Todavía cargando, esperar
      return;
    }

    // Intentar seleccionar hasta 4 voces variadas
    let selected = [];

    if (spanishVoices.length > 0) {
      // Clasificar por nombre como heurística de género
      const masc = spanishVoices.filter(v =>
        /jorge|carlos|pablo|diego|andrés|enrique|juan|miguel|pedro|antonio|male|hombre/i.test(v.name)
      );
      const fem = spanishVoices.filter(v =>
        /mónica|paulina|elena|lucia|carmen|rosa|maria|female|mujer|conchita|penelope/i.test(v.name)
      );
      const others = spanishVoices.filter(v => !masc.includes(v) && !fem.includes(v));

      // Tomar hasta 2 de cada tipo
      selected = [
        ...fem.slice(0, 2),
        ...masc.slice(0, 2)
      ];

      // Si no hay suficientes, rellenar con others
      if (selected.length < 4) {
        for (const v of others) {
          if (selected.length >= 4) break;
          if (!selected.includes(v)) selected.push(v);
        }
      }

      // Si aún no hay suficientes, rellenar con cualquier español
      if (selected.length < 4) {
        for (const v of spanishVoices) {
          if (selected.length >= 4) break;
          if (!selected.includes(v)) selected.push(v);
        }
      }
    }

    // Si no hay voces en español, tomar las primeras 4 disponibles
    if (selected.length === 0) {
      selected = allVoices.slice(0, 4);
      if (selected.length > 0) {
        App.showToast('No se encontraron voces en español. Mostrando voces disponibles.', 'info');
      }
    }

    this.voices = selected;
    this.renderVoices();
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

    const colors = ['#007AFF', '#FF9500', '#34C759', '#AF52DE'];
    grid.innerHTML = this.voices.map((voice, i) => `
      <div class="card voice-card" id="voice-${i}" onclick="Voices.select(${i})">
        <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
          <circle cx="24" cy="16" r="10" fill="${colors[i % colors.length]}" opacity="0.2"/>
          <circle cx="24" cy="16" r="6" fill="${colors[i % colors.length]}" opacity="0.5"/>
          <path d="M12 38c0-6 5-10 12-10s12 4 12 10" fill="${colors[i % colors.length]}" opacity="0.15"/>
        </svg>
        <h4 class="voice-name">${voice.name.replace(/\(.*\)/, '').trim()}</h4>
        <p class="voice-lang">${voice.lang}</p>
        <button class="btn voice-preview" onclick="event.stopPropagation(); Voices.preview(${i})">Escuchar</button>
      </div>
    `).join('');

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

  confirm() {
    if (this.selectedIndex < 0) {
      App.showToast('Selecciona una voz primero', 'error');
      return;
    }

    speechSynthesis.cancel();
    App.state.selectedVoice = this.voices[this.selectedIndex];
    App.go('player');
  }
};
