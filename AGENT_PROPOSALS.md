# Propuestas del agente — 2026-05-26T01:30:50.904Z

_Modelo: claude-haiku-4-5-20251001 · 3408 in / 1317 out tokens · ~$0.0100 · 13.2s_

# Revisión de `public/js/tutorial.js`

### Propuesta 1: Race condition en `setupSwipe()` — gestos simultáneos pueden saltar pasos
**Problema**: El método `setupSwipe()` no previene múltiples transiciones simultáneas. Si el usuario hace swipe rápido en ambas direcciones o toca múltiples veces antes de que `updateUI()` renderice, `currentStep` puede desincronizarse con el DOM (ej: saltar del paso 0 al 2, o ir a negativo).

**Cambio**: `public/js/tutorial.js:26-30` — agregar flag de transición en progreso:
```javascript
setupSwipe() {
  const slider = document.getElementById('tutorial-slider');
  if (!slider) return;

  slider.addEventListener('touchstart', (e) => {
    this.touchStartX = e.touches[0].clientX;
  }, { passive: true });

  slider.addEventListener('touchend', (e) => {
    if (this.isTransitioning) return; // ← Agregar guard
    const diff = this.touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      this.isTransitioning = true; // ← Set flag
      if (diff > 0) this.next();
      else this.prev();
      setTimeout(() => { this.isTransitioning = false; }, 300); // ← Reset tras animación CSS
    }
  }, { passive: true });
}
```
+ Agregar en `init()`: `this.isTransitioning = false;`

**Impacto**: Robustez (previene bugs de estado silenciosos en fast-swipe)  
**Esfuerzo**: XS (5 min)  
**Razón**: PWA en mobile = gestos frecuentes e impredecibles. Sin debounce, usuario frustrado salta secciones del tutorial sin entender la app. El flag cuesta casi nada.

---

### Propuesta 2: Falta validar existencia de DOM antes de `.textContent`
**Problema**: En `updateUI()` línea 43-44, si `btnNext` es `null` (DOM no montado), la asignación `.textContent` silenciosamente no hace nada. Pero si se llama `updateUI()` antes de que la página renderice (race en `init()` → `go('tutorial')` → `updateUI()` antes del HTML), se pierde el estado sin error visible.

**Cambio**: `public/js/tutorial.js:34-46` — agregar early return si DOM crítico no existe:
```javascript
updateUI() {
  const track = document.getElementById('tutorial-track');
  const dots = document.querySelectorAll('.dot');
  const btnNext = document.getElementById('btn-next');

  // Guard: si no existe track, el HTML no está listo aún → defer
  if (!track) {
    console.warn('[Tutorial] DOM no está montado aún');
    return;
  }

  track.style.transform = `translateX(-${this.currentStep * 100}%)`;
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === this.currentStep);
  });

  if (btnNext) { // Este check ya existe, pero ahora es redundante (está OK)
    if (this.currentStep === this.totalSteps - 1) {
      btnNext.textContent = 'Comenzar a escanear';
    } else {
      btnNext.textContent = 'Siguiente';
    }
  }
}
```

**Impacto**: Robustez (detecta timing issues), debugging (log visible si hay problemas de nav)  
**Esfuerzo**: XS (3 min)  
**Razón**: SPA sin build step = timing de carga impredecible. Guard barato evita estados silenciosos. El `console.warn` ayuda a debuggear si el cliente reporta "tutorial no avanza".

---

### Propuesta 3: Agregar botón "Revisar tutorial" en app después de completarlo
**Problema**: Una vez que `localStorage` marca tutorial como hecho, no hay forma de volver a verlo. Usuarios nuevos (o confundidos) o que saltaron con `skip()` no pueden reaprender sin limpiar datos manualmente. Reduce confianza.

**Cambio**: `public/js/app.js` (nav bar) — agregar entrada "Ayuda" que limpia la flag y reabre tutorial:
```javascript
// En app.js, dentro de la nav bar o settings:
function openTutorialAgain() {
  localStorage.removeItem('librovoz-tutorial-done');
  App.go('tutorial');
}
```
Agregar botón en HTML nav bar o settings con `onclick="openTutorialAgain()"`.

**Impacto**: UX (confianza, onboarding recuperable), retención (user no se siente "atrapado" si saltó)  
**Esfuerzo**: S (20 min — incluye UI + hook)  
**Razón**: Patrón estándar en PWAs (Slack, Notion, etc.). Costo nulo, impacto alto en retención de usuarios confundidos.

---

---

# Propuestas del agente — 2026-05-26T01:20:19.046Z

_Modelo: claude-haiku-4-5-20251001 · 2994 in / 1291 out tokens · ~$0.0094 · 11.9s_

