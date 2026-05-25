# LibroVoz

PWA que convierte libros físicos en audiolibros. Pipeline: cámara → OCR (Tesseract local + Claude fallback) → estructura de capítulos con IA → TTS con karaoke sincronizado. Modelo freemium con créditos, chat sobre el libro, export/import portable.

## Stack

- **Backend:** Node.js + Express.js (`server.js`)
- **Frontend:** Vanilla JavaScript (SPA), HTML5, CSS3 — sin build step
- **IA:** Anthropic Claude API (`@anthropic-ai/sdk`) — modelo `claude-haiku-4-5-20251001` con prompt caching
- **OCR cliente:** Tesseract.js (autohostado en `public/lib/tesseract/`)
- **PDF cliente:** pdf.js (vía CDN, lazy load)
- **Audio:** Web Speech Synthesis API (navegador)
- **Cámara:** MediaDevices API
- **Hosting:** Render.com con `render.yaml` (deploy automático al push)
- **Distribución Android:** PWABuilder → TWA (APK que carga la URL)

## Comandos

```bash
npm start            # Inicia servidor en puerto 3000 (o $PORT)
npm run dev          # Igual que start
npm run icons        # Regenera PNGs de íconos desde SVGs (scripts/generate-icons.js)
```

## Variables de entorno

- `ANTHROPIC_API_KEY` (requerida) — clave de API de Claude
- `PORT` (opcional, default: 3000)

Copiar `.env.example` a `.env` y configurar.

## Estructura del proyecto

```
server.js                       # Servidor Express, endpoints API
render.yaml                     # Config de deploy automático en Render
scripts/
└── generate-icons.js           # Genera PNGs de íconos desde SVGs (usa sharp)
public/
├── index.html                  # Entry point SPA
├── manifest.json               # PWA manifest con shortcuts y íconos maskable
├── sw.js                       # Service Worker (cache-first, versión vN)
├── .well-known/
│   └── assetlinks.json         # Digital Asset Links para TWA (Android)
├── assets/icons/               # Íconos PWA (192, 512, maskable, apple-touch)
├── lib/tesseract/              # Tesseract.js self-hosted (tesseract.min.js + worker)
├── css/
│   ├── variables.css           # Calm Glass design tokens
│   ├── components.css          # Botones pill glass, cards, inputs, toasts
│   ├── styles.css              # Landing, tutorial, processing, voices
│   ├── scanner.css             # UI del escáner
│   ├── player.css              # UI del reproductor
│   ├── library.css             # Biblioteca + nav bar
│   ├── paywall.css             # Paywall scaffolding
│   └── chat.css                # Modal de chat con IA
├── js/
│   ├── app.js                  # Controlador SPA, estado, nav bar, microcopy inicial
│   ├── api.js                  # Cliente API (fetch wrapper)
│   ├── db.js                   # IndexedDB v2: stores `books` + `quota`
│   ├── library.js              # Biblioteca: render, abrir, eliminar, export, import
│   ├── book-io.js              # Export/import .json portable entre dispositivos
│   ├── scanner.js              # Captura (3 fases) + upload PDF
│   ├── tesseract-ocr.js        # Wrapper Tesseract con worker singleton español
│   ├── pdf-extract.js          # Extracción de PDF (pdf.js) con fallback a Tesseract
│   ├── ocr.js                  # Pipeline hybrid: Tesseract + auto-fallback a Claude
│   ├── chapters.js             # Estructura por página + cleanup con junkPatterns
│   ├── processor.js            # Orquestador del pipeline + preview de capítulos
│   ├── voices.js               # Selección voz + auto-guardado con tier
│   ├── player.js               # Reproductor con karaoke + milestone microcopy
│   ├── chat.js                 # Modal de chat con IA sobre el libro
│   ├── tutorial.js             # Tutorial onboarding
│   ├── paywall.js              # Pantalla paywall (scaffolding sin Stripe)
│   ├── quota.js                # Cuota tier-aware (free vs paid vs imported)
│   ├── limits.js               # Constantes (max páginas, free books, packs)
│   ├── microcopy.js            # Frases ambientales por categoría
│   └── utils.js                # Utilidades (resize, thumbnails, etc.)
└── pages/
    ├── library.html            # Header con botón Importar + grid de libros
    ├── scanner.html            # Cámara fullscreen + botón flotante PDF
    ├── processing.html         # Progreso + preview de capítulos + revisión manual
    ├── voices.html             # Grid 2x2 de voces
    ├── player.html             # Player con botón flotante de chat
    ├── paywall.html            # 2 packs: libros + chat extra
    ├── chat.html               # Modal bottom-sheet (cargado vía fetch)
    └── tutorial.html
```

