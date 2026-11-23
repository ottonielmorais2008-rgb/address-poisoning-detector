// src/lib/rate-limit.ts
var hits = /* @__PURE__ */ new Map();
function allow(key, limit = 20, windowMs = 6e4, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5e3) hits.clear();
  return true;
}
function clientIp(headers, fallback = "unknown") {
  const forwarded = headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value && value.trim()) return value.split(",")[0].trim();
  const real = headers["x-real-ip"];
  const realValue = Array.isArray(real) ? real[0] : real;
  if (realValue && realValue.trim()) return realValue.trim();
  return fallback;
}

// src/lib/http.ts
var MAX_BODY_BYTES = 16384;
function methodOf(req) {
  return (req.method ?? "GET").toUpperCase();
}
function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
function tooLarge(req, max = MAX_BODY_BYTES) {
  const length = header(req, "content-length");
  if (length && Number(length) > max) return true;
  if (typeof req.body === "string" && byteLength(req.body) > max) return true;
  return false;
}
function readJsonBody(req) {
  if (req.body == null || req.body === "") {
    return { ok: false, error: "Invalid JSON body." };
  }
  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch {
      return { ok: false, error: "Invalid JSON body." };
    }
  }
  return { ok: true, value: req.body };
}
function cors(res) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
}

// src/lib/address.ts
var ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function isAddress(value) {
  return ADDRESS_RE.test(value.trim());
}

// src/lib/summary.ts
var MAX_SUMMARY_CHARS = 8e3;
var MAX_SUMMARY_FINDINGS = 8;
var SEVERITIES = /* @__PURE__ */ new Set(["critical", "high", "medium", "low", "none"]);
var FLAGS = /* @__PURE__ */ new Set(["fake-token", "zero-value", "dust", "spoofed-outgoing", "lookalike", "sent-to-lookalike"]);
function validateSummary(value) {
  if (!value || typeof value !== "object") return null;
  const v = value;
  if (typeof v.address !== "string" || !isAddress(v.address)) return null;
  if (typeof v.risk !== "string" || !SEVERITIES.has(v.risk)) return null;
  if (!Number.isFinite(v.transfersScanned) || v.transfersScanned < 0) return null;
  if (!Array.isArray(v.findings) || v.findings.length > MAX_SUMMARY_FINDINGS) return null;
  for (const f of v.findings) {
    if (!f || typeof f !== "object") return null;
    if (typeof f.address !== "string" || !isAddress(f.address)) return null;
    if (typeof f.severity !== "string" || !SEVERITIES.has(f.severity)) return null;
    if (f.imitates !== void 0 && (typeof f.imitates !== "string" || !isAddress(f.imitates))) return null;
    if (!Array.isArray(f.reasons) || f.reasons.some((r) => !r || !FLAGS.has(r.flag) || !Number.isFinite(r.count))) {
      return null;
    }
  }
  return v;
}
function serializeSummary(summary) {
  return JSON.stringify(summary);
}

// src/lib/explain.ts
var EXPLAIN_LIMIT = 6;
var EXPLAIN_WINDOW_MS = 6e4;
var DEFAULT_MODEL = "gemini-3.5-flash-lite";
var SYSTEM = `You explain the result of a read-only "address poisoning" scan of an Ethereum address, in plain English, for a non-expert.
Address poisoning: an attacker creates an address with the same first and last characters as someone the victim pays, then plants it in the victim's history with zero-value transfers, tiny "dust" transfers, or fake tokens named USDT/USDC, hoping the victim later copies the wrong address.
Flags in the data: "lookalike" (shares start/end characters with a real counterparty or with the scanned address), "fake-token" (a token pretending to be USDT/USDC), "zero-value" (a 0 USDT/USDC transfer), "dust" (a tiny real transfer from an unknown address), "spoofed-outgoing" (appears sent by the scanned address but needs no signature), "sent-to-lookalike" (real funds were sent to a lookalike; the most serious case).
Rules:
- Use only the supplied data. Do not invent amounts, dates, names, or owners of addresses. Refer to addresses in shortened form (0x1234\u2026abcd).
- Explain what the attacker is trying to do and what the scanned address's owner should do: never copy addresses from transaction history, use a saved address book, check the full address, and ignore unknown tokens. If "sent-to-lookalike" appears, say clearly that funds may already be lost and the owner should stop using that address.
- Do not tell the reader to interact with, approve, swap, or sell any token. Do not give financial advice.
- Mention that the scan only covers the recent transfers listed (scanned count and dates).
- Be concise: 2\u20134 short paragraphs, no headings.`;
function getGeminiApiKey(env = process.env) {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return void 0;
  return key.trim();
}
function getModelId(env = process.env) {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}
function prepareExplainPayload(input) {
  const summary = validateSummary(input?.summary);
  if (!summary) return { ok: false, status: 400, error: "A valid scan summary is required." };
  const serialized = serializeSummary(summary);
  if (serialized.length > MAX_SUMMARY_CHARS) {
    return { ok: false, status: 413, error: "The scan summary is too large to explain." };
  }
  return { ok: true, serialized };
}
async function callGemini(serialized, model, apiKey, fetchFn = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Explain this scan result:
${serialized}` }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.2 }
    })
  });
  if (!response.ok) throw new Error("The explanation service is unavailable right now.");
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The explanation service returned an empty response.");
  return text;
}
async function handleExplainHttp(req, res, deps = {}) {
  cors(res);
  if (methodOf(req) === "OPTIONS") {
    res.status(204).json(null);
    return;
  }
  if (methodOf(req) !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (tooLarge(req, MAX_SUMMARY_CHARS + 2048)) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  const env = deps.env ?? process.env;
  const ip = clientIp(req.headers ?? {}, req.socket?.remoteAddress ?? "unknown");
  if (!allow(`explain:${ip}`, EXPLAIN_LIMIT, EXPLAIN_WINDOW_MS, deps.now ?? Date.now())) {
    res.status(429).json({ error: "Too many explanation requests. Please wait a minute and try again." });
    return;
  }
  const key = getGeminiApiKey(env);
  if (!key) {
    res.status(503).json({ error: "The optional AI explanation is not configured on this deployment." });
    return;
  }
  const body = readJsonBody(req);
  if (!body.ok) {
    res.status(400).json({ error: body.error });
    return;
  }
  const prepared = prepareExplainPayload(body.value);
  if (!prepared.ok) {
    res.status(prepared.status).json({ error: prepared.error });
    return;
  }
  try {
    const generate = deps.generate ?? callGemini;
    const model = getModelId(env);
    const text = await generate(prepared.serialized, model, key);
    res.status(200).json({ explanation: text, model });
  } catch {
    res.status(502).json({ error: "The explanation could not be generated. Please try again in a moment." });
  }
}

// server/explain.ts
var maxDuration = 30;
async function handler(req, res) {
  await handleExplainHttp(req, res);
}
export {
  handler as default,
  maxDuration
};
