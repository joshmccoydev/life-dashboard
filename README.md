# LifeDash

LifeDash is a passive personal HUD for a fullscreen TV beside your workstation. It aggregates normalized information; it does not replace your calendar, reminders, banking apps, or development tools. No chatbot, AI dependency, database, or required interaction.

## Layout

Designed for 1920 × 1080, with proportional scaling at 1440p and 4K. A large local clock anchors the header alongside weather and system status. Three stable domain columns keep everything in a predictable place: Personal (schedule, reminders, habits, health, money), Work & Build (work schedule, GitHub, goals, projects), and Digital (AI telemetry, Mac/network health, and the prepared home-integration slot). Content does not rotate; only the deterministic attention message changes when more than one issue needs notice. Dark surfaces, subdued text, and a 1px periodic shift reduce static brightness; they cannot guarantee protection against burn-in.

## Requirements

- Node.js 22.12+ (24 LTS recommended) and npm.
- A modern browser and internet access for real weather / GitHub / HTTP checks.
- macOS, Linux, or Windows. Machine telemetry describes the **host running LifeDash**, which may be a VPS/container rather than the TV's computer.

## Installation

```sh
npm ci
cp .env.example .env.local
```

Dependencies are locked. Next.js 16, React 19, TypeScript 6, Tailwind 4. TypeScript 6 is selected for compatibility with Next.js's lint parser.

## Environment configuration

Edit `.env.local`, then restart the server. See `.env.example` for comments and every supported variable.

| Configuration                                                  | Purpose                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `LIFEDASH_LATITUDE`, `LIFEDASH_LONGITUDE`, `LIFEDASH_LOCATION` | Weather coordinates and visible location name. Defaults to Chicago, not an inferred personal location. |
| `WEATHER_UNIT`                                                 | `F` or `C`.                                                                                            |
| `TIMEZONE`                                                     | IANA timezone for clock, calendar, day boundaries, and modes; defaults to server timezone.             |
| `GITHUB_TOKEN`, `GITHUB_USERNAME`                              | Username enables public commit search / PR telemetry; add a token for authenticated contributions.     |
| `SYSTEM_HEALTH_ENDPOINTS`                                      | JSON array of `{name, url, timeoutMs?}`; HTTP(S), success means 2xx.                                   |
| `LIFEDASH_MACHINE_NAME`                                        | Label for the actual LifeDash host.                                                                    |
| `MORNING_START`, `DAY_START`, `EVENING_START`, `NIGHT_START`   | Local hours (0–23); defaults 6 / 9 / 17 / 22. Use distinct hours.                                      |
| `ROTATION_SECONDS`                                             | Attention-message and pixel-shift interval; default 25, minimum 10.                                    |
| `LIFEDASH_DEMO`                                                | `true` switches every domain to explicitly labeled mock data.                                          |
| `REFRESH_<DOMAIN>_SECONDS`                                     | Adapter cache intervals; see example file.                                                             |

`src/config/dashboard.json` contains display preferences, refresh defaults, adapter selections, service endpoints, local demo finance values, goals, and projects. Use `mock` to force demo for a domain; `auto` selects available real adapters. Domains without real implementations remain demo regardless of selection. Environment variables override JSON defaults. `SYSTEM_HEALTH_ENDPOINTS=[]` overrides any JSON services; remove the variable to use the JSON file.

Example service configuration (replace the example host):

```json
[
  {
    "name": "VPS",
    "url": "https://your-host.example/health",
    "timeoutMs": 5000
  }
]
```

No private addresses are hardcoded. HTTP checks run on the server and do not reveal endpoint URLs in the dashboard. They report reachability/latency, not invented VPS CPU, disk, or uptime. Those metrics require a future telemetry agent. Invalid endpoint configuration is logged and ignored. Checks do not currently support custom auth headers.

## Running locally

Development:

```sh
npm run dev
```

Production / leave running tonight:

```sh
npm run build
npm start
```

Open **http://localhost:3000** on a browser attached to the TV. On another device on your trusted LAN, use `http://<LifeDash-host-LAN-IP>:3000`. Scripts bind to `0.0.0.0`. The local V1 has no login; keep it on your trusted LAN. Before exposing it beyond your LAN, put authenticated access in front of it. No bank accounts or sensitive medical records are connected.

