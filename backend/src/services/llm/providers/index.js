const { groqChatCompletions } = require("./groq");
const { geminiGenerateContent } = require("./gemini");

async function llmComplete({ messages, temperature }) {
  const provider = (process.env.LLM_PROVIDER || "groq").toLowerCase();
  try {
    if (provider === "gemini") {
      return await geminiGenerateContent({ messages, temperature });
    }
    return await groqChatCompletions({ messages, temperature });
  } catch (err) {
    // Optional fallback provider if configured.
    const fallback = (process.env.LLM_FALLBACK_PROVIDER || "").toLowerCase();
    if (fallback && fallback !== provider) {
      // eslint-disable-next-line no-console
      console.error(`[llm] provider=${provider} failed, falling back to ${fallback}:`, err?.message || err);
      if (fallback === "gemini") return geminiGenerateContent({ messages, temperature });
      if (fallback === "groq") return groqChatCompletions({ messages, temperature });
    }
    // eslint-disable-next-line no-console
    console.error(`[llm] provider=${provider} failed:`, err?.message || err);
    throw err;
  }
}

module.exports = { llmComplete };