### Propuesta 1: Detectar skip del tutorial y persistir estado de onboarding
**Problema**: Si el usuario cierra la app en medio del tutorial (paso 1-2), `localStorage` lo marca como "no completado", y reabre el tutorial completo en próxima sesión. Además, no hay forma de volver a acceder al tutorial después de completarlo si lo necesita.

**Cambio**: 
- `public/js/tutorial.js:5-10` — cambiar `currentStep` a IndexedDB para persistir progreso parcial:
```javascript
async init() {
  const done = await DB.getQuota('tutorial-done');
  if (done) {
    App.go('scanner');
    return;
  }
  const progress = (await DB.getQuota('tutorial-step')) || 0;
  this.currentStep = progress;
  this.updateUI();
  this.setupSwipe();
}
```
- `public/js/tutorial.js:40` — guardar paso cada vez que avanza:
```javascript
updateUI() {
  // ... código existente
  DB.setQuota('tutorial-step', this.currentStep); // Agregar esta línea
}
```
- `public/js/tutorial.js:75` — cambiar `complete()` para usar DB:
```javascript
async complete() {
  await DB.setQuota('tutorial-done', '1');
  await DB.setQuota('tutorial-step', 0); // Limpiar
  App.go('scanner');
}
```

**Impacto**: UX (retención, recuperación de sesión interrumpida)  
**Esfuerzo**: S (30 min — ya existe `DB.setQuota/getQuota`)  
**Razón**: PWA debe ser resiliente a cierres inesperados. Si un usuario en WiFi débil cierra el tab en paso 2/3, perder el progreso es fricción innecesaria. IndexedDB ya está en uso en `db.js`.

---

### Propuesta 2: Race condition en `setupSwipe` si se llama múltiples veces
**Problema**: Si `Tutorial.init()` se invoca más de una vez (p.ej., volviendo de scanner), `setupSwipe()` agrega listeners duplicados sin limpiar los anteriores, causando múltiples transiciones con un solo swipe.

**Cambio**: 
- `public/js/tutorial.js:17-31` — guardar referencia a listeners y limpiarlos antes de reasignar:
```javascript
setupSwipe() {
  const slider = document.getElementById('tutorial-slider');
  if (!slider) return;

  // Limpiar listeners previos
  const newSlider = slider.cloneNode(true);
  slider.parentNode.replaceChild(newSlider, slider);
  const newRef = document.getElementById('tutorial-slider');

  newRef.addEventListener('touchstart', (e) => {
    this.touchStartX = e.touches[0].clientX;
  }, { passive: true });

  newRef.addEventListener('touchend', (e) => {
    const diff = this.touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) this.next();
      else this.prev();
    }
  }, { passive: true });
}
```

**Impacto**: Robustez (evita comportamiento inesperado en navegación repetida)  
**Esfuerzo**: XS (5 min)  
**Razón**: El código actual no previene re-inicialización. Aunque hoy es poco probable (flujo va scanner → biblioteca → no vuelve), es una trampa de bugs futura barata de evitar.

---

### Propuesta 3: Agregar indicador visual de "tutorial puede repetirse" en navbar
**Problema**: Una vez completado, no hay forma discovereable de volver al tutorial si el usuario lo olvida o necesita repasarlo. El icono "?" o "Ayuda" sería UX mejorada.

**Cambio**:
- `public/js/app.js` (navbar section) — agregar botón "Ayuda" en nav bar que llame a `Tutorial.reset()`:
```javascript
// En la navbar (apps.html o donde esté renderizada)
<button id="btn-help" aria-label="Tutorial de ayuda">?</button>
```
- `public/js/tutorial.js:78-83` — agregar método reset:
```javascript
reset() {
  localStorage.removeItem('librovoz-tutorial-done');
  DB.setQuota('tutorial-done', null);
  DB.setQuota('tutorial-step', 0);
  this.currentStep = 0;
  App.go('tutorial');
}
```

**Impacto**: UX (accesibilidad, descubrimiento)  
**Esfuerzo**: S (30 min — requiere editar navbar)  
**Razón**: Usuarios nuevos o confundidos necesitan regresar al tutorial. Ahora es imposible sin DevTools. Impacto mínimo en navegación (solo 1 botón más).

---

# Propuestas del agente LibroVoz

Aquí se acumulan las propuestas que genera `scripts/agent-audit.js` cada vez que corre. Más recientes arriba.

**No commitees automáticamente** — revisa cada propuesta y decide cuáles aplicar.

Para correr una auditoría manual:
```bash
npm run audit
```

Para modo continuo (cada 60 min):
```bash
npm run audit:watch
```

---

_No hay propuestas todavía. Corre `npm run audit` para generar la primera tanda._
