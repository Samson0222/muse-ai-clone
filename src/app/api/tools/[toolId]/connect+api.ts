import {
  authenticate,
  getComposio,
  handle,
  HttpError,
  json,
  loadTool,
} from "@/lib/toolConnections";

/** POST /api/tools/:toolId/connect */
export async function POST(req: Request, { toolId }: { toolId: string }) {
  return handle(async () => {
    const { user, db } = await authenticate(req);
    const tool = await loadTool(db, toolId);

    if (!tool.composio_auth_config_id) {
      throw new HttpError(
        400,
        `${tool.name} has no composio_auth_config_id configured`,
      );
    }

    // Optional deep link Composio redirects to after OAuth completes.
    const body = await req.json().catch(() => ({}));
    const callbackUrl: string | undefined =
      typeof body?.callbackUrl === "string"
        ? body.callbackUrl
        : process.env.COMPOSIO_CALLBACK_URL || undefined;

    const request = await getComposio().connectedAccounts.link(
      user.id,
      tool.composio_auth_config_id,
      callbackUrl ? { callbackUrl } : undefined,
    );

    if (!request.redirectUrl) {
      throw new HttpError(502, "Composio did not return a connect URL");
    }

    // For link flows the request id is the connected account id (ca_...).
    const { error } = await db.from("user_tool_connections").upsert(
      {
        user_id: user.id,
        tool_id: tool.id,
        status: "pending",
        composio_connected_account_id: request.id,
        composio_connection_request_id: request.id,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "user_id,tool_id" },
    );
    if (error) throw new HttpError(500, `Failed to save: ${error.message}`);

    return json({
      status: "pending",
      connectUrl: request.redirectUrl,
      connectionRequestId: request.id,
    });
  });
}
