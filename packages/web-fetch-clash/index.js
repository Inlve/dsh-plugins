// dsh-web-fetch-clash
//
// A ctx.web fetch provider for environments where DNS answers are Fake-IP
// placeholders produced by a remote Mihomo/Clash (OpenClash, Clash Verge on a
// router). The stock `http` provider refuses them because they are not public
// unicast addresses.
//
// This provider never bypasses the SSRF check: when system resolution returns
// only Fake-IP placeholders, it asks the Clash controller for the truthful
// answer (`GET /dns/query`, which bypasses Fake-IP in Mihomo), requires every
// returned address to be public unicast, and only then transports the request.
// Transport can stay on the Fake-IP address (`connect: fake`) so the router's
// domain mapping and routing rules keep working, or pin to the verified real
// addresses (`connect: real`).
//
// Runtime dependencies: node:http(s), node:dns, node:net only. The config
// schema uses @deepseek-ai/schemastery, a package DSH itself provides (peer,
// not a third-party runtime dependency).

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import z from '@deepseek-ai/schemastery';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-web-fetch-clash';

/** Hard dependency: the web seam must exist before this provider registers. */
export const inject = ['web'];

/** Stable provider id selected via `web.fetchProvider`. */
export const PROVIDER_ID = 'clash-dns';

const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)';

/** IPv4 ranges that are never public unicast. */
const IPV4_SPECIAL = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '255.255.255.255/32',
].map(parseCidr);

/** IPv6 ranges that are never public unicast. */
const IPV6_SPECIAL = [
  '::/128', '::1/128', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/32',
  '2001:2::/48', '2001:10::/28', '2001:20::/28', '2001:db8::/32', '2002::/16',
  '3fff::/20', 'fc00::/7', 'fe80::/10', 'ff00::/8',
].map(parseCidr);

const DEFAULT_CONFIG = {
  controller: 'http://127.0.0.1:9090',
  secret: '',
  fakeCidrs: ['198.18.0.0/15', 'fdfe:dcba:9876::/48', '2001:2::/48'],
  lanCidrs: '',
  connect: 'fake',
  resolve: 'auto',
  cacheTtlMs: 60000,
  queryTimeoutMs: 4000,
  timeoutMs: 30000,
  maxResponseBytes: 5000000,
  maxBodyChars: 100000,
  maxRedirects: 5,
  userAgent: DEFAULT_USER_AGENT,
};

/**
 * Host configuration schema. Fields are volatile so the Plugins page can edit
 * them live: the loader swaps the provider fiber without an app restart.
 */
export const Config = z.object({
  controller: z.string().default(DEFAULT_CONFIG.controller).volatile(),
  secret: z.string().default('').volatile(),
  resolve: z.string().default('auto').volatile(),
  connect: z.string().default('fake').volatile(),
  fakeCidrs: z.string().default('198.18.0.0/15, fdfe:dcba:9876::/48, 2001:2::/48').volatile(),
  lanCidrs: z.string().default('').volatile(),
  cacheTtlMs: z.number().default(60000).volatile(),
  queryTimeoutMs: z.number().default(4000).volatile(),
  timeoutMs: z.number().default(30000).volatile(),
  maxResponseBytes: z.number().default(5000000).volatile(),
  maxBodyChars: z.number().default(100000).volatile(),
  maxRedirects: z.number().default(5).volatile(),
  userAgent: z.string().default(DEFAULT_USER_AGENT).volatile(),
});

/* ------------------------------------------------------------------ */
/* IP parsing and classification                                       */
/* ------------------------------------------------------------------ */

function parseCidr(text) {
  const value = String(text).trim();
  const slash = value.indexOf('/');
  const address = slash === -1 ? value : value.slice(0, slash);
  const ip = parseIp(address);
  if (!ip) throw new Error(`invalid CIDR address: ${value}`);
  const max = ip.family === 4 ? 32 : 128;
  const prefix = slash === -1 ? max : Number(value.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
    throw new Error(`invalid CIDR prefix: ${value}`);
  }
  return { bytes: ip.bytes, prefix, family: ip.family, text: value };
}

