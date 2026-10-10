/**
 * POST /api/tools/execute
 *
 * Runs a single tool capability after the user confirmed it in chat
 * (5. write action confirmation). The client only sends the capability key and
 * its arguments; everything else is re-validated here:
 *
 * - the caller's JWT identifies the user
 * - the capability must exist in the shared registry
 * - the matching tool must be connected for that user
 *
 * Every attempt is written to `agent_tool_runs` by `executeCapability`.
 */
import {
  executeCapability,
  getConnectedTools,
  resolveCapability,
} from "@/lib/agentTools";
import { authenticate, handle, HttpError, json } from "@/lib/toolConnections";

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await authenticate(req);

    const body = await req.json().catch(() => ({}));
    const capabilityKey = typeof body?.capability === "string" ? body.capability : "";
    const input =
      body?.input && typeof body.input === "object" ? body.input : {};

    if (!capabilityKey) throw new HttpError(400, "Missing capability");

    const connectedTools = await getConnectedTools(db, user.id);
    const { capability, connectedTool } = resolveCapability(
      connectedTools,
      capabilityKey,
    );

    if (!capability) throw new HttpError(400, `Unknown capability ${capabilityKey}`);
    if (!connectedTool) {
      throw new HttpError(
        409,
        `${capability.toolkit} is not connected. Connect it first and try again.`,
      );
    }

    const parsed = capability.parameters.safeParse(input);
    if (!parsed.success) {
      throw new HttpError(
        400,
        `Invalid arguments for ${capability.key}: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }

    const result = await executeCapability({
      db,
      userId: user.id,
      capability,
      input: parsed.data,
      connectedTool,
      metadata: { confirmed: true, source: "chat_confirmation" },
    });

    // A failed run answers 502 with `error`, which the client turns into the
    // chat message, so the wording is not duplicated here.
    return json(
      {
        status: result.status,
        action: result.action,
        capability: capability.key,
        tool: connectedTool.name,
        input_summary: result.inputSummary,
        output_summary: result.outputSummary,
        error_message: result.error ?? null,
        error: result.error ?? undefined,
        message: `Done — ${result.inputSummary}.`,
      },
      result.status === "success" ? 200 : 502,
    );
  });
}
