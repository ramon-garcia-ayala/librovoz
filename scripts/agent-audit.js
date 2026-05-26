#!/usr/bin/env node
/**
 * LibroVoz Agent Audit
 *
 * Agente local de bajo costo que revisa el proyecto periódicamente y propone
 * mejoras. NO commitea nada — solo escribe propuestas a AGENT_PROPOSALS.md
 * para que tú las revises y decidas.
 *
 * Uso:
 *   node scripts/agent-audit.js          # corrida única
 *   node scripts/agent-audit.js --watch  # cada N minutos (default 60)
 *
 * Configuración por env:
 *   ANTHROPIC_API_KEY  (requerida)
 *   AUDIT_INTERVAL_MIN (default 60)
 *   AUDIT_MAX_TOKENS_INPUT (default 12000)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.resolve(__dirname, '..');
const PROPOSALS_FILE = path.join(ROOT, 'AGENT_PROPOSALS.md');
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_INPUT_CHARS = parseInt(process.env.AUDIT_MAX_TOKENS_INPUT || '12000', 10) * 4;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY en .env');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Recolectar contexto del proyecto ────────────────────────────────────
function readFileSafe(filePath, maxChars = 3000) {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    return text.length > maxChars ? text.slice(0, maxChars) + '\n…[truncado]' : text;
  } catch {
    return '';
  }
}

function gitLogRecent(n = 10) {
  try {
    return execSync(`git log --oneline -${n}`, { cwd: ROOT }).toString();
  } catch {
    return '';
  }
}

function gitDiffLastCommit() {
  try {
    return execSync('git diff HEAD~1 HEAD --stat', { cwd: ROOT }).toString();
  } catch {
    return '';
  }
}

function listFiles(dir, exts) {
  try {
    const out = [];
    function walk(d) {
      for (const f of fs.readdirSync(d)) {
        if (f.startsWith('.') || f === 'node_modules' || f === 'lib') continue;
        const full = path.join(d, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (exts.some(e => f.endsWith(e))) {
          out.push(path.relative(ROOT, full));
        }
      }
    }
    walk(dir);
    return out;
  } catch {
    return [];
  }
}

// ── Build el prompt con contexto ────────────────────────────────────────
function buildPrompt() {
  const claudeMd = readFileSafe(path.join(ROOT, 'CLAUDE.md'), 3500);
  const recentCommits = gitLogRecent(10);
  const lastDiff = gitDiffLastCommit();
  const jsFiles = listFiles(path.join(ROOT, 'public', 'js'), ['.js']).join('\n');
  const cssFiles = listFiles(path.join(ROOT, 'public', 'css'), ['.css']).join('\n');

  // Snapshot de un archivo rotativo (uno distinto cada hora)
  const allJs = listFiles(path.join(ROOT, 'public', 'js'), ['.js']);
  const rotIdx = Math.floor(Date.now() / (60 * 60 * 1000)) % allJs.length;
  const sampleFile = allJs[rotIdx] || 'public/js/app.js';
  const sampleContent = readFileSafe(path.join(ROOT, sampleFile), 4000);

  const existingProposals = readFileSafe(PROPOSALS_FILE, 2000);

  return `Eres un agente revisor de código senior con visión de producto. Tu trabajo: auditar este proyecto y proponer 1-3 mejoras concretas y accionables.

# Proyecto: LibroVoz (PWA — escanea libros, los convierte en audiolibros con TTS)

## Architecture overview (CLAUDE.md, resumido)
${claudeMd}

## Commits recientes
${recentCommits}

## Cambios en último commit
${lastDiff}

## Archivos JS del proyecto
${jsFiles}

## Archivos CSS del proyecto
${cssFiles}

## Archivo bajo revisión esta vuelta (rotativo): ${sampleFile}
\`\`\`javascript
${sampleContent}
\`\`\`

## Propuestas previas (no repitas)
${existingProposals.slice(0, 1500)}

---

# Tu tarea

Revisa el archivo bajo revisión + el contexto general. Propone 1-3 mejoras CONCRETAS. Cada propuesta debe:

1. Tener un título corto (< 60 chars)
2. Explicar el problema en 1-2 oraciones
3. Proponer cambio específico (archivo + línea aprox + cambio sugerido)
4. Estimar impacto (UX / costo / robustez / accesibilidad / performance)
5. Estimar esfuerzo (XS = 5 min, S = 30 min, M = 2 h, L = medio día)

PRIORIZA:
- Bugs reales detectables del código (race conditions, leaks, edge cases)
- Mejoras de UX detectables (touch targets, contrast, a11y, mobile gotchas)
- Reducción de costo de API (caching, batching, evitar llamadas innecesarias)
- Robustez (error handling, retry, persistence)

EVITA:
- Cambios cosméticos sin propósito claro
- Reescrituras grandes (sin esfuerzo justificable)
- Cosas ya implementadas (revisa la lista de Propuestas previas)
- Refactors abstractos

Responde en MARKDOWN, formato:

### Propuesta N: Título
**Problema**: ...
**Cambio**: archivo:línea — qué exactamente
**Impacto**: UX/costo/...
**Esfuerzo**: XS/S/M/L
**Razón**: por qué vale la pena
---

Si encuentras menos de 1 mejora razonable, di "Sin propuestas esta vuelta. Código en buen estado." y nada más.`;
}

// ── Ejecutar audit ──────────────────────────────────────────────────────
async function runAudit() {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] Auditando...`);

  const prompt = buildPrompt();
  const truncated = prompt.length > MAX_INPUT_CHARS
    ? prompt.slice(0, MAX_INPUT_CHARS) + '\n[...truncado por límite de input]'
    : prompt;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: truncated }]
    });

    const proposals = response.content[0]?.text || '(sin output)';
    const usage = response.usage;
    const tookSec = ((Date.now() - start) / 1000).toFixed(1);

    // Costo estimado Haiku 4.5: $1/MTok input, $5/MTok output
    const costUsd = ((usage.input_tokens / 1e6) * 1 + (usage.output_tokens / 1e6) * 5).toFixed(4);

    // Append al archivo de propuestas (al inicio, más reciente arriba)
    const header = `# Propuestas del agente — ${new Date().toISOString()}\n\n_Modelo: ${MODEL} · ${usage.input_tokens} in / ${usage.output_tokens} out tokens · ~$${costUsd} · ${tookSec}s_\n\n`;
    const existing = fs.existsSync(PROPOSALS_FILE) ? fs.readFileSync(PROPOSALS_FILE, 'utf-8') : '';
    const newContent = header + proposals + '\n\n---\n\n' + existing;

    fs.writeFileSync(PROPOSALS_FILE, newContent);
    console.log(`✓ Propuestas escritas a AGENT_PROPOSALS.md (${usage.input_tokens} in / ${usage.output_tokens} out · ~$${costUsd})`);
  } catch (err) {
    console.error('Error en audit:', err.message);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────
const watchMode = process.argv.includes('--watch');
const intervalMin = parseInt(process.env.AUDIT_INTERVAL_MIN || '60', 10);

if (watchMode) {
  console.log(`Modo watch: corriendo cada ${intervalMin} minutos. Ctrl+C para parar.`);
  runAudit();
  setInterval(runAudit, intervalMin * 60 * 1000);
} else {
  runAudit();
}
