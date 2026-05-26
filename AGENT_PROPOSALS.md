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
