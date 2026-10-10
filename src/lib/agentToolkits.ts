/**
 * Muse AI Clone - Agent Toolkit Capability Registry
 *
 * Shared (client + server safe) description of what the agent can do with a
 * connected Composio toolkit:
 *
 * - `TOOLKIT_CAPABILITIES`: the agent-facing tools, each mapped to one or more
 *   candidate Composio action slugs with their own argument builders. Slugs and
 *   argument names drift between Composio toolkit versions, so execution walks
 *   the candidate list until one is accepted (see `executeCapability`).
 * - `detectRequiredToolkits`: keyword detection used before the agent runs, so
 *   a request that clearly needs Gmail / Slack / Google Calendar can ask the
 *   user to connect it instead of guessing.
 *
 * Contains no secrets: never import server credentials from this module.
 */
import { z } from "zod";

/** Composio toolkit slugs the agent can drive today. */
export type ToolkitSlug = "gmail" | "slack" | "googlecalendar";

/** Read capabilities run immediately; write capabilities need confirmation. */
export type CapabilityKind = "read" | "write";

/** One Composio action slug plus the argument shape that slug expects. */
export interface ActionCandidate {
  action: string;
  buildArgs: (input: any) => Record<string, unknown>;
}

export interface Capability {
  /** Agent-facing tool name (also the id sent to /api/tools/execute). */
  key: string;
  toolkit: ToolkitSlug;
  kind: CapabilityKind;
  /** Short description handed to the model. */
  description: string;
  /** Agent-facing parameter schema. */
  parameters: z.ZodObject<any>;
  /** Composio actions to try, in order of preference. */
  candidates: ActionCandidate[];
  /** One-line human summary of the call, stored as `input_summary`. */
  summarize: (input: any) => string;
  /** Extra sentence shown in the confirmation card (write capabilities). */
  confirmLabel?: (input: any) => string;
}

const MAX_SUMMARY = 240;

