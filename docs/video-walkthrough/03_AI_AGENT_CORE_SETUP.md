# 🤖 Chapter 03 — AI Agent Core Setup (Current Phase)

> **Video Timestamp:** `00:50:17 - 01:14:33`  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)  
> **Status:** 🎯 Current Phase

---

## 🎯 What the Video Covers in this Chapter

1. Installing the OpenAI Agents SDK: `@openai/agents`.
2. Configuring `OPENAI_API_KEY` in your environment.
3. Defining the initial lightweight Cooper agent instance.
4. Setting up the Expo Router API route: `src/app/api/chat+api.ts`.
5. Sending the first chat message from the mobile UI and receiving Cooper's response.

> [!IMPORTANT]
> **No Browserbase or Streaming yet!**  
> In this chapter of the video, the author builds a simple, working, non-streaming conversational agent. This allows you to verify that OpenAI and your API route are working without worrying about browser automation or Server-Sent Events (which come in Chapter 06).

---

## 📁 Project Structure for this Chapter

```
src/
├── prompts/
│   ├── system/
│   │   └── cooper.system.md       # 🌟 Markdown prompt for Cooper
│   ├── loader.ts                  # Safe prompt loader with file system read & caching
│   └── index.ts                   # Export helper
├── lib/
│   └── openAiAgent.ts             # Cooper Agent definition using @openai/agents
└── app/
    ├── api/
    │   └── chat+api.ts            # Server-side POST endpoint
    └── (tabs)/
        └── chat.tsx               # Mobile chat UI sending turns to /api/chat
```

---

## 🛠️ Step-by-Step Implementation

### Step 1: Install Dependencies
```bash
npm install @openai/agents
```

Ensure your `.env` contains:
```env
OPENAI_API_KEY=sk-proj-...
```

---

### Step 2: Create the Markdown System Prompt

Create `src/prompts/system/cooper.system.md`:

```markdown
# Cooper — Autonomous AI Companion

You are Cooper, a warm, proactive, and concise AI companion inside Muse AI.
Help the user think through goals, recurring tasks, automations, and next steps.
Keep your replies practical, encouraging, and brief.
Format your responses using clear Markdown where appropriate.
```

---

### Step 3: Create the Safe Prompt Loader

Create `src/prompts/loader.ts`:

```typescript
import fs from 'fs';
import path from 'path';

const promptCache = new Map<string, string>();

/**
 * Loads a markdown prompt file from src/prompts/
 * Note: Only call this from server-side code (API routes / server modules).
 */
export function loadPrompt(relativePath: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  let content = promptCache.get(relativePath);
  if (!content || isDev) {
    const fullPath = path.join(process.cwd(), 'src', 'prompts', relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Prompt file not found at: ${fullPath}`);
    }
    content = fs.readFileSync(fullPath, 'utf-8');
    promptCache.set(relativePath, content);
  }

  return content;
}
```

Create `src/prompts/index.ts`:

```typescript
import { loadPrompt } from './loader';

export function getCooperSystemPrompt(): string {
  return loadPrompt('system/cooper.system.md');
}
```

---

### Step 4: Create the Cooper Agent (`src/lib/openAiAgent.ts`)

Create `src/lib/openAiAgent.ts`:

```typescript
import { Agent } from "@openai/agents";
import { getCooperSystemPrompt } from "@/prompts";

export const agent = new Agent({
  name: "AI Agent Cooper",
  instructions: getCooperSystemPrompt(),
  model: "gpt-4o",
});
```

---

### Step 5: Create the Chat Server Route (`src/app/api/chat+api.ts`)

In Expo Router, files ending in `+api.ts` execute as Node.js server endpoints:

```typescript
import { agent } from "@/lib/openAiAgent";
import { ChatMessage } from "@/types";
import { AgentInputItem, run } from "@openai/agents";

type ChatReqBody = {
  messages?: ChatMessage[];
};

export async function POST(req: Request) {
  try {
    const body: ChatReqBody = await req.json();
    const messages = body.messages || [];

    // Map client ChatMessage objects to @openai/agents input items
    const mappedMessages = mapAgentInput(messages);

    // Execute agent turn
    const result = await run(agent, mappedMessages);

    return Response.json({
      output: result.finalOutput ?? "",
    });
  } catch (error: any) {
    console.error("Error in /api/chat:", error);
    return Response.json(
      { error: error.message || "Failed to run agent" },
      { status: 500 }
    );
  }
}

function mapAgentInput(messages: ChatMessage[]): AgentInputItem[] {
  return messages.map((message: ChatMessage) => {
    if (message.sender === "agent") {
      return {
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: message.text,
          },
        ],
      };
    }
    return {
      role: "user",
      content: message.text,
    };
  });
}
```

---

### Step 6: Connect Mobile Chat (`src/app/(tabs)/chat.tsx`)

In `src/app/(tabs)/chat.tsx`, update `handleSend` to call `/api/chat`:

```typescript
const handleSend = async () => {
  const text = inputText.trim();
  if (!text) return;

  const userMsg: ChatMessage = {
    id: Date.now().toString(),
    sender: 'user',
    text,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  const updatedMessages = [...messages, userMsg];
  setMessages(updatedMessages);
  setInputText('');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: updatedMessages }),
    });

    const data = await response.json();

    if (data.output) {
      const agentMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'agent',
        text: data.output,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, agentMsg]);
    }
  } catch (err) {
    console.error("Chat turn error:", err);
  }
};
```

---

## ✅ Chapter Verification Gate

- Start the Expo development server: `npm run start` or `npx expo start --web`.
- In the Chat tab, type *"Hello Cooper, who are you?"* and press Send.
- The user peach bubble displays the text immediately.
- Within 1–2 seconds, Cooper responds in a soft gray bubble matching the persona defined in `cooper.system.md`.
- Editing `src/prompts/system/cooper.system.md` immediately changes Cooper's personality on subsequent turns.
