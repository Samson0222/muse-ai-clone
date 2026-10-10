/**
 * Muse AI Clone - Schedule Rules (pure, client + server safe)
 *
 * Shared math for recurring agent tasks. The Supabase `agent-run` dispatcher
 * only advances `daily` and `weekly` rules (it adds 24h / 7d to `next_run_at`),
 * so those are the only frequencies the agent may create. The first
 * `next_run_at` must therefore be computed correctly in the user's timezone
 * here; the dispatcher keeps it moving afterwards.
 *
 * No secrets, no Node-only imports.
 */

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];
export type ScheduleFrequency = "daily" | "weekly";

/** Stored verbatim in `scheduled_agent_tasks.schedule_rule`. */
export interface ScheduleRule {
  frequency: ScheduleFrequency;
  /** 24-hour "HH:MM" wall-clock time in the schedule's timezone. */
  time: string;
  /** Required when `frequency` is "weekly". */
  weekday?: Weekday;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTime(time: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(time.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Normalises "8:00" to "08:00"; null when the time is invalid. */
export function normalizeTime(time: string): string | null {
  const parsed = parseTime(time);
  if (!parsed) return null;
  return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
}

/** Returns the timezone when Intl knows it, otherwise "UTC". */
export function safeTimezone(timezone?: string | null): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(ms: number, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));

  const pick = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour") % 24,
    minute: pick("minute"),
    second: pick("second"),
  };
}

/** Offset (ms) to add to UTC to get wall-clock time in `timezone` at `ms`. */
function offsetAt(ms: number, timezone: string): number {
  const p = zonedParts(ms, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for a wall-clock time in `timezone` (DST-safe). */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const first = naive - offsetAt(naive, timezone);
  // The offset can differ at the corrected instant (DST boundary): re-check.
  return naive - offsetAt(first, timezone);
}

/**
 * The next time the rule fires strictly after `from`, as a UTC Date.
 * Throws when the rule is invalid.
 */
export function computeNextRunAt(
  rule: ScheduleRule,
  timezone: string,
  from: Date = new Date(),
): Date {
  const time = parseTime(rule.time);
  if (!time) throw new Error(`Invalid time "${rule.time}". Use 24-hour HH:MM.`);

  const weekdayIndex =
    rule.frequency === "weekly" ? WEEKDAYS.indexOf(rule.weekday as Weekday) : -1;
  if (rule.frequency === "weekly" && weekdayIndex < 0) {
    throw new Error("A weekly schedule needs a weekday.");
  }

  const tz = safeTimezone(timezone);
  const today = zonedParts(from.getTime(), tz);

  for (let offset = 0; offset <= 8; offset += 1) {
    // Civil-date arithmetic in UTC is exact: no timezone is involved.
    const civil = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (weekdayIndex >= 0 && civil.getUTCDay() !== weekdayIndex) continue;

    const candidate = zonedTimeToUtc(
      civil.getUTCFullYear(),
      civil.getUTCMonth() + 1,
      civil.getUTCDate(),
      time.hour,
      time.minute,
      tz,
    );
    if (candidate > from.getTime()) return new Date(candidate);
  }

  throw new Error("Could not compute the next run time.");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "08:00" -> "8:00 AM" */
export function formatTime12(time: string): string {
  const parsed = parseTime(time);
  if (!parsed) return time;
  const suffix = parsed.hour >= 12 ? "PM" : "AM";
  const hour = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12;
  return `${hour}:${String(parsed.minute).padStart(2, "0")} ${suffix}`;
}

/** "Every day at 8:00 AM" / "Every Monday at 9:30 AM" */
export function describeSchedule(rule: ScheduleRule): string {
  const when = formatTime12(rule.time);
  return rule.frequency === "weekly" && rule.weekday
    ? `Every ${capitalize(rule.weekday)} at ${when}`
    : `Every day at ${when}`;
}

/** "Tomorrow at 8:00 AM" / "Mon, Oct 12 at 8:00 AM", in the user's timezone. */
export function describeRunTime(
  runAt: Date,
  timezone: string,
  now: Date = new Date(),
): string {
  const tz = safeTimezone(timezone);
  const run = zonedParts(runAt.getTime(), tz);
  const current = zonedParts(now.getTime(), tz);
  const dayDiff = Math.round(
    (Date.UTC(run.year, run.month - 1, run.day) -
      Date.UTC(current.year, current.month - 1, current.day)) /
      86_400_000,
  );

  const time = formatTime12(
    `${String(run.hour).padStart(2, "0")}:${String(run.minute).padStart(2, "0")}`,
  );
  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Tomorrow at ${time}`;

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(runAt);
  return `${date} at ${time}`;
}

/** Local date and time for the model prompt, e.g. "Sat, Oct 10, 2026, 14:05". */
export function describeLocalNow(timezone: string, now: Date = new Date()): string {
  const tz = safeTimezone(timezone);
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `${text} (${tz})`;
}
