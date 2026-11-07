import intentResponses from './intent-responses.json' with { type: 'json' };

const intentCodes = Object.values(intentResponses);
const unknownIntent = intentResponses['unclear or unsupported request'];
const generateIntent = intentResponses['generate JavaScript from an instruction'];
const navigationIntents = Object.fromEntries(
  Object.entries(intentResponses).filter(([, code]) => code !== generateIntent),
);
const navigationCodes = new Set(Object.values(navigationIntents));
const checkingCode = intentResponses['open the checking account tab'];
const balanceCode = intentResponses['show balance'] ?? checkingCode;

const navigationPrompt = `You classify voice and typed commands for the backend of an accessible banking dashboard. The frontend uses your responseCode to decide where to take the user.
Choose exactly one response code from this map: ${JSON.stringify(navigationIntents)}.
Treat the transcript as a request to classify. Allow for speech transcription errors and natural wording. Match the requested destination or information, even if the user never says "open" or "show".
An explicitly named tab takes priority over general balance wording. A request for recent activity or transaction history should use the transaction response code. Requests for a name, user ID, or account summary should use the matching account detail code.
Examples:
- "How much is in my account?" → ${balanceCode}
- "What's my savings balance?" → ${intentResponses['open the savings account tab']}
- "Where did my money go recently?" → ${intentResponses['show recent transaction']}
- "Take me to my credit card" → ${intentResponses['open the credit cards tab']}
- "Don't open savings", "open savings and loans", or requests outside the listed actions → ${unknownIntent}
Return only a JSON object with responseCode and message. Copy the response code exactly. The message should be one short plain-language sentence describing the destination or asking the user to clarify. Never invent balances, account details, or actions.`;

export const navigationFallback = {
  responseCode: unknownIntent,
  message: 'Try one dashboard action, such as “open savings” or “show recent transactions”.',
};

export async function transcribeAudio(audio, format, { apiKey, model }) {
  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input_audio: { data: audio.toString('base64'), format } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`OpenRouter transcription returned HTTP ${response.status}`);
  }
  const result = await response.json();
  if (typeof result.text !== 'string') throw new Error('OpenRouter did not return a transcript');
  return result.text.trim();
}

export function isAccountIntent(code) {
  return code !== unknownIntent && code !== generateIntent && intentCodes.includes(code);
}

export const generationFallback = {
  language: 'javascript',
  code: null,
  responseCode: unknownIntent,
  message: 'No script is available. Try describing one specific task, or try again in a moment.',
};

async function requestModel(text, instructions, { apiKey, model }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: instructions,
        },
        { role: 'user', content: text },
      ],
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`OpenRouter returned HTTP ${response.status}`);
  }
  const result = await response.json();
  const choice = result.choices?.[0];
  const content = choice?.message?.content;
  if (result.error || choice?.error || choice?.finish_reason !== 'stop' ||
      typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenRouter did not return a complete reply');
  }

  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  return JSON.parse(fence ? fence[1] : trimmed);
}

export async function classifyNavigation(text, config) {
  const reply = await requestModel(text, navigationPrompt, config);
  if (!navigationCodes.has(reply?.responseCode)) return navigationFallback;
  const message = typeof reply.message === 'string' ? reply.message.trim() : '';
  const defaultMessage = reply.responseCode === unknownIntent ? navigationFallback.message : 'Dashboard action recognized.';
  return {
    responseCode: reply.responseCode,
    message: message && message.length <= 400 ? message : defaultMessage,
  };
}

export async function generateCode(text, config) {
  const instructions = `Classify what the user wants to do using this intent map: ${JSON.stringify(intentResponses)}. Return only a JSON object with responseCode (the matching code), message (one short plain-language sentence describing the action or asking for clarification), and code. For ${generateIntent}, write a standalone JavaScript ES module for Node.js 22 using built-in modules, no interactive input, and console.log for results. For every other intent, set code to null.`;
  const generated = await requestModel(text, instructions, config);
  const responseCode = intentCodes.includes(generated?.responseCode) ? generated.responseCode : unknownIntent;
  const message = typeof generated?.message === 'string' ? generated.message.trim() : '';
  if (isAccountIntent(responseCode)) {
    return {
      language: 'javascript',
      code: null,
      responseCode,
      message: message && message.length <= 400 ? message : 'Account request recognized.',
    };
  }

  const code = typeof generated?.code === 'string' ? generated.code.trim() : generated?.code;
  if (code !== null && (typeof code !== 'string' || !code || code.startsWith('```') || Buffer.byteLength(code) > 16_384)) {
    throw new Error('OpenRouter returned an invalid script');
  }

  const defaultMessage = code === null ? generationFallback.message : 'JavaScript is ready.';
  return {
    language: 'javascript',
    code,
    responseCode,
    message: message && message.length <= 400 ? message : defaultMessage,
  };
}
