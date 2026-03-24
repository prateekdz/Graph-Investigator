function isDebug() {
  return process.env.LLM_DEBUG === "1" || process.env.GEMINI_DEBUG === "1";
}

function logDebug(...args) {
  // eslint-disable-next-line no-console
  if (isDebug()) console.log("[gemini]", ...args);
}

function buildPromptFromMessages(messages) {
  const parts = [];
  for (const m of messages || []) {
    if (!m || typeof m.content !== "string") continue;
    const role = String(m.role || "user").toUpperCase();
    parts.push(`${role}:\n${m.content}`);
  }
  return parts.join("\n\n").trim();
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return "";
  return parts.map((p) => p?.text || "").join("").trim();
}

function buildGeminiUrl({ apiKey, apiVersion, model }) {
  return `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function buildListModelsUrl({ apiKey, apiVersion }) {
  return `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${encodeURIComponent(apiKey)}`;
}

function looksLikeModelNotFound({ status, bodyText }) {
  if (status !== 404) return false;
  const s = String(bodyText || "");
  return s.includes("models/") && (s.includes("not found") || s.includes("NOT_FOUND") || s.includes("ListModels"));
}

function normalizeModelName(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  return s.startsWith("models/") ? s.slice("models/".length) : s;
}

let cachedModelList = null;
let cachedModelListAt = 0;

async function listModels({ apiKey, apiVersion }) {
  const now = Date.now();
  if (cachedModelList && now - cachedModelListAt < 5 * 60 * 1000) return cachedModelList;

  const url = buildListModelsUrl({ apiKey, apiVersion });
  logDebug("list_models_request", { url: url.replace(apiKey, "***"), apiVersion });

  const resp = await fetch(url, { method: "GET" });
  const rawText = await resp.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!resp.ok) {
    logDebug("list_models_error", { status: resp.status, apiVersion, body: data || rawText });
    return null;
  }

  const models = Array.isArray(data?.models) ? data.models : [];
  const normalized = models
    .map((m) => ({
      name: normalizeModelName(m?.name),
      supportedGenerationMethods: Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : []
    }))
    .filter((m) => m.name);

  cachedModelList = normalized;
  cachedModelListAt = now;
  logDebug("list_models_ok", { apiVersion, count: normalized.length });
  return normalized;
}

function pickModelFromList(models, preferred) {
  const pref = normalizeModelName(preferred);
  const list = Array.isArray(models) ? models : [];
  const supports = list.filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"));

  const has = (name) => supports.find((m) => m.name === name) || null;
  if (pref && has(pref)) return pref;

  const wantFlash = pref.includes("flash");
  const wantPro = pref.includes("pro");

  const firstBy = (predicate) => supports.find((m) => predicate(m?.name || ""))?.name || null;
  if (wantFlash) return firstBy((n) => n.includes("flash")) || firstBy((n) => n.includes("pro")) || supports[0]?.name || null;
  if (wantPro) return firstBy((n) => n.includes("pro")) || firstBy((n) => n.includes("flash")) || supports[0]?.name || null;
  return firstBy((n) => n.includes("flash")) || supports[0]?.name || null;
}

async function geminiGenerateContent({ messages, temperature = 0 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("Missing GEMINI_API_KEY.");
    err.statusCode = 500;
    throw err;
  }

  // Gemini models and supported methods vary by API version.
  // We try v1beta first, then v1 for compatibility across environments.
  const model = process.env.GEMINI_MODEL || "gemini-pro";

  const prompt = buildPromptFromMessages(messages);
  const body = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature
    }
  };

  const apiVersions = ["v1beta", "v1"];
  let lastError = null;

  for (const apiVersion of apiVersions) {
    const candidateModels = [];
    const preferred = normalizeModelName(model);
    if (preferred) candidateModels.push(preferred);
    // Common aliases to try if the configured model isn't available.
    if (preferred && !preferred.endsWith("-latest")) candidateModels.push(`${preferred}-latest`);
    if (preferred && preferred.includes("1.5") && preferred.includes("flash")) candidateModels.push("gemini-1.5-flash-latest");
    if (preferred && preferred.includes("1.5") && preferred.includes("pro")) candidateModels.push("gemini-1.5-pro-latest");

    const tryOnce = async (modelToTry) => {
      const url = buildGeminiUrl({ apiKey, apiVersion, model: modelToTry });
      logDebug("request", {
        url: url.replace(apiKey, "***"),
        model: modelToTry,
        apiVersion,
        temperature,
        promptChars: prompt.length
      });

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const rawText = await resp.text();
      let data;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }

      if (!resp.ok) {
        logDebug("error_response", { status: resp.status, apiVersion, model: modelToTry, body: data || rawText });
        const err = new Error(`Gemini API error (${resp.status}): ${rawText}`);
        err.statusCode = 502;
        err._geminiStatus = resp.status;
        err._geminiBody = rawText;
        throw err;
      }

      const content = extractGeminiText(data);
      if (!content) {
        logDebug("empty_response", { apiVersion, model: modelToTry, data });
        const err = new Error(`Gemini API returned empty response. Raw: ${rawText}`);
        err.statusCode = 502;
        throw err;
      }

      logDebug("response_ok", { apiVersion, model: modelToTry, chars: content.length });
      return content;
    };

    // 1) Try configured + common aliases.
    for (const m of candidateModels) {
      try {
        return await tryOnce(m);
      } catch (err) {
        lastError = err;
        if (looksLikeModelNotFound({ status: err?._geminiStatus || 0, bodyText: err?._geminiBody || err?.message })) {
          continue;
        }
        throw err;
      }
    }

    // 2) If model isn't found, call ListModels and pick a compatible one.
    try {
      const models = await listModels({ apiKey, apiVersion });
      const picked = pickModelFromList(models, preferred);
      if (picked && !candidateModels.includes(picked)) {
        return await tryOnce(picked);
      }
    } catch (err) {
      lastError = err;
      // Fall through to next API version.
    }
  }

  throw lastError || new Error("Gemini API failed.");
}

module.exports = { geminiGenerateContent, extractGeminiText, buildPromptFromMessages };
