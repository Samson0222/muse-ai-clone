import { agent } from "@/lib/openAiAgent";
import { closeBrowserSessions } from "@/services/tools/BrowserBaseSession";
import { ChatMessage } from "@/types";
import { AgentInputItem, run } from "@openai/agents";

export async function POST(req: Request) {
  const { messages = [] } = await req.json();

  const input = mapMessages(messages);
  const encoder = new TextEncoder();

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
