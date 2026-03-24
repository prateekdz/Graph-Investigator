const express = require("express");
const { search } = require("../services/searchService");
const { buildFlow } = require("../services/flowService");

function extractTokens(text) {
  const s = String(text || "");
  const tokens = [];
  for (const m of s.matchAll(/\b\d{6,12}\b/g)) tokens.push(m[0]);
  for (const m of s.matchAll(/\b[A-Z][A-Z0-9]{8,20}\b/g)) tokens.push(m[0]);
  return Array.from(new Set(tokens)).slice(0, 8);
}

function asClaudeMessages(messages) {
  // Expect: [{role:"user"|"assistant", content:"..."}]
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: m.content }));
}

async function callClaude({ apiKey, model, system, messages }) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system,
      messages
    })
  });

  if (!resp.ok) {
    const body = await resp.text();
    const err = new Error(`Claude API error (${resp.status}): ${body}`);
    err.statusCode = 502;
    throw err;
  }
  const data = await resp.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  const text = parts.map((p) => p.text || "").join("").trim();
  return text || "";
}

async function callGemini({ apiKey, model, system, messages }) {
  const prompt =
    `${system}\n\n` +
    messages
      .map((m) => `${String(m.role || "user").toUpperCase()}:\n${String(m.content || "")}`)
      .join("\n\n")
      .trim();

  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const raw = await resp.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!resp.ok) {
    const err = new Error(`Gemini API error (${resp.status}): ${raw}`);
    err.statusCode = 502;
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("")?.trim();
  return text || "";
}

function boldTokens(text, tokens) {
  let out = String(text || "");
  for (const t of tokens) {
    // Bold only if not already bolded
    out = out.replaceAll(t, `**${t}**`);
  }
  return out;
}

function wantsFlow(question) {
  const s = String(question || "").toLowerCase();
  if (s.includes("trace")) return true;
  if (s.includes("flow")) return true;
  if (s.includes("end-to-end")) return true;
  if (s.includes("timeline")) return true;
  return false;
}

function humanIdForNode(node) {
  const f = node?.fields || {};
  if (!node) return null;
  if (node.type === "Order") return f.salesOrder || null;
  if (node.type === "Invoice") return f.billingDocument || null;
  if (node.type === "Delivery") return f.deliveryDocument || null;
  if (node.type === "Customer") return f.businessPartner || f.customer || null;
  if (node.type === "JournalEntry") return f.accountingDocument || null;
  if (node.type === "Payment") return f.accountingDocument || null;
  return null;
}

function createChatRoutes({ graphStore, guardQuestion }) {
  const router = express.Router();

  // POST /api/chat
  router.post("/chat", async (req, res, next) => {
    try {
      const { messages } = req.body || {};
      const lastUser = Array.isArray(messages) ? [...messages].reverse().find((m) => m?.role === "user") : null;
      const question = lastUser?.content || "";

      // LLM should NOT invent answers. We use dataset-backed search, and only use LLM for intent extraction (inside search()) when needed.
      const result = await search({ q: question, graphStore, guardQuestion });

      if (result.rejected) {
        return res.json({ response: result.message, rejected: true, highlights: [] });
      }
      if (!result.found) {
        return res.json({
          response: result.message || "No matching record found in the dataset.",
          rejected: false,
          highlights: []
        });
      }

      // Return both a natural-language answer + structured data for UI card + graph highlighting.
      let response = result.answer;
      let flow = null;

      if (wantsFlow(question) && result?.mainNode?.id) {
        const built = buildFlow({ graphStore, rawId: result.mainNode.id });
        if (built?.found && built?.flow) {
          flow = built.flow;
          const hid = humanIdForNode(result.mainNode);
          const niceType = result.mainNode.type === "Invoice" ? "Invoice" : result.mainNode.type === "Order" ? "Order" : result.mainNode.type;
          response = `Here is the complete flow for ${niceType}${hid ? ` ${hid}` : ""}.`;
        }
      }

      return res.json({
        response,
        rejected: false,
        found: true,
        intent: result.intent,
        mainNode: result.mainNode,
        connections: result.connections,
        edges: result.edges,
        subgraph: result.subgraph,
        flow,
        highlights: [result.mainNode.id]
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createChatRoutes };
