# 🌐 Chapter 06 — Stagehand AI Automation, Browser Tools & Streaming

> **Video Timestamp:** `02:48:11 - 03:33:11`  
> **Repository Commit Reference:** `5a6d3c6` (`feat: enhance browser session management with Browserbase SDK integration, add new tools for browser actions, and improve chat functionality with streaming responses`)  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)

---

## 🎯 What the Video Covers in this Chapter

In Chapter 05, we established the basic connection to Browserbase and rendered a static/single-call session preview. In **Chapter 06**, TubeGuruji elevates Cooper to a fully autonomous web browser operator using **Stagehand** (`@browserbasehq/stagehand`).

Specifically, this chapter builds:
1. **In-Memory Browser Session Store (`src/services/tools/browserSessionStore.ts`)**: Retains active browser and Stagehand instances across multiple tool invocations within a single task run.
2. **Stagehand Integration in Browserbase Provider (`src/lib/browserbase.ts`)**: Dynamic extension discovery, WebSocket polyfill, and Stagehand initialization with `gpt-4o`.
3. **The 5-Tool Browser Suite (`src/services/tools/BrowserbaseSession.ts`)**:
   - `create_browser_session`: Spins up cloud browser, resolves candidate URLs, and returns live preview URL.
   - `browser_navigate`: Navigates to target or fallback URLs.
   - `browser_action`: Executes natural language browser actions (`stagehand.act`) such as clicking buttons or filling inputs.
   - `browser_read`: Extracts page data and structured facts (`stagehand.extract`).
   - `close_browser`: Shuts down and releases the Browserbase session.
4. **Autonomous Browser Workflow Prompting (`src/lib/openAiAgent.ts` & `src/prompts/system/cooper.system.md`)**: Instructs Cooper on the multi-step observe-act-extract loop, recovery paths, and login handoffs.
5. **NDJSON Server-Sent Streaming (`src/app/api/chat+api.ts`)**: Upgrades the API from synchronous JSON to `ReadableStream` (`application/x-ndjson`), allowing the server to push the live browser preview immediately while the agent continues navigating in the background.
6. **Streaming Chat Client (`src/app/(tabs)/chat.tsx`)**: Consumes the NDJSON stream with `response.body.getReader()`, renders a placeholder `"Working..."` state, pops up the live browser preview in real time, and saves the final answer to Supabase.
7. **Preview Resiliency (`src/components/common/ChatBrowserPreview.tsx`)**: Adds `minWidth: 200` to prevent layout collapse during live streaming loading.

---

## 🔑 Required Environment Variables

Before running Chapter 06, make sure your `.env` contains the following keys:

