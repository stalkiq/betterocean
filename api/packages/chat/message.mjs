/**
 * Serverless proxy to DigitalOcean Gradient AI.
 * Reads GRADIENT_AGENT_ENDPOINT and GRADIENT_AGENT_KEY from env (set in App Platform).
 * POST body: { messages: [{ role, content }, ...] }
 * Returns: { reply: string } or { error: string }
 */
import axios from 'axios';

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

  const url = endpoint.includes('v1') 
    ? `${endpoint.replace(/\/+$/, '')}/chat/completions`
    : `${endpoint.replace(/\/+$/, '')}/v1/chat/completions`;

  try {
    const res = await axios.post(
      url,
      { 
        model: process.env.GRADIENT_MODEL || "openai-gpt-oss-120b", 
        messages, 
        stream: false 
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        timeout: 60000,
      }
    );
    const text = res.data?.choices?.[0]?.message?.content;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { reply: text != null ? String(text) : '' },
    };
  } catch (err) {
    const message = err.response?.data?.message || err.response?.data?.error?.message || err.message || 'Gradient request failed';
    const code = err.response?.status || 502;
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { error: message },
    };
  }
}
