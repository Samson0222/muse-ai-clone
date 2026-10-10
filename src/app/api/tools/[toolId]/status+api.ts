import {
  authenticate,
  extractIdentity,
  fetchAccountIdentity,
  findConnectedAccountId,
  getComposio,
  handle,
  HttpError,
  isNotFound,
  json,
  loadConnection,
  loadTool,
  mapComposioStatus,
  publicConnection,
} from "@/lib/toolConnections";

/** GET /api/tools/:toolId/status */
export async function GET(req: Request, { toolId }: { toolId: string }) {
  return handle(async () => {
    const { user, db } = await authenticate(req);
    const tool = await loadTool(db, toolId);
    const row = await loadConnection(db, user.id, tool.id);

    let accountId: string | null =
      row?.composio_connected_account_id ?? row?.composio_connection_request_id;

    // Rows written before the account id was stored (or by an older build) can
    // say "connected" with nothing to look up — recover the id from Composio.
    if (row && !accountId && row.status !== "revoked") {
      accountId = await findConnectedAccountId(tool.toolkit_slug, user.id);
    }

    // Nothing started yet, or already disconnected: nothing to check upstream.
    if (!row || !accountId || row.status === "revoked") {
      return json({ toolId: tool.id, ...publicConnection(row) });
    }

    const now = new Date().toISOString();
    let update: Record<string, unknown>;
    try {
      const account = await getComposio().connectedAccounts.get(accountId);
      const status = mapComposioStatus(account.status);
      update = { status, last_checked_at: now };

      if (status === "connected") {
        let { label, email } = extractIdentity(account);
        if (!email && !row.connected_email) {
          const identity = await fetchAccountIdentity(tool.toolkit_slug, user.id, accountId);
          label = label ?? identity.label;
          email = identity.email;
        }
        update = {
          ...update,
          connected_label: label ?? row.connected_label,
          connected_email: email ?? row.connected_email,
          connected_at: row.connected_at ?? now,
        };
      }
    } catch (err) {
      // Deleted on Composio's side counts as revoked; other errors bubble up.
      if (!isNotFound(err)) {
        console.error(err);
        throw new HttpError(502, "Failed to check Composio status");
      }
      update = { status: "revoked", last_checked_at: now };
    }

    const { data: saved, error } = await db
      .from("user_tool_connections")
      .update({ ...update, composio_connected_account_id: accountId })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new HttpError(500, `Failed to save: ${error.message}`);

    return json({ toolId: tool.id, ...publicConnection(saved) });
  });
}