| Variable | Description | Where to get it |
|---|---|---|
| `OPENAI_API_KEY` | Powers OpenAI Agent and Stagehand inference | [platform.openai.com](https://platform.openai.com) |
| `BROWSERBASE_API_KEY` | Authenticates with Browserbase cloud browsers | [browserbase.com](https://browserbase.com) |
| `BROWSERBASE_PROJECT_ID` | Your Browserbase project / workspace ID | [browserbase.com](https://browserbase.com) |
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase Project URL | [supabase.com](https://supabase.com) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Anonymous Public Key | [supabase.com](https://supabase.com) |

---

## 📦 Required Dependencies

Install Stagehand and WebSocket support for the server environment:

```bash
npm install @browserbasehq/stagehand ws
npm install -D @types/ws
```

> [!NOTE]
> `react-native-webview` was already installed in Chapter 05. The `ws` package is required because the Node / Expo serverless environment needs a compliant WebSocket client when communicating with Browserbase CDP sessions.

---

## 🛠️ Step-by-Step Implementation

### Step 1: In-Memory Browser Session Store (`src/services/tools/browserSessionStore.ts`)

Create a session registry to hold the live `StagehandBrowser` and `Stagehand` instances in memory while Cooper performs multiple tool actions in a single conversation turn.

Create [src/services/tools/browserSessionStore.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/services/tools/browserSessionStore.ts):

```typescript
import type {
    Stagehand,
    StagehandBrowser,
} from "@browserbasehq/stagehand";

export type StoredBrowserSession = {
    browser: StagehandBrowser;
    stagehand: Stagehand;
};

const browserSessions = new Map<string, StoredBrowserSession>();

export function saveBrowserSession(
    sessionId: string,
    session: StoredBrowserSession
) {
    browserSessions.set(
        sessionId,
        session
    );
}

export function getBrowserSession(
    sessionId: string
) {
    return browserSessions.get(sessionId);
}

export function deleteBrowserSession(
    sessionId: string
) {
    browserSessions.delete(sessionId);
}
```

---

### Step 2: Update Type Definitions (`src/types/index.ts`)

Update `src/types/index.ts` to export `BrowserSessionToolOutput` (including `status: 'ready'`, `currentUrl`, and `attemptedUrls`), plus a backwards compatibility alias:

```typescript
export type BrowserSessionToolOutput = {
  type: 'browser_session';
  status: 'ready';
  sessionId: string;
  reason: string;
  currentUrl: string;
  previewUrl?: string;
  attemptedUrls?: string[];
};

/**
 * Backwards compatibility alias for components built in Phase 05
 */
export type BrowserBaseSessionToolOutput = BrowserSessionToolOutput;
```

Also verify that `ChatMessage` in [src/types/index.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/types/index.ts) uses this type:

```typescript
export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
  browserPreview?: BrowserSessionToolOutput;
}
```

---

### Step 3: Upgrade Browserbase Provider with Stagehand (`src/lib/browserbase.ts`)

Update [src/lib/browserbase.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/lib/browserbase.ts) to include:
1. WebSocket polyfill for `globalThis.WebSocket`.
2. Dynamic path locator for the Stagehand Chrome extension directory and zip archive (`findStagehandPackagePath`).
3. The `createBrowser()` function which launches Browserbase with `keepAlive: false` and initializes `Stagehand.create(...)`.

```typescript
import Browserbase from "@browserbasehq/sdk";
import fs from "fs";
import path from "path";
import WebSocket from "ws";

if (!globalThis.WebSocket) {
    globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
}

export const GetBrowserbase = () => {
    const apiKey = process.env.BROWSERBASE_API_KEY;

    if (!apiKey) {
        throw new Error(
            "BROWSERBASE_API_KEY is missing"
        );
    }

    return new Browserbase({
        apiKey,
    });
};

export const createBrowser = async () => {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        throw new Error(
            "BROWSERBASE_API_KEY is missing"
        );
    }

    if (!projectId) {
        throw new Error(
            "BROWSERBASE_PROJECT_ID is missing"
        );
    }

    if (!openaiApiKey) {
        throw new Error(
            "OPENAI_API_KEY is missing"
        );
    }

    const stagehandPackagePath = findStagehandPackagePath();

    process.env.STAGEHAND_EXTENSION_ARCHIVE_PATH = path.join(
        stagehandPackagePath,
        "dist/assets/stagehand-extension.zip"
    );

    process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = path.join(
        stagehandPackagePath,
        "dist/extension"
    );

    const {
        browserbase,
        Stagehand,
    } = await import("@browserbasehq/stagehand");

    const browser = await browserbase.launch({
        apiKey,
        projectId,
        keepAlive: false,
    });

    const stagehand = await Stagehand.create({
        browser,
        model: {
            modelName: "openai/gpt-4o",
            apiKey: openaiApiKey,
        },
        selfHeal: true,
    });

    return {
        browser,
        stagehand,
    };
};

function findStagehandPackagePath() {
    let currentPath = process.cwd();

    while (true) {
        const packagePath = path.join(
            currentPath,
            "node_modules/@browserbasehq/stagehand"
        );

        if (fs.existsSync(packagePath)) {
            return packagePath;
        }

        const parentPath = path.dirname(currentPath);

        if (parentPath === currentPath) {
            throw new Error(
                "Could not find @browserbasehq/stagehand in node_modules."
            );
        }

        currentPath = parentPath;
    }
}
```

---

### Step 4: The 5-Tool Browser Suite (`src/services/tools/BrowserbaseSession.ts`)

Replace [src/services/tools/BrowserbaseSession.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/services/tools/BrowserbaseSession.ts) with the complete implementation containing all 5 tools and helper routines:

```typescript
import {
    createBrowser,
    GetBrowserbase,
} from "@/lib/browserbase";
import { tool } from "@openai/agents";
import { z } from "zod";

import {
    deleteBrowserSession,
    getBrowserSession,
    saveBrowserSession,
} from "./browserSessionStore";

const loginRequiredSchema = z.object({
    loginRequired: z.boolean(),
    message: z.string(),
});

const readResultSchema = z.object({
    result: z.string(),
});

export const createBrowserbaseSessionTool = tool({
    name: "create_browser_session",

    description: `
Create a live Browserbase cloud browser session and open the requested startUrl.

This tool only starts the browser and navigates to startUrl. It does not perform
the user's task. Use browser_action and browser_read for each later step.
After this tool returns, continue the workflow with browser_action/browser_read
unless the user only asked to open the page.
`,

    parameters: z.object({
        reason: z.string(),
        startUrl: z
            .string()
            .describe(
                "A complete URL to open directly, for example https://google.com"
            ),
        userRequest: z
            .string()
            .optional()
            .describe(
                "The full user task for context only. This tool must not execute it."
            ),
    }),

    execute: async ({
        reason,
        startUrl,
    }) => {
        const {
            browser,
            stagehand,
        } = await createBrowser();

        const page = await getActivePageOrCreate(browser);
        const navigation = await tryNavigateToAny(
            page,
            getStartUrlCandidates(startUrl)
        );

        const sessionId = browser.sessionId ?? "";

        if (!sessionId) {
            throw new Error("Browserbase did not return a session ID.");
        }

        saveBrowserSession(
            sessionId,
            {
                browser,
                stagehand,
            }
        );

        const previewUrl = await getPreviewUrl(sessionId);
        const currentUrl = await page.url();

        return {
            type: "browser_session",
            status: "ready",
            sessionId,
            previewUrl,
            currentUrl,
            attemptedUrls: navigation.attemptedUrls,
            reason,
        };
    },
});

export const browserNavigateTool = tool({
    name: "browser_navigate",

    description: `
Navigate the existing browser session to a new URL or alternate URL.
Use this when the first page, path, or extraction did not produce the requested
information. Try a direct URL, an alternate page, or a search URL before failing.
`,

    parameters: z.object({
        sessionId: z.string(),
        url: z
            .string()
            .describe("A complete URL to open, for example https://www.google.com/search?q=google+trends+trending+searches"),
        reason: z.string(),
    }),

    execute: async ({
        sessionId,
        url,
        reason,
    }) => {
        const session = getRequiredBrowserSession(sessionId);
        const page = await getActivePageOrCreate(session.browser);
        const navigation = await tryNavigateToAny(
            page,
            getStartUrlCandidates(url)
        );
        const previewUrl = await getPreviewUrl(sessionId);
        const currentUrl = await page.url();

        return {
            type: "browser_navigation_result",
            status: "completed",
            sessionId,
            previewUrl,
            currentUrl,
            attemptedUrls: navigation.attemptedUrls,
            reason,
        };
    },
});

export const browserActionTool = tool({
    name: "browser_action",

    description: `
Perform exactly one logical browser action in an existing Browserbase session.
The OpenAI agent must break complex browser tasks into multiple calls.
Use this to actually click, type, press keys, scroll, select options, and open
links. Do not combine multiple actions into one instruction.
`,

    parameters: z.object({
        sessionId: z.string(),
        instruction: z
            .string()
            .describe(
                'One browser action, such as "Click the Search field" or "Press Enter".'
            ),
    }),

    execute: async ({
        sessionId,
        instruction,
    }) => {
        const session = getRequiredBrowserSession(sessionId);

        await session.stagehand.act(instruction);

        const page = await getActivePageOrCreate(session.browser);
        const currentUrl = await page.url();
        const previewUrl = await getPreviewUrl(sessionId);
        const loginCheck = await checkLoginRequired(session.stagehand);

        if (loginCheck.loginRequired) {
            return {
                type: "browser_action_result",
                status: "login_required",
                sessionId,
                previewUrl,
                currentUrl,
                message: loginCheck.message,
            };
        }

        return {
            type: "browser_action_result",
            status: "completed",
            sessionId,
            previewUrl,
            currentUrl,
        };
    },
});

export const browserReadTool = tool({
    name: "browser_read",

    description: `
Read information from the current page of an existing Browserbase session.
Use this for search results, prices, names, ratings, and other page facts.
Use this before answering any task that depends on what is currently shown in
the live browser.
`,

    parameters: z.object({
        sessionId: z.string(),
        instruction: z
            .string()
            .describe(
                "What to read or extract from the current page."
            ),
    }),

    execute: async ({
        sessionId,
        instruction,
    }) => {
        const session = getRequiredBrowserSession(sessionId);

        const extraction = await session.stagehand.extract(
            instruction,
            readResultSchema as any
        );

        const page = await getActivePageOrCreate(session.browser);
        const currentUrl = await page.url();
        const result = (extraction.data as z.infer<typeof readResultSchema>).result;
        const hasUsefulResult = isUsefulReadResult(result);

        return {
            type: "browser_read_result",
            status: hasUsefulResult ? "completed" : "no_data",
            sessionId,
            currentUrl,
            result,
            message: hasUsefulResult
                ? undefined
                : "No useful data was extracted from the current page. Try another action, alternate URL, search result, or browser_navigate before answering.",
        };
    },
});

export const closeBrowserTool = tool({
    name: "close_browser",

    description: "Close a Browserbase browser session when the browser task is complete.",

    parameters: z.object({
        sessionId: z.string(),
    }),

    execute: async ({
        sessionId,
    }) => {
        await closeBrowserSession(sessionId);

        return {
            type: "close_browser_result",
            status: "completed",
            sessionId,
        };
    },
});

export async function closeBrowserSession(
    sessionId: string
) {
    const session = getBrowserSession(sessionId);

    try {
        if (session) {
            await Promise.allSettled([
                session.stagehand.close(),
                session.browser?.close(),
            ]);
        }

        await releaseBrowserbaseSession(sessionId);
    } finally {
        deleteBrowserSession(sessionId);
    }
}

async function releaseBrowserbaseSession(
    sessionId: string
) {
    await GetBrowserbase().sessions.update(
        sessionId,
        {
            status: "REQUEST_RELEASE",
            projectId: process.env.BROWSERBASE_PROJECT_ID,
        }
    );
}

export async function closeBrowserSessions(
    sessionIds: Iterable<string>
) {
    const results = await Promise.allSettled(
        Array.from(sessionIds).map(closeBrowserSession)
    );

    const failedClose = results.find(
        result => result.status === "rejected"
    );

    if (failedClose?.status === "rejected") {
        throw failedClose.reason;
    }
}

export async function checkLoginRequired(
    stagehand: ReturnType<typeof getRequiredBrowserSession>["stagehand"]
) {
    const extraction = await stagehand.extract(
        `Determine whether authentication is actually blocking progress on the current page.

Return loginRequired true only when login is required to continue, a credential
page blocks progress, or an authentication challenge blocks the workflow.
Do not return true merely because the page contains a Sign In, Log In, or Account button.`,
        loginRequiredSchema as any
    );

    return extraction.data as z.infer<typeof loginRequiredSchema>;
}

async function getActivePageOrCreate(
    browser: ReturnType<typeof getRequiredBrowserSession>["browser"]
) {
    return (
        (await browser.context.activePage()) ??
        (await browser.context.newPage())
    );
}

function getRequiredBrowserSession(
    sessionId: string
) {
    const session = getBrowserSession(sessionId);

    if (!session) {
        throw new Error(
            `Browser session not found: ${sessionId}`
        );
    }

    return session;
}

async function getPreviewUrl(
    sessionId: string
) {
    const debug = await GetBrowserbase().sessions.debug(sessionId);

    return (
        debug.debuggerFullscreenUrl ??
        debug.debuggerUrl
    );
}

async function tryNavigateToAny(
    page: Awaited<ReturnType<typeof getActivePageOrCreate>>,
    urls: string[]
) {
    const attemptedUrls: string[] = [];
    let lastError: unknown;

    for (const url of urls) {
        attemptedUrls.push(url);

        try {
            await page.goto(
                url,
                {
                    waitUntil: "domcontentloaded",
                }
            );

            return {
                attemptedUrls,
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error("Unable to navigate to any attempted URL.");
}

function getStartUrlCandidates(
    inputUrl: string
) {
    const normalizedInput = normalizeUrl(inputUrl);
    const candidates = [
        normalizedInput,
    ];

    try {
        const parsedUrl = new URL(normalizedInput);
        const host = parsedUrl.hostname;
        const withoutWwwHost = host.replace(/^www\./, "");
        const withWwwHost = host.startsWith("www.")
            ? host
            : `www.${host}`;

        candidates.push(
            new URL(
                `${parsedUrl.protocol}//${withWwwHost}${parsedUrl.pathname}${parsedUrl.search}`
            ).toString()
        );

        if (parsedUrl.pathname !== "/") {
            candidates.push(
                `${parsedUrl.protocol}//${host}/`
            );
            candidates.push(
                `${parsedUrl.protocol}//${withWwwHost}/`
            );
        }

        candidates.push(
            `https://www.google.com/search?q=${encodeURIComponent(withoutWwwHost)}`
        );
    } catch {
        candidates.push(
            `https://www.google.com/search?q=${encodeURIComponent(inputUrl)}`
        );
    }

    return Array.from(new Set(candidates));
}

