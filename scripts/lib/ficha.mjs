// Utilidades del bot: leer una ficha de jugador, decodificar la página y respetar robots.txt.
// Sin dependencias, para poder ejecutarse en GitHub Actions sin instalar nada.

/* ---------- Texto ---------- */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  uuml: 'ü', Uuml: 'Ü', iexcl: '¡', iquest: '¿', ccedil: 'ç', agrave: 'à', egrave: 'è',
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

// Normaliza para comparar: sin tildes, mayúsculas y espacios simples.
export function norm(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Convierte el HTML en líneas de texto, separando por elementos de bloque.
export function htmlToLines(html) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:br|li|p|div|h[1-6]|tr|td|th|ul|ol|table|section|article|header|footer|main|nav|form|img)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Decodifica según el charset de la cabecera o de la propia página (muchas webs usan ISO-8859-1).
export function decodeBody(buffer, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) {
    const head = Buffer.from(buffer.slice(0, 2048)).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  charset = (charset ?? 'utf-8').toLowerCase();
  try {
    return { text: new TextDecoder(charset).decode(buffer), charset };
  } catch {
    return { text: new TextDecoder('utf-8').decode(buffer), charset: `${charset} (no soportado, se usó utf-8)` };
  }
}

/* ---------- Ficha de jugador ---------- */

const LABELS = new Map([
  ['CLUB AL QUE PERTENECE', 'club'],
  ['CATEGORIA', 'category'],
  ['POSICION', 'position'],
  ['POSICION ESPECIFICA', 'position_detail'],
  ['LUGAR DE NACIMIENTO', 'birth_place'],
  ['FECHA DE NACIMIENTO', 'birth_date'],
  ['EDAD', 'age'],
  ['EQUIPO DE PROCEDENCIA', 'previous_team'],
  ['OTRAS OBSERVACIONES', 'notes'],
]);

// Si el valor está en la línea siguiente (tablas), solo se recoge para estos campos.
const VALUE_ON_NEXT_LINE = new Set(['club', 'category', 'position', 'position_detail', 'birth_date']);

const LABEL_LINE = /^([^:]{3,40}):\s*(.*)$/;

function labelOf(line) {
  const match = LABEL_LINE.exec(line);
  return match ? LABELS.get(norm(match[1])) ?? null : null;
}

function findName(lines, firstLabelIndex) {
  if (firstLabelIndex < 1) return null;
  // El nombre completo está justo encima de la primera etiqueta ("OLASAGASTI" / "Lander Olasagasti Guillén").
  for (let i = firstLabelIndex - 1; i >= Math.max(0, firstLabelIndex - 6); i -= 1) {
    const line = lines[i];
    if (line.length < 3 || line.length > 80 || line.includes(':') || /^\d+$/.test(line)) continue;
    return line;
  }
  return null;
}

// Imágenes de relleno que la web usa cuando el jugador no tiene foto.
const PLACEHOLDER = /(no-?disponible|sin-?foto|nofoto|no-?image|default|placeholder)/i;

export function findPhoto(html, pageUrl, { allowHttp = false } = {}) {
  const candidates = [];
  const og =
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i.exec(html);
  if (og) candidates.push(['og', og[1]]);

  const IMG = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = IMG.exec(html))) {
    const src = match[1];
    if (PLACEHOLDER.test(src) || /(logo|icon|banner|escudo|flag|bandera|sprite|publi|\/ads?\/|pixel|spacer)/i.test(src)) continue;
    if (/\/(fotos?|jugadores?|players?|images?|imagenes|img|uploads)\//i.test(src)) candidates.push(['img', src]);
  }

  for (const [strategy, raw] of candidates) {
    if (PLACEHOLDER.test(raw)) continue;
    let url;
    try {
      url = new URL(decodeEntities(raw), pageUrl);
    } catch {
      continue;
    }
    if (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) {
      return { url: url.toString(), strategy };
    }
  }
  return { url: null, strategy: 'none' };
}

export function sourceIdFromUrl(url) {
  try {
    const u = new URL(url);
    const match = /\/(J\d+)/i.exec(u.pathname);
    if (match) return match[1].toUpperCase();
    // Formato corto: https://www.lapreferente.com/?IDjugador=369139
    const id = /^\d+$/.test(u.searchParams.get('IDjugador') ?? '') ? u.searchParams.get('IDjugador') : null;
    return id ? `J${id}` : null;
  } catch {
    return null;
  }
}

/**
 * Lee una ficha. De la fecha de nacimiento solo se guarda el año.
 * Devuelve { ok, fields, errors, warnings, diagnostics, preview }.
 */
export function parseFicha(html, pageUrl, options = {}) {
  const lines = htmlToLines(html);
  const found = {};
  const labelsSeen = [];
  let firstLabelIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const match = LABEL_LINE.exec(lines[i]);
    if (!match) continue;
    const key = LABELS.get(norm(match[1]));
    if (!key || key in found) continue;
    if (firstLabelIndex < 0) firstLabelIndex = i;

    let value = match[2].trim();
    if (!value && VALUE_ON_NEXT_LINE.has(key)) {
      const next = lines[i + 1];
      if (next && !labelOf(next)) value = next;
    }
    found[key] = value;
    labelsSeen.push(key);
  }

  const errors = [];
  const warnings = [];
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();

  if (labelsSeen.length === 0) {
    errors.push('no_se_encuentran_campos');
    return { ok: false, fields: {}, errors, warnings, diagnostics: { labels: [], lineCount: lines.length }, preview: previewOf(lines) };
  }

  const fullName = findName(lines, firstLabelIndex);
  if (!fullName) errors.push('sin_nombre');
  const nameConfirmed = Boolean(fullName && title && norm(title).includes(norm(fullName)));
  if (fullName && !nameConfirmed) warnings.push('nombre_no_confirmado_por_titulo');

  let birthYear = null;
  const date = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(found.birth_date ?? '');
  if (date) {
    const year = Number(date[3]);
    if (year >= 1980 && year <= 2015) birthYear = year;
  }
  if (birthYear == null) errors.push('sin_año');

  const photo = findPhoto(html, pageUrl, options);
  if (!photo.url) warnings.push('sin_foto');
  if (!found.club) warnings.push('sin_club');
  if (!found.category) warnings.push('sin_categoria');

  return {
    ok: errors.length === 0,
    fields: {
      full_name: fullName,
      birth_year: birthYear,
      club: found.club || null,
      category: found.category || null,
      position: found.position || null,
      position_detail: found.position_detail || null,
      photo_url: photo.url,
    },
    errors,
    warnings,
    diagnostics: { labels: labelsSeen, nameConfirmed, photoStrategy: photo.strategy, lineCount: lines.length },
    preview: previewOf(lines),
  };
}

function previewOf(lines) {
  return lines.slice(0, 40).join('\n').slice(0, 1500);
}

/* ---------- robots.txt ---------- */

export function parseRobots(text, agentToken) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (!line || idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (current) current.rules.push({ allow: key === 'allow', path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

export function isAllowed(rules, pathAndQuery) {
  let best = null;
  for (const rule of rules) {
    if (!rule.path) continue; // "Disallow:" vacío = todo permitido
    const pattern = rule.path
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$');
    if (!new RegExp(`^${pattern}`).test(pathAndQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
