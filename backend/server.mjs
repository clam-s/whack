import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { openAccounts } from './accounts.mjs';
import { classifyNavigation, generateCode, generationFallback, isAccountIntent, navigationFallback, transcribeAudio } from './openrouter.mjs';
import { runJavaScript } from './runner.mjs';

const { OPENROUTER_API_KEY, OPENROUTER_MODEL, FRONTEND_ORIGIN } = process.env;
const transcriptionModel = process.env.OPENROUTER_TRANSCRIPTION_MODEL || 'openai/whisper-large-v3';
const { FISH_API_KEY } = process.env;
const fishAsrModel = process.env.FISH_ASR_MODEL || 'transcribe-1-pro';
const fishTtsModel = process.env.FISH_TTS_MODEL || 'drama-3';
const fishTtsVoiceId = process.env.FISH_TTS_VOICE_ID?.trim() || 'b121b91872f54f04ba9f6da08b8b6253';
const fishTtsFallbackVoiceId = 'f3a2b90078d54a65af4b95f63bc7798e';
const fishTtsDirection = process.env.FISH_TTS_DIRECTION?.trim() || '[warm]';
const fishTtsSpeed = boundedNumber(process.env.FISH_TTS_SPEED, 1, 0.5, 2);
const fishTtsVolume = boundedNumber(process.env.FISH_TTS_VOLUME, 0, -20, 20);
const storeVoiceClips = process.env.DEBUG_STORE_VOICE_CLIPS === 'true';
const logVoiceTranscripts = process.argv.slice(2).includes('-d');
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
  ['/eyeTracking/eyetracker_v51.html', ['eyeTracking/eyetracker_v51.html', 'text/html']],
]);
const frontendAssets = new Map();
for (const [path, [file, type]] of frontendFiles) {
  frontendAssets.set(path, { type, body: readFileSync(new URL('../frontend/' + file, import.meta.url)) });
}
let activeGenerations = 0;
let activeAccountRequests = 0;
let activeTranscriptions = 0;
let activeSpeechRequests = 0;
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

function sendAudio(res, { audio, fallbackVoice }) {
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'X-Fish-Voice-Fallback': String(fallbackVoice),
  });
  res.end(audio);
}

