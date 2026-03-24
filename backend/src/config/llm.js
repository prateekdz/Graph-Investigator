const { env } = require("./env");

function llmConfig() {
  return {
    provider: (process.env.LLM_PROVIDER || "groq").toLowerCase(),
    groq: {
      apiKey: process.env.GROQ_API_KEY || "",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash"
    },
    safety: { ...env.querySafety }
  };
}

module.exports = { llmConfig };

