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

## Histórico de propuestas APLICADAS

### 2026-05-26 — tutorial.js
- ✅ Swipe horizontal + threshold 80px (anti scroll accidental)
- ✅ DOM guard en `updateUI()` con warn
- ✅ `aria-current` + `aria-label` en dots (WCAG AA)

---

_Sin propuestas pendientes. Corre `npm run audit` para generar la siguiente tanda._
