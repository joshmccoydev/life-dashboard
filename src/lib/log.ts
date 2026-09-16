export function log(event: string, details: Record<string, unknown> = {}) {
  console.info(
    JSON.stringify({ time: new Date().toISOString(), event, ...details }),
  );
}
