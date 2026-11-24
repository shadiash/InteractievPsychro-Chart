#!/usr/bin/env node
/* ============================================================================
   PsychroChart Ultra 3.0 — Zero-Dependency Single-File ES Module Bundler
   Compiles modular src/ CSS + ES6 JS into standalone HTML deliverables:
     - index.html
     - PsychroChart Ultra 3.0.html
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const CSS_FILES = [
  'src/styles/theme.css',
  'src/styles/layout.css'
];

const JS_MODULES = [
  'src/core/contracts.js',
  'src/engine/psychro.js',
  'src/engine/comfort.js',
  'src/engine/hvac.js',
  'src/engine/weather.js',
  'src/state/store.js',
  'src/render/baseRenderer.js',
  'src/render/overlayRenderer.js',
  'src/export/exporter.js',
  'src/ui/interaction.js',
  'src/ui/leftPanel.js',
  'src/ui/rightPanel.js',
  'src/ui/modals.js',
  'src/app.js'
];

const TEMPLATE_FILE = 'index.template.html';
const OUTPUT_FILES = [
  'index.html',
  'PsychroChart Ultra 3.0.html'
];

function readRequired(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required source file: ${relPath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
}

/**
 * Concatenate CSS files while hoisting any @import rules to the very top
 * so they remain valid CSS inside a single <style> block.
 */
function buildCssBundle() {
  const imports = [];
  const bodies = [];

  for (const relPath of CSS_FILES) {
    const raw = readRequired(relPath).replace(/\r\n/g, '\n');
    const lines = raw.split('\n');
    const kept = [];
    for (const line of lines) {
      if (/^\s*@import\s+/i.test(line)) {
        imports.push(line.trim());
      } else {
        kept.push(line);
      }
    }
    bodies.push(`/* --- ${relPath} --- */\n${kept.join('\n').trim()}`);
  }

  const parts = [];
  if (imports.length) parts.push(imports.join('\n'));
  parts.push(...bodies);
  return parts.join('\n\n').replace(/<\/style/gi, '<\\/style');
}

/**
 * Token-aware ES module syntax stripper.
 * Only inspects top-level statements (braceDepth === 0) outside strings,
 * template literals, regexes, and comments, so HTML/JS strings inside
 * exporters or comments are never corrupted.
 */
