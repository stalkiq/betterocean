/**
 * Serverless proxy to DigitalOcean Gradient AI.
 * Uses Node.js built-in fetch (no dependencies needed).
 * Reads GRADIENT_AGENT_ENDPOINT and GRADIENT_AGENT_KEY from env (set in App Platform).
 * POST body: { messages: [{ role, content }, ...] }
 * Returns: { reply: string } or { error: string }
 */
export async function main(event) {
  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;

  if (!endpoint || !key) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { error: 'Gradient AI is not configured. Set GRADIENT_AGENT_ENDPOINT and GRADIENT_AGENT_KEY in the app environment.' },
    };
  }

  const messages = event.messages || event.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { error: 'Request body must include messages array.' },
    };
  }

  const base = endpoint.replace(/\/+$/, '');
  const url = base.includes('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.GRADIENT_MODEL || 'openai-gpt-oss-120b',
        messages,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data?.message || data?.error?.message || data?.error || `Gradient returned ${res.status}`;
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: { error: msg },
      };
    }

    const text = data?.choices?.[0]?.message?.content;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { reply: text != null ? String(text) : '' },
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { error: err.message || 'Gradient request failed' },
    };
  }
}
