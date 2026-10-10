/**
 * POST /api/chat-title
 *
 * Names a conversation from its first exchange: a short, precise title for the
 * sidebar (3-5 words, no quotes, no trailing period). The client falls back to
 * a locally derived title if this route is unavailable, so a failure here is
 * never fatal to the chat flow.
 */
import { Agent, run } from "@openai/agents";

const MAX_TITLE_LENGTH = 48;

const titleAgent = new Agent({
  name: "Chat titler",
  instructions: `
    You name chat conversations.
    Read the exchange and reply with a title of 3 to 5 words that states the
    specific topic, e.g. "iPhone 17 Pro pricing" or "Weekly standup summary".

    RULES
    Reply with the title only — no quotes, no punctuation at the end,
    no prefixes like "Chat about".
    Use the user's language.
    Capitalise it like a sentence.
    Never exceed 6 words.
  `,
  model: "gpt-6.1-sol",
});

/** Trims model noise: quotes, markdown, trailing punctuation, extra words. */
function cleanTitle(raw: string): string {
  const firstLine = (raw ?? "").split("\n").find((line) => line.trim()) ?? "";
  const stripped = firstLine
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*(title|chat)\s*[:\-]\s*/i, "")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return stripped.length > MAX_TITLE_LENGTH
    ? `${stripped.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : stripped;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userMessage = String(body?.userMessage ?? "").slice(0, 1500);
    const agentMessage = String(body?.agentMessage ?? "").slice(0, 1500);

    if (!userMessage.trim()) {
      return Response.json({ title: null }, { status: 400 });
    }

    const result = await run(
      titleAgent,
      `User: ${userMessage}\n\nAssistant: ${agentMessage}`,
      { maxTurns: 1 },
    );

    const title = cleanTitle(String(result.finalOutput ?? ""));
    return Response.json(
      { title: title || null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[chat-title] failed to generate title", error);
    return Response.json({ title: null }, { status: 200 });
  }
}
