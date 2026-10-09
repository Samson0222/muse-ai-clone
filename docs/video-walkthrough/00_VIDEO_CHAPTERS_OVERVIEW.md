# 🎥 Video Walkthrough Track — Chapter Timeline & Overview

> **YouTube Video:** [How to Build a Muse AI Agent Clone Mobile App – React Native Expo Full Stack Tutorial](https://www.youtube.com/watch?v=ZOFVRjbB_xk)  
> **Channel:** TubeGuruji  
> **Total Length:** 3 hours 58 minutes (14,292 seconds)  
> **Purpose of this Track:** Follow along with the video tutorial step-by-step without skipping ahead or introducing dependencies prematurely.

---

## ⏱️ Video Chapter Map & Associated Guides

| Video Timestamp | Chapter Name | Corresponding Walkthrough Guide | What Gets Built |
|---|---|---|---|
| **00:00:00** | Introduction & Demo | Overview | High-level demo of the completed app. |
| **00:06:18** | Project Setup | [`01_PROJECT_SETUP.md`](./01_PROJECT_SETUP.md) | Boilerplate, Expo Router tabs, HugeIcons, Android emulator. |
| **00:21:27** | Database & Authentication | [`02_DATABASE_AND_AUTH.md`](./02_DATABASE_AND_AUTH.md) | Supabase project, Google OAuth Client ID, `expo-web-browser` login. |
| **00:50:17** | **AI Agent Setup** *(Current)* | [`03_AI_AGENT_CORE_SETUP.md`](./03_AI_AGENT_CORE_SETUP.md) | Simple OpenAI agent, `.md` prompt file, basic `chat+api.ts` JSON endpoint, first chat turn. |
| **01:14:33** | Save Chat & Create New Chat | [`04_SAVE_CHAT_AND_SIDEBAR.md`](./04_SAVE_CHAT_AND_SIDEBAR.md) | `chat_threads` & `chat_messages` tables in Supabase, `chatHistory.ts`, `SidebarDrawer.tsx`. |
| **02:22:13** | Browserbase Setup | [`05_BROWSERBASE_SETUP.md`](./05_BROWSERBASE_SETUP.md) | Browserbase account, API keys, remote browser launch, live debugger/preview URLs. |
| **02:48:11** | Stagehand: Make Browserbase Act | [`06_STAGEHAND_AND_STREAMING.md`](./06_STAGEHAND_AND_STREAMING.md) | `@browserbasehq/stagehand`, browser tools attached to Cooper, SSE streaming, `ChatBrowserPreview` WebView. |
| **03:15:00** | Composio Tools Configuration | [`06B_COMPOSIO_TOOLS_INTEGRATION.md`](./06B_COMPOSIO_TOOLS_INTEGRATION.md) | `@composio/core`, Gmail/Slack/Calendar OAuth connection flow, Settings Tools screen, Connect CTA in chat. |
| **03:33:11** | Schedule Recurring Task | [`07_SCHEDULED_RECURRING_TASKS.md`](./07_SCHEDULED_RECURRING_TASKS.md) | Schedule intent parser, confirmation card, `scheduled_agent_tasks` table, Supabase Edge Function `agent-run`, `pg_cron`. |
| **03:54:09** | Wrap Up | [`08_WRAP_UP_AND_POLISH.md`](./08_WRAP_UP_AND_POLISH.md) | Security key cleanup, testing, production considerations. |

---

## 💡 How this Track Works

1. **Incremental Complexity:** Each chapter only builds what the video builds. You won't see Browserbase or Stagehand imports in Chapter 3, because they haven't been introduced yet.
2. **Easy Verification:** At the end of each guide, there is a specific test to confirm your code matches what is running on TubeGuruji's screen.
3. **Markdown Prompt Modernization:** In Chapter 3, we use a clean `src/prompts/system/cooper.system.md` file rather than hardcoding prompts in TypeScript strings, giving you clean prompt management while staying 100% faithful to the video's logic.
