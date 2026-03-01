/**
 * Serverless proxy to DigitalOcean Gradient AI.
 * Uses Node.js built-in https module.
 * NOTE: OpenWhisk web actions require body to be a JSON string, not a JS object.
 */
import https from 'https';

function httpsPost(url, reqBody, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(reqBody);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(payload);
    req.end();
  });
}

export async function main(event) {
  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;

  if (!endpoint || !key) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Gradient AI is not configured.' }),
    };
  }

  const messages = event.messages || event.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Request body must include messages array.' }),
    };
  }

  const base = endpoint.replace(/\/+$/, '');
  const url = base.includes('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  try {
    const result = await httpsPost(
      url,
      { model: process.env.GRADIENT_MODEL || 'openai-gpt-oss-120b', messages, stream: false },
      { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
    );

    if (result.status < 200 || result.status >= 300) {
      const msg = result.body?.message || result.body?.error?.message || result.body?.error || `Gradient returned ${result.status}`;
      return {
        statusCode: result.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: String(msg) }),
      };
    }

    const text = result.body?.choices?.[0]?.message?.content;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reply: text != null ? String(text) : '' }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message || 'Gradient request failed' }),
    };
  }
}
