import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { verifyAccessJwt } from "@/lib/access-auth";
import {
  ACTIONS_KEY,
  parseActions,
  summarize,
} from "@/lib/decision-actions";
import { buildSnapshot, type Snapshot } from "@/lib/decisions";
import { readKvFeeds } from "@/lib/feed-store";

export const dynamic = "force-dynamic";

export type DecisionsPageDependencies = {
  accessJwt?: string | null;
  verify?: (jwt: string | null) => Promise<{ ok: boolean }>;
  snapshot?: () => Promise<Snapshot>;
  env?: {
    FEEDS_KV?: {
      get(key: string): Promise<string | null>;
    };
  };
  getCloudflareContext?: () => unknown;
  now?: Date;
};

type KvBinding = NonNullable<
  NonNullable<DecisionsPageDependencies["env"]>["FEEDS_KV"]
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKvBinding(value: unknown): value is KvBinding {
  return isRecord(value) && typeof value.get === "function";
}

function isSnapshot(value: unknown): value is Snapshot {
  return (
    isRecord(value) &&
    typeof value.generatedAt === "string" &&
    typeof value.count === "number" &&
    Array.isArray(value.cards)
  );
}

function decisionSnapshotFromFeeds(incoming: unknown): Snapshot | null {
  if (!isRecord(incoming) || !isRecord(incoming.decisions)) return null;

  const data = incoming.decisions.data;
  return isSnapshot(data) ? data : null;
}

async function resolveEnv(
  dependencies: DecisionsPageDependencies,
): Promise<DecisionsPageDependencies["env"]> {
  if (dependencies.env) return dependencies.env;

  try {
    const context = await (
      dependencies.getCloudflareContext ?? getCloudflareContext
    )();
    if (!isRecord(context) || !isRecord(context.env)) return undefined;

    return {
      FEEDS_KV: isKvBinding(context.env.FEEDS_KV)
        ? context.env.FEEDS_KV
        : undefined,
    };
  } catch {
    return undefined;
  }
}

