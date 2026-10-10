/**
 * Muse AI Clone - Scheduled Agent Tasks (server only)
 *
 * Turns a recurring-task request from the agent into a confirmation payload,
 * and, once the user confirms, into a `scheduled_agent_tasks` row that the
 * Supabase `agent-run` cron dispatcher picks up when `next_run_at` is due.
 *
 * Never import this from client code: it pulls in `@openai/agents`.
 */
import {
  computeNextRunAt,
  describeRunTime,
  describeSchedule,
  normalizeTime,
  safeTimezone,
  WEEKDAYS,
  type ScheduleRule,
  type Weekday,
} from "@/lib/scheduleRules";
import type { ChatScheduleRequest, CreatedSchedule } from "@/types";
import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const MAX_TITLE = 80;
const MAX_TEXT = 1000;
const MAX_ORIGINAL = 500;

/** Parameters the model fills in. Nullable instead of optional (strict mode). */
const scheduleToolParameters = z.object({
  title: z
    .string()
    .describe("Short card title, at most 6 words. Example: 'Hacker News top 5'."),
  task: z
    .string()
    .describe(
      "What to do on EVERY run, written as a direct instruction with no schedule words. Example: 'Get the top 5 Hacker News stories and write a short digest with titles, links and points.'",
    ),
  webTask: z
    .string()
    .nullable()
    .describe(
      "Only when the task needs live web data: a self-contained browser instruction including the URL. Example: 'Open https://news.ycombinator.com and list the top 5 stories with title, link and points.' Null otherwise.",
    ),
  frequency: z.enum(["daily", "weekly"]).describe("daily or weekly."),
  time: z
    .string()
    .describe("Wall-clock time in the user's timezone, 24-hour HH:MM. 8 AM is '08:00'."),
  weekday: z
    .enum(WEEKDAYS)
    .nullable()
    .describe("Lowercase weekday for weekly schedules. Null for daily."),
  delivery: z
    .enum(["chat", "slack"])
    .describe("chat (default) posts the result into the user's Muse chat. slack posts to a channel."),
  slackChannel: z
    .string()
    .nullable()
    .describe("Slack channel such as '#general'. Required when delivery is slack, null otherwise."),
});

type ScheduleToolInput = z.infer<typeof scheduleToolParameters>;