function boundedNumber(value, fallback, min, max) {
  if (value === undefined || value.trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

async function transcribeWithFish(audio, format) {
  const form = new FormData();
  form.append('audio', new Blob([audio], { type: `audio/${format}` }), `voice.${format}`);
  form.append('ignore_timestamps', 'true');
  const response = await fetch('https://api.fish.audio/v1/asr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FISH_API_KEY}`, model: fishAsrModel },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) {
      throw new RequestError(502, 'Fish Audio rejected FISH_API_KEY. Update it in .env and restart the backend.');
    }
    throw new Error(`Fish Audio transcription returned HTTP ${response.status}`);
  }
  const result = await response.json();
  if (typeof result.text !== 'string') throw new Error('Fish Audio did not return a transcript');
  return result.text.trim();
}

async function synthesizeWithFish(text) {
  const request = (voiceId) => fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FISH_API_KEY}`,
      'Content-Type': 'application/json',
      model: fishTtsModel,
    },
    body: JSON.stringify({
      text: fishTtsDirection ? `${fishTtsDirection} ${text}` : text,
      reference_id: voiceId,
      prosody: { speed: fishTtsSpeed, volume: fishTtsVolume },
      format: 'mp3',
      normalize: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  let response = await request(fishTtsVoiceId);
  let fallbackVoice = false;
  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 400 && /reference not found/i.test(errorBody) && fishTtsVoiceId !== fishTtsFallbackVoiceId) {
      response = await request(fishTtsFallbackVoiceId);
      fallbackVoice = response.ok;
    }
    if (!response.ok) {
      const messages = {
        400: 'Fish Audio rejected the voice or speech settings.',
        401: 'Fish Audio rejected the API key.',
        402: 'Fish Audio reports that the account has insufficient credit.',
        403: 'Fish Audio denied access to this voice or API.',
        429: 'Fish Audio rate limit reached.',
      };
      throw new Error(messages[response.status] || `Fish Audio speech synthesis returned HTTP ${response.status}`);
    }
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 5 * 1024 * 1024) throw new Error('Fish Audio returned invalid audio');
  return { audio, fallbackVoice };
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
  const allowedOrigins = new Set([
    FRONTEND_ORIGIN,
    `http://127.0.0.1:${localPort}`,
    `http://localhost:${localPort}`,
  ].filter(Boolean));
  if (FRONTEND_ORIGIN) {
    try {
      const configured = new URL(FRONTEND_ORIGIN);
      if (configured.hostname === 'localhost') allowedOrigins.add(`${configured.protocol}//127.0.0.1:${configured.port}`);
      if (configured.hostname === '127.0.0.1') allowedOrigins.add(`${configured.protocol}//localhost:${configured.port}`);
    } catch { /* An invalid configured origin is ignored; same-origin local use still works. */ }
  }
  // A file:// dashboard has an opaque "null" origin. This backend binds only to loopback,
  // so allow the local-file frontend to reach its explicitly configured local API.
  if (origin && origin !== 'null' && !allowedOrigins.has(origin)) {
    return send(res, 403, { error: 'Origin is not allowed' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  if (path === '/api/health' && req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, {
      status: 'ok',
      openRouterConfigured: Boolean(OPENROUTER_API_KEY && OPENROUTER_MODEL),
      fishAudioConfigured: Boolean(FISH_API_KEY),
      model: OPENROUTER_MODEL || null,
    });
  }

  if (path !== '/api/generate' && path !== '/api/intent' && path !== '/api/execute' && path !== '/api/account' && path !== '/api/transcribe' && path !== '/api/speak') {
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
      const startedAt = performance.now();
      const format = audioFormats.get(req.headers['content-type']?.split(';')[0].trim().toLowerCase());
      if (!format) throw new RequestError(415, 'Expected WebM or Ogg audio');
      if (!FISH_API_KEY && !OPENROUTER_API_KEY && !storeVoiceClips) throw new RequestError(503, 'Speech transcription requires a Fish Audio or OpenRouter API key');
      if (activeTranscriptions >= 2) throw new RequestError(429, 'Speech transcription is busy');
      activeTranscriptions++;
      try {
        const audio = await readBytes(req, 512 * 1024);
        if (!audio.length) throw new RequestError(400, 'No audio was recorded');
        if (storeVoiceClips) await saveVoiceClip(audio, format);
        if (!FISH_API_KEY && !OPENROUTER_API_KEY) {
          throw new RequestError(503, 'Speech transcription requires a Fish Audio or OpenRouter API key');
        }
        const text = FISH_API_KEY
          ? await transcribeWithFish(audio, format)
          : await transcribeAudio(audio, format, { apiKey: OPENROUTER_API_KEY, model: transcriptionModel });
        console.info(`[${path}] ${Math.round(performance.now() - startedAt)}ms via ${FISH_API_KEY ? 'Fish Audio' : 'OpenRouter'}`);
        if (logVoiceTranscripts) console.log('[voice transcript]', JSON.stringify(text));
        return send(res, 200, { text });
      } catch (error) {
        if (error instanceof RequestError) throw error;
        if (error.name === 'TimeoutError') throw new RequestError(504, 'Speech transcription timed out');
        throw new RequestError(502, 'Speech transcription failed');
      } finally {
        activeTranscriptions--;
      }
    }

    if (path === '/api/speak') {
      res.setHeader('Cache-Control', 'no-store');
      if (!FISH_API_KEY) throw new RequestError(503, 'Fish Audio is not configured');
      if (activeSpeechRequests >= 2) throw new RequestError(429, 'Speech synthesis is busy');
      const text = readField(await readBody(req), 'text', 2_000);
      activeSpeechRequests++;
      const startedAt = performance.now();
      try {
        const result = await synthesizeWithFish(text);
        console.info(`[${path}] ${Math.round(performance.now() - startedAt)}ms via Fish Audio`);
        return sendAudio(res, result);
      } catch (error) {
        if (error.name === 'TimeoutError') throw new RequestError(504, 'Speech synthesis timed out');
        throw new RequestError(502, error.message || 'Speech synthesis failed');
      } finally {
        activeSpeechRequests--;
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
      const body = await readBody(req);
      const text = readField(body, 'text', 8000);
      const navigation = path === '/api/intent';
      const fallback = navigation ? navigationFallback : generationFallback;
      const controls = navigation ? body.controls ?? [] : [];
      const context = navigation ? body.context ?? '' : '';
      if (typeof context !== 'string' || context.length > 4000) {
        throw new RequestError(400, 'context must be a string of up to 4000 characters');
      }
      if (!Array.isArray(controls) || controls.length > 100 ||
          controls.some((label) => typeof label !== 'string' || !label.trim() || label.length > 200)) {
        throw new RequestError(400, 'controls must contain at most 100 labels of up to 200 characters each');
      }
      if (!OPENROUTER_API_KEY || !OPENROUTER_MODEL) {
        console.warn(`[${path}] OpenRouter is not configured`);
        return send(res, 503, { ...fallback, error: 'OpenRouter is not configured' });
      }
      if (activeGenerations >= 4) throw new RequestError(429, 'Generation is busy');
      activeGenerations++;
      const startedAt = performance.now();
      try {
        const config = { apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL };
        const result = navigation
          ? await classifyNavigation(text, config, controls, context)
          : await generateCode(text, config);
        if (!navigation && result.code === null && !isAccountIntent(result.responseCode)) {
          return send(res, 502, { ...result, error: 'OpenRouter did not generate code' });
        }
        console.info(`[${path}] ${Math.round(performance.now() - startedAt)}ms → ${result.responseCode}`);
        return send(res, 200, result);
      } catch (error) {
        const timedOut = error.name === 'TimeoutError';
        console.error(`[${path}] ${timedOut ? 'request timed out' : error.message}`);
        const message = timedOut
          ? 'OpenRouter request timed out. Please try again.'
          : error.message?.startsWith('OpenRouter ')
            ? error.message
            : 'OpenRouter could not process the request. Please try again.';
        return send(res, timedOut ? 504 : 502, {
          ...fallback,
          error: message,
          message,
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
