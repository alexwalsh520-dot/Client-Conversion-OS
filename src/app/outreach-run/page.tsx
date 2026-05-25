'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';

interface Lead {
  first_name: string;
  last_name: string;
  email: string;
  lead_type: string;
  instagram_handle?: string;
  instagram_url?: string;
  video_url?: string;
}

type LeadStatus = 'pending' | 'uploading' | 'generating' | 'routing' | 'completed' | 'failed';

interface LeadResult {
  firstName: string;
  lastName: string;
  status: LeadStatus;
  pageUrl?: string;
  slug?: string;
  routePlan?: RoutePlan;
  routeResult?: DeliveryResult;
  error?: string;
}

interface RoutePlan {
  segment: string;
  missingEnv: string[];
  ghl: {
    pipelineName: string;
    stageName: string;
    tags: string[];
  };
  smartlead: {
    campaignEnv: string;
    campaignId: string | null;
    customFields?: Record<string, string>;
  };
}

interface DeliveryResult {
  testMode: boolean;
  emailUsed: string;
  originalEmail: string;
  segment: string;
  ghl: {
    contactId: string;
    opportunityId: string;
    stageName: string;
    pipelineName: string;
  };
  smartlead: {
    campaignEnv: string;
    campaignId: string;
    added: boolean;
    customFields: Record<string, string>;
  };
}

interface SSEEvent {
  leadIndex?: number;
  firstName?: string;
  lastName?: string;
  status: string;
  pageUrl?: string;
  gammaUrl?: string;
  slug?: string;
  routePlan?: RoutePlan;
  routeResult?: DeliveryResult;
  error?: string;
}

function normalizeColumnName(col: string): string {
  return col.toLowerCase().replace(/[\s_-]+/g, '').trim();
}

function capitalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/(^|[\s'-])([a-z])/g, (_, prefix: string, char: string) => {
    return `${prefix}${char.toUpperCase()}`;
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseCSV(text: string): Lead[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('CSV must have header + data rows');

  const normalizedHeaders = rows[0].map(normalizeColumnName);
  const colMap: Record<string, number> = {};

  normalizedHeaders.forEach((h, i) => {
    if (h === 'firstname' || h === 'first' || h === 'name') colMap.first_name = i;
    if (h === 'lastname' || h === 'last') colMap.last_name = i;
    if (h === 'email' || h === 'emailaddress') colMap.email = i;
    if (h === 'leadtype' || h === 'type' || h === 'segment') colMap.lead_type = i;
    if (
      h === 'instagramhandle' ||
      h === 'instagramusername' ||
      h === 'ighandle' ||
      h === 'igusername' ||
      h === 'ig'
    ) colMap.instagram_handle = i;
    if (
      h === 'instagramurl' ||
      h === 'instagramlink' ||
      h === 'igurl' ||
      h === 'iglink'
    ) colMap.instagram_url = i;
    if (
      h === 'videourl' ||
      h === 'video' ||
      h === 'bunnyurl' ||
      h === 'loomurl'
    ) colMap.video_url = i;
  });

  const required = ['first_name', 'email', 'lead_type'];
  const missing = required.filter(c => colMap[c] === undefined);
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);

  return rows
    .slice(1)
    .filter(row => row.some(Boolean))
    .map(row => ({
      first_name: capitalizeNamePart(row[colMap.first_name] || ''),
      last_name: colMap.last_name === undefined ? '' : capitalizeNamePart(row[colMap.last_name] || ''),
      email: row[colMap.email] || '',
      lead_type: row[colMap.lead_type] || '',
      instagram_handle: colMap.instagram_handle === undefined ? '' : row[colMap.instagram_handle] || '',
      instagram_url: colMap.instagram_url === undefined ? '' : row[colMap.instagram_url] || '',
      video_url: colMap.video_url === undefined ? '' : row[colMap.video_url] || '',
    }));
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string }> = {
  pending: { label: 'Waiting', color: 'var(--text-muted)' },
  uploading: { label: 'Uploading video...', color: 'var(--warning)' },
  generating: { label: 'Making Super Doc...', color: 'var(--warning)' },
  routing: { label: 'Sending to GHL + Smartlead...', color: 'var(--warning)' },
  completed: { label: 'Done', color: 'var(--success)' },
  failed: { label: 'Needs fix', color: 'var(--danger)' },
};

export default function OutreachRunPage() {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(true);

  const handleCSV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvFile(file);
    setResults([]);

    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length === 0) throw new Error('No data rows found');
      setLeads(parsed);
    } catch (err: unknown) {
      setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV');
      setLeads([]);
    }
  }, []);

  const canRun = Boolean(csvFile) && leads.length > 0 && !isRunning && !csvError;

  const handleRun = async () => {
    if (!canRun || !csvFile) return;

    setIsRunning(true);
    setResults(
      leads.map(l => ({
        firstName: l.first_name,
        lastName: l.last_name,
        status: 'pending' as const,
      })),
    );

    const runId = crypto.randomUUID();

    try {
      const csvText = await csvFile.text();
      const response = await fetch('/api/outreach-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, csvText, testMode }),
      });

      if (!response.ok) {
        const text = await response.text();
        let msg = `Server error (${response.status})`;
        try {
          const err = JSON.parse(text);
          msg = err.error || msg;
        } catch {
          msg = text.slice(0, 300) || msg;
        }
        throw new Error(msg);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data: SSEEvent = JSON.parse(line.slice(6));
            if (data.status === 'done' || data.status === 'error') continue;
            if (data.leadIndex === undefined) continue;

            setResults(prev => {
              const next = [...prev];
              const existing = next[data.leadIndex!];
              next[data.leadIndex!] = {
                firstName: data.firstName || existing.firstName,
                lastName: data.lastName || existing.lastName,
                status: data.status as LeadResult['status'],
                pageUrl: data.pageUrl || data.gammaUrl || existing.pageUrl,
                slug: data.slug || existing.slug,
                routePlan: data.routePlan || existing.routePlan,
                routeResult: data.routeResult || existing.routeResult,
                error: data.error,
              };
              return next;
            });
          } catch {
            /* skip malformed SSE frames */
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setResults(prev =>
        prev.length > 0
          ? prev.map(r => (r.status === 'completed' ? r : { ...r, status: 'failed' as const, error: msg }))
          : leads.map(l => ({ firstName: l.first_name, lastName: l.last_name, status: 'failed' as const, error: msg })),
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Auto Outreach</h1>
          <p style={subtitleStyle}>
            Upload one CSV. CCOS creates the Super Docs, moves test leads into GHL Contacted, then adds them to Smartlead.
          </p>
        </div>
        <div style={headerActionsStyle}>
          <Link href="/super-doc-editor" style={linkButtonStyle}>
            Edit Creator Template
          </Link>
          <Link href="/super-doc-editor?variant=agency" style={linkButtonStyle}>
            Edit Agency/TM Template
          </Link>
          <Link href="/super-doc/test-lead" target="_blank" style={linkButtonStyle}>
            View Test Page
          </Link>
        </div>
      </div>

      <div style={cardStyle}>
        <label style={labelStyle}>Upload CSV</label>
        <p style={hintStyle}>
          Required columns: first_name, email, lead_type. Optional: last_name, instagram_handle, instagram_url, video_url.
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={handleCSV}
          disabled={isRunning}
          style={fileInputStyle}
        />
        {csvError && (
          <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 8 }}>{csvError}</p>
        )}
        {leads.length > 0 && !csvError && (
          <p style={{ color: 'var(--success)', fontSize: '0.8rem', marginTop: 8 }}>
            {leads.length} lead{leads.length !== 1 ? 's' : ''} loaded
          </p>
        )}
      </div>

      <div style={{ ...cardStyle, marginTop: '1rem' }}>
        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={testMode}
            onChange={e => setTestMode(e.target.checked)}
            disabled={isRunning}
          />
          <span>
            Use dummy emails for this test
          </span>
        </label>
        <p style={hintStyle}>
          Keep this on until we are ready to send to real people.
        </p>
      </div>

      <button
        onClick={handleRun}
        disabled={!canRun}
        style={{
          ...runButtonStyle,
          backgroundColor: canRun ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
          color: canRun ? '#000' : 'var(--text-muted)',
          cursor: canRun ? 'pointer' : 'not-allowed',
        }}
      >
        {isRunning ? 'Running Outreach...' : 'Run Outreach'}
      </button>

      {results.length > 0 && (
        <div style={{ ...cardStyle, marginTop: '1.5rem' }}>
          <label style={labelStyle}>Results</label>
          <div style={resultsListStyle}>
            {results.map((r, i) => {
              const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.pending;
              return (
                <div key={i} style={resultItemStyle}>
                  <div style={resultHeaderStyle}>
                    <span style={leadNameStyle}>{r.firstName} {r.lastName}</span>
                    <span style={{ color: cfg.color, fontSize: '0.8rem', fontWeight: 700 }}>
                      {cfg.label}
                    </span>
                  </div>

                  {r.pageUrl && (
                    <div style={linkRowStyle}>
                      <a href={r.pageUrl} target="_blank" rel="noopener noreferrer" style={pageLinkStyle}>
                        {r.pageUrl}
                      </a>
                      {r.slug && (
                        <Link href={`/super-doc-editor/${r.slug}`} style={miniLinkStyle}>
                          Edit Doc
                        </Link>
                      )}
                    </div>
                  )}

                  {r.routeResult && (
                    <div style={routeBoxStyle}>
                      <p style={routeTextStyle}>
                        Test email: <strong>{r.routeResult.emailUsed}</strong>
                      </p>
                      <p style={routeTextStyle}>
                        GHL: {r.routeResult.ghl.pipelineName} / {r.routeResult.ghl.stageName}
                      </p>
                      <p style={routeTextStyle}>
                        Smartlead: {r.routeResult.smartlead.campaignId}
                      </p>
                      <p style={routeTextStyle}>
                        Doc field: {r.routeResult.smartlead.customFields.super_doc_url}
                      </p>
                    </div>
                  )}

                  {!r.routeResult && r.routePlan && (
                    <div style={routeBoxStyle}>
                      <p style={routeTextStyle}>
                        Segment: <strong>{r.routePlan.segment}</strong>
                      </p>
                      <p style={routeTextStyle}>
                        GHL: {r.routePlan.ghl.pipelineName} / {r.routePlan.ghl.stageName}
                      </p>
                      <p style={routeTextStyle}>
                        Smartlead: {r.routePlan.smartlead.campaignId || `Missing ${r.routePlan.smartlead.campaignEnv}`}
                      </p>
                      {r.routePlan.missingEnv.length > 0 && (
                        <p style={{ ...routeTextStyle, color: 'var(--warning)' }}>
                          Missing keys: {r.routePlan.missingEnv.join(', ')}
                        </p>
                      )}
                    </div>
                  )}

                  {r.error && (
                    <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: 6 }}>
                      {r.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: '2rem',
  maxWidth: 980,
  margin: '0 auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'flex-start',
  marginBottom: '1.5rem',
  flexWrap: 'wrap',
};

const headerActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 700,
  marginBottom: '0.25rem',
  color: 'var(--text-primary)',
};

const subtitleStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.875rem',
  margin: 0,
  maxWidth: 620,
};

const cardStyle: React.CSSProperties = {
  padding: '1.25rem',
  borderRadius: 12,
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border-primary)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 2,
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  margin: '4px 0 12px',
};

const fileInputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  fontSize: '0.8rem',
  color: 'var(--text-secondary)',
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: 'var(--text-primary)',
  fontSize: '0.875rem',
  fontWeight: 700,
};

const runButtonStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '0.8rem 2rem',
  borderRadius: 10,
  border: 'none',
  fontWeight: 700,
  fontSize: '0.9rem',
  width: '100%',
};

const linkButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.6rem 0.9rem',
  borderRadius: 8,
  border: '1px solid var(--border-primary)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
  fontSize: '0.8rem',
  fontWeight: 700,
  textDecoration: 'none',
};

const resultsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginTop: 12,
};

const resultItemStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  borderRadius: 8,
  backgroundColor: 'rgba(255,255,255,0.02)',
  border: '1px solid var(--border-primary)',
};

const resultHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
};

const leadNameStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontWeight: 700,
  fontSize: '0.875rem',
};

const linkRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginTop: 6,
};

const pageLinkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  fontSize: '0.8rem',
  wordBreak: 'break-all',
};

const routeBoxStyle: React.CSSProperties = {
  marginTop: 8,
  padding: '0.65rem 0.75rem',
  borderRadius: 8,
  border: '1px solid var(--border-primary)',
  background: 'rgba(255,255,255,0.03)',
};

const routeTextStyle: React.CSSProperties = {
  margin: '0 0 4px',
  color: 'var(--text-secondary)',
  fontSize: '0.75rem',
};

const miniLinkStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 999,
  padding: '0.25rem 0.55rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  textDecoration: 'none',
};
