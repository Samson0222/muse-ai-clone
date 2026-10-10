import {
  authenticate,
  getComposio,
  handle,
  HttpError,
  isNotFound,
  json,
  loadConnection,
  loadTool,
  publicConnection,
} from "@/lib/toolConnections";

/** POST /api/tools/:toolId/disconnect */
export async function POST(req: Request, { toolId }: { toolId: string }) {
  return handle(async () => {
    const { user, db } = await authenticate(req);
    const tool = await loadTool(db, toolId);
    const row = await loadConnection(db, user.id, tool.id);
    if (!row) return json({ toolId: tool.id, ...publicConnection(null) });

    const accountId =
      row.composio_connected_account_id ?? row.composio_connection_request_id;
    if (accountId) {
      try {
        await getComposio().connectedAccounts.delete(accountId);
      } catch (err) {
        // Already gone upstream is fine; any other failure must not look like success.
        if (!isNotFound(err)) {
          console.error(err);
          throw new HttpError(502, "Failed to revoke Composio connection");
        }
      }
    }

    const { data: saved, error } = await db
      .from("user_tool_connections")
      .update({
        // Abandoning a half-finished connect is not a revocation.
        status: row.status === "pending" ? "not_connected" : "revoked",
        composio_connected_account_id: null,
        composio_connection_request_id: null,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new HttpError(500, `Failed to save: ${error.message}`);

    return json({ toolId: tool.id, ...publicConnection(saved) });
  });
}