## Running fullscreen

Use browser fullscreen (F11 on many browsers; Control–Command–F on macOS). Set display resolution to 1920 × 1080 and browser zoom to 100%. Turn off OS sleep if you want an unattended display. Use the production server for normal operation. A process manager/systemd/launchd can restart the server after reboot; no daemon installation is included. The browser retries refreshes automatically after network failures and when it regains focus/connectivity.

Hidden preview controls:

- `/?demo=true`: all demo, no external requests for that view.
- `/?mode=morning`, `day`, `evening`, or `night`: force display emphasis.
- `/?pause=true`: pause attention-message rotation and pixel shifting.
- Combine parameters, e.g. `/?demo=true&mode=night&pause=true`.
- `/api/dashboard`: normalized domain state for diagnostics (local data; no tokens).

## Real integrations currently supported

- **Clock/date**: local, isolated React component; second ticks do not rerender the dashboard tree.
- **Weather**: Open-Meteo current temperature, apparent temperature, condition, high/low. Free for noncommercial use; no key. Default 15-minute server cache.
- **Host**: Node OS uptime, interval CPU utilization, RAM and filesystem disk use. CPU is unavailable until the second sample rather than invented. On macOS RAM is active + wired + physically occupied compressor pages from `vm_stat`, divided by total RAM; inactive cache is excluded. Other systems use `(total - free) / total`. This is **not** macOS memory pressure or Activity Monitor's app-memory metric. Disk reflects the filesystem holding this checkout.
- **Internet/API reachability**: a real HTTPS check to GitHub's API root. Failure means this endpoint is unreachable/unhealthy, not proof the whole internet is offline.
- **Configured HTTP services**: timeout-bounded parallel checks, every 45 seconds by default (rounded up to the next browser poll).
- **GitHub, when configured**: GraphQL contribution counts since local midnight, active contribution repos (up to 100), authored open PRs, and latest accessible repository push. Contribution counts follow GitHub's rules; they are not a count of every commit on every branch. Latest repository push is not necessarily a push you personally made. Private visibility depends on token permissions. A username alone enables the public-search adapter described below.

The browser polls every 30 seconds; each adapter independently decides whether its cache needs refreshing. Weather 900s, systems 45s, GitHub/AI 180s, calendar 30s, reminders/habits 120s, finance 1800s, health/goals 600s. Concurrent requests share in-flight work. Clock uses no API. Adapters refresh while the dashboard is open, not as background cron jobs.

## Mock integrations

**Finance remains demo/local data. Calendar, Reminders, Habits, Goals, and Projects become live after bridge authorization; Health becomes real after an iPhone sync or local import.** Every affected section carries a `DEMO` label. GitHub is demo without a username. Demo alerts explicitly include “demo.” Mock calendar data regenerates from actual local dates, so it stays coherent across days. Nothing shown as demo should be interpreted as your real balances, fitness, calendar, or provider usage. Codex quota windows and available reset credits are live when the signed-in local Codex executable is available; activity counters remain unknown. Cursor and Grok Bot stay visibly `SETUP NEEDED` until a supported source writes the optional local usage snapshot.

## Reliability and attention rules

Each source exposes provider, real/mock source, refresh interval, latest attempt, latest successful update, error and readiness/staleness. Fetch-in-progress is tracked within each adapter cache and deduplicated; API responses wait for normalized results. Failures retain last known values and mark stale immediately. Without a known reading, a failed real adapter displays labeled demo with `UNAVAILABLE`. Age-based staleness begins at twice the interval. Weather and GitHub last-good real snapshots persist under ignored `.lifedash/` for process restarts; other sources are in-memory. Local snapshots are not encrypted.

Attention rules: service offline; host disk >90%; overdue incomplete reminder; meeting within 15 minutes; bill due within 48 hours; stale/unavailable feeds. Critical alerts sort first. No AI prioritization. The top status covers system/feed health; demo reminder warnings do not claim a real systems outage. Individual panel boundaries contain rendering errors, and startup/global failures retry after 30 seconds. Structured JSON logs record initialization, real refreshes, recovery, failures, stale transitions, and service state changes without token/URL output.