function clip(value: string, max = MAX_SUMMARY) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Like `clip`, but keeps line breaks so confirmation cards stay readable. */
function clipBlock(value: string, max: number) {
  const text = value
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

/** Minutes between two ISO timestamps, defaulting to a 30 minute slot. */
function durationMinutes(startISO: string, endISO?: string | null): number {
  if (!endISO) return 30;
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30;
  return Math.max(5, Math.round((end - start) / 60000));
}

/* ------------------------------------------------------------------ Gmail */

const gmailReadEmails: Capability = {
  key: "gmail_read_emails",
  toolkit: "gmail",
  kind: "read",
  description:
    "Read or search the user's Gmail messages. Use for 'read my latest emails', 'any mail from X', inbox summaries.",
  parameters: z.object({
    query: z
      .string()
      .nullable()
      .describe(
        "Gmail search query such as 'is:unread', 'from:boss@acme.com'. Null for the latest inbox messages.",
      ),
    maxResults: z
      .number()
      .int()
      .nullable()
      .describe("How many messages to fetch (default 10, max 25)."),
  }),
  candidates: [
    {
      action: "GMAIL_FETCH_EMAILS",
      buildArgs: ({ query, maxResults }) => ({
        query: query ?? undefined,
        max_results: Math.min(Math.max(maxResults ?? 10, 1), 25),
      }),
    },
    {
      action: "GMAIL_LIST_MAILS",
      buildArgs: ({ query, maxResults }) => ({
        query: query ?? undefined,
        maxResults: Math.min(Math.max(maxResults ?? 10, 1), 25),
      }),
    },
  ],
  summarize: ({ query, maxResults }) =>
    clip(`Read ${maxResults ?? 10} emails${query ? ` matching "${query}"` : ""}`),
};

const gmailSendEmail: Capability = {
  key: "gmail_send_email",
  toolkit: "gmail",
  kind: "write",
  description:
    "Send an email from the user's Gmail account. Requires explicit user confirmation before it runs.",
  parameters: z.object({
    to: z.string().describe("Recipient email address."),
    subject: z.string().describe("Email subject line."),
    body: z.string().describe("Plain text email body."),
  }),
  candidates: [
    {
      action: "GMAIL_SEND_EMAIL",
      buildArgs: ({ to, subject, body }) => ({
        recipient_email: to,
        subject,
        body,
        is_html: false,
      }),
    },
  ],
  summarize: ({ to, subject }) => clip(`Send email to ${to} — "${subject}"`),
  confirmLabel: ({ to, subject, body }) =>
    clipBlock(`To: ${to}\nSubject: ${subject}\n\n${body}`, 400),
};

/* ------------------------------------------------------------------ Slack */

const slackListChannels: Capability = {
  key: "slack_list_channels",
  toolkit: "slack",
  kind: "read",
  description:
    "List Slack channels in the workspace. Use it to resolve a channel name to an id before reading or posting.",
  parameters: z.object({
    limit: z
      .number()
      .int()
      .nullable()
      .describe("How many channels to list (default 50)."),
  }),
  candidates: [
    {
      action: "SLACK_LIST_ALL_SLACK_TEAM_CHANNELS_WITH_VARIOUS_FILTERS",
      buildArgs: ({ limit }) => ({ limit: Math.min(Math.max(limit ?? 50, 1), 200) }),
    },
    {
      action: "SLACK_LIST_CHANNELS",
      buildArgs: ({ limit }) => ({ limit: Math.min(Math.max(limit ?? 50, 1), 200) }),
    },
  ],
  summarize: ({ limit }) => clip(`List ${limit ?? 50} Slack channels`),
};

const slackReadMessages: Capability = {
  key: "slack_read_messages",
  toolkit: "slack",
  kind: "read",
  description:
    "Read recent messages from a Slack channel. Pass the channel id (from slack_list_channels) or its name.",
  parameters: z.object({
    channel: z.string().describe("Slack channel id (e.g. C0123ABC) or name."),
    limit: z
      .number()
      .int()
      .nullable()
      .describe("How many messages to fetch (default 20)."),
  }),
  candidates: [
    {
      action: "SLACK_FETCH_CONVERSATION_HISTORY",
      buildArgs: ({ channel, limit }) => ({
        channel,
        limit: Math.min(Math.max(limit ?? 20, 1), 100),
      }),
    },
    {
      action: "SLACK_READ_MESSAGES",
      buildArgs: ({ channel, limit }) => ({
        channel,
        limit: Math.min(Math.max(limit ?? 20, 1), 100),
      }),
    },
  ],
  summarize: ({ channel, limit }) =>
    clip(`Read ${limit ?? 20} messages from Slack ${channel}`),
};

const slackSendMessage: Capability = {
  key: "slack_send_message",
  toolkit: "slack",
  kind: "write",
  description:
    "Post a message to a Slack channel. Requires explicit user confirmation before it runs.",
  parameters: z.object({
    channel: z.string().describe("Slack channel id or name to post into."),
    text: z.string().describe("Message text to post."),
  }),
  candidates: [
    {
      action: "SLACK_SEND_MESSAGE",
      buildArgs: ({ channel, text }) => ({ channel, text }),
    },
    {
      action: "SLACK_POST_MESSAGE",
      buildArgs: ({ channel, text }) => ({ channel, text }),
    },
  ],
  summarize: ({ channel, text }) => clip(`Post to Slack ${channel}: ${text}`),
  confirmLabel: ({ channel, text }) => clipBlock(`Channel: ${channel}\n\n${text}`, 400),
};

/* -------------------------------------------------------- Google Calendar */

const calendarReadEvents: Capability = {
  key: "calendar_read_events",
  toolkit: "googlecalendar",
  kind: "read",
  description:
    "List Google Calendar events in a time range. Use for 'what's on my calendar', availability and conflict checks.",
  parameters: z.object({
    timeMin: z
      .string()
      .nullable()
      .describe("ISO 8601 start of the range. Null means now."),
    timeMax: z
      .string()
      .nullable()
      .describe("ISO 8601 end of the range. Null means no upper bound."),
    maxResults: z
      .number()
      .int()
      .nullable()
      .describe("How many events to fetch (default 10, max 50)."),
  }),
  candidates: [
    {
      action: "GOOGLECALENDAR_EVENTS_LIST",
      buildArgs: ({ timeMin, timeMax, maxResults }) => ({
        calendar_id: "primary",
        timeMin: timeMin ?? new Date().toISOString(),
        timeMax: timeMax ?? undefined,
        max_results: Math.min(Math.max(maxResults ?? 10, 1), 50),
        single_events: true,
        order_by: "startTime",
      }),
    },
    {
      action: "GOOGLECALENDAR_LIST_EVENTS",
      buildArgs: ({ timeMin, timeMax, maxResults }) => ({
        calendarId: "primary",
        timeMin: timeMin ?? new Date().toISOString(),
        timeMax: timeMax ?? undefined,
        maxResults: Math.min(Math.max(maxResults ?? 10, 1), 50),
      }),
    },
  ],
  summarize: ({ timeMin, timeMax }) =>
    clip(
      `Read calendar events${timeMin ? ` from ${timeMin}` : ""}${timeMax ? ` to ${timeMax}` : ""}`,
    ),
};

const calendarCreateEvent: Capability = {
  key: "calendar_create_event",
  toolkit: "googlecalendar",
  kind: "write",
  description:
    "Create a Google Calendar event. Requires explicit user confirmation before it runs.",
  parameters: z.object({
    summary: z.string().describe("Event title."),
    startISO: z.string().describe("ISO 8601 start datetime, including offset."),
    endISO: z
      .string()
      .nullable()
      .describe("ISO 8601 end datetime. Null means a 30 minute event."),
    attendees: z
      .array(z.string())
      .nullable()
      .describe("Attendee email addresses, or null for none."),
    description: z.string().nullable().describe("Event description or agenda."),
    timezone: z
      .string()
      .nullable()
      .describe("IANA timezone such as Europe/London. Null uses the calendar default."),
  }),
  candidates: [
    {
      action: "GOOGLECALENDAR_CREATE_EVENT",
      buildArgs: ({ summary, startISO, endISO, attendees, description, timezone }) => {
        const minutes = durationMinutes(startISO, endISO);
        return {
          calendar_id: "primary",
          summary,
          description: description ?? undefined,
          start_datetime: startISO,
          event_duration_hour: Math.floor(minutes / 60),
          event_duration_minutes: minutes % 60,
          attendees: toList(attendees),
          timezone: timezone ?? undefined,
        };
      },
    },
    {
      action: "GOOGLECALENDAR_EVENTS_INSERT",
      buildArgs: ({ summary, startISO, endISO, attendees, description, timezone }) => {
        const minutes = durationMinutes(startISO, endISO);
        const end =
          endISO ?? new Date(Date.parse(startISO) + minutes * 60000).toISOString();
        return {
          calendar_id: "primary",
          summary,
          description: description ?? undefined,
          start: { dateTime: startISO, timeZone: timezone ?? undefined },
          end: { dateTime: end, timeZone: timezone ?? undefined },
          attendees: toList(attendees).map((email) => ({ email })),
        };
      },
    },
  ],
  summarize: ({ summary, startISO }) => clip(`Create event "${summary}" at ${startISO}`),
  confirmLabel: ({ summary, startISO, endISO, attendees, description }) =>
    clipBlock(
      [
        `Title: ${summary}`,
        `Starts: ${startISO}`,
        endISO ? `Ends: ${endISO}` : "Duration: 30 minutes",
        toList(attendees).length ? `Guests: ${toList(attendees).join(", ")}` : null,
        description ? `Notes: ${description}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      400,
    ),
};

export const TOOLKIT_CAPABILITIES: Capability[] = [
  gmailReadEmails,
  gmailSendEmail,
  slackListChannels,
  slackReadMessages,
  slackSendMessage,
  calendarReadEvents,
  calendarCreateEvent,
];

export function capabilitiesForToolkit(toolkit: string): Capability[] {
  return TOOLKIT_CAPABILITIES.filter((c) => c.toolkit === toolkit);
}

export function getCapability(key: string): Capability | undefined {
  return TOOLKIT_CAPABILITIES.find((c) => c.key === key);
}

/* -------------------------------------------------------------- Detection */

interface ToolkitDetection {
  toolkit: ToolkitSlug;
  /** Display name used in the "please connect" reply. */
  label: string;
  /** Tool slug in the Supabase `tools` table. */
  slug: string;
  patterns: RegExp[];
}

const TOOLKIT_DETECTION: ToolkitDetection[] = [
  {
    toolkit: "gmail",
    label: "Gmail",
    slug: "gmail",
    patterns: [
      /\bg-?mail\b/i,
      /\be-?mails?\b/i,
      /\binbox\b/i,
      /\bunread mail\b/i,
    ],
  },
  {
    toolkit: "slack",
    label: "Slack",
    slug: "slack",
    patterns: [/\bslack\b/i],
  },
  {
    toolkit: "googlecalendar",
    label: "Google Calendar",
    slug: "googlecalendar",
    patterns: [
      /\bcalendar\b/i,
      /\bmeetings?\b/i,
      /\bappointments?\b/i,
      /\bavailability\b/i,
      /\bfree\s?(time|slots?)\b/i,
      /\b(schedule|book|set up)\s+(a|an|the)?\s*(call|sync|catch[- ]?up|event)\b/i,
    ],
  },
];

const WRITE_INTENT =
  /\b(send|email|e-mail|reply|respond|post|message|dm|draft|create|schedule|book|invite|add|cancel|delete)\b/i;

export interface DetectedToolkit {
  toolkit: ToolkitSlug;
  label: string;
  slug: string;
  /** Best guess at the user's intent, used only for wording. */
  kind: CapabilityKind;
}

/**
 * Keyword detection for "this request needs an external tool".
 * Deliberately conservative: only explicit mentions count, so ordinary chat
 * and browser tasks are never gated behind a connection prompt.
 */
export function detectRequiredToolkits(text: string): DetectedToolkit[] {
  if (!text?.trim()) return [];
  const kind: CapabilityKind = WRITE_INTENT.test(text) ? "write" : "read";

  return TOOLKIT_DETECTION.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(text)),
  ).map((entry) => ({
    toolkit: entry.toolkit,
    label: entry.label,
    slug: entry.slug,
    kind,
  }));
}
