/**
 * Client-side access to `public.scheduled_agent_tasks` for the Tasks tab.
 *
 * - Reads, pauses and resumes rows through the user's Supabase session (RLS
 *   limits every query to the signed-in user).
 * - "Run now" calls the `agent-run` Edge Function with `run_scheduled_task`,
 *   the same function the cron dispatcher uses.
 *
 * Creating a schedule is not done here: it only happens after the user
 * confirms in chat (see /api/schedules).
 */
import {
  computeNextRunAt,
  describeRunTime,
  describeSchedule,
  normalizeTime,
  type ScheduleRule,
} from "@/lib/scheduleRules";
import { supabase } from "@/lib/supabase";

export type ScheduledTaskStatus = "active" | "paused" | "cancelled";

export interface ScheduledTask {
  id: string;
  title: string;
  status: ScheduledTaskStatus;
  delivery: string;
  timezone: string;
  scheduleRule: ScheduleRule;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: "completed" | "failed" | null;
  lastRunSummary: string | null;
  lastRunError: string | null;
}

function mapRow(row: any): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    delivery: row.delivery ?? "chat",
    timezone: row.timezone ?? "UTC",
    scheduleRule: (row.schedule_rule ?? {}) as ScheduleRule,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at ?? null,
    lastRunStatus: row.last_run_status ?? null,
    lastRunSummary: row.last_run_summary ?? null,
    lastRunError: row.last_run_error ?? null,
  };
}

/** The signed-in user's schedules, newest first. Cancelled rows are hidden. */
export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const { data, error } = await supabase
    .from("scheduled_agent_tasks")
    .select(
      "id, title, status, delivery, timezone, schedule_rule, next_run_at, last_run_at, last_run_status, last_run_summary, last_run_error",
    )
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/**
 * Pauses or resumes a schedule. Resuming recomputes `next_run_at`: a stale
 * past value would make the dispatcher fire the task immediately.
 */
export async function setScheduledTaskActive(
  task: ScheduledTask,
  active: boolean,
): Promise<ScheduledTask> {
  const patch: Record<string, unknown> = { status: active ? "active" : "paused" };
  if (active) {
    patch.next_run_at = computeNextRunAt(task.scheduleRule, task.timezone).toISOString();
  }

  const { data, error } = await supabase
    .from("scheduled_agent_tasks")
    .update(patch)
    .eq("id", task.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data);
}

/** Runs one schedule immediately through the Edge Function. */
export async function runScheduledTaskNow(taskId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("agent-run", {
    body: { mode: "run_scheduled_task", scheduledTaskId: taskId },
  });
  if (!error) return;

  // FunctionsHttpError carries the function's JSON body on `context`.
  let message = error.message;
  try {
    const body = await (error as any).context?.json?.();
    if (body?.error) message = String(body.error);
  } catch {
    // keep the generic message
  }
  throw new Error(message);
}

/** "Every day at 8:00 AM", or a fallback for rows saved without a rule. */
export function describeTaskSchedule(task: ScheduledTask): string {
  const rule = task.scheduleRule;
  return rule?.frequency && rule?.time ? describeSchedule(rule) : "Custom schedule";
}

/** "Tomorrow at 8:00 AM" in the schedule's own timezone. */
export function describeTaskNextRun(task: ScheduledTask): string {
  const next = new Date(task.nextRunAt);
  return Number.isNaN(next.getTime())
    ? "Unknown"
    : describeRunTime(next, task.timezone);
}

export function describeDelivery(delivery: string): string {
  const names: Record<string, string> = {
    chat: "Chat",
    slack: "Slack",
    email: "Email",
    gmail: "Email",
  };
  return names[delivery.toLowerCase()] ?? delivery;
}

/** "Oct 10, 8:00 AM" for the last run line. */
export function describeLastRun(task: ScheduledTask): string | null {
  if (!task.lastRunAt) return null;
  const when = new Date(task.lastRunAt);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ScheduledTaskEdit {
  title: string;
  scheduleRule: ScheduleRule;
}

/**
 * Saves a title / recurrence change. An active task gets a fresh
 * `next_run_at` for the new rule; a paused one is recomputed on resume.
 */
export async function updateScheduledTask(
  task: ScheduledTask,
  edit: ScheduledTaskEdit,
): Promise<ScheduledTask> {
  const title = edit.title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) throw new Error("Give the task a name.");

  const time = normalizeTime(edit.scheduleRule.time);
  if (!time) throw new Error("Pick a valid time.");

  const scheduleRule: ScheduleRule = {
    frequency: edit.scheduleRule.frequency,
    time,
    ...(edit.scheduleRule.frequency === "weekly" && edit.scheduleRule.weekday
      ? { weekday: edit.scheduleRule.weekday }
      : {}),
  };
  if (scheduleRule.frequency === "weekly" && !scheduleRule.weekday) {
    throw new Error("Pick a weekday.");
  }

  const patch: Record<string, unknown> = {
    title,
    schedule_rule: scheduleRule,
  };
  if (task.status === "active") {
    patch.next_run_at = computeNextRunAt(scheduleRule, task.timezone).toISOString();
  }

  const { data, error } = await supabase
    .from("scheduled_agent_tasks")
    .update(patch)
    .eq("id", task.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data);
}

/** Permanently removes a schedule. Past results already in chat are kept. */
export async function deleteScheduledTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from("scheduled_agent_tasks")
    .delete()
    .eq("id", taskId);

  if (error) throw new Error(error.message);
}
