const BASE_URL = "https://api.mercury.com/api/v1";

interface MercuryAccount {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface MercuryTransaction {
  id: string;
  [key: string]: unknown;
}

interface MercuryTransactionsResponse {
  total: number;
  transactions: MercuryTransaction[];
}

async function mercuryFetch<T = unknown>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Mercury API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function getMercuryAccounts(
  token: string
): Promise<{ accounts: MercuryAccount[] }> {
  return mercuryFetch<{ accounts: MercuryAccount[] }>("/accounts", token);
}

export async function getMercuryTransactions(
  token: string,
  accountId: string,
  params?: { offset?: number; limit?: number; start?: string; end?: string }
): Promise<MercuryTransactionsResponse> {
  const searchParams = new URLSearchParams();

  if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
  if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params?.start) searchParams.set("start", params.start);
  if (params?.end) searchParams.set("end", params.end);

  const qs = searchParams.toString();
  const path = `/account/${accountId}/transactions${qs ? `?${qs}` : ""}`;

  return mercuryFetch<MercuryTransactionsResponse>(path, token);
}

// Evaluated at call time (not module load) so env vars loaded via --env-file
// or late dotenv() calls still work.
export const mercuryTokens = {
  get coreshift() {
    return process.env.MERCURY_TOKEN_CORESHIFT ?? "";
  },
  get forge() {
    return process.env.MERCURY_TOKEN_FORGE ?? "";
  },
};
