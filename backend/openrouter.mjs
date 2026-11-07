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
          content: 'Convert the transcript into a standalone JavaScript ES module for Node.js 22. Return only code. Use built-in Node.js modules, avoid interactive input, and print results with console.log.',
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
  const fence = trimmed.match(/^```(?:javascript|js|mjs|node|nodejs)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const code = fence ? fence[1] : trimmed;
  if (!code.trim() || code.startsWith('```') || Buffer.byteLength(code) > 16_384) {
    throw new Error('OpenRouter returned an invalid script');
  }
  return code;
}
