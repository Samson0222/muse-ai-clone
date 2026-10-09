# 🔌 Chapter 06B — Composio External Tools Integration (Gmail, Slack, Calendar)

> **Repository Commit Reference:** `46b451fd` (`Refactor OpenAI agent configuration and update Supabase integration`)  
> **Source Guide Reference:** [`COMPOSIO_TOOLS_SETUP.md`](../../COMPOSIO_TOOLS_SETUP.md)  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)  
> **Preceding Phase:** [`06_STAGEHAND_AND_STREAMING.md`](./06_STAGEHAND_AND_STREAMING.md)

---

## 🎯 What this Phase Accomplishes

In Chapter 06, Cooper learned how to navigate and scrape arbitrary web pages with **Stagehand** and **Browserbase**. However, performing authenticated user operations — such as reading private inbox emails, sending Slack channel messages, or creating Google Calendar events — requires **OAuth authorization** and official service APIs.

**Composio** (`@composio/core` & `@composio/openai-agents`) provides this bridge. In this phase, TubeGuruji equips Cooper with:
1. **Supabase Schema for Tool Connections**:
   - `tools`: Catalog of available integrations (Gmail, Slack, Google Calendar, Notion, Instagram, Reddit, GitHub).
   - `user_tool_connections`: Per-user OAuth connection statuses (`not_connected`, `pending`, `connected`, `failed`, `revoked`).
   - `agent_tool_runs`: Audit log of agent tool invocations.
2. **Settings UI for Tools Management**:
   - A dedicated **"Tools & Connections"** screen (`src/app/tools.tsx`) under Settings (`src/app/(tabs)/settings.tsx`).
   - Interactive cards (`ToolCard.tsx`) and a management modal (`ManageToolModal.tsx`) supporting 1-tap OAuth connection via Expo `WebBrowser`.
3. **Backend Composio OAuth Endpoints**:
   - `POST /api/tools/[toolId]/connect`: Initiates Composio OAuth flow and returns the connect link.
   - `GET /api/tools/[toolId]/status`: Polls connection progress and syncs with Supabase.
   - `POST /api/tools/[toolId]/disconnect`: Revokes tokens and updates user state.
4. **Dynamic Agent Tool Binding (`src/lib/composioAgent.ts`)**:
   - Cooper dynamically queries the user's active tool connections.
   - If an account is connected, Cooper executes the real action (e.g. `GMAIL_SEND_EMAIL` or `SLACK_POST_MESSAGE`).
   - If an account is NOT connected, Cooper prompts the user with an in-chat **Connect CTA** button.

---

## 🔑 Environment Variables Setup

Ensure your `.env` contains the Composio API key alongside your existing keys:

```env
COMPOSIO_API_KEY="your_composio_api_key_here"
```