function stripBrackets(hostname) {
  const value = String(hostname || '');
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function parseIp(text) {
  if (net.isIPv4(text)) {
    const parts = text.split('.').map(Number);
    return { family: 4, bytes: Uint8Array.from(parts) };
  }
  if (net.isIPv6(text)) {
    const bytes = parseIpv6(text);
    if (bytes) return { family: 6, bytes };
  }
  return null;
}

function parseIpv6(text) {
  let s = text;
  let tail = [];
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4) {
    const parts = v4[1].split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    tail = [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
    s = s.slice(0, -v4[1].length);
    if (s.endsWith(':')) s = s.slice(0, -1);
    if (s.endsWith(':')) s = s.slice(0, -1);
  }
  const idx = s.indexOf('::');
  const head = idx >= 0 ? s.slice(0, idx) : s;
  const rest = idx >= 0 ? s.slice(idx + 2) : null;
  const headParts = head ? head.split(':') : [];
  const restParts = rest ? rest.split(':') : [];
  for (const part of [...headParts, ...restParts]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
  }
  const total = headParts.length + restParts.length + tail.length;
  if (rest === null && total !== 8) return null;
  if (total > 8) return null;
  const zeros = 8 - total;
  const words = [...headParts, ...Array(zeros).fill('0'), ...restParts, ...[]].map((w) => parseInt(w, 16));
  const all = [...words, ...tail];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    bytes[i * 2] = (all[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = all[i] & 0xff;
  }
  return bytes;
}

function cidrMatches(ip, cidr) {
  if (ip.family === 4 && cidr.family !== 4) {
    if (!isMappedV4(ip.bytes)) return false;
    return cidrMatches({ family: 4, bytes: ip.bytes.slice(12) }, cidr);
  }
  if (ip.family !== cidr.family) return false;
  const full = cidr.prefix >> 3;
  const rem = cidr.prefix & 7;
  for (let i = 0; i < full; i += 1) {
    if (ip.bytes[i] !== cidr.bytes[i]) return false;
  }
  if (rem) {
    const mask = (0xff << (8 - rem)) & 0xff;
    if ((ip.bytes[full] & mask) !== (cidr.bytes[full] & mask)) return false;
  }
  return true;
}

function isMappedV4(bytes) {
  for (let i = 0; i < 10; i += 1) if (bytes[i] !== 0) return false;
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

function isPublicIp(ip) {
  if (!ip) return false;
  if (ip.family === 4) return !IPV4_SPECIAL.some((cidr) => cidrMatches(ip, cidr));
  if (isMappedV4(ip.bytes)) {
    return isPublicIp({ family: 4, bytes: ip.bytes.slice(12) });
  }
  // Global unicast is 2000::/3; everything outside it is non-public.
  if ((ip.bytes[0] & 0xe0) !== 0x20) return false;
  return !IPV6_SPECIAL.some((cidr) => cidrMatches(ip, cidr));
}

/**
 * Classify a resolved address:
 *   'fake'    - inside one of the configured Fake-IP pools
 *   'public'  - public unicast
 *   'private' - anything else (loopback, RFC1918, ULA, link-local, ...)
 *   'invalid' - not an IP literal
 */
function classifyAddress(address, fakeCidrs, lanCidrs = []) {
  const ip = parseIp(address);
  if (!ip) return 'invalid';
  if (fakeCidrs.some((cidr) => cidrMatches(ip, cidr))) return 'fake';
  if (lanCidrs.some((cidr) => cidrMatches(ip, cidr))) return 'lan';
  if (isPublicIp(ip)) return 'public';
  return 'private';
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

function webError(code, message) {
  const error = new Error(message);
  error.name = 'WebError';
  error.code = code;
  return error;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...(input || {}) };
  const fakeCidrs = typeof config.fakeCidrs === 'string'
    ? config.fakeCidrs.split(/[\s,]+/).filter(Boolean)
    : config.fakeCidrs;
  if (!Array.isArray(fakeCidrs) || fakeCidrs.length === 0) {
    throw new Error('fakeCidrs must be a non-empty CIDR list');
  }
  config.fakeCidrs = fakeCidrs.map(parseCidr);
  const lanCidrs = typeof config.lanCidrs === 'string'
    ? config.lanCidrs.split(/[\s,]+/).filter(Boolean)
    : Array.isArray(config.lanCidrs) ? config.lanCidrs : [];
  if (config.lanCidrs !== undefined && !Array.isArray(lanCidrs) && typeof config.lanCidrs !== 'string') {
    throw new Error('lanCidrs must be a CIDR list');
  }
  config.lanCidrs = lanCidrs.map(parseCidr);
  if (config.connect !== 'fake' && config.connect !== 'real') {
    throw new Error('connect must be "fake" or "real"');
  }
  if (config.resolve !== 'auto' && config.resolve !== 'clash') {
    throw new Error('resolve must be "auto" or "clash"');
  }
  if (!Number.isInteger(config.cacheTtlMs) || config.cacheTtlMs < 0) {
    throw new Error('cacheTtlMs must be a non-negative integer');
  }
  for (const key of ['queryTimeoutMs', 'timeoutMs', 'maxResponseBytes', 'maxBodyChars', 'maxRedirects']) {
    const value = config[key];
    if (!Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  }
  const controller = new URL(config.controller);
  if (controller.protocol !== 'http:' && controller.protocol !== 'https:') {
    throw new Error('controller must be an http(s) URL');
  }
  if (controller.protocol === 'http:') {
    const host = stripBrackets(controller.hostname);
    const ip = parseIp(host);
    const localName = host === 'localhost';
    if (!localName && (!ip || isPublicIp(ip))) {
      throw new Error('an http controller must point at a loopback or private address; use https otherwise');
    }
  }
  config.controllerUrl = controller;
  return config;
}

/* ------------------------------------------------------------------ */
/* Clash controller query                                              */
/* ------------------------------------------------------------------ */

async function queryClash(config, hostname, type) {
  try {
    return await queryClashOnce(config, hostname, type, config.queryTimeoutMs);
  } catch (error) {
    // A cold router cache can exceed the first budget; retry once, then fail.
    if (error && error.timeout) {
      return queryClashOnce(config, hostname, type, config.queryTimeoutMs * 2);
    }
    throw error;
  }
}

async function queryClashOnce(config, hostname, type, timeoutMs) {
  const url = new URL('/dns/query', config.controllerUrl);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', type);
  const mod = url.protocol === 'https:' ? https : http;
  const headers = { accept: 'application/json' };
  if (config.secret) headers.authorization = `Bearer ${config.secret}`;

  const response = await new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'GET', headers, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        reject(webError('WEB_PROVIDER_ERROR', 'Clash controller redirect refused'));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) {
          req.destroy(webError('WEB_PROVIDER_ERROR', 'Clash controller response too large'));
        }
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(webError('WEB_PROVIDER_ERROR', `Clash controller returned HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(webError('WEB_PROVIDER_ERROR', 'Clash controller returned invalid JSON'));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => {
      const error = webError('WEB_PROVIDER_ERROR', 'Clash controller query timed out');
      error.timeout = true;
      req.destroy(error);
    });
    req.on('error', (error) => {
      reject(error instanceof Error && error.code ? error
        : webError('WEB_PROVIDER_ERROR', `Clash controller unreachable: ${error.message}`));
    });
    req.end();
  });

  const answer = Array.isArray(response && response.Answer) ? response.Answer : [];
  const wanted = type === 'A' ? 1 : 28;
  const addresses = [];
  for (const record of answer) {
    if (!record || record.type !== wanted || typeof record.data !== 'string') continue;
    const ip = record.data.trim();
    if (net.isIP(ip)) addresses.push({ address: ip, family: net.isIP(ip) });
  }
  return addresses;
}

async function resolveRealAddresses(config, hostname) {
  const [v4, v6] = await Promise.all([
    queryClash(config, hostname, 'A').catch((error) => { throw error; }),
    queryClash(config, hostname, 'AAAA').catch((error) => { throw error; }),
  ]);
  const seen = new Set();
  const result = [];
  for (const entry of [...v4, ...v6]) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    result.push(entry);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

async function systemResolve(hostname) {
  try {
    const answers = await dns.promises.lookup(hostname, { all: true, order: 'verbatim' });
    return answers.map((entry) => ({ address: entry.address, family: entry.family }));
  } catch (error) {
    throw webError('WEB_PROVIDER_ERROR', `cannot resolve "${hostname}": ${error.message}`);
  }
}

const VERIFICATION_CACHE_LIMIT = 256;

function cacheGet(cache, hostname) {
  const hit = cache.get(hostname);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(hostname);
    return null;
  }
  return hit.real;
}

function cacheSet(cache, hostname, real, ttlMs) {
  if (ttlMs <= 0) return;
  cache.set(hostname, { real, expiresAt: Date.now() + ttlMs });
  if (cache.size > VERIFICATION_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/**
 * Decide which addresses may be transported for `url`.
 * - all public: the system answer set is used
 * - all Fake-IP: Clash must vouch for a public real answer; transport follows
 *   `connect` (the Fake-IP set, or the verified real set)
 * - anything else (private, mixed) keeps the stock refusal meaning
 */
async function resolveTarget(url, config, cache) {
  const hostname = stripBrackets(url.hostname);
  if (!hostname) throw webError('WEB_INVALID_URL', 'URL has no hostname');

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    const kind = classifyAddress(hostname, config.fakeCidrs, config.lanCidrs);
    if (kind === 'fake') {
      throw webError('WEB_BLOCKED_URL', `URL hostname "${hostname}" is a Fake-IP placeholder`);
    }
    if (kind !== 'public' && kind !== 'lan') {
      throw webError('WEB_BLOCKED_URL', `URL hostname "${hostname}" is not a public address`);
    }
    return [{ address: hostname, family: literalFamily }];
  }

  // `resolve: clash` treats Clash as the only resolver: never consult system
  // DNS, ask the controller for the truthful answer, validate it, and pin it.
  if (config.resolve === 'clash') {
    const real = await resolveRealAddresses(config, hostname);
    if (real.length === 0) {
      throw webError('WEB_BLOCKED_URL', `hostname "${hostname}" has no truthful address from Clash`);
    }
    for (const entry of real) {
      const kind = classifyAddress(entry.address, config.fakeCidrs);
      if (kind !== 'public') {
        throw webError(
          'WEB_BLOCKED_URL',
          `URL hostname "${hostname}" resolves to a non-public IP address via Clash (${entry.address})`,
        );
      }
    }
    return real;
  }

  const system = await systemResolve(hostname);
  if (system.length === 0) {
    throw webError('WEB_PROVIDER_ERROR', `hostname "${hostname}" resolved to no addresses`);
  }
  const kinds = system.map((entry) => classifyAddress(entry.address, config.fakeCidrs, config.lanCidrs));
  const allowed = (kind) => kind === 'public' || kind === 'lan';

  if (kinds.every(allowed)) {
    return system;
  }

  if (kinds.every((kind) => kind === 'fake')) {
    let real = cacheGet(cache, hostname);
    if (!real) {
      real = await resolveRealAddresses(config, hostname);
      if (real.length === 0) {
        throw webError('WEB_BLOCKED_URL', `URL hostname "${hostname}" resolves only to Fake-IP placeholders`);
      }
      for (const entry of real) {
        const kind = classifyAddress(entry.address, config.fakeCidrs);
        if (kind !== 'public') {
          throw webError(
            'WEB_BLOCKED_URL',
            `URL hostname "${hostname}" resolves to a non-public IP address via Clash (${entry.address})`,
          );
        }
      }
      cacheSet(cache, hostname, real, config.cacheTtlMs);
    }
    return config.connect === 'real' ? real : system;
  }

  if (kinds.some((kind) => kind === 'fake')) {
    throw webError(
      'WEB_BLOCKED_URL',
      `URL hostname "${hostname}" resolves to a mixed Fake-IP and real answer set`,
    );
  }
  throw webError('WEB_BLOCKED_URL', `URL hostname "${hostname}" resolves to a non-public IP address`);
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function fixedLookup(addresses) {
  return (hostname, options, callback) => {
    const all = options && typeof options === 'object' && options.all;
    if (all) {
      process.nextTick(callback, null, addresses);
      return;
    }
    const first = addresses[0];
    process.nextTick(callback, null, first.address, first.family);
  };
}

function isBinaryContentType(contentType) {
  return /^(image|audio|video)\//.test(contentType)
    || /application\/(pdf|octet-stream|zip|gzip|x-7z-compressed|x-rar-compressed)/.test(contentType);
}

function decodeBody(buffer, contentType) {
  const match = /charset=([^;\s]+)/i.exec(contentType || '');
  const charset = match ? match[1].replace(/["']/g, '') : 'utf8';
  try {
    return buffer.toString(Buffer.isEncoding(charset) ? charset : 'utf8');
  } catch {
    return buffer.toString('utf8');
  }
}

function requestOnce(url, addresses, config, signal) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      headers: {
        'user-agent': config.userAgent,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1',
      },
      lookup: fixedLookup(addresses),
      timeout: config.timeoutMs,
      signal,
    };
    const req = mod.request(url, options, (res) => {
      const location = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        resolve({ redirect: location });
        return;
      }
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (chunk) => {
        if (truncated) return;
        const remaining = config.maxResponseBytes - size;
        if (remaining <= 0) {
          truncated = true;
          return;
        }
        if (chunk.length > remaining) {
          chunks.push(chunk.subarray(0, remaining));
          size += remaining;
          truncated = true;
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated });
      });
      res.on('error', (error) => reject(webError('WEB_PROVIDER_ERROR', error.message)));
    });
    req.on('timeout', () => {
      req.destroy(webError('WEB_FETCH_TIMEOUT', `fetch of ${url.href} timed out`));
    });
    req.on('error', (error) => {
      if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
        reject(webError('WEB_ABORTED', 'fetch aborted'));
        return;
      }
      reject(error instanceof Error && error.name === 'WebError'
        ? error
        : webError('WEB_PROVIDER_ERROR', error.message));
    });
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function createProvider(input) {
  const config = normalizeConfig(input);
  const verificationCache = new Map();

  async function fetchImpl(request, signal) {
    const raw = request && typeof request.url === 'string' ? request.url : '';
    let current;
    try {
      current = new URL(raw);
    } catch {
      throw webError('WEB_INVALID_URL', `invalid URL: ${raw}`);
    }
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw webError('WEB_INVALID_URL', 'only http(s) URLs are supported');
    }
    if (current.username || current.password) {
      throw webError('WEB_BLOCKED_URL', 'credentials in URLs are not allowed');
    }
    if (current.href.length > 2048) {
      throw webError('WEB_INVALID_URL', 'URL exceeds 2048 characters');
    }

    const visited = new Set();
    for (let hop = 0; hop <= config.maxRedirects; hop += 1) {
      if (visited.has(current.href)) {
        throw webError('WEB_REDIRECT_BLOCKED', `redirect loop at ${current.href}`);
      }
      visited.add(current.href);

      const hostname = stripBrackets(current.hostname);
      const addresses = await resolveTarget(current, config, verificationCache);
      let response;
      try {
        response = await requestOnce(current, addresses, config, signal);
      } catch (error) {
        // A stale entry (router restart, fake-IP reassignment) must not stick.
        verificationCache.delete(hostname);
        throw error;
      }

      if (response.redirect) {
        const next = new URL(response.redirect, current);
        if (next.origin !== current.origin) {
          throw webError('WEB_REDIRECT_BLOCKED', `cross-origin redirect to ${next.href} refused`);
        }
        current = next;
        continue;
      }

      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (isBinaryContentType(contentType)) {
        throw webError('WEB_UNSUPPORTED_CONTENT_TYPE', `unsupported content type: ${contentType}`);
      }
      const kind = contentType.includes('text/html') || contentType.includes('application/xhtml')
        ? 'html'
        : 'text';
      let content = decodeBody(response.body, contentType);
      let truncated = response.truncated;
      if (content.length > config.maxBodyChars) {
        content = content.slice(0, config.maxBodyChars);
        truncated = true;
      }
      return {
        url: current.href,
        statusCode: response.statusCode,
        body: { kind, content },
        truncated,
      };
    }

    throw webError('WEB_REDIRECT_BLOCKED', `exceeded the maximum of ${config.maxRedirects} redirects`);
  }

  return {
    id: PROVIDER_ID,
    available: () => true,
    fetch: fetchImpl,
  };
}

export function apply(ctx, config) {
  const provider = createProvider(config);
  ctx.web.registerFetchProvider(provider);
}
