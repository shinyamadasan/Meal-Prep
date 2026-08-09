const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const REDIRECT_LIMIT = 5;
const DNS_JSON_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const ERROR_MESSAGES = {
  METHOD_NOT_ALLOWED: 'Use POST /recipe-import.',
  INVALID_REQUEST: 'Request body must be JSON with a recipe URL.',
  INVALID_URL: 'Enter a valid http or https recipe URL.',
  BLOCKED_TARGET: 'This URL is not allowed.',
  FETCH_FAILED: 'We could not fetch this webpage.',
  TIMEOUT: 'The recipe webpage took too long to respond.',
  TOO_MANY_REDIRECTS: 'The webpage redirected too many times.',
  UNSUPPORTED_CONTENT: 'The URL did not return an HTML recipe page.',
  RESPONSE_TOO_LARGE: 'The recipe page is too large to import.',
  NO_RECIPE_FOUND: 'We found the webpage but could not detect structured recipe data.'
};

export default {
  async fetch(request, env) {
    return handleRequest(request, env || {});
  }
};

export async function handleRequest(request, env = {}) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 405, cors);

  const path = new URL(request.url).pathname;
  if (path !== '/recipe-import') return errorResponse('METHOD_NOT_ALLOWED', 405, cors);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('INVALID_REQUEST', 400, cors);
  }
  if (!body || typeof body.url !== 'string') return errorResponse('INVALID_REQUEST', 400, cors);

  let initialUrl;
  try {
    initialUrl = await validateTargetUrl(body.url, env);
  } catch (e) {
    return errorResponse(e.code || 'INVALID_URL', e.status || 400, cors);
  }

  let page;
  try {
    page = await fetchRecipePage(initialUrl, env);
  } catch (e) {
    return errorResponse(e.code || 'FETCH_FAILED', e.status || 502, cors);
  }

  const blocks = await collectJsonLdBlocks(page.html);
  const parsed = parseJsonLdBlocks(blocks);
  const nodes = flattenJsonLdNodes(parsed.values);
  const candidates = nodes.filter(isRecipeNode);
  if (candidates.length === 0) return errorResponse('NO_RECIPE_FOUND', 422, cors);

  const selected = selectBestRecipe(candidates);
  const warnings = parsed.warnings.slice();
  if (candidates.length > 1) warnings.push('Multiple Recipe objects found; selected the most complete one.');

  return jsonResponse({
    ok: true,
    recipe: extractRecipeSource(selected.node, {
      requestedUrl: initialUrl.href,
      finalUrl: page.finalUrl
    }),
    warnings
  }, 200, cors);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers)
  });
}

function errorResponse(code, status, headers = {}) {
  return jsonResponse({ ok: false, errorCode: code, message: ERROR_MESSAGES[code] || 'Recipe import failed.' }, status, headers);
}

function codedError(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status;
  return err;
}

export async function validateTargetUrl(value, env = {}) {
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    throw codedError('INVALID_URL', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw codedError('INVALID_URL', 400);
  if (url.username || url.password) throw codedError('INVALID_URL', 400);
  if (isBlockedHostname(url.hostname)) throw codedError('BLOCKED_TARGET', 400);

  const addresses = await resolveHostnameAddresses(url.hostname, env);
  if (addresses.some(isBlockedIp)) throw codedError('BLOCKED_TARGET', 400);
  return url;
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return isBlockedIp(host);
}

export function isBlockedIp(value) {
  const host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIpv4(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  if (host.startsWith('::ffff:')) return isBlockedIp(host.slice(7));
  return false;
}

function parseIpv4(host) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map(Number);
  return parts.every(n => n >= 0 && n <= 255) ? parts : null;
}

async function resolveHostnameAddresses(hostname, env = {}) {
  if (parseIpv4(hostname) || hostname.includes(':')) return [hostname];
  if (env.resolveHostnameAddresses) return env.resolveHostnameAddresses(hostname);
  const endpoint = env.DNS_JSON_ENDPOINT || DNS_JSON_ENDPOINT;
  const out = [];
  for (const type of ['A', 'AAAA']) {
    const res = await fetch(endpoint + '?name=' + encodeURIComponent(hostname) + '&type=' + type, {
      headers: { Accept: 'application/dns-json' }
    });
    if (!res.ok) throw codedError('BLOCKED_TARGET', 400);
    const data = await res.json();
    (data.Answer || []).forEach(answer => {
      if (answer && typeof answer.data === 'string') out.push(answer.data);
    });
  }
  if (out.length === 0) throw codedError('BLOCKED_TARGET', 400);
  return out;
}

export async function fetchRecipePage(initialUrl, env = {}) {
  let current = initialUrl;
  for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects++) {
    const response = await fetchWithTimeout(current.href, env);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location) throw codedError('FETCH_FAILED', 502);
      if (redirects === REDIRECT_LIMIT) throw codedError('TOO_MANY_REDIRECTS', 508);
      current = await validateTargetUrl(new URL(location, current).href, env);
      continue;
    }
    if (!response.ok) throw codedError('FETCH_FAILED', 502);

    const type = response.headers.get('Content-Type') || '';
    if (!/^text\/html\b|application\/xhtml\+xml\b/i.test(type)) throw codedError('UNSUPPORTED_CONTENT', 415);

    const html = await readBoundedText(response, MAX_HTML_BYTES);
    if (!html.trim()) throw codedError('UNSUPPORTED_CONTENT', 415);
    return { html, finalUrl: current.href };
  }
  throw codedError('TOO_MANY_REDIRECTS', 508);
}

