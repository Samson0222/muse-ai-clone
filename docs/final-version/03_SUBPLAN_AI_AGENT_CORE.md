# 🤖 Sub-Plan 02 — Conversational AI Agent Core & Streaming Chat

> **Document:** `docs/03_SUBPLAN_AI_AGENT_CORE.md`  
> **Parent Plan:** [`docs/00_MASTER_PLAN.md`](./00_MASTER_PLAN.md)  
> **Video Alignment:** Chapters `00:50:17 AI Agent Setup` and `01:14:33 Save Chat Conversation & Create New Chat`

---

## 🎯 Objective & Scope

Implement the core conversational intelligence engine for **Cooper**, our autonomous AI companion. This includes integrating the `@openai/agents` framework, building an Expo Router server API streaming route (`src/app/api/chat+api.ts`), connecting the mobile chat UI to stream real-time responses, and persisting conversation history across sessions in Supabase.

---

## 🧠 Agent Architecture & Prompt Engineering

### 1. Agent Definition (`src/lib/openAiAgent.ts`)
Create the core Cooper agent definition using `@openai/agents`:

```typescript
import { Agent } from "@openai/agents";
import {
  createBrowserbaseSessionTool,
  browserNavigateTool,
  browserActionTool,
  browserReadTool,
  closeBrowserTool
} from "@/services/tools/BrowserbaseSession";

export const cooperAgent = new Agent({
  name: "AI Agent Cooper",
  instructions: `
You are Cooper, an autonomous AI companion and proactive assistant for Muse AI.
You are capable, concise, helpful, and take action autonomously when requested.

CORE INTELLIGENCE & ROUTING:
1. Normal Conversational Queries:
   - Answer directly and helpfully with clear markdown.
   - For brainstorming, writing, summaries, or explanations, do NOT initiate browser tools.

2. Web Automation & Browser Tasks:
   - When a user asks you to check live prices, search the web, open a webpage, or interact with an online form, use the Browserbase browser tools.
   - Start with create_browser_session once.
   - Navigate and inspect the page using browser_read.
   - Execute single targeted actions using browser_action.
   - Always verify if the user's objective is completed before closing the browser.
   - Never expose raw session IDs, debugger URLs, or authentication keys to the user.

3. Tool Execution & Actions:
   - When external tool integrations (Gmail, Slack, Calendar, Notion) are connected, prefer taking real action over giving manual instructions.
   - Keep answers clear and friendly.
`,
  model: "gpt-4o",
  tools: [
    createBrowserbaseSessionTool,
    browserNavigateTool,
    browserActionTool,
    browserReadTool,
    closeBrowserTool,
  ],
});
```

---

## ⚡ Server-Side API Streaming Route (`src/app/api/chat+api.ts`)

Expo Router allows creating Node.js server routes with `+api.ts`. We use this to run the agent securely without exposing the `OPENAI_API_KEY` on the mobile client.

```typescript
import { run } from "@openai/agents";
import { cooperAgent } from "@/lib/openAiAgent";
import { parseScheduleIntentWithAgent } from "@/lib/scheduleIntentAgent";
import { validateUserFromRequest } from "@/lib/composioBackend";

export async function POST(req: Request) {
  let reqBody: any = {};
  try {
    reqBody = await req.json();
  } catch {
    reqBody = {};
  }

  const { messages = [], timezone = "UTC" } = reqBody;

  // Validate authenticated user
  let activeUserId: string | null = null;
  try {
    const userAuth = await validateUserFromRequest(req, reqBody.userId);
    activeUserId = userAuth.userId;
  } catch {
    activeUserId = reqBody.userId || null;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
      };

      try {
        const latestUserMessage = [...messages]
          .reverse()
          .find((m: any) => m?.sender === "user" && typeof m?.text === "string");

        // 1. Check for schedule / recurring task intent
        if (latestUserMessage) {
          const scheduleConfirmation = await parseScheduleIntentWithAgent({
            text: latestUserMessage.text,
            timezone,
          });

          if (scheduleConfirmation) {
            send({
              type: "schedule_confirmation",
              output: "Schedule this task?",
              scheduleConfirmation,
            });
            controller.close();
            return;
          }
        }

        // 2. Format input messages for @openai/agents
        const formattedInput = messages.map((m: any) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.text,
        }));

        // 3. Execute Cooper Agent with streaming
        const runner = await run(cooperAgent, formattedInput, {
          stream: true,
          maxTurns: 25,
        });

        for await (const event of runner) {
          if (event.type === "raw_model_stream_event") {
            const chunk = (event as any).data?.choices?.[0]?.delta?.content;
            if (chunk) {
              send({ type: "text", text: chunk });
            }
          } else if (
            event.type === "run_item_stream_event" &&
            event.name === "tool_output"
          ) {
            const output = (event.item as any).output;
            if (output?.type === "browser_session") {
              send({ type: "browser", browser: output });
            }
          }
        }

        await runner.completed;
        send({ type: "done", finalOutput: runner.finalOutput });
        controller.close();
      } catch (error: any) {
        send({ type: "error", error: error.message || "Execution error" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

---

## 📱 Mobile Chat Integration (`src/app/(tabs)/chat.tsx`)

Enhance the mobile chat client to consume the streaming API:

1. **Consume Stream:** Use `fetch()` with reader chunks to append incoming tokens directly to the current agent message bubble.
2. **Keyboard Handling:** Maintain `KeyboardAvoidingView` with dynamic `insets.top + 98` for iOS and auto-scroll on `keyboardDidShow`.
3. **Optimistic Updates:** Immediately render user message in peach bubble (`#E8C4B4`) with timestamp.
4. **Thread Storage:** Save messages into Supabase upon completion of each turn:
   ```typescript
   await SaveChatMessage(currentThreadId, 'user', userText);
   await SaveChatMessage(currentThreadId, 'agent', accumulatedAgentText);
   ```

---

## 🗂️ Side Chats & Thread Navigation (`SidebarDrawer.tsx`)

1. **Main Chat vs Side Chats:**
   - The primary chat is marked `type: 'main'`.
   - Ad-hoc task threads are created as `type: 'side'`.
2. **"New Chat" Action:**
   - Creates a new thread row in `chat_threads`.
   - Clears message viewport and focuses the input.
3. **Session Drawer:**
   - Lists past threads with title and unread badge.
   - Selecting a thread switches `currentThreadId` and loads historical messages from `chat_messages`.

---

## ✅ Acceptance Criteria & Testing Checklist

- [ ] Sending a general knowledge question ("What is quantum computing?") yields a fast streamed text response.
- [ ] Peach bubble renders on right side; gray bubble renders on left side.
- [ ] Keyboard input gracefully stays above keyboard without obscuring recent messages.
- [ ] Creating a new chat clears the screen and creates a record in `chat_threads`.
- [ ] Opening the slide-in drawer shows all previous conversations.
- [ ] Refreshing the screen preserves conversation history from Supabase.
