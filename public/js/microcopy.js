// LibroVoz - Microcopy ambiental (frases por categoría)
//
// Reglas (de la spec Calm Glass):
// - Máximo 12 palabras, idealmente 6-8.
// - Sin signos de exclamación. Sin emojis.
// - Tono calmado, factual, tuteo en español neutro.
// - Cifras siempre concretas.
const Microcopy = {
  // ── Catálogo ─────────────────────────────────────────────────────────
  phrases: {
    welcome: [
      'Hoy es un buen día para terminar ese capítulo.',
      'Tu próxima lectura te está esperando.',
      'Respira. El libro no se va.',
      'Un capítulo cabe en un viaje corto.',
      'Lo lento también es leer.',
      'Volviste. Aquí estaba tu libro.',
      'Empieza por una página. Solo una.',
      'La voz que te lee te conoce ya.'
    ],

    didYouKnow: [
      // TODO: replace 70% / 1840 MXN / 40% con datos reales del usuario
      'Escanear un libro físico te ahorra cerca del 70% vs el digital.',
      'Quienes escanean leen 40% más rápido al mes siguiente.',
      'Un libro promedio cabe en 12 minutos de escaneo.',
      'Tus libros nunca salen de tu teléfono. Procesamos local.',
      'Diez minutos de lectura al día son tres libros al año.',
      'La voz de tu libro responde a tu velocidad, no al revés.'
    ],

    conversion: [
      // TODO: replace 480 / 8 con cifras reales por usuario
      'Con el paquete completo ahorras 480 MXN al año.',
      'Quienes pagan terminan 8 libros más al año en promedio.',
      'Por menos que un café al mes, lees sin límites.',
      'Tu próximo libro ya está esperando. 99 MXN, sin renovación.',
      'Resumen y chat con tu libro: 99 MXN, libros incluidos.'
    ],

    milestone: [
      // TODO: replace contadores reales (7 días / 3er libro) con tracking
      'Llevas un capítulo más. Tu cerebro lo nota.',
      'Terminaste tu libro. Bien.',
      'Otro capítulo cerrado. Sigue.',
      'Esta semana leíste más que la mayoría.',
      'Tres libros en un mes. Ese ritmo es tuyo.'
    ],

    loading: [
      'Procesando con calma. Las palabras toman su tiempo.',
      'Leyendo página por página. Casi.',
      'Encontrando las palabras adecuadas.',
      'Un momento. El libro se está acomodando.',
      'Calentando la voz que te leerá.'
    ]
  },

  // ── State ─────────────────────────────────────────────────────────────
  _sessionShown: new Set(), // categorías mostradas en esta sesión

  _lastPicked: {}, // categoria → última frase, para evitar repetir consecutivos

  // ── Selector principal ───────────────────────────────────────────────
  // Devuelve una frase de la categoría dada. Si es 'conversion' y el usuario
  // ya pagó, devuelve null (la UI debe ocultar el slot).
  // Si 'conversion' ya se mostró en esta sesión, también null.
  async get(category) {
    if (!this.phrases[category]) return null;

    // Reglas especiales para conversion
    if (category === 'conversion') {
      // Ocultar si ya pagó
      try {
        if (typeof Quota !== 'undefined') {
          const status = await Quota.getStatus();
          if (status.hasPaid) return null;
        }
      } catch {}
      // Máximo 1 vez por sesión
      const sessionKey = 'mc_conversion_shown';
      if (sessionStorage.getItem(sessionKey)) return null;
      sessionStorage.setItem(sessionKey, '1');
    }

    const pool = this.phrases[category];
    const last = this._lastPicked[category];
    let candidate;
    let attempts = 0;
    do {
      candidate = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    } while (candidate === last && pool.length > 1 && attempts < 5);

    this._lastPicked[category] = candidate;
    this._sessionShown.add(category);
    return candidate;
  },

  // Versión sync (no chequea quota — para loading/welcome donde da igual)
  pickSync(category) {
    const pool = this.phrases[category];
    if (!pool || !pool.length) return null;
    const last = this._lastPicked[category];
    let candidate;
    let attempts = 0;
    do {
      candidate = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    } while (candidate === last && pool.length > 1 && attempts < 5);
    this._lastPicked[category] = candidate;
    return candidate;
  },

  // ── Helper de inyección DOM ──────────────────────────────────────────
  // Pinta una frase en el elemento con id dado. Si es conversion + paid o ya
  // mostrada, oculta el elemento.
  async render(elementId, category) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const phrase = await this.get(category);
    if (!phrase) {
      el.style.display = 'none';
      return;
    }
    el.textContent = phrase;
    el.classList.add('microcopy', `microcopy-${category === 'didYouKnow' ? 'didyouknow' : category}`);
    el.style.display = '';
  }
};