## Arquitectura

### Flujo de pantallas
Landing → Tutorial (opcional) → Scanner → Processing → Voices → Player
Library → Player (restauración directa de libros guardados o importados)

### Navegación
Nav bar inferior fija con 3 tabs: Inicio, Biblioteca, Escanear. Se oculta en player y scanner (fullscreen). Glass `backdrop-filter blur(40px) saturate(160%)`.

### Estética: Calm Glass
Sistema de diseño inspirado en Calm + Kindle + Apple Liquid Glass.
- **Paleta**: gradiente beige `#F4F1EC → #E8E2D5`, acento único slate-blue desaturado `#8BA3B8`
- **Texto**: jerarquía por opacidad sobre `--text-base-rgb` (100/70/45/25%)
- **Glass**: `var(--glass-bg)` rgba(255,255,255,0.55) + `var(--glass-blur)` blur(24px) saturate(140%)
- **Easings**: `cubic-bezier(0.22, 1, 0.36, 1)` en 400/600/1200ms
- **Sin gradientes saturados, sin bordes ≥2px, sin emojis, sin transiciones <300ms**

### Persistencia local (IndexedDB v2 — `librovoz-db`)

**Store `books`** — cada libro:
- `id, title, author, subtitle, coverThumbnail, chapters[], fullText`
- `processingMode ('literal'|'summary'), voiceName, voiceLang, currentChapter, speed`
- `tier ('free'|'paid'|'imported'), summaryAvailable, chatHistory[]`
- `savedAt, lastPlayedAt, importedAt?, importedFrom?`

**Store `quota`** (singleton id='singleton') — créditos por dispositivo:
- `freeBooksUsed (max 2), freeChatUsed (max 10)`
- `paidBooksRemaining, paidChatRemaining`
- `summaryUnlocked, purchasedPacks[]`

### Estado global (`App.state` en `app.js`)
- `coverImage`, `coverThumbnail`, `coverInfo {title, author, subtitle}`
- `indexPages[], bookPages[]`
- `fullText, indexText`
- `chapters[], processingMode, selectedVoice, currentChapter, isPlaying`
- `_loadedBookId, _savedSpeed, _prefetchedFullText, _lastJunkPatterns`

### Endpoints API (`server.js`)

