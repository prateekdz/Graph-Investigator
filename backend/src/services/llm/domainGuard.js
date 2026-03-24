const MAX_QUESTION_CHARS = 800;

// Domain vocabulary for SAP Order-to-Cash dataset.
const IN_DOMAIN_KEYWORDS = [
  "order",
  "sales order",
  "so",
  "salesorder",
  "orderline",
  "order line",
  "delivery",
  "shipment",
  "outbound delivery",
  "invoice",
  "billing",
  "billing document",
  "payment",
  "clearing",
  "accounts receivable",
  "ar",
  "journal entry",
  "business partner",
  "customer",
  "sold-to",
  "sold to",
  "product",
  "material",
  "plant",
  "storage location",
  "currency",
  "net amount",
  "schedule line"
];

// Common unrelated topics that should be rejected quickly.
const OUT_OF_DOMAIN_HINTS = [
  "prime minister",
  "pm of",
  "president of",
  "capital of",
  "who is pm",
  "who is the pm",
  "who is president",
  "weather",
  "stock price",
  "bitcoin",
  "movie",
  "actor",
  "song lyrics",
  "sports score",
  "ipl",
  "nba",
  "nfl",
  "election"
];

function normalize(text) {
  return String(text || "").trim();
}

function containsAny(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function extractIdLikeTokens(question) {
  // Heuristic: ids in this dataset are often numeric or alphanumeric material codes.
  // Examples: salesOrder=740506 (6 digits), deliveryDocument=80737721 (8 digits),
  // billingDocument=90504248 (8 digits), customer=320000083 (9 digits),
  // material=S8907367001003 (alnum, starts with letter).
  const tokens = [];
  const s = String(question || "");

  // Numeric tokens 6-10 digits
  const numRe = /\b\d{6,10}\b/g;
  const alphaNumRe = /\b[A-Z][A-Z0-9]{8,20}\b/g; // material-like

  for (const m of s.matchAll(numRe)) tokens.push(m[0]);
  for (const m of s.matchAll(alphaNumRe)) tokens.push(m[0]);

  return Array.from(new Set(tokens));
}

function validateQuestionShape(questionRaw) {
  const question = normalize(questionRaw);
  if (!question) {
    const err = new Error("Missing question.");
    err.statusCode = 400;
    throw err;
  }
  if (question.length > MAX_QUESTION_CHARS) {
    const err = new Error(`Question too long (max ${MAX_QUESTION_CHARS} chars).`);
    err.statusCode = 400;
    throw err;
  }
  return question;
}

function classifyDatasetQuestion(questionRaw) {
  const question = validateQuestionShape(questionRaw);

  // Hard reject obvious unrelated topics.
  if (containsAny(question, OUT_OF_DOMAIN_HINTS)) {
    return {
      allowed: false,
      reason: "Question appears unrelated to the Order-to-Cash dataset.",
      category: "out_of_domain"
    };
  }

  const hasDomainKeyword = containsAny(question, IN_DOMAIN_KEYWORDS);
  const idTokens = extractIdLikeTokens(question);
  const hasId = idTokens.length > 0;

  // If it contains a dataset-like identifier AND a retrieval intent, allow.
  const hasRetrievalIntent = containsAny(question, ["show", "list", "find", "get", "connections", "linked", "related"]);

  if (hasDomainKeyword) {
    return { allowed: true, reason: "Contains O2C/domain keywords.", category: "in_domain" };
  }

  if (hasId && hasRetrievalIntent) {
    return { allowed: true, reason: `Contains dataset-like id(s): ${idTokens.join(", ")}`, category: "in_domain" };
  }

  // Ambiguous: ask user to restate in domain terms instead of calling the LLM.
  return {
    allowed: false,
    reason: "Question is ambiguous or not clearly related to the dataset.",
    category: "ambiguous",
    clarification:
      "Ask about customers, orders, deliveries, invoices, payments, products, or provide an ID (e.g., customer 320000083, order 740506, invoice 90504248)."
  };
}

function buildFallbackResponse(guardResult) {
  if (guardResult.category === "out_of_domain") {
    return "I can only answer questions about the uploaded Order-to-Cash dataset (customers, orders, deliveries, invoices, payments, products, addresses). Please rephrase your question in those terms.";
  }
  return guardResult.clarification || "Please ask a question about the dataset (customers, orders, deliveries, invoices, payments, products, addresses).";
}

module.exports = { classifyDatasetQuestion, buildFallbackResponse };

