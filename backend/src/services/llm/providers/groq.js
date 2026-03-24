async function groqChatCompletions({ messages, temperature = 0 }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error("Missing GROQ_API_KEY.");
    err.statusCode = 500;
    throw err;
  }

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      messages
    })
  });

  if (!resp.ok) {
    const body = await resp.text();
    const err = new Error(`Groq API error (${resp.status}): ${body}`);
    err.statusCode = 502;
    throw err;
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error("Groq API returned no content.");
    err.statusCode = 502;
    throw err;
  }
  return content;
}

module.exports = { groqChatCompletions };