function stripEsModuleSyntax(code, relPath) {
  const src = code.replace(/\r\n/g, '\n');
  const len = src.length;
  let i = 0;
  let out = '';
  let braceDepth = 0;
  const tplBraceStack = [];

  const isIdentChar = ch => /[A-Za-z0-9_$]/.test(ch);
  const isSpace = ch => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';

  function skipWsAndComments(pos) {
    let p = pos;
    while (p < len) {
      const ch = src[p];
      if (isSpace(ch)) {
        p++;
      } else if (ch === '/' && src[p + 1] === '/') {
        p += 2;
        while (p < len && src[p] !== '\n') p++;
      } else if (ch === '/' && src[p + 1] === '*') {
        p += 2;
        while (p < len && !(src[p] === '*' && src[p + 1] === '/')) p++;
        p = Math.min(len, p + 2);
      } else {
        break;
      }
    }
    return p;
  }

  function matchKeywordAt(pos, kw) {
    if (!src.startsWith(kw, pos)) return false;
    const before = pos > 0 ? src[pos - 1] : '';
    const after = pos + kw.length < len ? src[pos + kw.length] : '';
    return !isIdentChar(before) && !isIdentChar(after);
  }

  function readStringEnd(pos) {
    const quote = src[pos];
    let p = pos + 1;
    while (p < len) {
      if (src[p] === '\\') {
        p += 2;
      } else if (src[p] === quote) {
        return p + 1;
      } else {
        p++;
      }
    }
    return len;
  }

  /**
   * Consume a top-level `import ...` statement and return:
   * { endPos, replacement }
   */
  function consumeImport(startPos) {
    let p = startPos + 6; // after 'import'
    const nextNonWs = skipWsAndComments(p);
    // Keep dynamic import(...) or import.meta intact!
    if (src[nextNonWs] === '(' || src[nextNonWs] === '.') {
      return null;
    }

    // Advance until terminating ';' or end of from '...' string
    let stmt = '';
    let seenFrom = false;
    let inBrace = 0;
    p = nextNonWs;

    // Side-effect import: import 'foo.js';
    if (src[p] === '\'' || src[p] === '"') {
      p = readStringEnd(p);
      const afterStr = skipWsAndComments(p);
      if (src[afterStr] === ';') p = afterStr + 1;
      return { endPos: p, replacement: '' };
    }

    while (p < len) {
      const ch = src[p];
      if (ch === '/' && src[p + 1] === '/') {
        while (p < len && src[p] !== '\n') p++;
        continue;
      }
      if (ch === '/' && src[p + 1] === '*') {
        p += 2;
        while (p < len && !(src[p] === '*' && src[p + 1] === '/')) p++;
        p = Math.min(len, p + 2);
        continue;
      }
      if (ch === '{') {
        inBrace++;
        stmt += ch;
        p++;
        continue;
      }
      if (ch === '}') {
        inBrace = Math.max(0, inBrace - 1);
        stmt += ch;
        p++;
        continue;
      }
      if (inBrace === 0 && matchKeywordAt(p, 'from')) {
        seenFrom = true;
        p += 4;
        p = skipWsAndComments(p);
        if (src[p] === '\'' || src[p] === '"') {
          p = readStringEnd(p);
          const afterStr = skipWsAndComments(p);
          if (src[afterStr] === ';') p = afterStr + 1;
          break;
        }
        continue;
      }
      if (ch === ';' && inBrace === 0) {
        p++;
        break;
      }
      stmt += ch;
      p++;
    }

    if (!seenFrom) {
      throw new Error(`Malformed import statement in ${relPath}`);
    }

    // Detect aliased named imports: import { Orig as Alias } from '...'
    const aliases = [];
    const braceMatch = stmt.match(/\{([\s\S]*)\}/);
    if (braceMatch) {
      const specs = braceMatch[1].split(',');
      for (const rawSpec of specs) {
        const spec = rawSpec.trim();
        if (!spec) continue;
        const m = spec.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
        if (m && m[1] !== m[2]) {
          aliases.push(`var ${m[2]} = ${m[1]};`);
        }
      }
    }

    // Preserve line count so error line numbers map cleanly!
    const lineCount = (src.slice(startPos, p).match(/\n/g) || []).length;
    const newlines = '\n'.repeat(lineCount);
    return {
      endPos: p,
      replacement: (aliases.length ? aliases.join(' ') : '') + newlines
    };
  }

  /**
   * Consume a top-level `export ...` prefix/statement.
   */
  function consumeExport(startPos) {
    let p = skipWsAndComments(startPos + 6); // after 'export'

    // export const / let / var / function / async function / class
    if (
      matchKeywordAt(p, 'const') ||
      matchKeywordAt(p, 'let') ||
      matchKeywordAt(p, 'var') ||
      matchKeywordAt(p, 'function') ||
      matchKeywordAt(p, 'class') ||
      matchKeywordAt(p, 'async')
    ) {
      const lineCount = (src.slice(startPos, p).match(/\n/g) || []).length;
      return { endPos: p, replacement: '\n'.repeat(lineCount) };
    }

    // export default ...
    if (matchKeywordAt(p, 'default')) {
      const afterDef = skipWsAndComments(p + 7);
      if (
        matchKeywordAt(afterDef, 'function') ||
        matchKeywordAt(afterDef, 'class') ||
        matchKeywordAt(afterDef, 'async')
      ) {
        const lineCount = (src.slice(startPos, afterDef).match(/\n/g) || []).length;
        return { endPos: afterDef, replacement: '\n'.repeat(lineCount) };
      }
      // Standalone `export default Identifier;`
      let end = afterDef;
      while (end < len && src[end] !== ';' && src[end] !== '\n') end++;
      if (src[end] === ';') end++;
      const lineCount = (src.slice(startPos, end).match(/\n/g) || []).length;
      return { endPos: end, replacement: '\n'.repeat(lineCount) };
    }

    // export { a, b } [from '...'];  OR  export * [as X] from '...';
    if (src[p] === '{' || src[p] === '*') {
      let inBrace = 0;
      while (p < len) {
        const ch = src[p];
        if (ch === '{') { inBrace++; p++; continue; }
        if (ch === '}') {
          inBrace = Math.max(0, inBrace - 1);
          p++;
          if (inBrace === 0) {
            const after = skipWsAndComments(p);
            if (matchKeywordAt(after, 'from')) {
              p = skipWsAndComments(after + 4);
              if (src[p] === '\'' || src[p] === '"') p = readStringEnd(p);
              const semi = skipWsAndComments(p);
              if (src[semi] === ';') p = semi + 1;
            } else if (src[after] === ';') {
              p = after + 1;
            }
            break;
          }
          continue;
        }
        if (ch === '\'' || ch === '"') {
          p = readStringEnd(p);
          const semi = skipWsAndComments(p);
          if (src[semi] === ';') p = semi + 1;
          break;
        }
        if (ch === ';' && inBrace === 0) {
          p++;
          break;
        }
        p++;
      }
      const lineCount = (src.slice(startPos, p).match(/\n/g) || []).length;
      return { endPos: p, replacement: '\n'.repeat(lineCount) };
    }

    return null;
  }

  const REGEX_PRECEDING_KEYWORDS = new Set([
    'return', 'case', 'throw', 'delete', 'void', 'typeof',
    'in', 'instanceof', 'of', 'new', 'else', 'do', 'yield', 'await'
  ]);
  const REGEX_PRECEDING_PUNCT = new Set([
    '(', '[', '{', ',', ';', ':', '?', '=', '!', '&', '|', '^', '~',
    '+', '-', '*', '%', '<', '>', '/'
  ]);

  let atStmtStart = true;
  let lastSigKind = 'punct'; // 'punct' | 'ident' | 'keyword-re' | 'value'
  let lastSigChar = ';';

  function readRegexEnd(pos) {
    let p = pos + 1;
    let inClass = false;
    while (p < len) {
      const c = src[p];
      if (c === '\\') {
        p += 2;
        continue;
      }
      if (c === '\n') {
        // Unterminated regex — bail out safely as division
        return -1;
      }
      if (c === '[') {
        inClass = true;
        p++;
        continue;
      }
      if (c === ']' && inClass) {
        inClass = false;
        p++;
        continue;
      }
      if (c === '/' && !inClass) {
        p++;
        while (p < len && /[a-z]/i.test(src[p])) p++;
        return p;
      }
      p++;
    }
    return -1;
  }

  function canStartRegex() {
    if (lastSigKind === 'keyword-re') return true;
    if (lastSigKind === 'punct') return REGEX_PRECEDING_PUNCT.has(lastSigChar);
    return false;
  }

  while (i < len) {
    const ch = src[i];

    // Single-line comment
    if (ch === '/' && src[i + 1] === '/') {
      const start = i;
      i += 2;
      while (i < len && src[i] !== '\n') i++;
      out += src.slice(start, i);
      continue;
    }

    // Block comment
    if (ch === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(len, i + 2);
      out += src.slice(start, i);
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex()) {
      const end = readRegexEnd(i);
      if (end !== -1) {
        out += src.slice(i, end);
        i = end;
        atStmtStart = false;
        lastSigKind = 'value';
        lastSigChar = '/';
        continue;
      }
    }

    // String literal
    if (ch === '\'' || ch === '"') {
      const end = readStringEnd(i);
      out += src.slice(i, end);
      i = end;
      atStmtStart = false;
      lastSigKind = 'value';
      lastSigChar = ch;
      continue;
    }

    // Template literal
    if (ch === '`') {
      out += '`';
      i++;
      while (i < len) {
        if (src[i] === '\\') {
          out += src.slice(i, i + 2);
          i += 2;
        } else if (src[i] === '`') {
          out += '`';
          i++;
          break;
        } else if (src[i] === '$' && src[i + 1] === '{') {
          out += '${';
          i += 2;
          tplBraceStack.push(braceDepth);
          braceDepth++;
          lastSigKind = 'punct';
          lastSigChar = '{';
          break;
        } else {
          out += src[i];
          i++;
        }
      }
      atStmtStart = false;
      if (tplBraceStack.length === 0 || tplBraceStack[tplBraceStack.length - 1] !== braceDepth - 1) {
        lastSigKind = 'value';
        lastSigChar = '`';
      }
      continue;
    }

    // Track brace depth (including returning into template literal)
    if (ch === '{') {
      braceDepth++;
      out += ch;
      i++;
      atStmtStart = true;
      lastSigKind = 'punct';
      lastSigChar = '{';
      continue;
    }

    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      out += ch;
      i++;
      if (tplBraceStack.length && tplBraceStack[tplBraceStack.length - 1] === braceDepth) {
        tplBraceStack.pop();
        // Resume scanning template literal
        while (i < len) {
          if (src[i] === '\\') {
            out += src.slice(i, i + 2);
            i += 2;
          } else if (src[i] === '`') {
            out += '`';
            i++;
            break;
          } else if (src[i] === '$' && src[i + 1] === '{') {
            out += '${';
            i += 2;
            tplBraceStack.push(braceDepth);
            braceDepth++;
            lastSigKind = 'punct';
            lastSigChar = '{';
            break;
          } else {
            out += src[i];
            i++;
          }
        }
        atStmtStart = false;
        lastSigKind = 'value';
        lastSigChar = '`';
      } else {
        atStmtStart = true;
        lastSigKind = 'punct';
        lastSigChar = '}';
      }
      continue;
    }

    // Identifier / keyword token (also handles top-level import/export stripping)
    if (/[A-Za-z_$]/.test(ch)) {
      if (braceDepth === 0 && atStmtStart) {
        if (matchKeywordAt(i, 'import')) {
          const res = consumeImport(i);
          if (res) {
            out += res.replacement;
            i = res.endPos;
            atStmtStart = true;
            lastSigKind = 'punct';
            lastSigChar = ';';
            continue;
          }
        }
        if (matchKeywordAt(i, 'export')) {
          const res = consumeExport(i);
          if (res) {
            out += res.replacement;
            i = res.endPos;
            atStmtStart = false;
            lastSigKind = 'punct';
            lastSigChar = ';';
            continue;
          }
        }
      }

      const start = i;
      while (i < len && isIdentChar(src[i])) i++;
      const word = src.slice(start, i);
      out += word;
      atStmtStart = false;
      lastSigKind = REGEX_PRECEDING_KEYWORDS.has(word) ? 'keyword-re' : 'ident';
      lastSigChar = word[word.length - 1];
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < len && /[0-9a-fA-FxXoObBn._]/.test(src[i])) i++;
      out += src.slice(start, i);
      atStmtStart = false;
      lastSigKind = 'value';
      lastSigChar = '0';
      continue;
    }

    out += ch;
    if (ch === ';') {
      atStmtStart = true;
      lastSigKind = 'punct';
      lastSigChar = ';';
    } else if (ch === '\n') {
      if (braceDepth === 0) atStmtStart = true;
    } else if (!isSpace(ch)) {
      atStmtStart = false;
      if (ch === ')' || ch === ']') {
        lastSigKind = 'value';
        lastSigChar = ch;
      } else {
        lastSigKind = 'punct';
        lastSigChar = ch;
      }
    }
    i++;
  }

  return out;
}

