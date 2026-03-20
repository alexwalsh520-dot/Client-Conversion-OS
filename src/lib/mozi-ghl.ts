const BASE_URL = "https://rest.gohighlevel.com/v1";

const GHL_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.GHL_V1_API_KEY}`,
};

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  [key: string]: unknown;
}

interface GHLContactsResponse {
  contacts: GHLContact[];
  meta?: { total?: number; startAfterId?: string; startAfter?: number };
}

interface GHLPipeline {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
  [key: string]: unknown;
}

interface GHLOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue?: number;
  contact?: GHLContact;
  [key: string]: unknown;
}

interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta?: { total?: number; startAfterId?: string; startAfter?: number };
}

async function ghlFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...GHL_HEADERS, ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Search contacts with optional query, limit, and cursor-based pagination.
 * Automatically paginates through all results when no limit is specified.
 */
export async function searchContacts(params?: {
  query?: string;
  limit?: number;
  startAfterId?: string;
}): Promise<GHLContact[]> {
  const pageSize = Math.min(params?.limit ?? 100, 100);
  const allContacts: GHLContact[] = [];
  let startAfterId = params?.startAfterId;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body: Record<string, unknown> = {
      pageLimit: pageSize,
      ...(params?.query && { query: params.query }),
      ...(startAfterId && { startAfterId }),
    };

    const response = await ghlFetch<GHLContactsResponse>(
      "/contacts/search",
      { method: "POST", body: JSON.stringify(body) }
    );

    allContacts.push(...response.contacts);

    // Stop if we hit the requested limit or there are no more pages
    if (params?.limit && allContacts.length >= params.limit) {
      return allContacts.slice(0, params.limit);
    }

    const nextCursor = response.meta?.startAfterId;
    if (!nextCursor || response.contacts.length < pageSize) break;
    startAfterId = nextCursor;
  }

  return allContacts;
}

/**
 * Search opportunities, optionally filtered by pipeline ID.
 * Handles cursor-based pagination automatically.
 */
export async function getOpportunities(
  pipelineId?: string
): Promise<GHLOpportunity[]> {
  const allOpportunities: GHLOpportunity[] = [];
  let startAfterId: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const searchParams = new URLSearchParams({ limit: "100" });
    if (pipelineId) searchParams.set("pipeline_id", pipelineId);
    if (startAfterId) searchParams.set("startAfterId", startAfterId);

    const response = await ghlFetch<GHLOpportunitiesResponse>(
      `/opportunities/search?${searchParams.toString()}`
    );

    allOpportunities.push(...response.opportunities);

    const nextCursor = response.meta?.startAfterId;
    if (!nextCursor || response.opportunities.length < 100) break;
    startAfterId = nextCursor;
  }

  return allOpportunities;
}

/**
 * Get all pipelines for the location.
 */
export async function getPipelines(): Promise<GHLPipeline[]> {
  const response = await ghlFetch<{ pipelines: GHLPipeline[] }>(
    "/opportunities/pipelines"
  );
  return response.pipelines;
}