Morning and evening emphasize the Personal column. Day emphasizes Work & Build. Night reduces the visual weight of Work and Digital while Personal looks ahead to tomorrow; critical alerts remain visible. Layout positions stay fixed.

## Adapter architecture

```text
src/domains/models.ts       Normalized models; generic Adapter<T>
src/adapters/               Mock factories, Open-Meteo, GitHub, Node/HTTP systems
src/adapters/contracts.ts   Future Apple/Microsoft/Home Assistant contracts
src/lib/cache.ts            TTL, single-flight, last-good storage, fallback
src/lib/time.ts             Zoned time, mode selection, age/staleness
src/lib/alerts.ts           Deterministic rules
src/config/                JSON + server environment configuration
src/app/api/dashboard/     Server aggregation; no browser provider credentials
src/components/            Provider-independent display
tests/core.test.ts          Important logic and real local HTTP failure paths
```

## Adding another integration

1. Implement `Adapter<YourDomainState>` with a provider name, `source:'real'`, and timeout-bounded `fetch(now)` that validates/normalizes data.
2. Register it in `src/adapters/index.ts` through `make(domain, mock, real)` and `selectAdapter`. Keep all secrets/server calls there.
3. Add commented variables to `.env.example` and configuration parsing in `src/config/index.ts`.
4. Test normalization, invalid input and fallback. The UI consumes the existing domain model and needs no provider-specific rewrite.

## Apple Calendar, Reminders, and habits

Run `npm run bridge:apple` on macOS to compile and launch the read-only EventKit bridge. Approve Calendar and Reminders in the macOS prompts. It writes an atomic snapshot every 30 seconds to ignored `.lifedash/apple-bridge.json`; adapters reject denied permissions and snapshots older than three minutes. Undated reminders remain undated. All accessible calendars retain their names and all-day flags. `WORK_CALENDARS` is a JSON array of exact calendar names, matched case-insensitively, to group as work; others group as personal. The bridge reads the current day plus the next seven days. The Work panel ignores all-day and already-ended events, then shows the next timed shift plus the next four timed shifts in chronological order. The Personal agenda appears only when there is a future timed personal event.

For payments, create an Apple Reminders list named **Payments**. Add each payment with a title and due date. LifeDash removes those items from ordinary reminders and shows the next two dated, incomplete items under Upcoming Payments.

For habits, create an Apple Reminders list named **Habits**. Add one recurring reminder per habit, with a due date and recurrence schedule, then complete it normally from iPhone, Watch, Mac, or Siri. LifeDash excludes that list from Today, retains 35 days of recent completion history, and shows the current Monday–Sunday week. It groups recurring occurrences by reminder title, so keep each title unique and avoid renaming it if you want a continuous streak. Set `HABITS_LIST_NAME` in the shell before `npm run bridge:apple` and in `.env.local` only if you use a different list name. Restart the bridge after changing the name.

For goals and projects, create Apple Reminders lists named **Goals** and **Projects**. Each incomplete reminder becomes one dashboard item: the title is its name, Notes is the visible context or next action, and the due date is the target date. Completing the reminder removes it from the active dashboard. Set `GOALS_LIST_NAME` or `PROJECTS_LIST_NAME` in `.env.local` only when using different list names. The bridge remains read-only.

The bridge never creates, edits or deletes items. macOS requests full EventKit access even though this implementation only reads. Stop it with Activity Monitor (LifeDashBridge); restarting it rechecks permissions. No automatic login startup is installed. Local calendar snapshots are private plaintext files; keep this dashboard on a trusted local network. Apple Health requires a separate supported iPhone/export path; EventKit does not expose HealthKit data.

```text
Apple Calendar / Reminders / Habits → LifeDash macOS Bridge → normalized adapters → HUD
```

## Deferred-domain plan

