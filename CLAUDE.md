# LibroVoz

Aplicación web que convierte libros físicos en audiolibros usando visión por computadora (Claude AI) para OCR, procesamiento de texto con IA, y Web Speech API para síntesis de audio. PWA mobile-first optimizada para usuarios mayores.

## Stack

- **Backend:** Node.js + Express.js (`server.js`)
- **Frontend:** Vanilla JavaScript (SPA), HTML5, CSS3 — sin build step
- **IA:** Anthropic Claude API (`@anthropic-ai/sdk`) — modelo `claude-haiku-4-5-20251001`
- **Audio:** Web Speech Synthesis API (navegador)
- **Cámara:** MediaDevices API

## Comandos

```bash
npm start      # Inicia servidor en puerto 3000 (o $PORT)
npm run dev    # Igual que start
```

## Variables de entorno

- `ANTHROPIC_API_KEY` (requerida) — clave de API de Claude
- `PORT` (opcional, default: 3000)

Copiar `.env.example` a `.env` y configurar.

## Estructura del proyecto

```
server.js                   # Servidor Express, endpoints API
public/
├── index.html              # Entry point SPA
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker (cache-first)
├── css/
│   ├── variables.css       # Design tokens
│   ├── components.css      # Componentes reutilizables
│   ├── styles.css          # Estilos globales
│   ├── scanner.css         # UI del escáner
│   ├── player.css          # UI del reproductor
│   └── library.css         # UI de biblioteca + nav bar
├── js/
│   ├── app.js              # Controlador principal SPA, estado global, nav bar
│   ├── api.js              # Cliente API (fetch wrapper)
│   ├── db.js               # Capa IndexedDB (guardar/cargar libros)
│   ├── library.js          # Pantalla biblioteca (libros guardados)
│   ├── scanner.js          # Captura de cámara (3 fases: portada, índice, páginas)
│   ├── ocr.js              # Procesamiento OCR (paralelo en batches de 3)
│   ├── chapters.js         # Detección y división de capítulos
│   ├── processor.js        # Pipeline principal de procesamiento
│   ├── voices.js           # Selección de voz (filtro español) + auto-guardado
│   ├── player.js           # Reproductor con karaoke sincronizado
│   ├── tutorial.js         # Tutorial onboarding
│   └── utils.js            # Utilidades (redimensionar, thumbnails, etc.)
└── pages/
    ├── library.html
    ├── scanner.html
    ├── processing.html
    ├── voices.html
    ├── player.html
    └── tutorial.html
```

## Arquitectura

### Flujo de pantallas
Landing → Tutorial (opcional) → Scanner → Processing → Voices → Player
Library (libros guardados) → Player (restauración directa)

### Navegación
Nav bar inferior fija con 3 tabs: Inicio, Biblioteca, Escanear. Se oculta en player y scanner (fullscreen).

### Persistencia local
IndexedDB (`librovoz-db` → store `books`) para guardar libros procesados. Sin login. Auto-guardado al seleccionar voz. Guarda: título, autor, capítulos (texto), thumbnail de portada (~10KB), nombre de voz, progreso.

### Estado global (`App.state` en `app.js`)
- `coverImage`, `coverThumbnail`, `coverInfo` — imagen y metadata de portada
- `indexPages`, `bookPages` — arrays de imágenes base64
- `fullText`, `indexText` — texto extraído
- `chapters` — array de `{title, text}`
- `selectedVoice`, `currentChapter`, `isPlaying`
- `_loadedBookId` — ID del libro cargado desde biblioteca
- `_savedSpeed` — velocidad guardada para restaurar

### Endpoints API (`server.js`)
| Endpoint | Método | Función |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/ocr` | POST | Extraer texto de imagen de página |
| `/api/detect-cover` | POST | Extraer título/autor de portada |
| `/api/detect-chapters` | POST | Identificar capítulos en texto |
| `/api/summarize` | POST | Resumir texto de capítulo |

Rate limit: 100 req/min en `/api/*`. Payload máximo: 50MB.

### Pipeline de procesamiento
1. **Captura**: Scanner → imágenes base64
2. **OCR**: API Claude (visión) → texto extraído
3. **Detección**: API → identificar capítulos (fallback: chunks de 3000 palabras)
4. **Resumen** (opcional): API → condensar capítulos
5. **Reproducción**: Web Speech API → audio + karaoke

## Convenciones

- **Idioma de la UI:** español
- **Sin framework de tests** — testing manual
- **Sin build/transpilación** — JavaScript moderno servido directo
- **Persistencia local** — IndexedDB para libros guardados, sin backend de datos
- **CSS:** diseño Apple-inspired, targets táctiles grandes (48-56px mínimo)
- **Workaround Chrome:** el player reinicia speech cada 14s para evitar corte a los 15s

## Notas importantes

- El servidor sale con error si falta `ANTHROPIC_API_KEY`
- El servidor soporta HTTPS si encuentra `cert.pem`/`key.pem` en la raíz (necesario para cámara en Android)
- Las rutas SPA usan hash-based routing (`#/screen-name`)
- Service Worker cachea assets estáticos, las llamadas API bypasean cache
- Voces filtradas por idioma español (`es-*`); se guardan por nombre y se re-resuelven al restaurar
- Las imágenes se redimensionan a max 1500px antes de enviar a la API
- OCR paralelo en batches de 3 para mayor velocidad
- `cloudflared tunnel --url http://localhost:3000` para exponer con HTTPS real