function normalizeUrl(
    inputUrl: string
) {
    const trimmedUrl = inputUrl.trim();

    if (/^https?:\/\//i.test(trimmedUrl)) {
        return trimmedUrl;
    }

    return `https://${trimmedUrl}`;
}

function isUsefulReadResult(
    result: string
) {
    const normalizedResult = result.trim().toLowerCase();

    if (normalizedResult.length < 12) {
        return false;
    }

    return ![
        "no data",
        "not found",
        "unable to extract",
        "could not extract",
        "nothing found",
        "no useful",
        "i can't",
        "i cannot",
    ].some((failureText) => normalizedResult.includes(failureText));
}
```

---

### Step 5: Agent Configuration & Autonomous Browser Workflow Rules

In the video, TubeGuruji equips all 5 browser tools in `src/lib/openAiAgent.ts` and adds detailed rules for how Cooper autonomously drives the browser.

#### Option A: Direct Implementation in `src/lib/openAiAgent.ts` (Video Code)

```typescript
import {
    browserActionTool,
    browserNavigateTool,
    browserReadTool,
    closeBrowserTool,
    createBrowserbaseSessionTool,
} from "@/services/tools/BrowserbaseSession";
import { Agent } from "@openai/agents";

export const agent = new Agent({
    name: "AI Agent Cooper",
    instructions: `
You are Muse, an autonomous AI assistant.
Decide whether the user's request requires a live browser.
Use the browser only when the task requires:
visiting or interacting with a website
current website information
searching the web
opening a website for the user
checking shopping/product availability or prices
login
forms
booking or checkout
browser automation
For normal questions, writing, brainstorming, explanations, or provided content,
answer directly without creating a browser.

BROWSER WORKFLOW
When a browser is required:
1. Call create_browser_session once.
   For requests like "open Amazon", "go to amazon.com", "search Amazon for iPhone",
   or "find the current price", create a browser session. Do not answer with a
   manual link or say the browser tool is unavailable unless a tool call actually fails.
2. Inspect the page using browser_read.
3. Decide the next single action needed.
4. Perform that action using browser_action or browser_navigate.
5. Read the page again when needed.
6. Check whether the USER'S ORIGINAL GOAL is complete.
7. If the goal is NOT complete, continue using browser tools.
8. Repeat until the goal is complete.
9. Only then return the final answer.
10. Close the browser after the task is fully complete.

IMPORTANT:
Never stop just because a tool call succeeded.
Opening a website does NOT mean the task is complete.
Clicking a button does NOT mean the task is complete.
Navigating to a page does NOT mean the task is complete.
Continue until the user's requested result has actually been obtained.

RECOVERY:
If an action does not work:
- inspect the page again
- try another selector/action
- navigate to an alternate URL
- use search if necessary
- make multiple reasonable attempts before giving up
If browser_read returns no_data:
continue investigating instead of answering.

LOGIN:
If login is required:
- stop browser automation
- tell the user to log in using the live browser
- do not ask for passwords
- keep the browser session open

RULES:
- Create only ONE browser session per task.
- Use one logical action per browser_action.
- Do not create another session if one already exists.
- Do not answer from memory after starting a live browser task.
- Never expose session IDs, websocket URLs, debugger URLs, preview URLs, API keys, or internal browser details.
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

#### Option B: Clean Modular Architecture (`src/prompts/system/cooper.system.md`)

If you are using the modular Markdown prompt system introduced in Chapter 03, store the prompt in [src/prompts/system/cooper.system.md](file:///c:/Coding/agent-project/muse-ai-clone/src/prompts/system/cooper.system.md) and load it cleanly:

```typescript
import {
    browserActionTool,
    browserNavigateTool,
    browserReadTool,
    closeBrowserTool,
    createBrowserbaseSessionTool,
} from "@/services/tools/BrowserbaseSession";
import { getCooperSystemPrompt } from "@/prompts";
import { Agent } from "@openai/agents";

export const agent = new Agent({
    name: "AI Agent Cooper",
    instructions: getCooperSystemPrompt(),
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

### Step 6: Server-Sent Events / NDJSON Streaming (`src/app/api/chat+api.ts`)

Why stream? Multi-step browser automation can take 15–40 seconds. Without streaming:
- Mobile HTTP requests frequently time out.
- The user sees nothing until the whole script finishes.

With `ReadableStream` returning `application/x-ndjson`:
- The instant `create_browser_session` executes, the server sends `{ type: "browser", browser: output }`.
- The user's screen displays the live browser window immediately.
- The agent continues running `browser_action` and `browser_read` behind the scenes.
- Upon completion, `{ type: "final", output: "..." }` is sent.
- Active browser sessions are automatically safely closed in `finally` unless login was requested.

Update [src/app/api/chat+api.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/app/api/chat+api.ts):

```typescript
import { agent } from "@/lib/openAiAgent";
import { closeBrowserSessions } from "@/services/tools/BrowserbaseSession";
import { ChatMessage } from "@/types";
import { AgentInputItem, run } from "@openai/agents";

export async function POST(req: Request) {
    const { messages = [] } = await req.json();

    const input = mapMessages(messages);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: unknown) =>
                controller.enqueue(
                    encoder.encode(JSON.stringify(data) + "\n")
                );

            const browserSessionIds = new Set<string>();
            let loginRequired = false;

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
                        const output = parseOutput(
                            (event.item as any).output
                        );

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

                        if (
                            output?.type === "close_browser_result" &&
                            output.sessionId
                        ) {
                            browserSessionIds.delete(output.sessionId);
                        }

                        if (output?.status === "login_required") {
                            loginRequired = true;
                        }
                    }
                }

                // Await full completion of run
                await result.completed;

                send({
                    type: "final",
                    output: result.finalOutput ?? "",
                });

            } catch (error) {
                console.error(error);

                send({
                    type: "error",
                    message: getAgentErrorMessage(error),
                });

            } finally {
                if (
                    !loginRequired &&
                    browserSessionIds.size > 0
                ) {
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
    return messages.map(message =>
        message.sender === "agent"
            ? {
                role: "assistant",
                status: "completed",
                content: [{
                    type: "output_text",
                    text: message.text,
                }],
            }
            : {
                role: "user",
                content: message.text,
            }
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

function getAgentErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return `Agent failed: ${error.message}`;
    }

    return "Agent failed";
}
```

---

### Step 7: Stream Consumer & Real-Time Chat Updates (`src/app/(tabs)/chat.tsx`)

In [src/app/(tabs)/chat.tsx](file:///c:/Coding/agent-project/muse-ai-clone/src/app/(tabs)/chat.tsx):
1. Ensure your imports from `@/services/chatHistory` import `saveMessage` (or `SaveMessage`):
   ```typescript
   import { CreateNewThread, getThread, LoadMessages, saveMessage } from '@/services/chatHistory';
   ```
2. Replace `handleSend` with the streaming `fetch` implementation that consumes the NDJSON reader:

```typescript
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text) return;

    setIsSending(true);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    await saveMessage(
      userEmail ?? "",
      threadId ?? "",
      "user",
      text,
      {}
    );

    const agentMessageId = `msg-${Date.now() + 1}`;

    try {
      const ApiUrl = getApiUrl("/chat");

      const response = await fetch(ApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to connect to agent");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      // Add placeholder message immediately
      setMessages((prev) => [
        ...prev,
        {
          id: agentMessageId,
          sender: "agent",
          text: "Working...",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, {
          stream: true,
        });

        const lines = buffer.split("\n");

        // Keep unfinished line in buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const data = JSON.parse(line);

          // Browser created -> show preview immediately!
          if (data.type === "browser") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === agentMessageId
                  ? {
                    ...msg,
                    browserPreview: data.browser,
                  }
                  : msg
              )
            );
          }

          // Final agent response
          if (data.type === "final") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === agentMessageId
                  ? {
                    ...msg,
                    text:
                      data.output ??
                      "No Response from AI agent, Try Again",
                  }
                  : msg
              )
            );

            await saveMessage(
              userEmail ?? "",
              threadId ?? "",
              "assistant",
              data.output ??
              "No Response from AI agent, Try Again",
              {}
            );
          }

          if (data.type === "error") {
            throw new Error(data.message);
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage = error instanceof Error
        ? error.message
        : "Failed to send message";

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === agentMessageId
            ? {
              ...msg,
              text: errorMessage,
            }
            : msg
        )
      );

      showToast(errorMessage);
    } finally {
      setIsSending(false);
    }
  };
```

---

### Step 8: Minor Layout Adjustment in `ChatBrowserPreview.tsx`

In [src/components/common/ChatBrowserPreview.tsx](file:///c:/Coding/agent-project/muse-ai-clone/src/components/common/ChatBrowserPreview.tsx), add `minWidth: 200` to `browserPreviewFrame` to prevent layout collapse when the WebView is mounting during streaming:

```typescript
    browserPreviewFrame: {
        height: 220,
        backgroundColor: Colors.white,
        minWidth: 200,
    },
```

---

## 🛠️ Common Pitfalls & Troubleshooting

1. **`Cannot find module 'ws'` in server runtime:**
   - Make sure you ran `npm install ws` and `npm install -D @types/ws`. Node requires `ws` to establish WebSocket connections to Browserbase.
2. **`BROWSERBASE_PROJECT_ID is missing` or `OPENAI_API_KEY is missing`:**
   - Verify that your root `.env` has all three API keys populated and restart the Expo dev server with `npx expo start -c` to clear the cache.
3. **`Cannot find name 'saveMessage'`:**
   - In Phase 04, `chatHistory.ts` exported `SaveMessage` with capital `S`. Make sure `chatHistory.ts` exports both `SaveMessage` and `saveMessage = SaveMessage`.
4. **WebView blank or rendering issues on Web Browser:**
   - In the video, TubeGuruji tests on the **Android Emulator**. If testing in a web browser (`localhost:8081`), iframe security policies on external sites (like Amazon or Google) can block embedding. Testing on Android / iOS simulator provides the authentic native WebView experience.

---

## ✅ Chapter Verification Gate

1. **Start the local server:**
   ```bash
   npx expo start
   ```
2. **Execute a Multi-Step Browser Task:**
   - In chat, send:
     > *"Search Amazon for Sony WH-1000XM5 and tell me the price"*
3. **Verify the Real-Time Streaming Flow:**
   - [ ] A placeholder message with `"Working..."` appears instantly.
   - [ ] Within ~3–5 seconds, the `ChatBrowserPreview` WebView pops up directly in the chat bubble showing Amazon.
   - [ ] In the terminal logs, observe Stagehand performing actions (`act`, `extract`).
   - [ ] When the task is complete, the `"Working..."` text updates to Cooper's final answer containing the exact extracted prices.
   - [ ] The browser session closes automatically in the background (released in Browserbase).
   - [ ] Both the user prompt and Cooper's final answer are saved to Supabase `chat_messages`.

---

## 🚀 Next Milestone: Composio External Tools Integration (Chapter 06B)

Now that Cooper can autonomously browse and scrape web pages using Stagehand, the next natural capability is **authenticated third-party tool execution** (Gmail, Slack, Google Calendar, Notion, Instagram) via **Composio**!

👉 Proceed directly to [`06B_COMPOSIO_TOOLS_INTEGRATION.md`](./06B_COMPOSIO_TOOLS_INTEGRATION.md) for the complete database migrations, Settings UI, OAuth linking endpoints, and agent tool bindings.

