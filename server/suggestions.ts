import type { QuickResponse, Ticket, TicketMessage } from "@shared/schema";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","can","could","did","do","does","doing","done","for","from","get","got","had","has","have","he","her","hers","him","his","how","i","if","in","into","is","it","its","just","me","my","no","not","now","of","on","or","our","out","over","please","so","some","than","that","the","their","them","then","there","these","they","this","those","to","too","up","us","was","we","were","what","when","where","which","who","why","will","with","you","your","yours","am","im","ive","ill","weve","were","youre","theyre","dont","cant","wont","didnt","doesnt","isnt","wasnt","arent","hi","hello","hey","thanks","thank","ok","okay","yes","no",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function suggestQuickResponses(
  ticket: Pick<Ticket, "subject" | "description">,
  lastCustomerMessage: string | null,
  allQuickResponses: QuickResponse[],
  limit = 3,
): QuickResponse[] {
  const haystack = [
    ticket.subject || "",
    ticket.description || "",
    lastCustomerMessage || "",
  ].join(" ");
  const tokens = new Set(tokenize(haystack));
  if (tokens.size === 0 || allQuickResponses.length === 0) return [];

  const scored = allQuickResponses.map((qr) => {
    const titleTokens = new Set(tokenize(qr.title));
    const bodyTokens = new Set(tokenize(qr.message));
    let score = 0;
    titleTokens.forEach((t) => { if (tokens.has(t)) score += 3; });
    bodyTokens.forEach((t) => { if (tokens.has(t)) score += 1; });
    return { qr, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.qr);
}

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
const aiDraftCalls = new Map<string, number[]>();

export function checkAiDraftRateLimit(adminId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (aiDraftCalls.get(adminId) || []).filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT_MAX) {
    const resetAt = recent[0] + RATE_LIMIT_WINDOW_MS;
    aiDraftCalls.set(adminId, recent);
    return { allowed: false, remaining: 0, resetAt };
  }
  recent.push(now);
  aiDraftCalls.set(adminId, recent);
  return { allowed: true, remaining: RATE_LIMIT_MAX - recent.length, resetAt: now + RATE_LIMIT_WINDOW_MS };
}

export function isAiDraftEnabled(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
}

export function buildAiPrompt(args: {
  ticket: Pick<Ticket, "subject" | "description">;
  customerName: string;
  recentMessages: { role: "customer" | "admin"; sender: string; message: string }[];
  hints: QuickResponse[];
}): { system: string; user: string } {
  const { ticket, customerName, recentMessages, hints } = args;
  const system = [
    "You are a helpful, concise customer support agent.",
    "Draft a single reply to the customer. Keep it warm, professional, and under 120 words.",
    "Do not invent facts (no fake order numbers, dates, links, or specifics).",
    "Address the customer by their first name if provided. Sign off with a friendly closing.",
    "Output only the reply text — no preamble, no quotes, no markdown headings.",
  ].join(" ");

  const transcript = recentMessages
    .map((m) => `${m.role === "admin" ? "Agent" : "Customer"} (${m.sender}): ${m.message}`)
    .join("\n");

  const hintsBlock = hints.length
    ? "Relevant canned responses you may adapt or paraphrase:\n" +
      hints.map((h, i) => `${i + 1}. ${h.title}: ${h.message}`).join("\n")
    : "No matching canned responses; write the reply from scratch.";

  const user = [
    `Ticket subject: ${ticket.subject}`,
    `Customer: ${customerName}`,
    "",
    "Conversation (most recent last):",
    transcript || "(no messages yet — reply to the ticket subject/description)",
    ticket.description ? `\nTicket description: ${ticket.description}` : "",
    "",
    hintsBlock,
    "",
    "Draft the next reply from the agent.",
  ].join("\n");

  return { system, user };
}
