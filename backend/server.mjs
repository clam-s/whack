import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { openAccounts } from './accounts.mjs';
import { classifyNavigation, generateCode, generationFallback, isAccountIntent, navigationFallback, transcribeAudio } from './openrouter.mjs';
import { runJavaScript } from './runner.mjs';

const { OPENROUTER_API_KEY, OPENROUTER_MODEL, FRONTEND_ORIGIN } = process.env;
const transcriptionModel = process.env.OPENROUTER_TRANSCRIPTION_MODEL || 'openai/whisper-large-v3';
const storeVoiceClips = process.env.DEBUG_STORE_VOICE_CLIPS === 'true';
const voiceClipDirectory = new URL('./data/voice-clips/', import.meta.url);
const audioFormats = new Map([['audio/webm', 'webm'], ['audio/ogg', 'ogg']]);
const executionEnabled = process.env.ENABLE_CODE_EXECUTION === 'true';
const port = Number(process.env.PORT ?? 3001);
const accounts = openAccounts(process.env.ACCOUNT_DB_PATH);
const frontendFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/actions.js', ['actions.js', 'text/javascript']],
  ['/linking.js', ['linking.js', 'text/javascript']],
]);
const frontendAssets = new Map();
for (const [path, [file, type]] of frontendFiles) {
  frontendAssets.set(path, { type, body: readFileSync(new URL('../frontend/' + file, import.meta.url)) });
}
let activeGenerations = 0;
let activeAccountRequests = 0;
let activeTranscriptions = 0;
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

async function saveVoiceClip(audio, format) {
  const filename = `${Date.now()}-${randomUUID()}.${format}`;
  try {
    await mkdir(voiceClipDirectory, { recursive: true, mode: 0o700 });
    await writeFile(new URL(filename, voiceClipDirectory), audio, { flag: 'wx', mode: 0o600 });
    console.info(`[voice debug] Saved backend/data/voice-clips/${filename}`);
  } catch (error) {
    console.warn(`[voice debug] Could not save clip (${error.code ?? 'unknown error'})`);
  }
}

async function readBytes(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new RequestError(413, 'Request body is too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'Expected application/json');
  }
  const body = await readBytes(req, 100_000);
  try {
    return JSON.parse(body.toString('utf8'));
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
  const asset = frontendAssets.get(path);
  if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': asset.type + '; charset=utf-8' });
    return res.end(req.method === 'GET' ? asset.body : undefined);
  }
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  const localPort = server.address().port;
  if (origin && origin !== FRONTEND_ORIGIN && origin !== `http://127.0.0.1:${localPort}` &&
      origin !== `http://localhost:${localPort}`) {
    return send(res, 403, { error: 'Origin is not allowed' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  if (path !== '/api/generate' && path !== '/api/intent' && path !== '/api/execute' && path !== '/api/account' && path !== '/api/transcribe') {
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
    if (path === '/api/transcribe') {
      res.setHeader('Cache-Control', 'no-store');
      const format = audioFormats.get(req.headers['content-type']?.split(';')[0].trim().toLowerCase());
      if (!format) throw new RequestError(415, 'Expected WebM or Ogg audio');
      if (!OPENROUTER_API_KEY && !storeVoiceClips) throw new RequestError(503, 'Speech transcription requires an OpenRouter API key');
      if (activeTranscriptions >= 2) throw new RequestError(429, 'Speech transcription is busy');
      activeTranscriptions++;
      try {
        const audio = await readBytes(req, 512 * 1024);
        if (!audio.length) throw new RequestError(400, 'No audio was recorded');
        if (storeVoiceClips) await saveVoiceClip(audio, format);
        if (!OPENROUTER_API_KEY) throw new RequestError(503, 'Speech transcription requires an OpenRouter API key');
        const text = await transcribeAudio(audio, format, { apiKey: OPENROUTER_API_KEY, model: transcriptionModel });
        return send(res, 200, { text });
      } catch (error) {
        if (error instanceof RequestError) throw error;
        if (error.name === 'TimeoutError') throw new RequestError(504, 'Speech transcription timed out');
        throw new RequestError(502, 'OpenRouter could not transcribe the recording');
      } finally {
        activeTranscriptions--;
      }
    }

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

    if (path === '/api/generate' || path === '/api/intent') {
      const text = readField(await readBody(req), 'text', 8000);
      const navigation = path === '/api/intent';
      const fallback = navigation ? navigationFallback : generationFallback;
      if (!OPENROUTER_API_KEY || !OPENROUTER_MODEL) {
        return send(res, 503, { ...fallback, error: 'OpenRouter is not configured' });
      }
      if (activeGenerations >= 4) throw new RequestError(429, 'Generation is busy');
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
          error: timedOut ? 'OpenRouter request timed out' : 'OpenRouter could not process the request',
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