> [!TIP]
> You can obtain a free API key at [composio.dev](https://composio.dev). Composio provides built-in OAuth apps for Gmail, Slack, and Google Calendar so you don't have to register your own Google Cloud Console or Slack Developer credentials during development!

---

## 📦 Required Dependencies

Install the Composio core and OpenAI Agents integration packages:

```bash
npm install @composio/core @composio/openai-agents
```

---

## 🛠️ Step-by-Step Implementation

### Step 1: Run Supabase Database Migration

Execute the migration script in your **Supabase Dashboard $\rightarrow$ SQL Editor**. The file is located at [supabase/migrations/20261002_composio_tools.sql](file:///c:/Coding/agent-project/muse-ai-clone/supabase/migrations/20261002_composio_tools.sql).

```sql
-- 1. Helper function for handling updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create tools table
CREATE TABLE IF NOT EXISTS public.tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    toolkit_slug TEXT NOT NULL,
    description TEXT,
    category TEXT,
    logo_url TEXT,
    logo_key TEXT,
    actions JSONB DEFAULT '[]'::jsonb,
    composio_auth_config_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create user_tool_connections table
CREATE TABLE IF NOT EXISTS public.user_tool_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tool_id UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected', 'pending', 'connected', 'failed', 'revoked')),
    composio_connected_account_id TEXT,
    composio_connection_request_id TEXT,
    connected_label TEXT,
    connected_email TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    last_checked_at TIMESTAMPTZ,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_tool_connections_user_tool_unique UNIQUE (user_id, tool_id)
);

-- 4. Create agent_tool_runs audit log
CREATE TABLE IF NOT EXISTS public.agent_tool_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tool_id UUID REFERENCES public.tools(id) ON DELETE SET NULL,
    action_name TEXT NOT NULL,
    input_summary TEXT,
    output_summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS and Policies
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tool_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to active tools" ON public.tools
    FOR SELECT USING (is_active = true);

CREATE POLICY "Allow users to read their own connections" ON public.user_tool_connections
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow users to insert/update their own connections" ON public.user_tool_connections
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Allow users to read their own tool runs" ON public.agent_tool_runs
    FOR SELECT USING (auth.uid() = user_id);

-- Seed Initial Integrations
INSERT INTO public.tools (name, slug, toolkit_slug, description, category, logo_url, logo_key, actions, is_active, sort_order)
VALUES
('Gmail', 'gmail', 'gmail', 'Send and receive emails, manage drafts, and search messages via Gmail.', 'Email & Communication', 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg', 'gmail', '[{"name": "GMAIL_SEND_EMAIL", "description": "Send email"}, {"name": "GMAIL_LIST_MAILS", "description": "List emails"}]'::jsonb, true, 1),
('Slack', 'slack', 'slack', 'Send messages, read channels, and manage Slack workspace activity.', 'Team Collaboration', 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Slack_icon_2019.svg', 'slack', '[{"name": "SLACK_POST_MESSAGE", "description": "Post message"}, {"name": "SLACK_LIST_CHANNELS", "description": "List channels"}]'::jsonb, true, 2),
('Google Calendar', 'googlecalendar', 'googlecalendar', 'Schedule events, check availability, and manage calendar entries.', 'Productivity & Scheduling', 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg', 'googlecalendar', '[{"name": "GOOGLECALENDAR_CREATE_EVENT", "description": "Create event"}, {"name": "GOOGLECALENDAR_LIST_EVENTS", "description": "List events"}]'::jsonb, true, 3),
('Notion', 'notion', 'notion', 'Create pages, manage databases, and search docs in Notion.', 'Productivity & Workspace', 'https://upload.wikimedia.org/wikipedia/commons/e/e9/Notion-logo.svg', 'notion', '[{"name": "NOTION_CREATE_PAGE", "description": "Create page"}, {"name": "NOTION_SEARCH", "description": "Search workspace"}]'::jsonb, true, 4)
ON CONFLICT (slug) DO NOTHING;
```

---

### Step 2: Define Tool Data Types (`src/types/tools.ts`)

Create [src/types/tools.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/types/tools.ts):

```typescript
export type ToolConnectionStatus =
  | 'not_connected'
  | 'pending'
  | 'connected'
  | 'failed'
  | 'revoked';

export interface ToolAction {
  name: string;
  description: string;
}

export interface Tool {
  id: string;
  name: string;
  slug: string;
  toolkit_slug: string;
  description: string | null;
  category: string | null;
  logo_url: string | null;
  icon_url?: string | null;
  logo_key: string | null;
  actions: ToolAction[] | any;
  composio_auth_config_id?: string | null;
  is_active?: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface UserToolConnection {
  id: string;
  user_id: string;
  tool_id: string;
  status: ToolConnectionStatus;
  composio_connected_account_id: string | null;
  composio_connection_request_id: string | null;
  connected_label: string | null;
  connected_email: string | null;
  metadata: Record<string, any>;
  last_checked_at: string | null;
  connected_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ToolWithConnection extends Tool {
  connection_status: ToolConnectionStatus;
  connected_account_id?: string | null;
  connection_request_id?: string | null;
  connected_label?: string | null;
  connected_email?: string | null;
  user_connection_id?: string | null;
}

export interface StartConnectionResponse {
  success: boolean;
  connect_url?: string;
  connection_id?: string;
  status: ToolConnectionStatus;
  message?: string;
}

export interface CheckStatusResponse {
  success: boolean;
  status: ToolConnectionStatus;
  connected_label?: string | null;
  connected_email?: string | null;
  message?: string;
}

export interface DisconnectResponse {
  success: boolean;
  status: ToolConnectionStatus;
  message?: string;
}
```

---

### Step 3: Service Layer for Tools (`src/services/tools.ts`)

Create [src/services/tools.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/services/tools.ts):

```typescript
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import {
  Tool,
  ToolWithConnection,
  UserToolConnection,
  StartConnectionResponse,
  CheckStatusResponse,
  DisconnectResponse,
} from '@/types/tools';

export const fetchToolsFromSupabase = async (): Promise<Tool[]> => {
  const { data, error } = await supabase
    .from('tools')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data as Tool[]) || [];
};

export const getUserToolConnections = async (
  userId: string
): Promise<UserToolConnection[]> => {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_tool_connections')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  return (data as UserToolConnection[]) || [];
};

export const fetchToolsWithUserConnection = async (
  userId?: string
): Promise<ToolWithConnection[]> => {
  const tools = await fetchToolsFromSupabase();
  if (!userId) {
    return tools.map((t) => ({ ...t, connection_status: 'not_connected' }));
  }

  const connections = await getUserToolConnections(userId);
  const connMap = new Map<string, UserToolConnection>();
  connections.forEach((c) => connMap.set(c.tool_id, c));

  return tools.map((tool) => {
    const conn = connMap.get(tool.id);
    return {
      ...tool,
      connection_status: conn ? conn.status : 'not_connected',
      connected_account_id: conn?.composio_connected_account_id ?? null,
      connection_request_id: conn?.composio_connection_request_id ?? null,
      connected_label: conn?.connected_label ?? null,
      connected_email: conn?.connected_email ?? null,
      user_connection_id: conn?.id ?? null,
    };
  });
};

function getApiBaseUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    return `http://${ip}:8081`;
  }
  if (Platform.OS === 'android') return 'http://10.0.2.2:8081';
  return 'http://localhost:8081';
}

