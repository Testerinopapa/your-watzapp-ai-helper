export async function functionErrorCode(
  data: unknown,
  error: unknown,
): Promise<string | null> {
  const direct = (data as { error?: unknown } | null)?.error;
  if (typeof direct === "string") return direct;

  const context = (error as { context?: Response } | null)?.context;
  if (!context) return null;

  try {
    const body = await context.clone().json();
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}
