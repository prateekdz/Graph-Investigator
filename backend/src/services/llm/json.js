function stripCodeFences(text) {
  return text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
}

function extractJsonObject(text) {
  const cleaned = stripCodeFences(String(text || "").trim());
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    const err = new Error("LLM did not return a JSON object.");
    err.statusCode = 502;
    throw err;
  }
  const candidate = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    const err = new Error("Failed to parse LLM JSON response.");
    err.statusCode = 502;
    throw err;
  }
}

module.exports = { extractJsonObject };

