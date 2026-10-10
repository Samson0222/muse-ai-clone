/**
 * Client-side wrappers for the Composio connection API routes.
 * Safe for React Native: only talks to our own /api/tools/* endpoints.
 */
import { getApiUrl } from "@/lib/services";
import { supabase } from "@/lib/supabase";
import type {
  ChatScheduleRequest,
  CreatedSchedule,
  ToolExecutionResult,
} from "@/types";

export type ToolConnectionState = {
  toolId: string;
  status: "not_connected" | "pending" | "connected" | "failed" | "revoked";
  connected_label: string | null;
  connected_email: string | null;
  last_checked_at: string | null;
  connected_at: string | null;
};

/** Calls one of our /api/tools/* routes with the user's Supabase JWT. */
async function authorizedRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in first.");

  const res = await fetch(getApiUrl(path), {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      payload?.error ?? payload?.message ?? `Request failed (${res.status})`,
    );
  }
  return payload as T;
}

function request<T>(
  toolId: string,
  action: "connect" | "status" | "disconnect",
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  return authorizedRequest<T>(
    `tools/${encodeURIComponent(toolId)}/${action}`,
    init,
  );
}

/** Starts OAuth; open `connectUrl` with expo-web-browser. */
export function startToolConnection(toolId: string, callbackUrl?: string) {
  return request<{
    status: "pending";
    connectUrl: string;
    connectionRequestId: string;
  }>(toolId, "connect", { method: "POST", body: { callbackUrl } });
}

export function checkToolConnection(toolId: string) {
  return request<ToolConnectionState>(toolId, "status", { method: "GET" });
}

export function disconnectTool(toolId: string) {
  return request<ToolConnectionState>(toolId, "disconnect", { method: "POST" });
}

/**
 * Runs a write action the user just confirmed in chat.
 * The server re-checks the capability and the connection before executing,
 * and logs the run to `agent_tool_runs`.
 */
export function executeConfirmedToolAction(
  capability: string,
  input: Record<string, unknown>,
) {
  return authorizedRequest<ToolExecutionResult>("tools/execute", {
    method: "POST",
    body: { capability, input },
  });
}

/**
 * Saves the recurring task the user just confirmed in chat. The server
 * recomputes the first run time and inserts into `scheduled_agent_tasks`,
 * which the Supabase cron dispatcher then runs when it is due.
 */
export function createConfirmedSchedule(
  request: ChatScheduleRequest,
  sourceThreadId: string | null,
) {
  return authorizedRequest<CreatedSchedule>("schedules", {
    method: "POST",
    body: {
      title: request.title,
      task: request.task,
      webTask: request.webTask,
      frequency: request.frequency,
      time: request.time,
      weekday: request.weekday,
      timezone: request.timezone,
      delivery: request.delivery,
      slackChannel: request.slackChannel,
      originalPrompt: request.originalPrompt,
      sourceThreadId,
    },
  });
}
