/**
 * Server-only helpers for Composio tool connection routes
 * (src/app/api/tools/[toolId]/*). Never import this from client code:
 * it reads COMPOSIO_API_KEY.
 *
 * Supabase access uses the caller's JWT, so RLS on user_tool_connections
 * enforces per-user isolation. No service role key is needed.
 */
import { Composio } from "@composio/core";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

export type ConnectionStatus =
  | "not_connected"
  | "pending"
  | "connected"
  | "failed"
  | "revoked";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolRow {
  id: string;
  name: string;
  slug: string;
  toolkit_slug: string;
  composio_auth_config_id: string | null;
  is_active: boolean;
}

let composioClient: Composio | null = null;

export function getComposio(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new HttpError(500, "COMPOSIO_API_KEY is not configured");
  composioClient ??= new Composio({ apiKey });
  return composioClient;
}

export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Wraps a handler so HttpErrors become JSON responses and others become 500. */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    console.error(error);
    return json({ error: "Internal server error" }, 500);
  }
}

/** Validates the Bearer token and returns a user-scoped Supabase client. */
export async function authenticate(
  req: Request,
): Promise<{ user: User; db: SupabaseClient }> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  if (!url || !anonKey) throw new HttpError(500, "Supabase is not configured");

  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Missing Authorization bearer token");

  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired session");
  return { user: data.user, db };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `toolId` may be the tools.id UUID or the tool slug (e.g. "gmail"). */
export async function loadTool(
  db: SupabaseClient,
  toolId: string,
): Promise<ToolRow> {
  const { data, error } = await db
    .from("tools")
    .select("id, name, slug, toolkit_slug, composio_auth_config_id, is_active")
    .eq(UUID_RE.test(toolId) ? "id" : "slug", toolId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new HttpError(500, `Failed to load tool: ${error.message}`);
  if (!data) throw new HttpError(404, "Tool not found");
  return data as ToolRow;
}

export async function loadConnection(
  db: SupabaseClient,
  userId: string,
  toolId: string,
) {
  const { data, error } = await db
    .from("user_tool_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("tool_id", toolId)
    .maybeSingle();
  if (error) throw new HttpError(500, `Failed to load: ${error.message}`);
  return data as Record<string, any> | null;
}

export function mapComposioStatus(status?: string | null): ConnectionStatus {
  switch (status) {
    case "ACTIVE":
      return "connected";
    case "REVOKED":
      return "revoked";
    case "FAILED":
    case "EXPIRED":
    case "INACTIVE":
      return "failed";
    default: // INITIALIZING, INITIATED, unknown
      return "pending";
  }
}

export function isNotFound(err: any) {
  return err?.status === 404 || /not.?found/i.test(err?.message ?? "");
}

/** Best-effort extraction of an account label/email from a Composio account. */
export function extractIdentity(account: unknown): {
  label: string | null;
  email: string | null;
} {
  const a = account as {
    data?: Record<string, unknown>;
    params?: Record<string, unknown>;
  };
  const sources = [a?.data, a?.params].filter(Boolean) as Record<
    string,
    unknown
  >[];
  const pick = (keys: string[]) => {
    for (const source of sources) {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value) return value;
      }
    }
    return null;
  };

  const email = pick(["email", "user_email", "emailAddress"]);
  const label = pick(["name", "username", "user_name", "team_name"]) ?? email;
  return { label, email };
}

export function publicConnection(row: Record<string, any> | null) {
  return {
    status: (row?.status ?? "not_connected") as ConnectionStatus,
    connected_label: row?.connected_label ?? null,
    connected_email: row?.connected_email ?? null,
    last_checked_at: row?.last_checked_at ?? null,
    connected_at: row?.connected_at ?? null,
  };
}

/** Finds this user's live Composio account for a toolkit, if any. */
export async function findConnectedAccountId(
  toolkitSlug: string,
  userId: string,
): Promise<string | null> {
  try {
    const list = await getComposio().connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [toolkitSlug],
    });
    const items = list.items ?? [];
    const active = items.find((item) => item.status === "ACTIVE");
    return (active ?? items[0])?.id ?? null;
  } catch (err) {
    console.error(`[identity] could not list ${toolkitSlug} accounts`, err);
    return null;
  }
}

/** Per-toolkit action that returns the signed-in account's profile. */
const PROFILE_ACTIONS: Record<
  string,
  { action: string; args?: Record<string, unknown> }
> = {
  gmail: { action: "GMAIL_GET_PROFILE" },
  googlecalendar: {
    action: "GOOGLECALENDAR_GET_CALENDAR",
    args: { calendar_id: "primary" },
  },
  github: { action: "GITHUB_GET_THE_AUTHENTICATED_USER" },
};

function findString(value: unknown, keys: string[], depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) return obj[key] as string;
  }
  for (const child of Object.values(obj)) {
    const found = findString(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Best-effort: asks the toolkit who is signed in. Never throws. */
export async function fetchAccountIdentity(
  toolkitSlug: string,
  userId: string,
  connectedAccountId: string,
): Promise<{ label: string | null; email: string | null }> {
  const profile = PROFILE_ACTIONS[toolkitSlug];
  if (!profile) return { label: null, email: null };
  try {
    const result = await getComposio().tools.execute(profile.action, {
      userId,
      connectedAccountId,
      arguments: profile.args ?? {},
      dangerouslySkipVersionCheck: true,
    });
    const data = (result as { data?: unknown }).data;
    const email =
      findString(data, ["emailAddress", "email"]) ??
      (toolkitSlug === "googlecalendar" ? findString(data, ["id"]) : null);
    const label = email ?? findString(data, ["login", "name"]);
    return { label, email };
  } catch (err) {
    console.error(`[identity] ${toolkitSlug} lookup failed`, err);
    return { label: null, email: null };
  }
}

/**
 * Same as `authenticate`, but returns null instead of throwing when the
 * request carries no (or an invalid) session. Used by routes that still work
 * for signed-out callers, such as /api/chat.
 */
export async function tryAuthenticate(
  req: Request,
): Promise<{ user: User; db: SupabaseClient } | null> {
  try {
    return await authenticate(req);
  } catch {
    return null;
  }
}