- **Health:** keep it local and summary-only. The existing authenticated Apple Health receiver is the first path: Health Auto Export or an iPhone Shortcut sends daily steps, sleep, active energy, exercise and ring goals. Add workouts only after daily totals prove reliable. A native iOS companion is a later option, not a V1 dependency.
- **Money:** keep Upcoming Payments in Apple Reminders now. Next, add a manual CSV/OFX import for monthly spending, cash flow and account-balance trends without storing bank credentials. A read-only aggregation provider can follow after its cost, institution coverage and privacy tradeoffs are accepted; transactions and credentials should never be exposed to the TV browser.
- **Goals and projects:** live Apple Reminders lists now replace decorative percentages with target dates and next actions. A later pass can combine those items with GitHub repository activity for software projects; progress should come from completed milestones, never a guessed score.
- **Personal-machine telemetry when hosted:** the built-in CPU/RAM/disk adapter always measures the machine running LifeDash. A VPS therefore shows VPS health. A future authenticated Mac heartbeat can push Mac CPU, memory, disk, battery and last-seen status to the hosted dashboard while keeping the VPS as a separate host.
- **Home:** stay read-only and exception-oriented: home/away state, unlocked doors, lights left on, temperature and active scene. Home Assistant remains the preferred bridge for Hue/HomeKit-adjacent devices. Until it is connected, this panel is intentionally only a prepared slot.

## Planned integrations

1. Microsoft Graph: Outlook/Teams meeting summaries and workday timing only.
2. Home Assistant/Hue: read-only state and exception summaries.
3. Finance import/aggregation after the local HUD proves useful.

Later: finance import/aggregation, richer Apple Health workout sync, a personal-machine heartbeat, and provider-specific documented AI telemetry. Contracts exist; these integrations do not.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Tests cover mode boundaries/timezones/DST, deterministic rules, stale thresholds, normalization, real-to-demo fallback, retained last-good values, cache deduplication/TTL, HTTP 2xx/503/timeout behavior, and demo provenance. Public GitHub and signed-in Codex quotas have been smoke-tested locally. Private GitHub data still needs a token.

### Dracula theme and live Codex