| Endpoint | Método | Función |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/ocr` | POST | OCR vision Claude (fallback automático cuando Tesseract falla) |
| `/api/detect-cover` | POST | Extrae título/autor de portada (imagen 1024px) |
| `/api/detect-chapters` | POST | Estructura capítulos por página + retorna `junkPatterns` regex para limpiar OCR |
| `/api/summarize` | POST | Resume capítulo (solo libros paid) |
| `/api/chat` | POST | Chat sobre el libro con prompt caching (cache_control ephemeral) |

Rate limit general: 100 req/min en `/api/*`. Rate limit chat: 60/hora por IP. Payload máximo: 50MB.

### Pipeline de procesamiento
1. **Captura**: Scanner → portada + índice opcional + páginas (max 200 contenido, 10 índice)
2. **OCR**:
   - Portada: Claude vision con imagen reducida a 1024px (~$0.003/libro)
   - Páginas: Tesseract.js local (gratis) → si confianza <70 o texto <50 chars → auto-fallback a Claude vision para esa página
   - Índice: Tesseract local
3. **Estructura**: `/api/detect-chapters` recibe `pages[{num,text}]` → retorna `{chapters[{name,startPage,endPage}], junkPatterns[]}`
4. **Cleanup**: cliente aplica regex de `junkPatterns` por línea, normaliza whitespace
5. **Preview**: muestra lista de capítulos detectados con título + primer texto
6. **Resumen** (opcional, solo paid): API condensa cada capítulo
7. **Reproducción**: Web Speech API + karaoke sincronizado

### Modelo freemium

**Free tier** (sin pagar):
- 2 libros procesables (tier='free')
- 10 preguntas de chat compartidas entre libros
- Sin modo resumen (paywall bloquea el card)
- Toast/redirect al paywall al llegar al límite

**Pack pagado** ($99 MXN, scaffolding — sin Stripe aún):
- 10 libros (tier='paid') con resumen IA disponible
- 50 preguntas chat compartidas
- `summaryUnlocked: true` permanente

**Pack chat extra** ($19 MXN): +50 preguntas

**Libros importados** (`tier='imported'`):
- No consumen cuota free (export/import es gratis)
- No tienen IA bundled (no summary, chat usa cuota normal)
- Lectura/audio funcionan normal

### Export / Import portable (`book-io.js`)
- Formato JSON `librovoz-book` versionado (`_format`, `_version: 1`)
- Botón ↓ en cada card de biblioteca → descarga `nombre.json`
- Botón "↑ Importar" en header → file picker → validación + tier='imported'
- Excluye: id, progreso, chatHistory, savedAt (regenerados al importar)

### Microcopy (`microcopy.js`)
Frases ambientales por categoría: `welcome`, `didYouKnow`, `conversion`, `milestone`, `loading`.
- Anti-repeat: no repite frase consecutiva
- `conversion`: max 1 vez por sesión, oculto si `Quota.hasPaid === true`
- Inyectado en: landing, library, processing (rota cada 12s), paywall, player milestone

### PWA / TWA / Android
- `manifest.json` con `id`, `scope`, shortcuts (Escanear, Biblioteca), íconos maskable
- `.well-known/assetlinks.json` con SHA-256 del APK firmado (package: `com.onrender.librovoz.twa`)
- `server.js` sirve dotfiles y fuerza `Content-Type: application/json` en assetlinks
- APK generado con PWABuilder → carga la URL de producción, contenido auto-actualiza con cada push

## Convenciones

- **Idioma de la UI:** español neutro (tuteo)
- **Sin framework de tests** — testing manual
- **Sin build/transpilación** — JavaScript moderno servido directo
- **Persistencia local primero** — IndexedDB en cliente. Backend solo proxy de API
- **CSS:** Calm Glass, targets táctiles 48-56px mínimo
- **Workaround Chrome:** el player reinicia speech cada 14s para evitar corte a los 15s

## Notas importantes

- El servidor sale con error si falta `ANTHROPIC_API_KEY`
- HTTPS local: si encuentra `cert.pem`/`key.pem` en la raíz, levanta HTTPS (necesario para cámara en Android)
- SPA routing por hash (`#/screen-name`)
- Service Worker cachea assets estáticos, las llamadas `/api/*` bypasean cache
- Voces filtradas por `lang.startsWith('es')`, se guardan por nombre y re-resuelven al cargar
- Imágenes contenido: max 1500px JPEG q=0.85. Portada para vision: 1024px (-50% tokens)
- OCR pages: Tesseract local secuencial (1 worker). Índice: Tesseract paralelo. Cover: Claude vision con imagen chica
- **Prompt caching** en `/api/chat`: `cache_control: { type: 'ephemeral' }` en system message (TTL 5min) → preguntas 2+ cuestan ~10% del input
- `cloudflared tunnel --url https://localhost:3001 --no-tls-verify` para exponer con HTTPS real durante desarrollo
- Render free tier: cold start ~30s tras inactividad. URL: `https://librovoz.onrender.com`

## Costos por libro (estimado USD)

| Componente | Costo |
|------------|-------|
| OCR Tesseract local | $0 |
| Auto-fallback Claude vision (~15% páginas) | ~$0.24 |
| Cover (Claude 1024px) | $0.003 |
| Estructura + cleanup (`/api/detect-chapters`) | $0.06 |
| Resumen opcional (10 capítulos) | $0.15 |
| Chat (con caching, 5 preguntas avg) | $0.075 |
| **Total libro literal sin chat** | **~$0.30** |
| **Total libro paid completo (resumen + chat)** | **~$0.55** |
