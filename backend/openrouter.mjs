import sentimentResponses from './sentiment-responses.json' with { type: 'json' };

const sentimentCodes = Object.values(sentimentResponses);

export const generationFallback = {
  language: 'javascript',
  code: null,
  responseCode: sentimentResponses.unclear,
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
          content: `Convert the transcript into a standalone JavaScript ES module for Node.js 22. Use built-in Node.js modules, avoid interactive input, and print results with console.log. Return only a JSON object with three fields: code (raw JavaScript, or null if the request cannot be turned into a script), responseCode (one of ${sentimentCodes.join(', ')} based on the sentiment expressed in the transcript), and message (one short plain-language sentence describing what the script does or asking for clarification if code is null).`,
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
  const code = typeof generated?.code === 'string' ? generated.code.trim() : generated?.code;
  if (code !== null && (typeof code !== 'string' || !code || code.startsWith('```') || Buffer.byteLength(code) > 16_384)) {
    throw new Error('OpenRouter returned an invalid script');
  }

  const message = typeof generated.message === 'string' ? generated.message.trim() : '';
  const defaultMessage = code === null ? generationFallback.message : 'JavaScript is ready.';
  return {
    language: 'javascript',
    code,
    responseCode: sentimentCodes.includes(generated.responseCode) ? generated.responseCode : sentimentResponses.unclear,
    message: message && message.length <= 400 ? message : defaultMessage,
  };
}
