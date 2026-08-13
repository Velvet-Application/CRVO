import { getImportIdentity } from "./import-auth";

export type SqlFeedIdentity = { source: "bridge" | "dashboard"; actor: string };

export async function getSqlFeedIdentity(request: Request): Promise<SqlFeedIdentity | null> {
  const configured = process.env.CRVO_INGEST_TOKEN?.trim();
  const supplied = request.headers.get("x-crvo-ingest-token")?.trim();
  if (configured && supplied && constantTimeEqual(configured, supplied)) {
    return { source: "bridge", actor: "crvo-sql-bridge" };
  }

  const dashboard = await getImportIdentity(request);
  if (dashboard) return { source: "dashboard", actor: dashboard.email };
  return null;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