The HUD uses the [Dracula palette](https://draculatheme.com/spec), local monospace fonts, flat panels, and a stable three-column TV layout.

`CODEX_BINARY` optionally selects a local signed-in Codex executable. On macOS the installed ChatGPT app binary is detected automatically. LifeDash uses the documented [Codex app-server](https://learn.chatgpt.com/docs/app-server) initialization handshake and `account/rateLimits/read`, then closes the process. Polling follows the AI TTL (180 seconds). It never starts threads, turns, jobs, sign-in flows, purchases, or quota resets. The dashboard shows five-hour/weekly remaining percentages, visible reset countdowns, and the number of available reset credits with their earliest expiry. Missing windows fail visibly; tokens, costs, and agent activity are not inferred.

Cursor's documented personal usage lives in its Spending dashboard. Grok Bot's weekly included usage—whether granted by a Cursor plan or a linked SuperGrok subscription—lives in Grok Bot's Usage & Billing screen. LifeDash does not scrape either app's cookies or private storage. An external trusted bridge can instead write `.lifedash/ai-usage.json` (or `AI_USAGE_PATH`) using this normalized shape; the file must be refreshed at least daily:

```json
{
  "updatedAt": "2026-09-16T03:00:00Z",
  "cursor": { "remainingPercent": 82, "resetAt": "2026-10-01T00:00:00Z" },
  "grokbot": { "requestsRemaining": 42, "detail": "SuperGrok-linked grant" }
}
```

Each service accepts `remainingPercent`, `usedPercent`, `requestsRemaining`, or a short `value`, plus optional `resetAt` and `detail`. Invalid or older-than-24-hour snapshots fall back to `SETUP NEEDED`; no number is invented. Cursor Team/Enterprise users can build a bridge from Cursor's documented Admin/Analytics API. Personal-plan automation should wait for an official API rather than copy browser session credentials.

GitHub without a token uses [public commit and PR search](https://docs.github.com/en/rest/search/search). Commit search covers the local day and can lag indexing; public commits differ from GitHub contribution counts and omit private activity. More than 100 commits or an incomplete result causes a visible stale/error state rather than an inaccurate repository count. Add a token to use the existing authenticated contribution adapter.

## Apple Watch / Health connection

The Watch syncs to iPhone Health. macOS cannot read that HealthKit store directly. LifeDash accepts a small authenticated daily summary from an iPhone app or Shortcut; no hosting or automatic startup is required.

Health is intentionally set to `mock` while connection is deferred. When ready, set `adapters.health` to `auto` in `src/config/dashboard.json`. Direct Wi-Fi sync is optional and disabled until paired. After you approve using unencrypted local HTTP, run `npm run health:pair`, then restart LifeDash. This generates a local token and saves the URL, header and setup steps in private ignored `.lifedash/health-pairing.txt`. Connect iPhone and Mac to the same trusted Wi-Fi; do not expose this HTTP receiver publicly. A future VPS connection needs HTTPS. Health payloads are not logged; only normalized recent metrics are saved in private `.lifedash/health-sync.json` (mode 0600).

The simplest sender is [Health Auto Export](https://www.healthyapps.dev/), which supports automatic [REST API exports](https://help.healthyapps.dev/en/health-auto-export/automations/rest-api/). Setup: JSON, export version 2, Health Metrics, daily aggregation, aggregated sleep, default range (yesterday + today), batching off. Select Step Count, Sleep Analysis, Active Energy and Apple Exercise Time; prefer Watch sources. Use the pairing URL and Authorization header. Test on the unlocked iPhone. Subsequent background sync can be delayed by device lock, Low Power Mode or iOS scheduling. Automatic export features may require the app's paid tier. The app also supports iCloud Drive exports as an alternative to direct HTTP.

Use full daily totals, **not Since Last Sync**: repeated uploads replace totals rather than adding them. Multiple totals per metric/day are rejected to prevent ambiguous duplication. Sleep uses total asleep, excluding time in bed. Missing metrics and goals remain unknown; energy appears in kcal if no real Move goal is supplied. Workout sync is not configured yet.

A free Apple Shortcut can instead POST a JSON Dictionary with `date` (yyyy-MM-dd) and selected fields: `steps`, `sleepMinutes`, `activeEnergy` (kcal), `exerciseMinutes`, `standHours`, and optionally your actual goals / `activityPercent`. Query the desired local-day metrics with Find Health Samples, calculate the selected totals, then use Get Contents of URL with POST / JSON and the same Authorization header. Health permissions must be granted on iPhone. Do not blindly add overlapping Watch/iPhone step samples; select the intended source. Personal automations can trigger the Shortcut, but locked-device Health access can delay it.

Manual import remains an optional fallback: iPhone Health → profile → Export All Health Data → AirDrop the ZIP to Mac, then `npm run health:import -- /absolute/path/to/export.zip --timezone America/Chicago`. The streaming Python importer reads export.xml without extracting the ZIP, retains only 15 recent days of dashboard metrics, and saves private `.lifedash/health-import.json`. Raw exports are not copied into the project. Watch samples are preferred for steps, identical samples deduplicate, and overlapping asleep segments merge. Quantity samples are attributed to their end date; totals may differ from Apple's source-prioritized Health totals. Rings and goals use exported ActivitySummary values. Unsupported or missing values stay unknown.

The panel shows the actual data date and Synced/Imported age. Polling does not reset data freshness; after twice the Health TTL it is marked stale. Without any data the panel displays labeled demo/unavailable. Keep the dashboard open to refresh; no scheduler or startup service has been installed.

### Glance priorities and recovery

Evening mode previews tomorrow once today's timed events are finished; any remaining appointment today keeps priority. Night mode previews tomorrow before midnight and this morning after midnight, respecting the configured morning start. A clear tomorrow is shown as clear rather than substituting a later date. All-day counts follow the displayed agenda date.

The attention bar rotates only critical alerts when any are present, so an outage or full disk cannot disappear behind a routine reminder. Night mode keeps critical alerts and feed/connection problems visible while quieting routine tasks and bills. Normal live mode does not create urgency from mock reminders, bills, meetings or mock system metrics; full demo mode exercises those rules. Failed real feeds still produce warnings even if fallback data is demo.

An individual rendering error leaves the rest of the dashboard running and retries the affected panel every 30 seconds. Systems rows prioritize offline and unknown endpoints so failures cannot hide below the displayed rows. Startup/login/hosting changes remain deferred.
