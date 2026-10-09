# 🌐 Chapter 05 — Browserbase Cloud Browser Setup & Live Preview

> **Video Timestamp:** `02:22:13 - 02:48:11`  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)

---

## 🎯 What the Video Covers in this Chapter

In this chapter, TubeGuruji equips Cooper with his **first autonomous web tool**:
1. **Why Cloud Browsers?** Explains that mobile apps cannot run Playwright/Chromium directly on devices due to OS sandboxing and resource constraints.
2. **Browserbase Dashboard:** Registers on [browserbase.com](https://www.browserbase.com), creates a project, and retrieves `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`.
3. **Packages Installation:** Installs `@browserbasehq/sdk`, `react-native-webview`, and `zod`.
4. **Browserbase Client Provider (`src/lib/browserbase.ts`):** Initializes the Browserbase SDK client.
5. **Browser Session Tool (`src/services/tools/BrowserbaseSession.ts`):** Creates the `@openai/agents` tool `create_browser_session` that launches a remote cloud browser session and fetches the interactive live debugger URL.
6. **Agent Instruction & Tool Binding (`src/lib/openAiAgent.ts`):** Injects `createBrowserbaseSessionTool` into Cooper and updates the system prompt to guide when a browser is required (e.g. visiting websites, live search) vs. when not to use one.
7. **API Route Tool Handling (`src/app/api/chat+api.ts`):** Inspects `result.newItems` for tool execution output and returns `{ output, browser: browserbaseSession }`.
8. **In-App Live Browser View (`src/components/common/ChatBrowserPreview.tsx`):** Renders the cloud browser stream in the chat bubble using `react-native-webview`, with an "Open Browser" button.
9. **Chat UI Integration (`src/app/(tabs)/chat.tsx`):** Captures `data.browser` on agent responses and renders `ChatBrowserPreview` inside the agent's bubble.

---

## 📦 Step 1: Install Required Packages

Install the Browserbase SDK, WebView component, and Zod schema validator:

```bash
npx expo install react-native-webview
npm install @browserbasehq/sdk zod
```

Add your credentials to `.env`:

```env
BROWSERBASE_API_KEY=bb_...
BROWSERBASE_PROJECT_ID=...
```

---

## 📝 Step 2: Update TypeScript Types (`src/types/index.ts`)

Add the browser session tool output contract and update `ChatMessage`:

```typescript
export type BrowserSessionToolOutput = {
  type: 'browser_session';
  sessionId: string;
  reason: string;
  startUrl?: string;
  previewUrl?: string;
};

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
  browserPreview?: BrowserSessionToolOutput; // 🌟 Added
}
```

---

## 🎨 Step 3: Update Color Tokens (`src/constants/colors.ts`)

Add the browser preview background color to `Colors`:

```typescript
export const Colors = {
  // ... existing colors
  browserPreviewBg: '#FFFFFF',
};
```

---

## 🔌 Step 4: Browserbase Client (`src/lib/browserbase.ts`)

Create `src/lib/browserbase.ts`:

```typescript
import Browserbase from '@browserbasehq/sdk';

export const GetBrowserbase = () => {
  const apiKey = process.env.BROWSERBASE_API_KEY;

  if (!apiKey) {
    throw new Error('BROWSERBASE_API_KEY is missing from environment');
  }

  return new Browserbase({
    apiKey,
  });
};
```

---

## 🛠️ Step 5: Create Browser Session Tool (`src/services/tools/BrowserbaseSession.ts`)

Create `src/services/tools/BrowserbaseSession.ts`:

```typescript
import { GetBrowserbase } from "@/lib/browserbase";
import { BrowserSessionToolOutput } from "@/types";
import { tool } from "@openai/agents";
import z from "zod";

export const createBrowserbaseSessionTool = tool({
  name: 'create_browser_session',
  description: `
Create a Browserbase cloud browser session.

Use this tool when the user's request requires:
- opening a website
- interacting with a website
- browsing current web content
- logging into a website
- filling forms
- booking
- checkout
- browser automation
- web research
`,
  parameters: z.object({
    reason: z
      .string()
      .describe("Why a browser session is required."),
    startUrl: z
      .string()
      .optional()
      .describe("Optional website the user wants to visit."),
  }),
  execute: async ({ reason, startUrl }) => {
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    const browserbase = GetBrowserbase();

    // 1. Create a remote cloud browser session
    const session = await browserbase.sessions.create({
      projectId,
      keepAlive: true,
    });

    console.log("Launched Browserbase Session:", session.id, "startUrl:", startUrl);

    // 2. Retrieve live interactive debugger URL
    const debugUrl = await browserbase.sessions.debug(session.id);
    const previewUrl = debugUrl.debuggerFullscreenUrl ?? debugUrl.debuggerUrl;

    return {
      type: 'browser_session',
      sessionId: session.id,
      reason,
      startUrl,
      previewUrl,
    } satisfies BrowserSessionToolOutput;
  },
});
```

---

## 🧠 Step 6: Update Cooper's Instructions & Tools (`src/lib/openAiAgent.ts`)

Update `src/lib/openAiAgent.ts` (or your Markdown prompt `src/prompts/system/cooper.system.md`) to attach `createBrowserbaseSessionTool`:

```typescript
import { createBrowserbaseSessionTool } from "@/services/tools/BrowserbaseSession";
import { Agent } from "@openai/agents";

export const agent = new Agent({
  name: "AI Agent Cooper",
  instructions: `
You are Muse, an autonomous AI assistant and companion.
Decide whether the user's task requires a live browser.

Use create_browser_session when:
- the user asks to open a website
- the user asks to browse a website
- the task requires interaction with a webpage
- the task requires current information from a website
- the task requires login or form filling
- the task requires booking, checkout, or browser automation

Do NOT create a browser when:
- answering normal questions
- brainstorming or writing content
- explaining something or summarizing provided information
- the task does not require accessing an external website

Only create ONE browser session for the current task.
After successfully creating the browser session say:
"The browser is ready."

Never expose:
- Browserbase session IDs
- WebSocket URLs
- debugger URLs or preview URLs
- API keys or internal connection details
`,
  model: "gpt-4o",
  tools: [createBrowserbaseSessionTool],
});
```

---

## ⚡ Step 7: Update `/api/chat` Route (`src/app/api/chat+api.ts`)

Update `src/app/api/chat+api.ts` to inspect `result.newItems` for tool execution output and return the browser session payload:

```typescript
import { agent } from "@/lib/openAiAgent";
import { ChatMessage } from "@/types";
import { AgentInputItem, run } from "@openai/agents";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];

    const mappedMessages = mapAgentInput(messages);
    const result = await run(agent, mappedMessages);

    // Check if the agent called create_browser_session tool
    let browserbaseSession = null;
    for (const item of (result?.newItems || [])) {
      if (item.type === 'tool_call_output_item') {
        const output = (item as any).output;
        if (output?.type === 'browser_session') {
          browserbaseSession = output;
        }
      }
    }

    return Response.json({
      output: result.finalOutput ?? '',
      browser: browserbaseSession,
    });
  } catch (error: any) {
    console.error("Error in /api/chat:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function mapAgentInput(messages: ChatMessage[]): AgentInputItem[] {
  return messages.map((message: ChatMessage) => {
    if (message.sender === 'agent') {
      return {
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: message.text,
          },
        ],
      };
    }
    return {
      role: 'user',
      content: message.text,
    };
  });
}
```

---

## 🖥️ Step 8: Create `ChatBrowserPreview` Component (`src/components/common/ChatBrowserPreview.tsx`)

Create `src/components/common/ChatBrowserPreview.tsx`:

```tsx
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';

import { Colors } from '@/constants/colors';
import { BrowserSessionToolOutput } from '@/types';

type ChatBrowserPreviewProps = {
  browserPreview: BrowserSessionToolOutput;
};

export function ChatBrowserPreview({ browserPreview }: ChatBrowserPreviewProps) {
  if (!browserPreview?.previewUrl) return null;

  return (
    <View style={styles.browserPreview}>
      {/* Embedded Live Cloud Browser View */}
      <WebView
        source={{ uri: browserPreview.previewUrl }}
        style={styles.browserPreviewFrame}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.browserPreviewLoading}>
            <ActivityIndicator color={Colors.iconDark} />
          </View>
        )}
      />

      {/* Button to open full interactive session in system browser */}
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.openBrowserButton}
        onPress={() => WebBrowser.openBrowserAsync(browserPreview.previewUrl ?? '')}>
        <Text style={styles.openBrowserButtonText}>Open Browser</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  browserPreview: {
    marginTop: 12,
    backgroundColor: Colors.browserPreviewBg,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    overflow: 'hidden',
  },
  browserPreviewFrame: {
    height: 220,
    backgroundColor: Colors.white,
  },
  browserPreviewLoading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  openBrowserButton: {
    marginHorizontal: 12,
    marginBottom: 12,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconDark,
  },
  openBrowserButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },
});
```

Also export it from `src/components/common/index.ts`:

```typescript
export * from './ChatBrowserPreview';
```

---

## 📱 Step 9: Render Browser Preview in Chat (`src/app/(tabs)/chat.tsx`)

In `src/app/(tabs)/chat.tsx`:

1. **Import `ChatBrowserPreview`:**
   ```typescript
   import { ChatBrowserPreview } from '@/components/common/ChatBrowserPreview';
   ```

2. **Capture `data.browser` when agent responds:**
   ```typescript
   const agentMsg: ChatMessage = {
     id: `msg-${Date.now() + 1}`,
     sender: 'agent',
     text: data?.output ?? 'The browser is ready.',
     timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
     browserPreview: data?.browser ?? undefined, // 🌟 Save preview object
   };
   ```

3. **Render inside agent message bubble:**
   Inside `messages.map`:
   ```tsx
   <View style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble]}>
     <Text style={[styles.bubbleText, isUser ? styles.userBubbleText : styles.agentBubbleText]}>
       {msg.text}
     </Text>

     {/* 🌟 Render Live Browser Preview if session exists */}
     {!isUser && msg.browserPreview ? (
       <ChatBrowserPreview browserPreview={msg.browserPreview} />
     ) : null}
   </View>
   ```

---

## ✅ Chapter Verification Gate

Follow these steps to verify your code against TubeGuruji's screen:

1. **Start the app:** Run `npx expo start` (on web, iOS, or Android).
2. **Normal Query (No browser):**
   - Ask: *"What is 2 + 2?"*
   - Cooper replies *"4"* directly. No browser session is launched.
3. **Web Query (Browser trigger):**
   - Ask: *"Open amazon.com"* or *"Browse to espn.com"*.
   - Check the terminal:
     ```
     Launched Browserbase Session: <session-id> startUrl: https://amazon.com
     ```
   - Cooper responds with *"The browser is ready."*
   - Right below Cooper's text, an embedded **WebView** loads showing the live cloud browser session!
   - Tapping **"Open Browser"** opens the full interactive session in the browser.
   - In the [Browserbase Sessions Dashboard](https://browserbase.com/sessions), the session appears active.