export const startToolConnectionApi = async (
  toolId: string,
  userId: string
): Promise<StartConnectionResponse> => {
  const res = await fetch(`${getApiBaseUrl()}/api/tools/${toolId}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return res.json();
};

export const checkToolConnectionStatusApi = async (
  toolId: string,
  userId: string
): Promise<CheckStatusResponse> => {
  const res = await fetch(
    `${getApiBaseUrl()}/api/tools/${toolId}/status?userId=${encodeURIComponent(userId)}`
  );
  return res.json();
};

export const disconnectToolApi = async (
  toolId: string,
  userId: string
): Promise<DisconnectResponse> => {
  const res = await fetch(`${getApiBaseUrl()}/api/tools/${toolId}/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return res.json();
};
```

---

### Step 4: Backend Composio Engine (`src/lib/composioBackend.ts`)

Create [src/lib/composioBackend.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/lib/composioBackend.ts) to handle Composio SDK calls and Supabase verification:

```typescript
import { Composio } from '@composio/core';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = ws;
}

export const KNOWN_AUTH_CONFIGS: Record<string, string> = {
  gmail: 'ac_cTxcieYY4OIG',
  slack: 'ac_ZQIFMZUVDdK9',
  googlecalendar: 'ac_PWMjz5tHuqU0',
};

export function getComposioClient(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error('COMPOSIO_API_KEY is missing');
  return new Composio({ apiKey });
}