function formatAge(
  ageMin: number | null,
  createdAt: string | null,
  generatedAt: string,
): string | null {
  if (ageMin === null || !Number.isFinite(ageMin)) return null;

  const createdMs = createdAt === null ? Number.NaN : Date.parse(createdAt);
  const generatedMs = Date.parse(generatedAt);
  const elapsedMs = generatedMs - createdMs;
  const minutes =
    Number.isFinite(elapsedMs) && elapsedMs >= 0
      ? Math.floor(elapsedMs / 60_000)
      : Math.max(0, Math.floor(ageMin));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1_440)}d`;
}

const styles = {
  page: {
    minHeight: "100dvh",
    margin: 0,
    padding: "20px 16px 40px",
    boxSizing: "border-box",
    background: "var(--bg)",
    color: "var(--fg)",
    fontFamily:
      "var(--font-ui)",
  },
  container: {
    width: "100%",
    maxWidth: 720,
    padding: 16,
    boxSizing: "border-box",
    overflowWrap: "anywhere",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 16,
    margin: "0 0 18px",
  },
  heading: {
    margin: 0,
    fontSize: "1.85rem",
    lineHeight: 1.1,
    letterSpacing: 0,
  },
  count: {
    color: "var(--fg-muted)",
    fontSize: "1rem",
    fontWeight: 600,
  },
  empty: {
    margin: "32px 0",
    color: "var(--fg-muted)",
  },
  card: {
    width: "100%",
    margin: "0 0 14px",
    padding: 16,
    boxSizing: "border-box",
    border: "var(--hairline)",
    borderRadius: 8,
    background: "var(--surface)",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  bot: {
    color: "var(--fg)",
    fontSize: "0.95rem",
    fontWeight: 750,
    overflowWrap: "anywhere",
  },
  badge: {
    display: "inline-flex",
    minHeight: 28,
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: "0.78rem",
    fontWeight: 700,
    lineHeight: 1.1,
  },
  dueBadge: {
    background: "color-mix(in srgb, var(--need-action) 14%, var(--surface))",
    color: "var(--need-action-text)",
  },
  blockingBadge: {
    background: "color-mix(in srgb, var(--need-blocking) 14%, var(--surface))",
    color: "var(--need-blocking-text)",
  },
  age: {
    marginLeft: "auto",
    color: "var(--fg-muted)",
    fontSize: "0.84rem",
    whiteSpace: "nowrap",
  },
  question: {
    display: "block",
    margin: "0 0 10px",
    fontSize: "1.08rem",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  },
  rec: {
    margin: "0 0 10px",
    color: "var(--fg-muted)",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  },
  context: {
    display: "-webkit-box",
    margin: "0 0 12px",
    overflow: "hidden",
    color: "var(--fg-muted)",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 3,
  },
  details: {
    margin: "0 0 14px",
    color: "var(--fg-muted)",
    fontSize: "0.86rem",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  },
  detailsLink: {
    color: "var(--side-grok-text)",
    textDecoration: "underline",
  },
  chosen: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    color: "var(--fg-muted)",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  },
  reply: {
    width: "100%",
    minHeight: 44,
    margin: "0 0 10px",
    padding: "9px 12px",
    boxSizing: "border-box",
    border: "var(--hairline)",
    borderRadius: 6,
    background: "var(--bg)",
    color: "var(--fg)",
    fontSize: "1rem",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    minHeight: 44,
    padding: "9px 12px",
    border: "var(--hairline)",
    borderRadius: 6,
    background: "var(--surface-hover)",
    color: "var(--fg)",
    fontSize: "0.96rem",
    fontWeight: 700,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;

export async function DecisionsPageContent(
  dependencies: DecisionsPageDependencies,
): Promise<ReactNode> {
  const now = dependencies.now ?? new Date();
  const verify =
    dependencies.verify ??
    ((accessJwt: string | null) =>
      verifyAccessJwt(accessJwt, {
        fetchImpl: globalThis.fetch,
        now: now.getTime(),
      }));
  const access = await verify(dependencies.accessJwt ?? null);
  if (!access.ok) {
    return "unauthorized";
  }

  const diskSnapshot = await (
    dependencies.snapshot ??
    (() =>
      buildSnapshot({
        vaultDir: process.env.DECISIONS_VAULT ?? "/workspace/vault",
        remindersFile:
          process.env.DECISIONS_REMINDERS ??
          "/workspace/reminders-queue.md",
        now,
      }))
  )();
  let snapshot = diskSnapshot;
  let env: DecisionsPageDependencies["env"];

  if (diskSnapshot.cards.length === 0) {
    try {
      env = await resolveEnv(dependencies);
      const feeds = await readKvFeeds(env?.FEEDS_KV);
      snapshot = decisionSnapshotFromFeeds(feeds) ?? diskSnapshot;
    } catch {
      snapshot = diskSnapshot;
    }
  }

  let actions: ReturnType<typeof parseActions> = [];
  try {
    env ??= await resolveEnv(dependencies);
    if (env?.FEEDS_KV) {
      actions = parseActions(await env.FEEDS_KV.get(ACTIONS_KEY));
    }
  } catch {
    actions = [];
  }
  const actionsByDecision = new Map(
    actions.map((action) => [action.decisionId, action]),
  );

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.heading}>decisions</h1>
          <span style={styles.count}>{snapshot.count}</span>
        </header>

        {snapshot.cards.length === 0 ? (
          <p style={styles.empty}>no decisions waiting</p>
        ) : (
          snapshot.cards.map((card) => {
            const age = formatAge(
              card.ageMin,
              card.createdAt,
              snapshot.generatedAt,
            );
            const questionSummary = summarize(card.question);
            const action = actionsByDecision.get(card.id);
            const chosenAction =
              action?.status === "chosen" ? action : undefined;

            return (
              <form
                key={card.id}
                method="post"
                action="/api/decisions"
                style={styles.card}
              >
                <input type="hidden" name="id" value={card.id} />

                <div style={styles.meta}>
                  <span style={styles.bot}>{card.bot || "unknown bot"}</span>
                  {card.due ? (
                    <span style={{ ...styles.badge, ...styles.dueBadge }}>
                      due {card.due}
                    </span>
                  ) : null}
                  {card.blocking ? (
                    <span
                      style={{
                        ...styles.badge,
                        ...styles.blockingBadge,
                      }}
                    >
                      blocking
                    </span>
                  ) : null}
                  {age ? <span style={styles.age}>{age}</span> : null}
                </div>

                <strong style={styles.question}>{questionSummary}</strong>
                {questionSummary !== card.question ? (
                  <details style={styles.details}>
                    <summary style={styles.detailsLink}>more</summary>
                    <span>{card.question}</span>
                  </details>
                ) : null}

                {card.rec ? <p style={styles.rec}>rec: {card.rec}</p> : null}
                {card.context ? (
                  <p style={styles.context}>{card.context}</p>
                ) : null}
                {card.link ? (
                  <p style={styles.details}>
                    details:{" "}
                    {/^https?:\/\//i.test(card.link) ? (
                      <a
                        href={card.link}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.detailsLink}
                      >
                        {card.link}
                      </a>
                    ) : (
                      <span>{card.link}</span>
                    )}
                  </p>
                ) : null}

                {chosenAction ? (
                  <div style={styles.chosen}>
                    <span>{`chosen: ${chosenAction.choice}`}</span>
                    <button
                      type="submit"
                      name="choice"
                      value="undo"
                      style={styles.button}
                    >
                      undo
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      name="reply"
                      maxLength={500}
                      placeholder="reply (optional)"
                      aria-label="reply"
                      style={styles.reply}
                    />

                    <div style={styles.actions}>
                      <button
                        type="submit"
                        name="choice"
                        value="yes"
                        style={styles.button}
                      >
                        yes
                      </button>
                      <button
                        type="submit"
                        name="choice"
                        value="no"
                        style={styles.button}
                      >
                        no
                      </button>
                      <button
                        type="submit"
                        name="choice"
                        value="later"
                        style={styles.button}
                      >
                        later
                      </button>
                      <button
                        type="submit"
                        name="choice"
                        value="reply"
                        style={styles.button}
                      >
                        reply
                      </button>
                    </div>
                  </>
                )}
              </form>
            );
          })
        )}
      </div>
    </main>
  );
}

export default async function DecisionsPage(): Promise<ReactNode> {
  const now = new Date();
  const accessJwt = (await headers()).get("cf-access-jwt-assertion");
  const access = await verifyAccessJwt(accessJwt, {
    fetchImpl: globalThis.fetch,
    now: now.getTime(),
  });

  return DecisionsPageContent({
    accessJwt,
    verify: async () => access,
    now,
  });
}
