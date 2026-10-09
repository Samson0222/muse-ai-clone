# 🗄️ Sub-Plan 01 — Database Schema, RLS & Authentication

> **Document:** `docs/02_SUBPLAN_DATABASE_AND_AUTH.md`  
> **Parent Plan:** [`docs/00_MASTER_PLAN.md`](./00_MASTER_PLAN.md)  
> **Video Alignment:** Chapters `00:21:27 Database & Authentication` and `01:14:33 Save Chat Conversation & Create New Chat`

---

## 🎯 Objective & Scope

Establish the cloud PostgreSQL foundation in Supabase and implement Google OAuth authentication in the mobile app. By the end of this phase, users will sign in with Google, have their session persisted in `AsyncStorage`, and have their chat threads and messages securely stored with Row-Level Security (RLS).

---

## 🏛️ Database Schema Architecture

Execute the following consolidated SQL migration in the **Supabase SQL Editor**:

```sql
-- 1. Enable Required Extensions
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- 2. Timestamp Management Helper Function
create or replace function public.update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ========================================================
-- 3. CHAT THREADS TABLE
-- ========================================================
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_email text not null,
  type text not null default 'side' check (type in ('main', 'side')),
  title text default 'New Conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_threads_user on public.chat_threads(user_email, type);
create index if not exists idx_chat_threads_user_id on public.chat_threads(user_id);

alter table public.chat_threads enable row level security;

create policy "Users can view their own threads"
  on public.chat_threads for select to authenticated
  using (auth.uid() = user_id or auth.email() = user_email);

create policy "Users can insert their own threads"
  on public.chat_threads for insert to authenticated
  with check (auth.uid() = user_id or auth.email() = user_email);

create policy "Users can update their own threads"
  on public.chat_threads for update to authenticated
  using (auth.uid() = user_id or auth.email() = user_email);

create policy "Users can delete their own threads"
  on public.chat_threads for delete to authenticated
  using (auth.uid() = user_id or auth.email() = user_email);

-- ========================================================
-- 4. CHAT MESSAGES TABLE
-- ========================================================
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender text not null check (sender in ('user', 'agent', 'system')),
  text text not null,
  schedule_confirmation jsonb,
  browser_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_thread on public.chat_messages(thread_id, created_at);

alter table public.chat_messages enable row level security;

create policy "Users can view messages from their threads"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.chat_threads
      where public.chat_threads.id = public.chat_messages.thread_id
      and (public.chat_threads.user_id = auth.uid() or public.chat_threads.user_email = auth.email())
    )
  );

create policy "Users can insert messages into their threads"
  on public.chat_messages for insert to authenticated
  with check (
    exists (
      select 1 from public.chat_threads
      where public.chat_threads.id = public.chat_messages.thread_id
      and (public.chat_threads.user_id = auth.uid() or public.chat_threads.user_email = auth.email())
    )
  );

-- ========================================================
-- 5. TOOLS & INTEGRATIONS CATALOG TABLE
-- ========================================================
create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  toolkit_slug text not null,
  description text,
  category text,
  logo_url text,
  logo_key text,
  actions jsonb default '[]'::jsonb,
  composio_auth_config_id text,
  is_active boolean not null default true,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tools enable row level security;

create policy "Allow all authenticated users to read active tools"
  on public.tools for select to authenticated
  using (is_active = true);

-- Seed Essential Tools
insert into public.tools (name, slug, toolkit_slug, description, category, logo_key, is_active, sort_order)
values
  ('Gmail', 'gmail', 'gmail', 'Send, read and summarize emails', 'Communication', 'gmail', true, 1),
  ('Slack', 'slack', 'slack', 'Send messages, read channels and alert teams', 'Communication', 'slack', true, 2),
  ('Google Calendar', 'googlecalendar', 'googlecalendar', 'Check availability and manage meetings', 'Productivity', 'googlecalendar', true, 3),
  ('Notion', 'notion', 'notion', 'Create pages, update databases and notes', 'Productivity', 'notion', true, 4),
  ('GitHub', 'github', 'github', 'Inspect repositories, issues and pull requests', 'Developer', 'github', true, 5)
on conflict (slug) do nothing;

-- ========================================================
-- 6. USER TOOL CONNECTIONS TABLE
-- ========================================================
create table if not exists public.user_tool_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_id uuid not null references public.tools(id) on delete cascade,
  status text not null default 'not_connected' check (status in ('not_connected', 'pending', 'connected', 'failed', 'revoked')),
  composio_connected_account_id text,
  composio_connection_request_id text,
  connected_label text,
  connected_email text,
  metadata jsonb default '{}'::jsonb,
  last_checked_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tool_id)
);

create index if not exists idx_user_tool_connections_user on public.user_tool_connections(user_id);

alter table public.user_tool_connections enable row level security;

create policy "Users can view their own tool connections"
  on public.user_tool_connections for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can manage their own tool connections"
  on public.user_tool_connections for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ========================================================
-- 7. AGENT TOOL RUNS LOG TABLE
-- ========================================================
create table if not exists public.agent_tool_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_id uuid references public.tools(id) on delete set null,
  action_name text not null,
  input_summary text,
  output_summary text,
  status text not null check (status in ('success', 'failed', 'running')),
  error_message text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_tool_runs_user on public.agent_tool_runs(user_id);

alter table public.agent_tool_runs enable row level security;

create policy "Users can view their own tool runs"
  on public.agent_tool_runs for select to authenticated
  using (auth.uid() = user_id);

-- ========================================================
-- 8. SCHEDULED AGENT TASKS TABLE
-- ========================================================
create table if not exists public.scheduled_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  original_prompt text not null,
  task_type text not null default 'generic_prompt' check (task_type in ('generic_prompt')),
  task_payload jsonb not null default '{}'::jsonb,
  schedule_rule jsonb not null default '{}'::jsonb,
  timezone text not null default 'UTC',
  delivery text not null default 'chat' check (length(trim(delivery)) > 0),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('completed', 'failed')),
  last_run_summary text,
  last_run_error text,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_agent_tasks_user on public.scheduled_agent_tasks(user_id);
create index if not exists idx_scheduled_agent_tasks_due on public.scheduled_agent_tasks(status, next_run_at) where status = 'active';

alter table public.scheduled_agent_tasks enable row level security;

create policy "Users can manage their own scheduled tasks"
  on public.scheduled_agent_tasks for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Automatic Updated At Triggers
create trigger set_chat_threads_updated_at before update on public.chat_threads for each row execute function public.update_updated_at_column();
create trigger set_user_tool_connections_updated_at before update on public.user_tool_connections for each row execute function public.update_updated_at_column();
create trigger set_scheduled_agent_tasks_updated_at before update on public.scheduled_agent_tasks for each row execute function public.update_updated_at_column();
```

