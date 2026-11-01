export interface KvExportOptions {
  endpoint: string;
  token: string;
  fetchImpl: typeof fetch;
}

export async function pushSnapshotToKv(
  snapshot: Record<string, unknown> | null,
  { endpoint, token, fetchImpl }: KvExportOptions,
): Promise<boolean> {
  if (snapshot === null) {
    return false;
  }

  const response = await fetchImpl(endpoint, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(snapshot),
  });

  if (!response.ok) {
    throw new Error(`KV export failed: ${response.status}`);
  }

  return true;
}
