require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Verificar API key
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('⚠️  Falta ANTHROPIC_API_KEY en el archivo .env');
  console.error('   Copia .env.example a .env y agrega tu clave');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public', { dotfiles: 'allow' }));

// Forzar Content-Type correcto para Digital Asset Links (Android lo requiere)
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
});

// Rate limiting general
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas solicitudes. Espera un momento.' }
});
app.use('/api/', limiter);

// Rate limit más estricto para chat (anti-abuse Fase 1)
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 60,                  // 60 preguntas/hora por IP
  message: { error: 'Demasiadas preguntas en una hora. Intenta más tarde.' }
});
app.use('/api/chat', chatLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: MODEL });
});

// OCR - Extraer texto de imagen de página
app.post('/api/ocr', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Falta la imagen' });

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: image }
          },
          {
            type: 'text',
            text: 'Extrae todo el texto de esta imagen de página de libro. Conserva los saltos de párrafo. Omite números de página y encabezados/pies de página. Devuelve solo el texto extraído, nada más.'
          }
        ]
      }]
    });

    const text = response.content[0]?.text || '';
    res.json({ text });
  } catch (err) {
    console.error('Error OCR:', err.message);
    res.status(500).json({ error: 'Error al procesar la imagen. Verifica tu API key.' });
  }
});

// Detectar portada - Extraer título y autor
app.post('/api/detect-cover', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Falta la imagen' });

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: image }
          },
          {
            type: 'text',
            text: 'Esta es la portada de un libro. Extrae el título, autor y subtítulo (si existe). Responde SOLO con JSON válido: {"title": "...", "author": "...", "subtitle": "..."}'
          }
        ]
      }]
    });

    const raw = response.content[0]?.text || '{}';
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      const info = JSON.parse(match ? match[0] : raw);
      res.json(info);
    } catch {
      res.json({ title: 'Libro sin título', author: 'Autor desconocido', subtitle: '' });
    }
  } catch (err) {
    console.error('Error cover:', err.message);
    res.status(500).json({ error: 'Error al analizar la portada' });
  }
});

// Detectar capítulos + cleanup (con awareness de página si se envía `pages`)
app.post('/api/detect-chapters', async (req, res) => {
  try {
    const { text, indexText, pages } = req.body;
    if (!text && !pages) return res.status(400).json({ error: 'Falta el texto o las páginas' });

    // Construir representación con números de página si están disponibles
    let bookRepresentation;
    let hasPageInfo = false;
    if (Array.isArray(pages) && pages.length > 0) {
      hasPageInfo = true;
      bookRepresentation = pages.map(p => `=== PÁGINA ${p.num} ===\n${p.text || ''}`).join('\n\n');
    } else {
      bookRepresentation = text || '';
    }

    const indexBlock = indexText
      ? `\nÍndice del libro (orientativo):\n${indexText}\n`
      : '';

    const pageInstructions = hasPageInfo
      ? `Cada página viene marcada con "=== PÁGINA N ===". Identifica los capítulos por su número de página de inicio y fin.`
      : `No tienes números de página. Identifica los capítulos por marcadores textuales.`;

    const prompt = `Eres un asistente que estructura libros escaneados (OCR). Tu trabajo:

1. **Detectar capítulos**: ${pageInstructions} Busca patrones como "Capítulo 1", "CAPÍTULO I", "Capítulo Uno", números romanos, o títulos en mayúsculas que marcan inicio.
2. **Identificar basura del OCR**: las imágenes escaneadas a veces meten sombras, fragmentos de tablas, números de página al pie, headers repetidos, o caracteres de gráficos. Genera patrones regex (sin flags) para limpiarlos.
3. **Sin reescribir**: NO modifiques el contenido. Solo dame metadata (rangos de páginas y patrones de regex).
${indexBlock}
Responde SOLO con JSON válido (sin texto extra) en este formato exacto:

\`\`\`
{
  "chapters": [
    { "name": "Capítulo 1: Título corto", "startPage": 1, "endPage": 14 }
  ],
  "junkPatterns": [
    "^\\\\s*\\\\d+\\\\s*$",
    "^[│┌┘─•]+$",
    "Página \\\\d+ de \\\\d+"
  ]
}
\`\`\`

Reglas estrictas:
- Si no hay números de página, usa "startChar" y "endChar" en lugar de startPage/endPage.
- Los patrones regex deben ser conservadores — NUNCA limpies palabras reales del libro.
- Si no encuentras capítulos claros, devuelve uno solo llamado "Libro Completo".
- "name" debe ser corto (max 60 chars), sin punto final.

Contenido del libro:

${bookRepresentation}`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0]?.text || '{}';
    try {
      // Aceptar tanto objeto como array (legacy)
      const objectMatch = raw.match(/\{[\s\S]*\}/);
      const arrayMatch = raw.match(/\[[\s\S]*\]/);

      let parsed;
      if (objectMatch) {
        parsed = JSON.parse(objectMatch[0]);
      } else if (arrayMatch) {
        parsed = { chapters: JSON.parse(arrayMatch[0]), junkPatterns: [] };
      } else {
        throw new Error('No JSON found');
      }

      // Normalizar respuesta
      const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
      const junkPatterns = Array.isArray(parsed.junkPatterns) ? parsed.junkPatterns : [];

      res.json({ chapters, junkPatterns });
    } catch {
      res.json({
        chapters: [{ name: 'Libro Completo', startChar: 0, endChar: (text || bookRepresentation).length }],
        junkPatterns: []
      });
    }
  } catch (err) {
    console.error('Error chapters:', err.message);
    res.status(500).json({ error: 'Error al detectar capítulos' });
  }
});

