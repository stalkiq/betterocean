/**
 * Diagnostic: echo back event info without calling Gradient.
 * Temporary test to confirm function invocation + routing works.
 */
export async function main(event) {
  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT || 'NOT SET';
  const hasKey = !!process.env.GRADIENT_AGENT_KEY;
  const messages = event.messages || event.body?.messages || event.__ow_body || null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: {
      ok: true,
      endpoint,
      hasKey,
      receivedMessages: Array.isArray(messages) ? messages.length : String(messages),
      eventKeys: Object.keys(event),
    },
  };
}
