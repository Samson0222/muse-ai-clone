# 🔌 Sub-Plan 04 — Third-Party Tool Integrations (Composio Platform)

> **Document:** `docs/05_SUBPLAN_COMPOSIO_TOOL_INTEGRATIONS.md`  
> **Parent Plan:** [`docs/00_MASTER_PLAN.md`](./00_MASTER_PLAN.md)  
> **Target Toolkits:** Gmail, Slack, Google Calendar, Notion, GitHub, Reddit

---

## 🎯 Objective & Scope

Allow Cooper to perform real actions across external productivity ecosystems on behalf of the authenticated user. Instead of building bespoke OAuth and REST client handlers for dozens of APIs, we integrate **Composio**'s Tool Router. Users connect their accounts via the Settings UI, and Cooper dynamically inherits the connected tools during conversation turns.

---

## 🏗️ Architecture & Integration Pattern

```mermaid
flowchart LR
    subgraph Client["Mobile App"]
        SettingsUI["Settings -> Connectors UI"]
        ManageModal["ManageToolModal"]
        ChatScreen["Chat Screen"]
    end

    subgraph API["Backend API Routes"]
        ConnectRoute["/api/tools/[toolId]/connect"]
        StatusRoute["/api/tools/[toolId]/status"]
        ChatRoute["/api/chat+api.ts"]
    end

    subgraph Cloud["External Services"]
        Composio["Composio Tool Router"]
        Supabase[(Supabase DB: user_tool_connections)]
        TargetApps["Gmail / Slack / Notion / GitHub"]
    end

    %% Connection Flow
    SettingsUI -->|Tap Connect| ManageModal
    ManageModal -->|POST| ConnectRoute
    ConnectRoute -->|initiate()| Composio
    Composio -->|OAuth Redirect URL| ManageModal
    ManageModal -->|Complete OAuth in WebBrowser| TargetApps
    ManageModal -->|Check Status| StatusRoute
    StatusRoute -->|Save Connected Account ID| Supabase

    %% Chat Agent Flow
    ChatScreen -->|User asks for action| ChatRoute
    ChatRoute -->|Query connected tools for user| Supabase
    ChatRoute -->|Inject Composio Tools into Agent| Composio
    Composio -->|Execute API on user's behalf| TargetApps
```

---

## 🛠️ Step-by-Step Implementation

### 1. Composio Backend Service (`src/lib/composioBackend.ts`)

Implements connection lifecycle handlers and Supabase synchronization:

```typescript
import { Composio } from '@composio/core';
import { createClient } from '@supabase/supabase-js';

export function getComposioClient(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error('COMPOSIO_API_KEY is not defined');
  return new Composio({ apiKey });
}

export function getSupabaseAdmin() {
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function initiateToolConnection(userId: string, toolkitSlug: string, userEmail?: string) {
  const composio = getComposioClient();
  const supabase = getSupabaseAdmin();

  // Initiate managed OAuth flow through Composio
  const connectionRequest = await composio.connectedAccounts.initiate({
    userUuid: userId,
    authScheme: 'OAUTH2',
    integrationId: toolkitSlug,
  });

  // Record pending connection in Supabase
  await supabase.from('user_tool_connections').upsert({
    user_id: userId,
    status: 'pending',
    composio_connection_request_id: connectionRequest.connectionId,
    connected_label: toolkitSlug,
    connected_email: userEmail,
  }, { onConflict: 'user_id,tool_id' });

  return {
    redirectUrl: connectionRequest.redirectUrl,
    connectionId: connectionRequest.connectionId,
  };
}
```

### 2. Expo Server Routes for Tool Management

Create the following API endpoints under `src/app/api/tools/[toolId]/`:

1. `connect+api.ts`: Receives user ID, calls `initiateToolConnection`, and returns the OAuth authorization URL.
2. `status+api.ts`: Polls Composio for connection authorization completion and transitions status from `pending` to `connected`.
3. `disconnect+api.ts`: Revokes the connected account in Composio and sets status to `not_connected` in Supabase.

### 3. Dynamic Tool Injection for Cooper Agent (`src/lib/composioAgent.ts`)

When executing `/api/chat+api.ts`, look up active connections for `userId` and create a user-scoped agent instance:

```typescript
import { Composio } from '@composio/core';
import { OpenAIAgentsProvider } from '@composio/openai-agents';
import { Agent } from '@openai/agents';
import { getSupabaseAdmin } from '@/lib/composioBackend';
import { cooperAgent } from '@/lib/openAiAgent';

export async function createCooperAgentForUser(userId: string) {
  const supabase = getSupabaseAdmin();

  // Fetch active connected tools for this user
  const { data: connections } = await supabase
    .from('user_tool_connections')
    .select('composio_connected_account_id, tools!inner(toolkit_slug)')
    .eq('user_id', userId)
    .eq('status', 'connected');

  if (!connections || connections.length === 0) {
    return cooperAgent; // Return base agent without external tools
  }

  const composio = new Composio({
    provider: new OpenAIAgentsProvider(),
    apiKey: process.env.COMPOSIO_API_KEY,
  });

  // Retrieve tool action schemas for the connected toolkits
  const toolkits = connections.map((c: any) => c.tools.toolkit_slug);
  const composioTools = await composio.getTools({
    toolkits,
    userUuid: userId,
  });

  // Clone agent with injected tools
  return new Agent({
    name: cooperAgent.name,
    instructions: cooperAgent.instructions,
    model: cooperAgent.model,
    tools: [...cooperAgent.tools, ...composioTools],
  });
}
```

### 4. Connectors UI in Mobile Settings (`src/app/tools.tsx` & `ManageToolModal.tsx`)

1. **Connectors List:** Display available integrations (Gmail, Slack, Notion, etc.) with their brand logos and current status pills (`Connected`, `Not Connected`).
2. **Connection Modal:**
   - Tap "Connect" triggers `initiateToolConnection`.
   - Opens authorization URL using `WebBrowser.openAuthSessionAsync`.
   - On return, displays success state and updates the toggle button.

---

## ✅ Acceptance Criteria & Testing Checklist

- [ ] Navigating to **Settings -> Connectors** renders available tools catalog loaded from Supabase.
- [ ] Tapping "Connect" on Slack or Gmail opens the OAuth consent flow in the web browser.
- [ ] Completing OAuth records the `composio_connected_account_id` in `user_tool_connections` with status `connected`.
- [ ] User sends chat prompt: "Summarize the last 3 emails I received in Gmail".
- [ ] Cooper queries the connected Gmail account and summarizes the emails accurately.
- [ ] An execution entry is logged in the `agent_tool_runs` table in Supabase.
- [ ] Tapping "Disconnect" revokes access and resets status to `not_connected`.
