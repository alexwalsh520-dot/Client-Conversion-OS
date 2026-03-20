const BASE_URL = "https://api.whop.com/api/v5/company";

interface WhopPayment {
  id: string;
  [key: string]: unknown;
}

interface WhopPaginatedResponse {
  data: WhopPayment[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_count: number;
  };
}

async function whopFetch<T = unknown>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Whop API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function getWhopPayments(
  apiKey: string,
  page = 1,
  per = 50
): Promise<WhopPaginatedResponse> {
  return whopFetch<WhopPaginatedResponse>(
    `/payments?page=${page}&per=${per}`,
    apiKey
  );
}

export async function getAllWhopPayments(apiKey: string): Promise<WhopPayment[]> {
  const all: WhopPayment[] = [];
  let page = 1;

  while (true) {
    const res = await getWhopPayments(apiKey, page, 50);
    all.push(...res.data);

    if (page >= res.pagination.total_pages) break;
    page++;
  }

  return all;
}

export const whopClients = [
  { apiKey: process.env.WHOP_KEY_KEITH!, influencer: "keith" as const },
  { apiKey: process.env.WHOP_KEY_TYSON!, influencer: "tyson" as const },
];
