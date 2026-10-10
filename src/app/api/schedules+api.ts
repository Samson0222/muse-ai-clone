/**
 * POST /api/schedules
 *
 * Saves a recurring task the user confirmed in chat. The agent only prepares
 * the schedule (see `schedule_task`); this route is the single place that
 * writes to `public.scheduled_agent_tasks`, after the Confirm button press.
 *
 * The caller's JWT identifies the user and scopes the insert through RLS, and
 * `next_run_at` is recomputed server side from the rule and timezone.
 */
import { authenticate, handle, HttpError, json } from "@/lib/toolConnections";
import { createScheduleBodySchema, createScheduledTask } from "@/lib/scheduledTasks";

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await authenticate(req);

    const parsed = createScheduleBodySchema.safeParse(
      await req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      throw new HttpError(
        400,
        `Invalid schedule: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }

    try {
      const schedule = await createScheduledTask(db, user.id, parsed.data);
      return json(schedule, 201);
    } catch (error: any) {
      throw new HttpError(422, error?.message ?? "Could not save the schedule.");
    }
  });
}