export function getSupabaseAdminClient() {
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function validateUserFromRequest(
  req: Request,
  bodyUserId?: string
): Promise<{ userId: string }> {
  if (bodyUserId) return { userId: bodyUserId };
  return { userId: 'anonymous-user' };
}
```

---

### Step 5: Backend API Routes for Tool Connection

Create the 3 route endpoints in `src/app/api/tools/[toolId]/`:

1. **Start Connection** ([src/app/api/tools/[toolId]/connect+api.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/app/api/tools/[toolId]/connect+api.ts)):
   ```typescript
   import { getComposioClient, getSupabaseAdminClient, KNOWN_AUTH_CONFIGS } from '@/lib/composioBackend';

   export async function POST(req: Request, { toolId }: { toolId: string }) {
     const { userId } = await req.json();
     const supabase = getSupabaseAdminClient();
     const composio = getComposioClient();

     const { data: tool } = await supabase.from('tools').select('*').eq('id', toolId).single();
     if (!tool) return Response.json({ success: false, message: 'Tool not found' }, { status: 404 });

     const authConfigId = tool.composio_auth_config_id || KNOWN_AUTH_CONFIGS[tool.slug];

     // Initiate Composio connection
     const connectionRequest = await composio.connectedAccounts.initiate({
       userId,
       authConfigId,
     });

     await supabase.from('user_tool_connections').upsert({
       user_id: userId,
       tool_id: toolId,
       status: 'pending',
       composio_connection_request_id: connectionRequest.id,
     }, { onConflict: 'user_id,tool_id' });

     return Response.json({
       success: true,
       connect_url: connectionRequest.redirectUrl,
       status: 'pending',
     });
   }
   ```

2. **Check Status** ([src/app/api/tools/[toolId]/status+api.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/app/api/tools/[toolId]/status+api.ts)):
   ```typescript
   import { getComposioClient, getSupabaseAdminClient } from '@/lib/composioBackend';

   export async function GET(req: Request, { toolId }: { toolId: string }) {
     const url = new URL(req.url);
     const userId = url.searchParams.get('userId');
     const supabase = getSupabaseAdminClient();
     const composio = getComposioClient();

     const { data: conn } = await supabase
       .from('user_tool_connections')
       .select('*')
       .eq('tool_id', toolId)
       .eq('user_id', userId)
       .single();

     if (!conn?.composio_connection_request_id) {
       return Response.json({ status: conn?.status || 'not_connected' });
     }

     const reqStatus = await composio.connectedAccounts.get({ id: conn.composio_connection_request_id });
     const isConnected = reqStatus.status === 'ACTIVE';

     if (isConnected) {
       await supabase.from('user_tool_connections').update({
         status: 'connected',
         composio_connected_account_id: reqStatus.id,
         connected_at: new Date().toISOString(),
       }).eq('id', conn.id);
     }

     return Response.json({
       success: true,
       status: isConnected ? 'connected' : conn.status,
     });
   }
   ```

3. **Disconnect** ([src/app/api/tools/[toolId]/disconnect+api.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/app/api/tools/[toolId]/disconnect+api.ts)):
   ```typescript
   import { getSupabaseAdminClient } from '@/lib/composioBackend';

   export async function POST(req: Request, { toolId }: { toolId: string }) {
     const { userId } = await req.json();
     const supabase = getSupabaseAdminClient();

     await supabase
       .from('user_tool_connections')
       .update({ status: 'revoked' })
       .eq('tool_id', toolId)
       .eq('user_id', userId);

     return Response.json({ success: true, status: 'revoked' });
   }
   ```

---

### Step 6: Tools & Connections Screen in Settings (`src/app/tools.tsx`)

1. In [src/app/(tabs)/settings.tsx](file:///c:/Coding/agent-project/muse-ai-clone/src/app/(tabs)/settings.tsx), wire the "Tools & Connections" row to navigate to `/tools`:
   ```tsx
   <TouchableOpacity
     style={styles.listItem}
     onPress={() => router.push('/tools' as any)}
     activeOpacity={0.65}>
     <View style={styles.listIconCol}>
       <HugeiconsIcon icon={Grid02Icon} size={22} color={Colors.iconDark} strokeWidth={2} />
     </View>
     <Text style={styles.listLabel}>Tools & Connections</Text>
     <HugeiconsIcon icon={ArrowRight01Icon} size={20} color={Colors.iconMuted} strokeWidth={1.8} />
   </TouchableOpacity>
   ```

2. Implement [src/app/tools.tsx](file:///c:/Coding/agent-project/muse-ai-clone/src/app/tools.tsx) with `WebBrowser.openAuthSessionAsync` to let the user authorize tools in 1 tap.

---

### Step 7: Equip Cooper with Composio Tools (`src/lib/composioAgent.ts`)

Create [src/lib/composioAgent.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/lib/composioAgent.ts) to dynamically merge Browserbase tools with active Composio user actions:

```typescript
import { Composio } from '@composio/core';
import { OpenAIAgentsProvider } from '@composio/openai-agents';
import { Agent } from '@openai/agents';
import {
  browserActionTool,
  browserNavigateTool,
  browserReadTool,
  closeBrowserTool,
  createBrowserbaseSessionTool,
} from '@/services/tools/BrowserbaseSession';

export async function createCooperAgentForUser(userId: string): Promise<Agent> {
  const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
    provider: new OpenAIAgentsProvider(),
  });

  // Fetch active connected accounts for this specific user
  const composioTools = await composio.tools.get({
    userId,
    tools: ['GMAIL', 'SLACK', 'GOOGLECALENDAR'],
  }).catch(() => []);

  return new Agent({
    name: 'AI Agent Cooper',
    model: 'gpt-4o',
    instructions: `
You are Muse, an autonomous AI companion.
You have access to both live browser tools and authenticated user integrations (Gmail, Slack, Google Calendar).

When asked to check emails, send messages, or schedule meetings:
1. Use the corresponding tool if connected.
2. If the user hasn't authorized the tool yet, provide a friendly message explaining that they need to connect the tool.
`,
    tools: [
      createBrowserbaseSessionTool,
      browserNavigateTool,
      browserActionTool,
      browserReadTool,
      closeBrowserTool,
      ...composioTools,
    ],
  });
}
```

---

### Step 8: Update Chat Streaming & Inline Connect CTA

In [src/app/api/chat+api.ts](file:///c:/Coding/agent-project/muse-ai-clone/src/app/api/chat+api.ts), use `createCooperAgentForUser`:

```typescript
const agent = await createCooperAgentForUser(activeUserId);
const result = await run(agent, mapMessages(messages), { stream: true, maxTurns: 30 });
```

In [src/app/(tabs)/chat.tsx](file:///c:/Coding/agent-project/muse-ai-clone/src/app/(tabs)/chat.tsx), if Cooper outputs a connect URL, render a prominent CTA button directly in the chat bubble:

```tsx
{msg.connectCta && (
  <TouchableOpacity
    style={styles.connectButton}
    onPress={() => WebBrowser.openBrowserAsync(msg.connectCta.connectUrl)}>
    <Text style={styles.connectButtonText}>Connect {msg.connectCta.toolName}</Text>
  </TouchableOpacity>
)}
```

---

## ✅ Chapter Verification Gate

1. **Verify Database:**
   - In Supabase Table Editor, verify `tools` has 4+ seeded rows (Gmail, Slack, Google Calendar, Notion).
2. **Verify Settings Navigation:**
   - Tap **Settings** tab $\rightarrow$ Tap **Tools & Connections**.
   - Verify the list of tools displays properly with logos and "Connect" buttons.
3. **Verify OAuth Connection:**
   - Tap **Connect** on Gmail or Slack.
   - An in-app authentication browser opens asking for account authorization.
   - Upon completion, the tool state transitions to **Connected**.
4. **Verify Cooper Autonomous Execution:**
   - In Chat, ask Cooper: *"Read the subjects of my last 3 unread emails"*.
   - Cooper executes `GMAIL_LIST_MAILS` and returns the exact emails from your inbox!
