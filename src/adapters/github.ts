import type { Adapter, BuildState } from "@/domains/models";
import { config } from "@/config";
import { localDateKey, zonedDateTime } from "@/lib/time";
type GitHubPayload = {
  data?: {
    user?: {
      login: string;
      pullRequests: { totalCount: number };
      contributionsCollection: {
        totalCommitContributions: number;
        commitContributionsByRepository: {
          repository: { nameWithOwner: string };
          contributions: { totalCount: number };
        }[];
      };
      repositories: { nodes: { pushedAt: string | null }[] };
    };
  };
  errors?: unknown[];
};
export function normalizeGitHub(payload: unknown): BuildState {
  const body = payload as GitHubPayload;
  const user = body?.data?.user;
  if (
    body?.errors?.length ||
    !user ||
    !Number.isFinite(user.contributionsCollection?.totalCommitContributions) ||
    !Number.isFinite(user.pullRequests?.totalCount) ||
    !Array.isArray(
      user.contributionsCollection?.commitContributionsByRepository,
    ) ||
    !Array.isArray(user.repositories?.nodes)
  )
    throw new Error("GitHub returned incomplete contribution data");
  const repos =
    user.contributionsCollection.commitContributionsByRepository.map((r) => ({
      name: r.repository.nameWithOwner,
      commits: r.contributions.totalCount,
    }));
  const activity = user.repositories.nodes
    .map((r) => r.pushedAt)
    .filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)))
    .sort();
  return {
    scope: "authenticated",
    username: user.login,
    commitsToday: user.contributionsCollection.totalCommitContributions,
    activeRepos: repos.length,
    openPRs: user.pullRequests.totalCount,
    lastActivity: activity.at(-1) || null,
    repositories: repos.sort((a, b) => b.commits - a.commits),
  };
}
export const githubAdapter: Adapter<BuildState> = {
  provider: config.githubToken ? "GitHub authenticated" : "GitHub public",
  source: "real",
  async fetch(now) {
    if (!config.githubToken) return fetchPublicGitHub(now);
    const from = zonedDateTime(
      localDateKey(now, config.display.timezone),
      0,
      0,
      config.display.timezone,
    ).toISOString();
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      body: JSON.stringify({
        query:
          "query($login: String!, $from: DateTime!, $to: DateTime!) { user(login:$login) { login pullRequests(states:OPEN) { totalCount } contributionsCollection(from:$from, to:$to) { totalCommitContributions commitContributionsByRepository(maxRepositories:100) { repository { nameWithOwner } contributions { totalCount } } } repositories(first:1, orderBy:{field:PUSHED_AT,direction:DESC}, ownerAffiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER]) { nodes { pushedAt } } } }",
        variables: {
          login: config.githubUsername,
          from,
          to: now.toISOString(),
        },
      }),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return normalizeGitHub(await response.json());
  },
};

type SearchPayload = {
  total_count: number;
  incomplete_results: boolean;
  items: {
    sha: string;
    repository: { full_name: string };
    commit: { committer: { date: string } };
  }[];
};
export function normalizePublicGitHub(
  commits: SearchPayload,
  prs: { total_count: number; incomplete_results: boolean },
  username: string,
): BuildState {
  if (
    !Number.isFinite(commits?.total_count) ||
    !Number.isFinite(prs?.total_count) ||
    !Array.isArray(commits?.items) ||
    commits.incomplete_results ||
    prs.incomplete_results ||
    commits.total_count > commits.items.length
  )
    throw new Error("GitHub public search incomplete");
  const repositories = new Map<string, number>();
  for (const item of commits.items) {
    if (!item.repository?.full_name)
      throw new Error("GitHub repository data incomplete");
    repositories.set(
      item.repository.full_name,
      (repositories.get(item.repository.full_name) || 0) + 1,
    );
  }
  const dates = commits.items
    .map((item) => item.commit?.committer?.date)
    .filter((date) => date && Number.isFinite(Date.parse(date)))
    .sort();
  return {
    scope: "public",
    username,
    commitsToday: commits.total_count,
    activeRepos: repositories.size,
    openPRs: prs.total_count,
    lastActivity: dates.at(-1) || null,
    repositories: Array.from(repositories, ([name, commits]) => ({
      name,
      commits,
    })).sort((a, b) => b.commits - a.commits),
  };
}
async function fetchPublicGitHub(now: Date): Promise<BuildState> {
  const from = zonedDateTime(
    localDateKey(now, config.display.timezone),
    0,
    0,
    config.display.timezone,
  ).toISOString();
  const search = async (kind: string, query: string) => {
    const url = new URL(`https://api.github.com/search/${kind}`);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", "100");
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHub public HTTP ${response.status}`);
    return response.json();
  };
  const [commits, prs] = await Promise.all([
    search(
      "commits",
      `author:${config.githubUsername} committer-date:${from}..${now.toISOString()}`,
    ),
    search("issues", `author:${config.githubUsername} is:pr is:open`),
  ]);
  return normalizePublicGitHub(commits, prs, config.githubUsername!);
}
