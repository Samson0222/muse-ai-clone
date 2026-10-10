/**
 * Muse AI Clone - Connected Tools <-> Agent Bridge (server only)
 *
 * Turns the user's connected Composio accounts into OpenAI Agents tools:
 *
 * - `getConnectedTools` loads the current user's connected tools.
 * - `buildCapabilityTools` exposes read capabilities that execute immediately
 *   and write capabilities that stop and ask the chat UI for confirmation.
 * - `executeCapability` performs a Composio action and writes an
 *   `agent_tool_runs` row for every attempt, success or failure.
 *
 * Never import this from client code: it reads COMPOSIO_API_KEY through
 * `getComposio()`.
 */
import {
  Capability,
  capabilitiesForToolkit,
  getCapability,
} from "@/lib/agentToolkits";
import { findConnectedAccountId, getComposio } from "@/lib/toolConnections";
import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A tool the user has actually connected, ready for execution. */
export interface ConnectedTool {
  tool_id: string;
  name: string;
  slug: string;
  toolkit_slug: string;
  actions: { name: string; description?: string }[];
  composio_connected_account_id: string | null;
  connected_label: string | null;
  logo_url: string | null;
  logo_key: string | null;
}

export interface ToolRunLog {
  user_id: string;
  tool_id: string | null;
  action_name: string;
  input_summary: string | null;
  output_summary: string | null;
  status: "success" | "failed";
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

/** Payload the chat UI sends back when the user confirms a write action. */
export interface ConfirmationRequest {
  type: "confirmation_required";
  capability: string;
  toolSlug: string;
  toolName: string;
  toolkitSlug: string;
  logoUrl: string | null;
  logoKey: string | null;
  /** One-line description of what will happen. */
  actionSummary: string;
  /** Multi-line detail rendered inside the confirmation card. */
  details: string;
  input: Record<string, unknown>;
}

const AGENT_OUTPUT_LIMIT = 4000;
const LOG_OUTPUT_LIMIT = 1000;

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeActions(raw: unknown): ConnectedTool["actions"] {
  const list = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(list)) return [];
  return list
    .map((item: any) => ({
      name: String(item?.name ?? ""),
      description: item?.description ? String(item.description) : undefined,
    }))
    .filter((item) => item.name);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * 1. Connected tools context for the current user.
 * Returns toolkit_slug, tool name, actions, composio_connected_account_id and
 * connected_label for every tool whose connection is live.
 */
export async function getConnectedTools(
  db: SupabaseClient,
  userId: string,
): Promise<ConnectedTool[]> {
  const { data, error } = await db
    .from("user_tool_connections")
    .select(
      "tool_id, composio_connected_account_id, composio_connection_request_id, connected_label, connected_email, tools!inner(id, name, slug, toolkit_slug, actions, is_active, logo_url, logo_key)",
    )
    .eq("user_id", userId)
    .eq("status", "connected");

  if (error) {
    console.error("[agentTools] failed to load connected tools", error.message);
    return [];
  }

  const rows = (data ?? []) as any[];

  const connected = await Promise.all(
    rows
      .filter((row) => row.tools?.is_active !== false)
      .map(async (row): Promise<ConnectedTool> => {
        const toolkitSlug = String(row.tools?.toolkit_slug ?? row.tools?.slug ?? "");
        let accountId: string | null =
          row.composio_connected_account_id ??
          row.composio_connection_request_id ??
          null;

        // Rows written by an older build can be connected without an id.
        if (!accountId && toolkitSlug) {
          accountId = await findConnectedAccountId(toolkitSlug, userId);
        }

        return {
          tool_id: String(row.tools?.id ?? row.tool_id),
          name: String(row.tools?.name ?? ""),
          slug: String(row.tools?.slug ?? ""),
          toolkit_slug: toolkitSlug,
          actions: normalizeActions(row.tools?.actions),
          composio_connected_account_id: accountId,
          connected_label: row.connected_label ?? row.connected_email ?? null,
          logo_url: row.tools?.logo_url ?? null,
          logo_key: row.tools?.logo_key ?? null,
        };
      }),
  );

  return connected;
}

/** Looks up catalog rows for the tools a request needs but the user lacks. */
export async function loadToolsBySlugs(db: SupabaseClient, slugs: string[]) {
  if (slugs.length === 0) return [];
  const { data, error } = await db
    .from("tools")
    .select("id, name, slug, toolkit_slug, description, logo_url, logo_key")
    .in("slug", slugs)
    .eq("is_active", true);

  if (error) {
    console.error("[agentTools] failed to load tool catalog", error.message);
    return [];
  }
  return (data ?? []) as {
    id: string;
    name: string;
    slug: string;
    toolkit_slug: string;
    description: string | null;
    logo_url: string | null;
    logo_key: string | null;
  }[];
}

/**
 * 6. Tool run logging. Never throws: a logging failure must not break a reply.
 */
export async function logToolRun(db: SupabaseClient, run: ToolRunLog) {
  try {
    const { error } = await db.from("agent_tool_runs").insert({
      user_id: run.user_id,
      tool_id: run.tool_id,
      action_name: run.action_name,
      input_summary: run.input_summary,
      output_summary: run.output_summary,
      status: run.status,
      error_message: run.error_message ?? null,
      metadata: run.metadata ?? {},
    });
    if (error) console.error("[agentTools] failed to log tool run", error.message);
  } catch (err) {
    console.error("[agentTools] failed to log tool run", err);
  }
}

/** True when the failure looks like a wrong action slug or argument shape. */
function shouldTryNextCandidate(err: any): boolean {
  if (err?.status === 404) return true;
  const message = `${err?.message ?? ""} ${stringify(err?.response ?? "")}`;
  return /not.?found|does not exist|no such|unknown (action|tool)|unsupported|invalid (action|tool|argument|parameter)|required (property|field)|validation/i.test(
    message,
  );
}

export interface CapabilityResult {
  status: "success" | "failed";
  /** Composio action slug that actually ran (or the last one attempted). */
  action: string;
  inputSummary: string;
  outputSummary: string;
  data?: unknown;
  error?: string;
}

/**
 * Executes a capability through Composio and logs the run.
 * Walks the capability's candidate action slugs so a renamed Composio action
 * does not take the feature down.
 */
export async function executeCapability({
  db,
  userId,
  capability,
  input,
  connectedTool,
  metadata,
}: {
  db: SupabaseClient;
  userId: string;
  capability: Capability;
  input: Record<string, unknown>;
  connectedTool: ConnectedTool;
  metadata?: Record<string, unknown>;
}): Promise<CapabilityResult> {
  const inputSummary = capability.summarize(input);
  const composio = getComposio();
  let lastError: any = null;
  let lastAction = capability.candidates[0]?.action ?? capability.key;

  for (const candidate of capability.candidates) {
    lastAction = candidate.action;
    try {
      const result = await composio.tools.execute(candidate.action, {
        userId,
        connectedAccountId: connectedTool.composio_connected_account_id ?? undefined,
        arguments: candidate.buildArgs(input),
        dangerouslySkipVersionCheck: true,
      });

      const payload = result as { data?: unknown; successful?: boolean; error?: unknown };

      if (payload?.successful === false) {
        lastError = new Error(stringify(payload.error) || "Composio reported a failure");
        if (shouldTryNextCandidate(lastError)) continue;
        break;
      }

      const outputSummary = clip(stringify(payload?.data ?? payload), LOG_OUTPUT_LIMIT);

      await logToolRun(db, {
        user_id: userId,
        tool_id: connectedTool.tool_id,
        action_name: candidate.action,
        input_summary: inputSummary,
        output_summary: outputSummary,
        status: "success",
        metadata: { capability: capability.key, kind: capability.kind, ...metadata },
      });

      return {
        status: "success",
        action: candidate.action,
        inputSummary,
        outputSummary,
        data: payload?.data ?? payload,
      };
    } catch (err) {
      lastError = err;
      if (!shouldTryNextCandidate(err)) break;
    }
  }

  const errorMessage = clip(
    (lastError?.message as string) || "Tool execution failed",
    LOG_OUTPUT_LIMIT,
  );

  await logToolRun(db, {
    user_id: userId,
    tool_id: connectedTool.tool_id,
    action_name: lastAction,
    input_summary: inputSummary,
    output_summary: null,
    status: "failed",
    error_message: errorMessage,
    metadata: { capability: capability.key, kind: capability.kind, ...metadata },
  });

  return {
    status: "failed",
    action: lastAction,
    inputSummary,
    outputSummary: "",
    error: errorMessage,
  };
}

/** Resolves a capability key plus the user's connected tool for its toolkit. */
export function resolveCapability(
  connectedTools: ConnectedTool[],
  capabilityKey: string,
) {
  const capability = getCapability(capabilityKey);
  if (!capability) return { capability: null, connectedTool: null } as const;
  const connectedTool =
    connectedTools.find((t) => t.toolkit_slug === capability.toolkit) ?? null;
  return { capability, connectedTool } as const;
}

/**
 * 4 + 5. Agent tools for every connected toolkit.
 * Read capabilities execute straight away; write capabilities return a
 * confirmation request that the chat UI turns into a Confirm / Cancel card.
 */
export function buildCapabilityTools({
  db,
  userId,
  connectedTools,
}: {
  db: SupabaseClient;
  userId: string;
  connectedTools: ConnectedTool[];
}) {
  const tools: ReturnType<typeof tool>[] = [];

  for (const connectedTool of connectedTools) {
    for (const capability of capabilitiesForToolkit(connectedTool.toolkit_slug)) {
      tools.push(
        tool({
          name: capability.key,
          description: `${capability.description} Connected account: ${
            connectedTool.connected_label ?? connectedTool.name
          }.`,
          parameters: capability.parameters as any,
          execute: async (input: any) => {
            if (capability.kind === "write") {
              const request: ConfirmationRequest = {
                type: "confirmation_required",
                capability: capability.key,
                toolSlug: connectedTool.slug,
                toolName: connectedTool.name,
                toolkitSlug: connectedTool.toolkit_slug,
                logoUrl: connectedTool.logo_url,
                logoKey: connectedTool.logo_key,
                actionSummary: capability.summarize(input),
                details: capability.confirmLabel?.(input) ?? capability.summarize(input),
                input,
              };
              return request;
            }

            const result = await executeCapability({
              db,
              userId,
              capability,
              input,
              connectedTool,
            });

            if (result.status === "failed") {
              return {
                type: "tool_error",
                tool: connectedTool.name,
                action: result.action,
                error: result.error,
              };
            }

            return {
              type: "tool_result",
              tool: connectedTool.name,
              action: result.action,
              data: clip(stringify(result.data), AGENT_OUTPUT_LIMIT),
            };
          },
        }),
      );
    }
  }

  return tools;
}

/** Instruction block describing the user's connected tools to the model. */
export function describeConnectedTools(connectedTools: ConnectedTool[]): string {
  if (connectedTools.length === 0) {
    return "The user has no connected tools. Do not claim you can read their email, Slack or calendar.";
  }

  const lines = connectedTools.map((t) => {
    const caps = capabilitiesForToolkit(t.toolkit_slug);
    const names = caps.map((c) => c.key).join(", ") || "no agent actions yet";
    return `- ${t.name} (${t.toolkit_slug})${
      t.connected_label ? ` as ${t.connected_label}` : ""
    }: ${names}`;
  });

  return `CONNECTED TOOLS\n${lines.join("\n")}`;
}
