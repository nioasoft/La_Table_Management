import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getCronExecutionLogs, type CronJobName } from "@/lib/cron-logger";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const searchParams = request.nextUrl.searchParams;
  const jobName = searchParams.get("jobName") as CronJobName | null;
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const logs = await getCronExecutionLogs({
    jobName: jobName || undefined,
    limit: Math.min(limit, 200),
  });

  return NextResponse.json({ logs });
}