// Resumir capítulo
app.post('/api/summarize', async (req, res) => {
  try {
    const { text, chapterName } = req.body;
    if (!text) return res.status(400).json({ error: 'Falta el texto' });

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Resume este capítulo "${chapterName || 'Sin nombre'}" de forma concisa para narración en audio. Escribe en un estilo natural hablado, sin referencias visuales como "como se muestra en la figura". Mantén las ideas y eventos clave.\n\nTexto del capítulo:\n\n${text}`
      }]
    });

    const summary = response.content[0]?.text || text;
    res.json({ summary });
  } catch (err) {
    console.error('Error summarize:', err.message);
    res.status(500).json({ error: 'Error al resumir el capítulo' });
  }
});

// Chat con un libro (usa prompt caching para reducir costo en preguntas subsecuentes)
app.post('/api/chat', async (req, res) => {
  try {
    const { bookText, bookTitle, messages, question } = req.body;
    if (!bookText || !question) {
      return res.status(400).json({ error: 'Faltan datos del libro o la pregunta' });
    }

    // Truncar contexto del libro por seguridad (80k chars ~= 20k tokens)
    const truncated = String(bookText).slice(0, 80000);
    const title = String(bookTitle || 'el libro').slice(0, 200);

    const systemPrompt = `Eres un asistente experto que responde preguntas sobre un libro específico.

Reglas estrictas:
- Solo responde basándote en el contenido del libro proporcionado abajo.
- Si la pregunta no se puede contestar con el texto, di amablemente que esa información no aparece en el libro.
- Responde en español, en 2-4 oraciones máximo, tono cercano y amable.
- No inventes datos. No salgas del tema del libro.

Título: ${title}

Contenido del libro:

${truncated}`;

    const history = Array.isArray(messages)
      ? messages
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
          .slice(-20) // últimos 20 mensajes max
          .map(m => ({ role: m.role, content: String(m.content) }))
      : [];

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' } // reduce 90% costo en preguntas subsecuentes
        }
      ],
      messages: [
        ...history,
        { role: 'user', content: String(question).slice(0, 500) }
      ]
    });

    const answer = response.content[0]?.text || '';
    res.json({
      answer,
      usage: response.usage // útil para confirmar que prompt caching está funcionando
    });
  } catch (err) {
    console.error('Error chat:', err.message);
    res.status(500).json({ error: 'Error al procesar tu pregunta. Intenta de nuevo.' });
  }
});

// Iniciar servidor (HTTPS si hay certificados, HTTP como fallback)
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');
const localIP = getLocalIP();

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const https = require('https');
  const sslOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  https.createServer(sslOptions, app).listen(PORT, '0.0.0.0', () => {
    console.log(`\n📚 LibroVoz servidor HTTPS iniciado`);
    console.log(`   Local:  https://localhost:${PORT}`);
    console.log(`   Red:    https://${localIP}:${PORT}`);
    console.log(`\n   En tu celular abre la URL de Red.`);
    console.log(`   Acepta el aviso de certificado para continuar.\n`);
  });
} else {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n📚 LibroVoz servidor HTTP iniciado`);
    console.log(`   Local:  http://localhost:${PORT}`);
    console.log(`   Red:    http://${localIP}:${PORT}`);
    console.log(`\n   ⚠️  Sin HTTPS la cámara no funciona en celulares.`);
    console.log(`   Genera certificados con: openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes\n`);
  });
}

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