/**
 * Combine all JS modules in topological order into a single strict IIFE
 * and validate syntax + duplicate declarations via Node's vm.Script.
 */
function buildJsBundle() {
  const headerLines = [
    '/* ============================================================================',
    '   PsychroChart Ultra 3.0 — Compiled Single-File Bundle',
    `   Built: ${new Date().toISOString()}`,
    '   ============================================================================ */',
    '(() => {',
    "'use strict';"
  ];

  const chunks = [headerLines.join('\n')];
  const lineMap = [];
  let currentLine = headerLines.length + 1;

  for (const relPath of JS_MODULES) {
    const raw = readRequired(relPath);
    const stripped = stripEsModuleSyntax(raw, relPath);
    const banner = `\n/* ==================== MODULE: ${relPath} ==================== */\n`;
    const bannerLines = (banner.match(/\n/g) || []).length;
    const moduleStartLine = currentLine + bannerLines;
    const moduleLineCount = (stripped.match(/\n/g) || []).length + 1;

    lineMap.push({
      relPath,
      startLine: moduleStartLine,
      endLine: moduleStartLine + moduleLineCount - 1
    });

    chunks.push(banner + stripped);
    currentLine = moduleStartLine + moduleLineCount;
  }

  chunks.push('\n})();\n');
  const combined = chunks.join('\n');

  // Escape any literal </script> inside strings/templates so HTML parser stays safe
  const safeBundle = combined.replace(/<\/(script)/gi, '<\\/$1');

  // Validate compiled JS bundle with V8 parser (catches syntax errors & duplicate top-level let/const/class)
  try {
    new vm.Script(safeBundle, { filename: 'psychro-ultra-3.0.bundle.js' });
  } catch (err) {
    const stackLines = String(err.stack || '').split('\n');
    let locationHint = '';
    const lineMatch = String(err.stack || '').match(/psychro-ultra-3\.0\.bundle\.js:(\d+)/);
    if (lineMatch) {
      const errLine = Number(lineMatch[1]);
      const hit = lineMap.find(m => errLine >= m.startLine && errLine <= m.endLine);
      if (hit) {
        locationHint = ` (in ${hit.relPath}, approx line ${errLine - hit.startLine + 1})`;
      }
    }
    throw new Error(`Bundle JS validation failed${locationHint}: ${err.message}\n${stackLines.slice(0, 5).join('\n')}`);
  }

  return safeBundle;
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
  const t0 = Date.now();
  const template = readRequired(TEMPLATE_FILE);

  if (!template.includes('<!-- INLINE_CSS -->')) {
    throw new Error(`Template ${TEMPLATE_FILE} is missing <!-- INLINE_CSS --> marker`);
  }
  if (!template.includes('<!-- INLINE_JS -->')) {
    throw new Error(`Template ${TEMPLATE_FILE} is missing <!-- INLINE_JS --> marker`);
  }

  const cssBundle = buildCssBundle();
  const jsBundle = buildJsBundle();

  const styleTag = `<style>\n${cssBundle}\n</style>`;
  const scriptTag = `<script>\n${jsBundle}\n</script>`;

  // Use function replacers so '$' sequences inside JS/CSS are never interpreted as backreferences!
  const html = template
    .replace('<!-- INLINE_CSS -->', () => styleTag)
    .replace('<!-- INLINE_JS -->', () => scriptTag);

  for (const outRel of OUTPUT_FILES) {
    const outPath = path.join(ROOT, outRel);
    fs.writeFileSync(outPath, html, 'utf8');
  }

  const cssBytes = Buffer.byteLength(cssBundle, 'utf8');
  const jsBytes = Buffer.byteLength(jsBundle, 'utf8');
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const elapsed = Date.now() - t0;

  const row = text => `│  ${text.padEnd(58)}  │`;
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log(row('PSYCHRO·ULTRA 3.0 — Single-File Build Succeeded'));
  console.log('├──────────────────────────────────────────────────────────────┤');
  console.log(row(`CSS bundle : ${String(CSS_FILES.length).padStart(2)} files   | ${formatKB(cssBytes).padStart(9)}`));
  console.log(row(`JS bundle  : ${String(JS_MODULES.length).padStart(2)} modules | ${formatKB(jsBytes).padStart(9)}  (vm.Script OK)`));
  console.log(row(`Final HTML : ${formatKB(htmlBytes).padStart(9)}  (${elapsed} ms)`));
  console.log(row('Outputs    :'));
  for (const outRel of OUTPUT_FILES) {
    console.log(row(`  • ${outRel}`));
  }
  console.log('└──────────────────────────────────────────────────────────────┘');
}

try {
  main();
} catch (err) {
  console.error('\n[BUILD FAILED]', err.message || err);
  process.exit(1);
}
