# Decisions App: Phase 1

Decisions is Josh's mobile decisions inbox at `/decisions` in LifeDash. Phase 1 gives Josh one place on his phone to review open questions, see each bot's recommendation, and answer with the decision itself.

## Decision sources

The inbox collects open decisions from these sources:

- Open decision lines in the vault file `03 Resources/_Meta/Decisions.md`.
- Items marked `needs_josh` in `00 Home/Bots/Status.md`.
- The Queue section of `/workspace/reminders-queue.md`.
- The newest decision packet in `00 Home/Bots/Alfred/Approvals/`.

Each source must supply the same decision shape so the inbox can present the items consistently.

## Standard ask line

```text
- [ASK] YYYY-MM-DD HH:MM CT | owner: <Bot> | blocking: yes/no | due: YYYY-MM-DD or none | q: <question> | rec: <recommendation> | ctx: <one line> | link: <vault path or URL>
```

Use the timestamp to identify the oldest asks, use `blocking: yes` for decisions that stop other work, and use `due: none` when there is no deadline.

## Ordering

Decisions are sorted by due date, then blocking status, then age:

1. Dated due dates in ascending order, with `none` after dated items.
2. `blocking: yes` before `blocking: no`.
3. Oldest asks first when the earlier fields tie.

## Writing a decision back

LifeDash runs on the box. When Josh answers, the mobile app sends the response to `POST /api/decisions`. The server appends Josh's exact words, the owner bot, and an `[id:...]` marker to `03 Resources/_Meta/Decisions.md`; the browser does not write to the vault directly. The POST is idempotent, so retrying the same decision cannot append it twice. A decision whose ID is already answered drops off the inbox list.

No secrets are stored in the browser. The only credential is `DECISIONS_TOKEN` in the URL, which works like a private link.

## Environment

- `DECISIONS_TOKEN` (required): the private-link token used by `/decisions`.
- `DECISIONS_VAULT`: the vault path used for decisions and approvals.
- `DECISIONS_REMINDERS`: the reminders queue path.

## Local preview

Start the app from the repository:

```sh
DECISIONS_TOKEN=<pick one> npm run dev
```

Open:

```text
http://localhost:3000/decisions?t=<token>
```

On a phone, use the browser's **Add to Home Screen** action to install the inbox like an app.

## Tests

Run the decisions tests with:

```sh
node --test tests/decisions.test.ts
```

## Phase 2 and exposure

The following phase 2 features are not built:

- Webhook wake of the owner bot when a decision is answered.
- Push alerts.

Do not deploy this app or expose it beyond the LAN without Josh's explicit yes.
