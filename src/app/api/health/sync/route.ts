import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "@/config";
import {
  healthAuthorized,
  normalizeHealthSync,
  mergeHealthDays,
  type HealthDay,
} from "@/lib/health-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let writes = Promise.resolve();
export async function POST(request: Request) {
  if (!process.env.HEALTH_SYNC_TOKEN)
    return Response.json(
      { error: "Health sync is not paired. Run npm run health:pair." },
      { status: 503 },
    );
  if (
    !healthAuthorized(
      request.headers.get("authorization"),
      process.env.HEALTH_SYNC_TOKEN,
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json({ error: "Send application/json" }, { status: 415 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1048576) {
        await reader.cancel();
        return Response.json(
          { error: "Use a small daily summary (max 1 MB)" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const now = new Date(),
      updates = normalizeHealthSync(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
        config.display.timezone,
        now,
      );
    const write = writes.then(async () => {
      const folder = join(process.cwd(), ".lifedash"),
        file = join(folder, "health-sync.json");
      await mkdir(folder, { recursive: true });
      let previous: HealthDay[] = [];
      try {
        const snapshot = JSON.parse(await readFile(file, "utf8"));
        if (
          snapshot.timezone === config.display.timezone &&
          Array.isArray(snapshot.days)
        )
          previous = snapshot.days;
      } catch {}
      const days = mergeHealthDays(
        previous,
        updates,
        now.toISOString(),
        config.display.timezone,
      );
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(
        temp,
        JSON.stringify({
          version: 1,
          timezone: config.display.timezone,
          importedAt: now.toISOString(),
          days,
        }),
        { mode: 0o600 },
      );
      await rename(temp, file);
    });
    writes = write.catch(() => {});
    await write;
    return Response.json(
      { ok: true, daysUpdated: updates.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid =
      error instanceof SyntaxError ||
      (error instanceof Error && !("code" in error));
    return Response.json(
      {
        error:
          invalid && error instanceof Error
            ? error.message
            : "Could not save Health summary",
      },
      { status: invalid ? 400 : 500 },
    );
  }
}