function clean(value: string | null | undefined, max: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Validates the model's arguments and builds the card payload.
 * Throws an Error whose message is safe to show to the model.
 */
export function buildScheduleRequest(
  input: Pick<
    ScheduleToolInput,
    "title" | "task" | "webTask" | "frequency" | "time" | "weekday" | "delivery" | "slackChannel"
  >,
  context: { timezone: string; originalPrompt: string; now?: Date },
): ChatScheduleRequest {
  const now = context.now ?? new Date();
  const timezone = safeTimezone(context.timezone);

  const title = clean(input.title, MAX_TITLE);
  const task = clean(input.task, MAX_TEXT);
  if (!title || !task) throw new Error("A schedule needs a title and a task.");

  const time = normalizeTime(input.time);
  if (!time) throw new Error(`Invalid time "${input.time}". Use 24-hour HH:MM.`);

  if (input.frequency === "weekly" && !input.weekday) {
    throw new Error("A weekly schedule needs a weekday.");
  }

  const slackChannel =
    input.delivery === "slack" ? clean(input.slackChannel, 80) : "";
  if (input.delivery === "slack" && !slackChannel) {
    throw new Error("Slack delivery needs a channel. Ask the user which channel.");
  }

  const rule: ScheduleRule = {
    frequency: input.frequency,
    time,
    ...(input.frequency === "weekly" ? { weekday: input.weekday as Weekday } : {}),
  };
  const nextRunAt = computeNextRunAt(rule, timezone, now);

  return {
    title,
    task,
    webTask: clean(input.webTask, MAX_TEXT) || null,
    frequency: rule.frequency,
    time,
    weekday: rule.weekday ?? null,
    timezone,
    delivery: input.delivery,
    slackChannel: slackChannel || null,
    originalPrompt: clean(context.originalPrompt, MAX_ORIGINAL),
    scheduleSummary: describeSchedule(rule),
    nextRunLabel: describeRunTime(nextRunAt, timezone, now),
  };
}

/** Wire format of POST /api/schedules (the confirm button). */
export const createScheduleBodySchema = z.object({
  title: z.string(),
  task: z.string(),
  webTask: z.string().nullable().optional(),
  frequency: z.enum(["daily", "weekly"]),
  time: z.string(),
  weekday: z.enum(WEEKDAYS).nullable().optional(),
  timezone: z.string(),
  delivery: z.enum(["chat", "slack"]),
  slackChannel: z.string().nullable().optional(),
  originalPrompt: z.string().optional(),
  sourceThreadId: z.string().nullable().optional(),
});

export type CreateScheduleBody = z.infer<typeof createScheduleBodySchema>;

/**
 * Saves a confirmed schedule. `next_run_at` is recomputed here, not trusted
 * from the card: the user may confirm long after the card was drawn.
 * Runs with the caller's JWT, so RLS keeps rows scoped to the user.
 */
export async function createScheduledTask(
  db: SupabaseClient,
  userId: string,
  body: CreateScheduleBody,
): Promise<CreatedSchedule> {
  const request = buildScheduleRequest(
    {
      title: body.title,
      task: body.task,
      webTask: body.webTask ?? null,
      frequency: body.frequency,
      time: body.time,
      weekday: body.weekday ?? null,
      delivery: body.delivery,
      slackChannel: body.slackChannel ?? null,
    },
    { timezone: body.timezone, originalPrompt: body.originalPrompt ?? body.task },
  );

  const rule: ScheduleRule = {
    frequency: request.frequency,
    time: request.time,
    ...(request.weekday ? { weekday: request.weekday as Weekday } : {}),
  };
  const nextRunAt = computeNextRunAt(rule, request.timezone);

  const taskPayload: Record<string, unknown> = {
    prompt: request.task,
    task: request.task,
    useOpenAi: true,
    ...(request.webTask ? { browserTask: request.webTask, pollBrowserbase: true } : {}),
    ...(body.sourceThreadId ? { sourceThreadId: body.sourceThreadId } : {}),
    // Same shape as the Slack example in docs/docs/scheduled-agent-tasks.md.
    ...(request.delivery === "slack" && request.slackChannel
      ? {
          composioToolkitSlug: "slack",
          composioUseCase: "Send a message to a Slack channel",
          composioArguments: { channel: request.slackChannel },
        }
      : {}),
  };

  const { data, error } = await db
    .from("scheduled_agent_tasks")
    .insert({
      user_id: userId,
      title: request.title,
      original_prompt: request.originalPrompt || request.task,
      task_type: "generic_prompt",
      task_payload: taskPayload,
      schedule_rule: rule,
      timezone: request.timezone,
      delivery: request.delivery,
      next_run_at: nextRunAt.toISOString(),
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    // 42P01: the table has not been created in this Supabase project yet.
    if (error.code === "42P01" || /scheduled_agent_tasks/.test(error.message)) {
      throw new Error(
        "The scheduled_agent_tasks table is missing. Run docs/functions/agent-run/scheduled_agent_tasks.sql in the Supabase SQL editor.",
      );
    }
    throw new Error(error.message);
  }

  return {
    id: String(data.id),
    scheduleSummary: request.scheduleSummary,
    nextRunLabel: describeRunTime(nextRunAt, request.timezone),
    nextRunAt: nextRunAt.toISOString(),
    delivery: request.delivery,
  };
}

/**
 * Agent tool: prepares a recurring task and stops for confirmation. Nothing is
 * written to Supabase here; the chat card's Confirm button does that.
 */
export function buildScheduleTool(context: {
  timezone: string;
  originalPrompt: string;
}) {
  return tool({
    name: "schedule_task",
    description:
      "Create a recurring scheduled task (daily or weekly) that runs automatically in the cloud and delivers its result to the user. Use whenever the user asks for something 'every day', 'every morning', 'weekly', 'every Monday' and similar. It does NOT save anything: it shows the user a confirmation card.",
    parameters: scheduleToolParameters as any,
    execute: async (input: any) => {
      try {
        const request = buildScheduleRequest(input, context);
        return { type: "schedule_confirmation_required", schedule: request };
      } catch (error: any) {
        return {
          type: "tool_error",
          tool: "schedule_task",
          error: error?.message ?? "Could not prepare the schedule.",
        };
      }
    },
  });
}
