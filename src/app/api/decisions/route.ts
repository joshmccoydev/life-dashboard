import { join } from "node:path";
import {
  DECISIONS_PATH,
  appendAnswer,
  buildSnapshot,
  checkToken,
  formatAnswerLine,
} from "@/lib/decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
} as const;

type Choice = "yes" | "no" | "later" | "reply";

type Submission = {
  id: string;
  choice: Choice;
  reply: string;
};

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

function cookieToken(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;

    const name = cookie.slice(0, separator).trim();
    if (name !== "decisions_token") continue;

    const value = cookie.slice(separator + 1).trim();
    if (!value) return undefined;

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

function requestToken(
  request: Request,
  formToken?: string,
): string | undefined {
  const queryToken = new URL(request.url).searchParams.get("t");
  return (
    queryToken ||
    request.headers.get("x-decisions-token") ||
    cookieToken(request) ||
    formToken ||
    undefined
  );
}

function snapshotOptions() {
  return {
    vaultDir: process.env.DECISIONS_VAULT ?? "/workspace/vault",
    remindersFile:
      process.env.DECISIONS_REMINDERS ??
      "/workspace/reminders-queue.md",
    now: new Date(),
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
    typeof values.reply !== "string"
  ) {
    return { submission: null, error: "invalid request" };
  }

  if (
    values.choice !== "yes" &&
    values.choice !== "no" &&
    values.choice !== "later" &&
    values.choice !== "reply"
  ) {
    return { submission: null, error: "invalid choice" };
  }

  if (values.reply.length > 500) {
    return { submission: null, error: "reply too long" };
  }

  return {
    submission: {
      id: values.id,
      choice: values.choice,
      reply: values.reply,
    },
    error: null,
  };
}

export async function GET(request: Request): Promise<Response> {
  if (
    !checkToken(
      requestToken(request),
      process.env.DECISIONS_TOKEN,
    )
  ) {
    return unauthorizedResponse();
  }

  try {
    return jsonResponse(await buildSnapshot(snapshotOptions()));
  } catch {
    return jsonResponse({ error: "internal server error" }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const contentType =
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ??
      "";
    const isForm = contentType === "application/x-www-form-urlencoded";
    const isJson = contentType === "application/json";

    const form = isForm
      ? new URLSearchParams(await request.text())
      : undefined;
    const token = requestToken(request, form?.get("t") ?? undefined);

    if (!token || !checkToken(token, process.env.DECISIONS_TOKEN)) {
      return unauthorizedResponse();
    }

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

    const options = snapshotOptions();
    const snapshot = await buildSnapshot(options);
    const card = snapshot.cards.find(
      (candidate) => candidate.id === result.submission.id,
    );
    if (!card) {
      return jsonResponse({ error: "decision not found" }, 404);
    }

    const answer = await appendAnswer({
      decisionsFile: join(options.vaultDir, DECISIONS_PATH),
      line: formatAnswerLine({
        id: card.id,
        bot: card.bot,
        question: card.question,
        choice: result.submission.choice,
        reply: result.submission.reply,
        at: new Date(),
      }),
      id: result.submission.id,
    });

    if (form) {
      const redirectToken = new URLSearchParams({ t: token }).toString();
      return new Response(null, {
        status: 303,
        headers: {
          ...RESPONSE_HEADERS,
          Location: `/decisions?${redirectToken}`,
        },
      });
    }

    return jsonResponse({ ok: true, added: answer.added });
  } catch {
    return jsonResponse({ error: "internal server error" }, 500);
  }
}
