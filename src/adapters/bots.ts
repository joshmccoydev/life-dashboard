export type BotStatus = {
  name: string;
  status: string;
  detail: string | null;
};

type BotStatusRecord = Record<string, unknown>;

function property(record: BotStatusRecord, name: string): unknown {
  const entry = Object.entries(record).find(
    ([key]) => key.toLowerCase() === name,
  );
  return entry?.[1];
}

function normalizeDetail(value: unknown): string | null {
  if (value === undefined || value === null) return null;

  const detail = String(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([a-z][a-z\d+.-]*:\/\/[^>]+)>/gi, "$1")
    .trim();

  if (!detail || /^(?:none|-|n\/a)$/i.test(detail)) return null;
  return detail.slice(0, 200);
}

export function parseBotStatus(
  records: readonly BotStatusRecord[],
): BotStatus[] {
  return records
    .map((record, index) => ({
      bot: {
        name: String(property(record, "name") ?? ""),
        status: String(property(record, "status") ?? ""),
        detail: normalizeDetail(property(record, "detail")),
      },
      index,
    }))
    .sort((a, b) => {
      const waitingRank =
        Number(a.bot.status.trim().toLowerCase() !== "waiting") -
        Number(b.bot.status.trim().toLowerCase() !== "waiting");
      return waitingRank || a.index - b.index;
    })
    .map(({ bot }) => bot);
}
