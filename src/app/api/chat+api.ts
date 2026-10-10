/**
 * POST /api/chat
 *
 * Streams the agent run as NDJSON. Event types consumed by the chat screen:
 * - `browser` : a live Browserbase session preview
 * - `connect` : a required tool is not connected yet (Connect CTA)
 * - `confirm` : a write action is waiting for user confirmation
 * - `schedule`: a recurring task is waiting for user confirmation
 * - `final`   : the agent's answer
 * - `error`   : the run failed
 *
 * The Authorization bearer token is optional: without it the agent still runs
 * with browser tools only, which keeps the screen working for signed-out dev.
 */
import {
  buildCapabilityTools,
  getConnectedTools,
  loadToolsBySlugs,
  type ConnectedTool,
} from "@/lib/agentTools";
import { detectRequiredToolkits, type DetectedToolkit } from "@/lib/agentToolkits";
import { buildAgent } from "@/lib/openAiAgent";
import { safeTimezone } from "@/lib/scheduleRules";
import { buildScheduleTool } from "@/lib/scheduledTasks";
import { tryAuthenticate } from "@/lib/toolConnections";
import { closeBrowserSessions } from "@/services/tools/BrowserBaseSession";
import { ChatMessage } from "@/types";
import { AgentInputItem, run } from "@openai/agents";

export async function POST(req: Request) {
  const { messages = [], timezone: clientTimezone } = await req.json();
  const timezone = safeTimezone(clientTimezone);

  const input = mapMessages(messages);
  const encoder = new TextEncoder();
  const auth = await tryAuthenticate(req);

  // 1. Connected tools context for this user.
  let connectedTools: ConnectedTool[] = [];
  if (auth) {
    try {
      connectedTools = await getConnectedTools(auth.db, auth.user.id);
    } catch (error) {
      console.error("[chat] failed to load connected tools", error);
    }
  }

  // 2 + 3. Detect a required tool and ask for a connection when it is missing.
  const lastUserText = lastUserMessage(messages);
  const missing = auth
    ? detectRequiredToolkits(lastUserText).filter(
        (required) =>
          !connectedTools.some((tool) => tool.toolkit_slug === required.toolkit),
      )
    : [];

  if (auth && missing.length > 0) {
    const payload = await buildConnectPayload(auth.db, missing);
    if (payload.tools.length > 0) {
      return ndjson(encoder, [
        { type: "connect", connect: payload },
        { type: "final", output: payload.message },
      ]);
    }
  }

  const capabilityTools = auth
    ? buildCapabilityTools({
        db: auth.db,
        userId: auth.user.id,
        connectedTools,
      })
    : [];

  // Scheduling needs a signed-in user: the confirmed task belongs to them.
  const scheduleTools = auth
    ? [buildScheduleTool({ timezone, originalPrompt: lastUserText })]
    : [];

  const agent = buildAgent({
    connectedTools,
    capabilityTools,
    scheduleTools,
    timezone,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      const browserSessionIds = new Set<string>();
      let keepBrowserSessionsOpen = false;

      try {
        const result = await run(agent, input, {
          stream: true,
          maxTurns: 30,
        });

        for await (const event of result) {
          if (
            event.type === "run_item_stream_event" &&
            event.name === "tool_output"
          ) {
            const output = parseOutput((event.item as any).output);

            if (
              output?.type === "browser_session" &&
              typeof output.sessionId === "string"
            ) {
              browserSessionIds.add(output.sessionId);

              send({
                type: "browser",
                browser: output,
              });
            }

            if (output?.type === "close_browser_result" && output.sessionId) {
              browserSessionIds.delete(output.sessionId);
            }

            // 5. A write action stopped to ask the user first.
            if (output?.type === "confirmation_required") {
              send({
                type: "confirm",
                confirm: {
                  capability: output.capability,
                  toolSlug: output.toolSlug,
                  toolName: output.toolName,
                  toolkitSlug: output.toolkitSlug,
                  logoUrl: output.logoUrl ?? null,
                  logoKey: output.logoKey ?? null,
                  actionSummary: output.actionSummary,
                  details: output.details,
                  input: output.input,
                },
              });
            }

            // A recurring task is waiting for the user to confirm it.
            if (output?.type === "schedule_confirmation_required") {
              send({ type: "schedule", schedule: output.schedule });
            }

            if (output?.status === "login_required") {
              keepBrowserSessionsOpen = true;
            }
          }
        }

        // Streamed results are settled once iteration finishes.
        // completed can also be awaited explicitly.
        await result.completed;

        send({
          type: "final",
          output: result.finalOutput ?? "",
        });
      } catch (error) {
        console.error(error);

        send({
          type: "error",
          message: "Agent failed",
        });
      } finally {
        if (!keepBrowserSessionsOpen && browserSessionIds.size > 0) {
          try {
            await closeBrowserSessions(browserSessionIds);
          } catch (closeError) {
            console.error(closeError);
          }
        }

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}

/** Replies with a fixed list of NDJSON events (no agent run needed). */
function ndjson(encoder: TextEncoder, events: unknown[]) {
  const body = events.map((event) => JSON.stringify(event) + "\n").join("");
  return new Response(encoder.encode(body), {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}

/** Builds the Connect CTA payload plus the chat text that introduces it. */
async function buildConnectPayload(db: any, missing: DetectedToolkit[]) {
  const rows = await loadToolsBySlugs(
    db,
    missing.map((item) => item.slug),
  );

  const tools = missing
    .map((item) => {
      const row = rows.find(
        (candidate) =>
          candidate.slug === item.slug || candidate.toolkit_slug === item.toolkit,
      );
      if (!row) return null;
      return {
        tool_id: row.id,
        slug: row.slug,
        name: row.name,
        logo_url: row.logo_url,
        logo_key: row.logo_key,
      };
    })
    .filter(Boolean) as {
    tool_id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    logo_key: string | null;
  }[];

  const names = tools.map((tool) => tool.name);
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : (names[0] ?? "");

  return {
    tools,
    message: list
      ? `I need access to ${list} before I can do that. Tap Connect below to link your account, then send your message again.`
      : "",
  };
}

function lastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.sender === "user") return messages[i].text ?? "";
  }
  return "";
}

function mapMessages(messages: ChatMessage[]): AgentInputItem[] {
  return messages.map((message) =>
    message.sender === "agent"
      ? {
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: message.text,
            },
          ],
        }
      : {
          role: "user",
          content: message.text,
        },
  ) as AgentInputItem[];
}

function parseOutput(output: unknown) {
  if (typeof output !== "string") return output;

  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}
