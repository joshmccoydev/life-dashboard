import { getCloudflareContext } from "@opennextjs/cloudflare";
import { join } from "node:path";
import {
  DECISIONS_PATH,
  appendAnswer,
  buildSnapshot,
  formatAnswerLine,
  type Snapshot,
} from "@/lib/decisions";
import { isAccessAuthorized } from "@/lib/access-auth";
import {
  isSameOrigin,
  recordChoice,
  undoChoice,
} from "@/lib/decision-actions";
import { readKvFeeds } from "@/lib/feed-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
} as const;

type Choice = "yes" | "no" | "later" | "reply";

type Submission = {
  id: string;
  choice: Choice | "undo";
  reply: string;
};

type KvBinding = {
  get(key: string): Promise<string | null>;
  put?(key: string, value: string): Promise<void>;
};

type RouteDependencies = {
  env?: { FEEDS_KV?: KvBinding };
  getCloudflareContext?: () =>
    | { env: { FEEDS_KV?: KvBinding } }
    | Promise<{ env: { FEEDS_KV?: KvBinding } }>;
  snapshot?: () => Promise<Snapshot>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKvBinding(value: unknown): value is KvBinding {
  return isRecord(value) && typeof value.get === "function";
}

function isWritableKv(
  value: KvBinding | undefined,
): value is KvBinding & { put(key: string, value: string): Promise<void> } {
  return typeof value?.put === "function";
}

async function resolveEnv(
  dependencies: RouteDependencies,
): Promise<RouteDependencies["env"]> {
  if (dependencies.env) return dependencies.env;

  try {
    const context = await (
      dependencies.getCloudflareContext ?? getCloudflareContext
    )();
    if (!isRecord(context) || !isRecord(context.env)) return undefined;
    return {
      FEEDS_KV: isKvBinding(context.env.FEEDS_KV)
        ? {
            get: context.env.FEEDS_KV.get,
            ...(typeof context.env.FEEDS_KV.put === "function"
              ? { put: context.env.FEEDS_KV.put }
              : {}),
          }
        : undefined,
    };
  } catch {
    return undefined;
  }
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

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function unauthorizedResponse(): Response {
  return new Response("unauthorized", {
    status: 401,
    headers: RESPONSE_HEADERS,
  });
}

function isAuthorized(request: Request): Promise<boolean> {
  return isAccessAuthorized(request, {
    fetchImpl: globalThis.fetch,
    now: new Date().getTime(),
  });
}

function snapshotOptions(now = new Date()) {
  return {
    vaultDir: process.env.DECISIONS_VAULT ?? "/workspace/vault",
    remindersFile:
      process.env.DECISIONS_REMINDERS ??
      "/workspace/reminders-queue.md",
    now,
  };
}

function validateSubmission(values: {
  id?: unknown;
  choice?: unknown;
  reply?: unknown;
}):
  | { submission: Submission; error: null }
  | { submission: null; error: string } {
  if (
    typeof values.id !== "string" ||
    !values.id ||
    typeof values.choice !== "string" ||
    (values.reply !== undefined && typeof values.reply !== "string")
  ) {
    return { submission: null, error: "invalid request" };
  }

  if (
    values.choice !== "yes" &&
    values.choice !== "no" &&
    values.choice !== "later" &&
    values.choice !== "reply" &&
    values.choice !== "undo"
  ) {
    return { submission: null, error: "invalid choice" };
  }

  const reply = values.reply ?? "";
  if (reply.length > 500) {
    return { submission: null, error: "reply too long" };
  }

  return {
    submission: {
      id: values.id,
      choice: values.choice,
      reply,
    },
    error: null,
  };
}

export async function GET(
  request: Request,
  context?: { params?: Promise<unknown> } & RouteDependencies,
): Promise<Response> {
  if (!(await isAuthorized(request))) {
    return unauthorizedResponse();
  }

  try {
    const dependencies = context ?? {};
    const build =
      dependencies.snapshot ?? (() => buildSnapshot(snapshotOptions()));
    const diskSnapshot = await build();
    if (diskSnapshot.cards.length > 0) return jsonResponse(diskSnapshot);

    const env = await resolveEnv(dependencies);
    const feeds = await readKvFeeds(env?.FEEDS_KV);
    return jsonResponse(decisionSnapshotFromFeeds(feeds) ?? diskSnapshot);
  } catch {
    return jsonResponse({ error: "internal server error" }, 500);
  }
}

export async function POST(
  request: Request,
  context?: { params?: Promise<unknown> } & RouteDependencies,
): Promise<Response> {
  try {
    if (!(await isAuthorized(request))) {
      return unauthorizedResponse();
    }

    const isDirectLegacyCall =
      context === undefined &&
      request.headers.get("origin") === null &&
      request.headers.get("sec-fetch-site") === null;
    if (!isSameOrigin(request) && !isDirectLegacyCall) {
      return jsonResponse({ error: "cross-origin" }, 403);
    }

    const contentType =
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ??
      "";
    const isForm = contentType === "application/x-www-form-urlencoded";
    const isJson = contentType === "application/json";

    const form = isForm
      ? new URLSearchParams(await request.text())
      : undefined;

    if (!isForm && !isJson) {
      return jsonResponse({ error: "unsupported content type" }, 415);
    }

    let values:
      | { id?: unknown; choice?: unknown; reply?: unknown }
      | undefined;

    if (form) {
      values = {
        id: form.get("id") ?? undefined,
        choice: form.get("choice") ?? undefined,
        reply: form.get("reply") ?? undefined,
      };
    } else {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "invalid request" }, 400);
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ error: "invalid request" }, 400);
      }
      values = body as {
        id?: unknown;
        choice?: unknown;
        reply?: unknown;
      };
    }

    const result = validateSubmission(values);
    if (!result.submission) {
      return jsonResponse({ error: result.error }, 400);
    }

    const submission = result.submission;
    const dependencies = context ?? {};
    const now = new Date();
    const options = snapshotOptions(now);
    const env = await resolveEnv(dependencies);
    const kv = env?.FEEDS_KV;

    if (submission.choice === "undo") {
      if (!isWritableKv(kv)) {
        return jsonResponse({ error: "decision not found" }, 404);
      }

      const action = await undoChoice(kv, submission.id, now);
      if (!action) {
        return jsonResponse({ error: "decision not found" }, 404);
      }

      if (form) {
        return new Response(null, {
          status: 303,
          headers: {
            ...RESPONSE_HEADERS,
            Location: "/decisions",
          },
        });
      }

      return jsonResponse({ ok: true, status: action.status });
    }

    const build =
      dependencies.snapshot ?? (() => buildSnapshot(options));
    const diskSnapshot = await build();
    let card = diskSnapshot.cards.find(
      (candidate) => candidate.id === submission.id,
    );

    if (!card) {
      const feeds = await readKvFeeds(kv);
      card = decisionSnapshotFromFeeds(feeds)?.cards.find(
        (candidate) => candidate.id === submission.id,
      );
    }

    if (!card) {
      return jsonResponse({ error: "decision not found" }, 404);
    }

    if (isWritableKv(kv)) {
      const action = await recordChoice(
        kv,
        {
          decisionId: card.id,
          bot: card.bot,
          question: card.question,
          choice: submission.choice,
          reply: submission.reply,
        },
        now,
      );

      if (form) {
        return new Response(null, {
          status: 303,
          headers: {
            ...RESPONSE_HEADERS,
            Location: "/decisions",
          },
        });
      }

      return jsonResponse({ ok: true, status: action.status });
    }

    const answer = await appendAnswer({
      decisionsFile: join(options.vaultDir, DECISIONS_PATH),
      line: formatAnswerLine({
        id: card.id,
        bot: card.bot,
        question: card.question,
        choice: submission.choice,
        reply: submission.reply,
        at: now,
      }),
      id: submission.id,
    });

    if (form) {
      return new Response(null, {
        status: 303,
        headers: {
          ...RESPONSE_HEADERS,
          Location: "/decisions",
        },
      });
    }

    return jsonResponse({ ok: true, added: answer.added });
  } catch {
    return jsonResponse({ error: "internal server error" }, 500);
  }
}
