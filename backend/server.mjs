import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { openAccounts } from './accounts.mjs';
import { classifyNavigation, generateCode, generationFallback, isAccountIntent, navigationFallback } from './openrouter.mjs';

const { OPENROUTER_API_KEY, OPENROUTER_MODEL, FRONTEND_ORIGIN } = process.env;
const port = Number(process.env.PORT ?? 3001);
const accounts = openAccounts(process.env.ACCOUNT_DB_PATH);
const dashboard = readFileSync(new URL('../frontend/index.html', import.meta.url));
let activeGenerations = 0;
let activeAccountRequests = 0;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  if (body.responseCode) console.info(`[intent] ${body.responseCode} (HTTP ${status})`);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'Expected application/json');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 100_000) {
      req.resume();
      throw new RequestError(413, 'Request body is too large');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Invalid JSON');
  }
}

function readField(body, field, limit) {
  const value = body?.[field];
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > limit) {
    throw new RequestError(400, `${field} must be a non-empty string of at most ${limit} bytes`);
  }
  return value;
}

const server = createServer(async (req, res) => {
  const path = req.url?.split('?')[0];
  if ((path === '/' || path === '/index.html') && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(req.method === 'GET' ? dashboard : undefined);
  }
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  const localPort = server.address().port;
  if (origin && origin !== FRONTEND_ORIGIN && origin !== `http://127.0.0.1:${localPort}` &&
      origin !== `http://localhost:${localPort}`) {
    return send(res, 403, { error: 'Origin is not allowed' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  if (path !== '/api/generate' && path !== '/api/intent' && path !== '/api/account') {
    return send(res, 404, { error: 'Route not found' });
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { error: 'Expected POST' });
  }

  try {
    if (path === '/api/account') {
      res.setHeader('Cache-Control', 'no-store');
      const body = await readBody(req);
      const userId = readField(body, 'userId', 100);
      const password = readField(body, 'password', 256);
      if (activeAccountRequests >= 4) throw new RequestError(429, 'Account lookup is busy');
      activeAccountRequests++;
      try {
        const account = await accounts.fetchAccount(userId, password);
        if (!account) throw new RequestError(401, 'Invalid user ID or password');
        return send(res, 200, account);
      } finally {
        activeAccountRequests--;
      }
    }

    const text = readField(await readBody(req), 'text', 8000);
    const navigation = path === '/api/intent';
    const fallback = navigation ? navigationFallback : generationFallback;
    if (!OPENROUTER_API_KEY || !OPENROUTER_MODEL) {
      return send(res, 503, { ...fallback, error: 'OpenRouter is not configured' });
    }
    if (activeGenerations >= 4) throw new RequestError(429, 'OpenRouter is busy');
    activeGenerations++;
    try {
      const handleRequest = navigation ? classifyNavigation : generateCode;
      const result = await handleRequest(text, {
        apiKey: OPENROUTER_API_KEY,
        model: OPENROUTER_MODEL,
      });
      if (!navigation && result.code === null && !isAccountIntent(result.responseCode)) {
        return send(res, 502, { ...result, error: 'OpenRouter did not generate code' });
      }
      return send(res, 200, result);
    } catch (error) {
      const timedOut = error.name === 'TimeoutError';
      return send(res, timedOut ? 504 : 502, {
        ...fallback,
        error: timedOut ? 'OpenRouter request timed out' : 'OpenRouter could not process the command',
      });
    } finally {
      activeGenerations--;
    }
  } catch (error) {
    if (error instanceof RequestError) {
      return send(res, error.status, { error: error.message });
    }
    return send(res, 500, { error: 'Unexpected server error' });
  }
});

server.on('close', () => accounts.close());

server.listen(port, '127.0.0.1', () => {
  console.log(`Dashboard and API listening on http://127.0.0.1:${server.address().port}`);
});
