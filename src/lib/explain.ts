import { allow, clientIp } from "./rate-limit.js";
import { cors, methodOf, readJsonBody, tooLarge, type HttpRequest, type HttpResponse } from "./http.js";
import { MAX_SUMMARY_CHARS, serializeSummary, validateSummary } from "./summary.js";

export type EnvMap = Record<string, string | undefined>;

export const EXPLAIN_LIMIT = 6;
export const EXPLAIN_WINDOW_MS = 60_000;
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export const SYSTEM = `You explain the result of a read-only "address poisoning" scan of an Ethereum address, in plain English, for a non-expert.
Address poisoning: an attacker creates an address with the same first and last characters as someone the victim pays, then plants it in the victim's history with zero-value transfers, tiny "dust" transfers, or fake tokens named USDT/USDC, hoping the victim later copies the wrong address.
Flags in the data: "lookalike" (shares start/end characters with a real counterparty or with the scanned address), "fake-token" (a token pretending to be USDT/USDC), "zero-value" (a 0 USDT/USDC transfer), "dust" (a tiny real transfer from an unknown address), "spoofed-outgoing" (appears sent by the scanned address but needs no signature), "sent-to-lookalike" (real funds were sent to a lookalike; the most serious case).
Rules:
- Use only the supplied data. Do not invent amounts, dates, names, or owners of addresses. When you name an address, show its first 8 and last 6 characters (0x96c407df…6bef98) so a lookalike and the address it copies are visibly different; never write them so they look identical.
- Explain what the attacker is trying to do and what the scanned address's owner should do: never copy addresses from transaction history, use a saved address book, check the full address, and ignore unknown tokens. If "sent-to-lookalike" appears, say clearly that funds may already be lost and the owner should stop using that address.
- Do not tell the reader to interact with, approve, swap, or sell any token. Do not give financial advice.
- Mention that the scan only covers the recent transfers listed (scanned count and dates).
- Be concise: 2–4 short paragraphs, no headings.`;

export function getGeminiApiKey(env: EnvMap = process.env): string | undefined {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return undefined;
  return key.trim();
}

export function getModelId(env: EnvMap = process.env): string {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}

export function prepareExplainPayload(
  input: unknown,
): { ok: true; serialized: string } | { ok: false; status: number; error: string } {
  const summary = validateSummary((input as { summary?: unknown } | null)?.summary);
  if (!summary) return { ok: false, status: 400, error: "A valid scan summary is required." };
  const serialized = serializeSummary(summary);
  if (serialized.length > MAX_SUMMARY_CHARS) {
    return { ok: false, status: 413, error: "The scan summary is too large to explain." };
  }
  return { ok: true, serialized };
}

export async function callGemini(
  serialized: string,
  model: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Explain this scan result:\n${serialized}` }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.2 },
    }),
  });
  if (!response.ok) throw new Error("The explanation service is unavailable right now.");
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The explanation service returned an empty response.");
  return text;
}

export async function handleExplainHttp(
  req: HttpRequest,
  res: HttpResponse,
  deps: { env?: EnvMap; generate?: typeof callGemini; now?: number } = {},
): Promise<void> {
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
