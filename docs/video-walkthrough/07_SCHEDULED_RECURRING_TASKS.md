# ⏰ Chapter 07 — Autonomous Scheduled Tasks & Supabase Edge Cron

> **Video Timestamp:** `03:33:11 - 03:54:09`  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)

---

## 🎯 What the Video Covers in this Chapter

1. Enabling background autonomy: allowing Cooper to run tasks in the cloud on a recurring schedule without the mobile app needing to stay open.
2. Creating a natural language schedule intent parser (`src/lib/scheduleIntentAgent.ts`).
3. Displaying an interactive confirmation card inside the chat thread.
4. Creating the `public.scheduled_agent_tasks` table in Supabase.
5. Deploying the Supabase Edge Function: `supabase/functions/agent-run`.
6. Setting up `pg_cron` in PostgreSQL to invoke the edge function automatically every minute.
7. Connecting the **Tasks** tab to list scheduled goals, toggle active/paused states, and trigger manual test runs.

---

## 🏛️ Database Migration for Scheduled Tasks

Run this SQL in your **Supabase SQL Editor**:

```sql
create extension if not exists pgcrypto;

create table if not exists public.scheduled_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  original_prompt text not null,
  task_type text not null default 'generic_prompt',
  task_payload jsonb not null default '{}'::jsonb,
  schedule_rule jsonb not null default '{}'::jsonb,
  timezone text not null default 'UTC',
  delivery text not null default 'chat',
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('completed', 'failed')),
  last_run_summary text,
  last_run_error text,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_agent_tasks_due
on public.scheduled_agent_tasks (status, next_run_at)
where status = 'active';

alter table public.scheduled_agent_tasks enable row level security;

create policy "Users can manage their own scheduled tasks"
  on public.scheduled_agent_tasks for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

---

## 🛠️ Step-by-Step Implementation

### 1. Schedule Intent Parsing (`src/lib/scheduleIntentAgent.ts`)

Extract time and frequency from conversational prompts:

```typescript
import OpenAI from "openai";

export async function parseScheduleIntentWithAgent({
  text,
  timezone = "UTC",
}: {
  text: string;
  timezone?: string;
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `
Extract scheduling intent from user message: "${text}"
Current Timezone: "${timezone}"

If user wants a recurring task, return JSON:
{
  "isSchedule": true,
  "title": "Short title",
  "frequency": "daily" | "weekly",
  "time": "HH:MM",
  "weekday": "monday" ... "sunday",
  "delivery": "chat",
  "task": "Action prompt"
}
Otherwise return: {"isSchedule": false}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  if (!parsed.isSchedule) return null;

  return {
    title: parsed.title,
    originalPrompt: text,
    taskType: "generic_prompt" as const,
    taskPayload: { prompt: parsed.task, task: parsed.task },
    scheduleRule: { frequency: parsed.frequency, time: parsed.time, weekday: parsed.weekday },
    timezone,
    delivery: parsed.delivery || "chat",
  };
}
```

---

### 2. Schedule Task Management (`src/lib/scheduledTasks.ts`)

Provides client helpers to insert tasks into `scheduled_agent_tasks` and trigger runs:

```typescript
import { supabase } from "@/lib/supabase";

export async function createScheduledTask(userId: string, confirmation: any) {
  const { data, error } = await supabase
    .from("scheduled_agent_tasks")
    .insert({
      user_id: userId,
      title: confirmation.title,
      original_prompt: confirmation.originalPrompt,
      task_payload: confirmation.taskPayload,
      schedule_rule: confirmation.scheduleRule,
      timezone: confirmation.timezone,
      delivery: confirmation.delivery,
      next_run_at: new Date().toISOString(), // or computed next run
      status: "active",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

---

### 3. Deploy Supabase Edge Function (`supabase/functions/agent-run`)

In the `supabase/functions/agent-run/` directory:
- Deploy with Supabase CLI:
  ```bash
  npx supabase functions deploy agent-run
  ```
- Set Supabase Secrets:
  ```bash
  npx supabase secrets set \
    OPENAI_API_KEY="..." \
    BROWSERBASE_API_KEY="..." \
    BROWSERBASE_PROJECT_ID="..."
  ```

---

### 4. Enable `pg_cron` Automated Dispatcher

Run in **Supabase SQL Editor**:

```sql
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'run-due-agent-tasks',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/agent-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('mode', 'run_due_schedules')
  ) as request_id;
  $$
);
```

---

## ✅ Chapter Verification Gate

- Ask Cooper in chat: *"Check Hacker News top stories every morning at 9 AM"*.
- Cooper responds with a confirmation card displaying recurrence details.
- User taps "Confirm"; the task is saved to Supabase.
- Opening the **Tasks Tab** displays the task with an active toggle.
- Tapping "Run Now" triggers the Edge Function manually, updating the last run status to `completed` and posting results into the chat!
