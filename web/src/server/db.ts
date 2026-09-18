import postgres from "postgres";

declare global { var sectionarySql: ReturnType<typeof postgres> | undefined; }

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return globalThis.sectionarySql ??= postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
}

export function apiError(error: unknown) {
  console.error(error);
  const message = error instanceof Error && error.message.includes("DATABASE_URL") ? error.message : "Database request failed";
  return Response.json({ error: message, code: "DATABASE_ERROR" }, { status: 503 });
}
