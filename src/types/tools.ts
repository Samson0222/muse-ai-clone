/**
 * Muse AI Clone - Tools & Composio Connections Type Definitions
 *
 * Data models for autonomous agent tools, third-party connectors,
 * and user connection state tracked in Supabase.
 */

/**
 * Status of a user's connection to an external tool.
 */
export type ToolConnectionStatus =
  | 'not_connected'
  | 'pending'
  | 'connected'
  | 'failed'
  | 'revoked';

/**
 * Specification for an individual action supported by a tool.
 */
export interface ToolAction {
  /** Unique action identifier (e.g. 'GMAIL_SEND_EMAIL', 'SLACK_POST_MESSAGE') */
  name: string;
  /** Human-readable description of what this action does */
  description?: string;
  /** Optional parameter specifications or schema */
  parameters?: Record<string, any>;
}

/**
 * Base Tool definition stored in Supabase `tools` table.
 */
export interface Tool {
  /** Unique tool identifier (UUID) */
  id: string;
  /** Display name (e.g. 'Gmail', 'Slack', 'Google Calendar') */
  name: string;
  /** Unique URL-friendly slug (e.g. 'gmail', 'slack') */
  slug: string;
  /** Composio toolkit identifier (e.g. 'gmail', 'slack') */
  toolkit_slug: string;
  /** Human-readable explanation of tool capabilities */
  description: string;
  /** Category grouping (e.g. 'Email & Communication', 'Team Collaboration') */
  category: string;
  /** Remote image URL for SVG or PNG brand icon */
  logo_url: string | null;
  /** Local fallback key for icon resolution */
  logo_key: string | null;
  /** Array of executable actions available on this tool */
  actions: ToolAction[];
  /** Composio OAuth/App auth configuration identifier */
  composio_auth_config_id?: string | null;
  /** Whether the tool is active and visible in the app */
  is_active?: boolean;
  /** Display order priority */
  sort_order?: number;
  /** Creation timestamp */
  created_at?: string;
  /** Last update timestamp */
  updated_at?: string;
}

/**
 * User tool connection record stored in Supabase `user_tool_connections` table.
 */
export interface UserToolConnection {
  /** Connection record UUID */
  id: string;
  /** User UUID linked to auth.users */
  user_id: string;
  /** Tool UUID linked to tools table */
  tool_id: string;
  /** Current connection lifecycle state */
  status: ToolConnectionStatus;
  /** Composio connected account identifier */
  composio_connected_account_id?: string | null;
  /** Active Composio connection request ID */
  composio_connection_request_id?: string | null;
  /** User-facing connected account label (e.g. 'Personal Gmail') */
  connected_label?: string | null;
  /** Associated email address of the connected account */
  connected_email?: string | null;
  /** Additional connection metadata from Composio */
  metadata?: Record<string, any>;
  /** Timestamp when connection health was last checked */
  last_checked_at?: string | null;
  /** Timestamp when OAuth connection was successfully established */
  connected_at?: string | null;
  /** Creation timestamp */
  created_at?: string;
  /** Last update timestamp */
  updated_at?: string;
}

/**
 * Combined tool contract with the current user's connection status.
 * Standard app data structure consumed by UI screens (Settings, Connectors, Chat).
 */
export interface ToolWithConnection {
  /** Tool ID (UUID) */
  id: string;
  /** Tool ID alias matching requirement specification */
  tool_id: string;
  /** Tool display name */
  name: string;
  /** Tool unique slug */
  slug: string;
  /** Composio toolkit slug */
  toolkit_slug: string;
  /** Descriptive capability summary */
  description: string;
  /** Category classification */
  category: string;
  /** Brand logo remote URL */
  logo_url: string | null;
  /** Brand logo local fallback key */
  logo_key: string | null;
  /** Actions available on this tool */
  actions: ToolAction[];
  /** Connection status for the active user */
  status: ToolConnectionStatus;
  /** Label of the connected account (null if not connected) */
  connected_label: string | null;
  /** Email address of the connected account (null if not connected) */
  connected_email: string | null;
  /** Composio auth config identifier */
  composio_auth_config_id?: string | null;
  /** Connection record ID if exists */
  connection_id?: string | null;
}

/**
 * A tool the agent needs but the user has not connected yet.
 * Rendered in chat as a Connect CTA (see ChatConnectCta).
 */
export interface ChatConnectSuggestionTool {
  /** tools.id UUID */
  tool_id: string;
  /** tools.slug — accepted by the /api/tools/:toolId/* routes */
  slug: string;
  /** Display name (e.g. 'Gmail') */
  name: string;
  logo_url?: string | null;
  logo_key?: string | null;
}

/**
 * Payload of the `connect` chat stream event.
 */
export interface ChatConnectSuggestion {
  tools: ChatConnectSuggestionTool[];
  /** Agent-authored sentence introducing the CTA. */
  message?: string;
}

/**
 * Payload of the `confirm` chat stream event: a write action the agent prepared
 * but will not run until the user approves it.
 */
export interface ChatConfirmRequest {
  /** Capability key from the shared registry (e.g. 'gmail_send_email') */
  capability: string;
  /** tools.slug of the tool that will run it */
  toolSlug: string;
  /** Display name of the tool */
  toolName: string;
  /** Composio toolkit slug */
  toolkitSlug: string;
  /** Brand logo for the confirmation card header */
  logoUrl?: string | null;
  logoKey?: string | null;
  /** One-line description of the pending action */
  actionSummary: string;
  /** Multi-line detail shown inside the confirmation card */
  details: string;
  /** Arguments replayed to /api/tools/execute on confirm */
  input: Record<string, any>;
}

/** Lifecycle of a confirmation card inside the chat thread. */
export type ChatConfirmState =
  | 'pending'
  | 'running'
  | 'confirmed'
  | 'cancelled'
  | 'failed';

/** Result returned by POST /api/tools/execute. */
export interface ToolExecutionResult {
  status: 'success' | 'failed';
  action: string;
  capability: string;
  tool: string;
  input_summary: string;
  output_summary: string;
  error_message: string | null;
  message: string;
}

/**
 * Payload of the `schedule` chat stream event: a recurring task the agent
 * prepared but will not save until the user confirms it.
 */
export interface ChatScheduleRequest {
  /** Short card title, e.g. "Hacker News top 5" */
  title: string;
  /** Instruction the dispatcher executes on every run */
  task: string;
  /** Self-contained browser instruction when the task needs live web data */
  webTask: string | null;
  frequency: 'daily' | 'weekly';
  /** 24-hour "HH:MM" in `timezone` */
  time: string;
  /** Lowercase weekday name, weekly schedules only */
  weekday: string | null;
  /** IANA timezone the time is expressed in */
  timezone: string;
  /** Where each run's result is delivered */
  delivery: 'chat' | 'slack';
  /** Slack channel, only when `delivery` is 'slack' */
  slackChannel: string | null;
  /** The user's message that asked for the schedule */
  originalPrompt: string;
  /** Human readable recurrence, e.g. "Every day at 8:00 AM" */
  scheduleSummary: string;
  /** Human readable first run, e.g. "Tomorrow at 8:00 AM" */
  nextRunLabel: string;
}

/** Result returned by POST /api/schedules. */
export interface CreatedSchedule {
  id: string;
  scheduleSummary: string;
  nextRunLabel: string;
  nextRunAt: string;
  delivery: 'chat' | 'slack';
}