---

## 💻 Client Implementation

### 1. Upgrade Supabase Client to TypeScript (`src/lib/supabase.ts`)
Replace `src/lib/supabase.js` with a fully typed client:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
```

### 2. Google OAuth Handshake (`src/app/index.tsx`)
Ensure OAuth redirection correctly captures parameters across iOS, Android, and Web:

```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle() {
  const redirectTo = Linking.createURL('/auth/callback');
  
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) return null;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return null;

  // Extract access token & refresh token from hash fragment
  const params = new URLSearchParams(result.url.split('#')[1]);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken && refreshToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    return sessionData.session;
  }
  return null;
}
```

### 3. Chat History & Thread Management Service (`src/services/chatHistory.ts`)
Create `src/services/chatHistory.ts` providing CRUD utilities for `chat_threads` and `chat_messages`.

---

## ✅ Acceptance Criteria & Testing Checklist

- [ ] All 6 PostgreSQL tables created in Supabase with RLS enabled.
- [ ] User can tap "Sign in with Google" on mobile/web; browser opens Google account chooser.
- [ ] After Google authentication, session is saved in `AsyncStorage` and user is routed to `/(tabs)/chat`.
- [ ] On app re-launch, session is automatically restored without requiring re-login.
- [ ] Calling `chatHistory.CreateNewThread()` successfully persists a row in `chat_threads`.
- [ ] Sign out in `Settings` clears the session and redirects to `/`.