async function fetchWithTimeout(url, env = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.FETCH_TIMEOUT_MS || FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: 'manual', signal: controller.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw codedError('TIMEOUT', 504);
    throw codedError('FETCH_FAILED', 502);
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response, limit) {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch (e) {}
      throw codedError('RESPONSE_TOO_LARGE', 413);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(chunk => { merged.set(chunk, offset); offset += chunk.byteLength; });
  return new TextDecoder().decode(merged);
}

export async function collectJsonLdBlocks(html) {
  if (typeof HTMLRewriter !== 'undefined') {
    const blocks = [];
    let active = null;
    const rewriter = new HTMLRewriter().on('script[type="application/ld+json"]', {
      element() {
        active = [];
        blocks.push(active);
      },
      text(text) {
        if (active) active.push(text.text);
        if (text.lastInTextNode) active = null;
      }
    });
    await rewriter.transform(new Response(html, { headers: { 'Content-Type': 'text/html' } })).arrayBuffer();
    return blocks.map(parts => parts.join('')).filter(s => s.trim());
  }
  return collectJsonLdBlocksFallback(html);
}

function collectJsonLdBlocksFallback(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1])) blocks.push(match[2]);
  }
  return blocks;
}

export function parseJsonLdBlocks(blocks) {
  const values = [];
  const warnings = [];
  blocks.forEach((block, index) => {
    try {
      values.push(JSON.parse(block));
    } catch (e) {
      warnings.push('Ignored malformed JSON-LD block #' + (index + 1) + '.');
    }
  });
  return { values, warnings };
}

export function flattenJsonLdNodes(value) {
  const nodes = [];
  function visit(node) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== 'object') return;
    nodes.push(node);
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
    if (node.itemListElement) visit(node.itemListElement);
  }
  visit(value);
  return nodes;
}

export function isRecipeNode(node) {
  const type = node && node['@type'];
  if (Array.isArray(type)) return type.map(String).some(t => t.toLowerCase() === 'recipe');
  return String(type || '').toLowerCase() === 'recipe';
}

export function selectBestRecipe(candidates) {
  return candidates.map((node, index) => ({ node, index, score: scoreRecipe(node) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
}

function scoreRecipe(node) {
  let score = 0;
  if (asText(node.name)) score += 5;
  if (asArray(node.recipeIngredient).length) score += 5;
  if (extractInstructions(node.recipeInstructions).length) score += 5;
  if (asText(node.recipeYield).length) score += 2;
  if (asText(node.prepTime)) score += 1;
  if (asText(node.cookTime)) score += 1;
  if (asText(node.totalTime)) score += 1;
  if (node.nutrition) score += 2;
  if (extractImage(node.image)) score += 1;
  return score;
}

export function extractRecipeSource(node, meta = {}) {
  return {
    name: asText(node.name) || null,
    description: asText(node.description) || null,
    prepTime: asText(node.prepTime) || null,
    cookTime: asText(node.cookTime) || null,
    totalTime: asText(node.totalTime) || null,
    recipeYield: normalizeYield(node.recipeYield),
    rawIngredients: asArray(node.recipeIngredient).map(asText).filter(Boolean),
    instructions: extractInstructions(node.recipeInstructions),
    nutrition: extractNutrition(node.nutrition),
    image: extractImage(node.image),
    author: extractAuthor(node.author),
    requestedUrl: meta.requestedUrl || null,
    finalUrl: meta.finalUrl || meta.requestedUrl || null,
    sourceSite: meta.finalUrl ? new URL(meta.finalUrl).hostname : null
  };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).replace(/\s+/g, ' ').trim();
  if (typeof value === 'object') return asText(value.text || value.name || value['@value'] || '');
  return '';
}

function normalizeYield(value) {
  const values = asArray(value).map(asText).filter(Boolean);
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : values;
}

export function extractInstructions(value) {
  const out = [];
  function visit(item, section) {
    if (item == null) return;
    if (typeof item === 'string') { addInstruction(item, section); return; }
    if (Array.isArray(item)) { item.forEach(child => visit(child, section)); return; }
    if (typeof item !== 'object') return;
    const type = item['@type'];
    const types = Array.isArray(type) ? type.map(String) : [String(type || '')];
    if (types.some(t => t.toLowerCase() === 'howtosection')) {
      const nextSection = asText(item.name) || section || null;
      visit(item.itemListElement || item.steps, nextSection);
      return;
    }
    const text = asText(item.text || item.name);
    if (text) addInstruction(text, section);
    visit(item.itemListElement, section);
  }
  function addInstruction(text, section) {
    const clean = asText(text);
    if (!clean) return;
    out.push(section ? { section, text: clean } : { text: clean });
  }
  visit(value, null);
  return out;
}

function extractNutrition(value) {
  if (!value || typeof value !== 'object') return null;
  const fields = ['calories', 'proteinContent', 'carbohydrateContent', 'fatContent', 'fiberContent', 'sodiumContent'];
  const out = {};
  fields.forEach(field => {
    const text = asText(value[field]);
    if (text) out[field] = text;
  });
  return Object.keys(out).length ? out : null;
}

function extractImage(value) {
  const first = asArray(value).find(Boolean);
  if (first == null) return null;
  if (typeof first === 'string') return first.trim() || null;
  if (typeof first === 'object') return asText(first.url || first.contentUrl) || null;
  return null;
}

function extractAuthor(value) {
  const text = asText(asArray(value)[0]);
  return text || null;
}
