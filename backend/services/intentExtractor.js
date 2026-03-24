const { llmComplete } = require("../src/services/llm/providers");
const { extractJsonObject } = require("../src/services/llm/json");

function normalizeEntity(entity) {
  const e = String(entity || "").trim().toLowerCase();
  if (!e) return null;
  if (e.includes("journal")) return "JournalEntry";
  if (e.includes("invoice") || e.includes("billing")) return "Invoice";
  if (e.includes("order")) return "Order";
  if (e.includes("delivery") || e.includes("shipment")) return "Delivery";
  if (e.includes("payment")) return "Payment";
  if (e.includes("customer") || e.includes("business partner")) return "Customer";
  if (e.includes("product") || e.includes("material")) return "Product";
  return null;
}

function extractIdCandidate(text) {
  const s = String(text || "");
  const num = s.match(/\b\d{6,12}\b/);
  if (num) return num[0];
  const alphaNum = s.match(/\b[A-Z][A-Z0-9]{8,20}\b/);
  if (alphaNum) return alphaNum[0];
  return null;
}

function heuristicIntent(q) {
  const s = String(q || "").toLowerCase();
  const id = extractIdCandidate(q);

  let entity = null;
  if (s.includes("journal")) entity = "JournalEntry";
  else if (s.includes("invoice") || s.includes("billing")) entity = "Invoice";
  else if (s.includes("sales order") || (s.includes("order") && !s.includes("purchase"))) entity = "Order";
  else if (s.includes("delivery") || s.includes("shipment")) entity = "Delivery";
  else if (s.includes("payment") || s.includes("clearing")) entity = "Payment";
  else if (s.includes("customer") || s.includes("business partner") || s.includes("sold-to")) entity = "Customer";
  else if (s.includes("product") || s.includes("material") || s.includes("sku")) entity = "Product";

  // If the user asked "journal entry for <billing>" but didn't say "journal",
  // we still allow entity=null and let resolution choose best match.
  const confidence = entity && id ? 0.9 : id ? 0.6 : 0.0;
  return { entity, id, confidence, source: "heuristic" };
}

function buildIntentPrompt(q) {
  return [
    {
      role: "system",
      content:
        "You are an intent extractor for an Order-to-Cash dataset.\n" +
        "Task: Extract ONLY (entity, id) from the user's query.\n" +
        "Rules:\n" +
        "- Output JSON only.\n" +
        '- JSON shape: {"entity":"JournalEntry|Invoice|Order|Delivery|Payment|Customer|Product","id":"<string>"}\n' +
        "- If you cannot find an id, return {\"entity\":null,\"id\":null}.\n" +
        "- Do NOT answer the question, do NOT add extra keys.\n"
    },
    { role: "user", content: `Query: ${q}` }
  ];
}

function hasProviderKey() {
  const provider = String(process.env.LLM_PROVIDER || "").toLowerCase();
  if (provider === "gemini") return Boolean(String(process.env.GEMINI_API_KEY || "").trim());
  if (provider === "groq") return Boolean(String(process.env.GROQ_API_KEY || "").trim());
  return false;
}

function intentLlmEnabled() {
  const flag = String(process.env.INTENT_LLM_ENABLED || "").toLowerCase().trim();
  if (["0", "false", "no"].includes(flag)) return false;
  return hasProviderKey();
}

async function llmIntent(q) {
  const messages = buildIntentPrompt(q);

  // Prefer the configured provider; Gemini format is handled inside providers layer.
  const raw = await llmComplete({ messages, temperature: 0 });
  const parsed = extractJsonObject(raw);
  const entity = normalizeEntity(parsed?.entity);
  const id = parsed?.id ? String(parsed.id).trim() : null;
  return { entity: entity || null, id: id || null, confidence: entity && id ? 0.85 : 0.3, source: "llm" };
}

async function extractIntent(q) {
  const h = heuristicIntent(q);
  if (h.confidence >= 0.85) return h;

  // If LLM isn't configured (or explicitly disabled), don't try intent extraction via LLM.
  if (!intentLlmEnabled()) return h;

  try {
    const i = await llmIntent(q);
    // If LLM couldn't find id, keep heuristic id if present.
    return { ...i, id: i.id || h.id || null };
  } catch (err) {
    const msg = err?.message || String(err);
    // Common provider failures (expired/invalid key) should fall back silently to heuristic intent.
    if (/API key expired|API_KEY_INVALID|invalid api key|unauthorized/i.test(msg)) return h;
    // eslint-disable-next-line no-console
    console.error("[intent] LLM intent extraction failed:", msg);
    return h;
  }
}

module.exports = { extractIntent, heuristicIntent, extractIdCandidate };
