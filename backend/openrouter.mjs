import intentResponses from './intent-responses.json' with { type: 'json' };

const intentCodes = Object.values(intentResponses);
const unknownIntent = intentResponses['unclear or unsupported request'];
const generateIntent = intentResponses['generate JavaScript from an instruction'];

export function isAccountIntent(code) {
  return code !== unknownIntent && code !== generateIntent && intentCodes.includes(code);
}

export const generationFallback = {
  language: 'javascript',
  code: null,
  responseCode: unknownIntent,
  message: 'No script is available. Try describing one specific task, or try again in a moment.',
};

export async function generateCode(text, { apiKey, model }) {
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
          content: `Classify what the user wants to do using this intent map: ${JSON.stringify(intentResponses)}. Return only a JSON object with responseCode (the matching code), message (one short plain-language sentence describing the action or asking for clarification), and code. For ${generateIntent}, write a standalone JavaScript ES module for Node.js 22 using built-in modules, no interactive input, and console.log for results. For every other intent, set code to null.`,
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
    throw new Error('OpenRouter did not return a complete script');
  }

  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const generated = JSON.parse(fence ? fence[1] : trimmed);
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
