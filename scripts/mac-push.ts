export interface MacReadings {
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  battery: {
    percent: number;
    charging: boolean;
  } | null;
}

export interface RunMacPushOptions {
  endpoint: string;
  token: string;
  machineId: string;
  machineName: string;
  now: () => Date;
  collect: () => Promise<MacReadings>;
  fetchImpl: typeof fetch;
}

export async function runMacPush({
  endpoint,
  token,
  machineId,
  machineName,
  now,
  collect,
  fetchImpl,
}: RunMacPushOptions): Promise<void> {
  const readings = await collect();
  const lastSeenAt = now().toISOString();

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      machine: {
        id: machineId,
        name: machineName,
        status: "online",
        ...readings,
        lastSeenAt,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Mac push failed: ${response.status}`);
  }
}
