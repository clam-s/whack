import { createServer } from 'node:http';
import { openAccounts } from './accounts.mjs';
import { generateCode, generationFallback } from './openrouter.mjs';
import { runJavaScript } from './runner.mjs';

const { OPENROUTER_API_KEY, OPENROUTER_MODEL, FRONTEND_ORIGIN } = process.env;
const executionEnabled = process.env.ENABLE_CODE_EXECUTION === 'true';
const port = Number(process.env.PORT ?? 3001);
const accounts = openAccounts(process.env.ACCOUNT_DB_PATH);
let activeGenerations = 0;
let activeAccountRequests = 0;
let executing = false;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
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
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && origin !== FRONTEND_ORIGIN && origin !== `http://127.0.0.1:${port}`) {
    return send(res, 403, { error: 'Origin is not allowed' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  const path = req.url?.split('?')[0];
  if (path !== '/api/generate' && path !== '/api/execute' && path !== '/api/account') {
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

    if (path === '/api/generate') {
      const text = readField(await readBody(req), 'text', 8000);
      if (!OPENROUTER_API_KEY || !OPENROUTER_MODEL) {
        return send(res, 503, { ...generationFallback, error: 'OpenRouter is not configured' });
      }
      if (activeGenerations >= 4) throw new RequestError(429, 'Generation is busy');
      activeGenerations++;
      try {
        const result = await generateCode(text, {
          apiKey: OPENROUTER_API_KEY,
          model: OPENROUTER_MODEL,
        });
        if (result.code === null) {
          return send(res, 502, { ...result, error: 'OpenRouter did not generate code' });
        }
        return send(res, 200, result);
      } catch (error) {
        const timedOut = error.name === 'TimeoutError';
        return send(res, timedOut ? 504 : 502, {
          ...generationFallback,
          error: timedOut ? 'Code generation timed out' : 'OpenRouter could not generate code',
        });
      } finally {
        activeGenerations--;
      }
    }

    if (!executionEnabled) throw new RequestError(503, 'Code execution is disabled');
    const code = readField(await readBody(req), 'code', 16_384);
    if (executing) throw new RequestError(429, 'Execution is busy');
    executing = true;
    try {
      return send(res, 200, await runJavaScript(code));
    } catch {
      throw new RequestError(503, 'Node.js runner is unavailable');
    } finally {
      executing = false;
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
  console.log(`Backend listening on http://127.0.0.1:${server.address().port}`);
});
