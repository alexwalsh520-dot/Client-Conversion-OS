'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';

interface Lead {
  first_name: string;
  last_name: string;
  email: string;
  lead_type: string;
  instagram_handle?: string;
  instagram_url?: string;
}

type LeadStatus = 'pending' | 'uploading' | 'generating' | 'routing' | 'completed' | 'failed';

interface LeadResult {
  firstName: string;
  lastName: string;
  status: LeadStatus;
  pageUrl?: string;
  slug?: string;
  routePlan?: RoutePlan;
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
  error?: string;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.mp4$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeColumnName(col: string): string {
  return col.toLowerCase().replace(/[\s_-]+/g, '').trim();
}

function capitalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/(^|[\s'-])([a-z])/g, (_, prefix: string, char: string) => {
    return `${prefix}${char.toUpperCase()}`;
  });
}

function parseCSV(text: string): Lead[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have header + data rows');

  const headers = lines[0].split(',').map(h => h.trim());
  const normalizedHeaders = headers.map(normalizeColumnName);
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
    )
      colMap.instagram_handle = i;
    if (
      h === 'instagramurl' ||
      h === 'instagramlink' ||
      h === 'igurl' ||
      h === 'iglink'
    )
      colMap.instagram_url = i;
  });

  const required = ['first_name', 'email', 'lead_type'];
  const missing = required.filter(c => colMap[c] === undefined);
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);

  return lines
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      return {
        first_name: capitalizeNamePart(values[colMap.first_name] || ''),
        last_name: colMap.last_name === undefined ? '' : capitalizeNamePart(values[colMap.last_name] || ''),
        email: values[colMap.email] || '',
        lead_type: values[colMap.lead_type] || '',
        instagram_handle: colMap.instagram_handle === undefined ? '' : values[colMap.instagram_handle] || '',
        instagram_url: colMap.instagram_url === undefined ? '' : values[colMap.instagram_url] || '',
      };
    });
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--text-muted)' },
  uploading: { label: 'Uploading to Bunny...', color: 'var(--warning)' },
  generating: { label: 'Creating Super Doc...', color: 'var(--warning)' },
  routing: { label: 'Checking CRM route...', color: 'var(--warning)' },
  completed: { label: 'Page ready', color: 'var(--success)' },
  failed: { label: 'Failed', color: 'var(--danger)' },
};

function leadVideoKey(lead: Lead): string {
  return normalizeKey(`${lead.first_name}-${lead.last_name || ''}`);
}

export default function OutreachRunPage() {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [matchStatus, setMatchStatus] = useState<Map<string, boolean>>(new Map());
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);

  const videoFilesRef = useRef<File[]>([]);
  const leadsRef = useRef<Lead[]>([]);

  const updateMatches = useCallback((currentLeads: Lead[], currentVideos: File[]) => {
    const videoNames = new Set(
      currentVideos.map(f => normalizeKey(f.name)),
    );
    const matches = new Map<string, boolean>();
    currentLeads.forEach(lead => {
      const key = leadVideoKey(lead);
      matches.set(key, videoNames.has(key));
    });
    setMatchStatus(matches);
  }, []);

  const handleCSV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvFile(file);
    setFolderMessage(null);

    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length === 0) throw new Error('No data rows found');
      setLeads(parsed);
      leadsRef.current = parsed;
      updateMatches(parsed, videoFilesRef.current);
    } catch (err: unknown) {
      setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV');
      setLeads([]);
      leadsRef.current = [];
    }
  }, [updateMatches]);

  const handleVideos = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setFolderMessage(null);
    setVideoFiles(files);
    videoFilesRef.current = files;
    updateMatches(leadsRef.current, files);
  }, [updateMatches]);

  const handleFolder = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setCsvError(null);
    setFolderMessage(null);

    const csv = files.find(file => file.name.toLowerCase().endsWith('.csv')) || null;
    const videos = files.filter(file => file.name.toLowerCase().endsWith('.mp4'));

    if (!csv) {
      setCsvError('Folder needs one CSV file');
      setCsvFile(null);
      setLeads([]);
      leadsRef.current = [];
      setVideoFiles(videos);
      videoFilesRef.current = videos;
      updateMatches([], videos);
      return;
    }

    try {
      const text = await csv.text();
      const parsed = parseCSV(text);
      if (parsed.length === 0) throw new Error('No data rows found');
      setCsvFile(csv);
      setLeads(parsed);
      leadsRef.current = parsed;
      setVideoFiles(videos);
      videoFilesRef.current = videos;
      updateMatches(parsed, videos);
      setFolderMessage(`Loaded ${csv.name} and ${videos.length} video${videos.length === 1 ? '' : 's'}`);
    } catch (err: unknown) {
      setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV');
      setCsvFile(null);
      setLeads([]);
      leadsRef.current = [];
      setVideoFiles(videos);
      videoFilesRef.current = videos;
      updateMatches([], videos);
    }
  }, [updateMatches]);

  const allMatched =
    leads.length > 0 &&
    videoFiles.length > 0 &&
    leads.every(l => matchStatus.get(leadVideoKey(l)));
  const canRun = allMatched && !isRunning && !csvError;

  const handleRun = async () => {
    if (!canRun || !csvFile) return;

    setIsRunning(true);
    setResults([]);
    setUploadProgress(null);

    const runId = crypto.randomUUID();

    try {
      for (let i = 0; i < videoFiles.length; i++) {
        const video = videoFiles[i];
        setUploadProgress(`Uploading ${video.name} (${i + 1}/${videoFiles.length})...`);

        const res = await fetch(
          `/api/outreach-test/upload?runId=${encodeURIComponent(runId)}&name=${encodeURIComponent(video.name)}`,
          { method: 'PUT', body: video },
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Upload failed for ${video.name}: ${text}`);
        }
      }

      setUploadProgress(null);
      setResults(
        leads.map(l => ({
          firstName: l.first_name,
          lastName: l.last_name,
          status: 'pending' as const,
        })),
      );

      const csvText = await csvFile.text();
      const response = await fetch('/api/outreach-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, csvText }),
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
              next[data.leadIndex!] = {
                firstName: data.firstName || next[data.leadIndex!].firstName,
                lastName: data.lastName || next[data.leadIndex!].lastName,
                status: data.status as LeadResult['status'],
                pageUrl: data.pageUrl || data.gammaUrl,
                slug: data.slug,
                routePlan: data.routePlan,
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
      console.error('Outreach run failed:', msg);
      setResults(prev =>
        prev.length > 0
          ? prev.map(r => (r.status === 'pending' ? { ...r, status: 'failed' as const, error: msg } : r))
          : leads.map(l => ({ firstName: l.first_name, lastName: l.last_name, status: 'failed' as const, error: msg })),
      );
    } finally {
      setIsRunning(false);
      setUploadProgress(null);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <h1
        style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          marginBottom: '0.25rem',
          color: 'var(--text-primary)',
        }}
      >
        Auto Outreach Test
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Upload a folder or separate files. Bunny and Super Doc run for real. GHL and Smartlead are dry-run routing checks.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link href="/super-doc-editor" style={linkButtonStyle}>
          Edit Template
        </Link>
        <Link href="/super-doc/test-lead" target="_blank" style={linkButtonStyle}>
          View Test Page
        </Link>
      </div>

      {/* ── Folder Upload ── */}
      <div style={cardStyle}>
        <label style={labelStyle}>Folder Upload</label>
        <p style={hintStyle}>Pick one folder with one CSV and matching .mp4 videos.</p>
        <input
          type="file"
          multiple
          onChange={handleFolder}
          disabled={isRunning}
          style={fileInputStyle}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
        {folderMessage && (
          <p style={{ color: 'var(--success)', fontSize: '0.8rem', marginTop: 8 }}>{folderMessage}</p>
        )}
      </div>

      {/* ── CSV Upload ── */}
      <div style={{ ...cardStyle, marginTop: '1rem' }}>
        <label style={labelStyle}>CSV File</label>
        <p style={hintStyle}>
          Required: first_name, email, lead_type. Optional: last_name, instagram_handle, instagram_url.
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
            {leads.length} lead{leads.length !== 1 ? 's' : ''} parsed
          </p>
        )}
      </div>

      {/* ── Video Upload ── */}
      <div style={{ ...cardStyle, marginTop: '1rem' }}>
        <label style={labelStyle}>Video Files</label>
        <p style={hintStyle}>
          .mp4 files — filename must be firstname-lastname (e.g. john-smith.mp4)
        </p>
        <input
          type="file"
          accept=".mp4"
          multiple
          onChange={handleVideos}
          disabled={isRunning}
          style={fileInputStyle}
        />
        {videoFiles.length > 0 && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: 8 }}>
            {videoFiles.length} video{videoFiles.length !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>

      {/* ── Match Validation ── */}
      {leads.length > 0 && videoFiles.length > 0 && (
        <div style={{ ...cardStyle, marginTop: '1rem' }}>
          <label style={labelStyle}>Video Matching</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {leads.map((lead, i) => {
              const matched = matchStatus.get(leadVideoKey(lead));
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.8rem',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: matched ? 'var(--success)' : 'var(--danger)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {lead.first_name} {lead.last_name}
                  </span>
                  <span style={{ color: matched ? 'var(--success)' : 'var(--danger)' }}>
                    {matched
                      ? `← ${leadVideoKey(lead)}.mp4`
                      : 'No matching video'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Run Button ── */}
      <button
        onClick={handleRun}
        disabled={!canRun}
        style={{
          marginTop: '1.5rem',
          padding: '0.75rem 2rem',
          borderRadius: 10,
          border: 'none',
          backgroundColor: canRun ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
          color: canRun ? '#000' : 'var(--text-muted)',
          fontWeight: 600,
          fontSize: '0.9rem',
          cursor: canRun ? 'pointer' : 'not-allowed',
          transition: 'all 0.2s',
          width: '100%',
        }}
      >
        {isRunning ? 'Processing...' : 'Run Bunny + Super Doc'}
      </button>

      {/* ── Upload Progress ── */}
      {uploadProgress && (
        <p style={{ color: 'var(--warning)', fontSize: '0.8rem', marginTop: 12, textAlign: 'center' }}>
          {uploadProgress}
        </p>
      )}

      {/* ── Results ── */}
      {results.length > 0 && (
        <div style={{ ...cardStyle, marginTop: '1.5rem' }}>
          <label style={labelStyle}>Results</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {results.map((r, i) => {
              const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.pending;
              return (
                <div
                  key={i}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: 8,
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                        fontSize: '0.875rem',
                      }}
                    >
                      {r.firstName} {r.lastName}
                    </span>
                    <span style={{ color: cfg.color, fontSize: '0.8rem', fontWeight: 500 }}>
                      {cfg.label}
                    </span>
                  </div>
                  {r.pageUrl && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                      <a
                        href={r.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: 'var(--accent)',
                          fontSize: '0.8rem',
                          wordBreak: 'break-all',
                        }}
                      >
                        {r.pageUrl}
                      </a>
                      {r.slug && (
                        <Link href={`/super-doc-editor/${r.slug}`} style={miniLinkStyle}>
                          Edit Doc
                        </Link>
                      )}
                    </div>
                  )}
                  {r.routePlan && (
                    <div style={routeBoxStyle}>
                      <p style={routeTextStyle}>
                        Segment: <strong>{r.routePlan.segment}</strong>
                      </p>
                      <p style={routeTextStyle}>
                        GHL dry run: {r.routePlan.ghl.pipelineName} / {r.routePlan.ghl.stageName}
                      </p>
                      <p style={routeTextStyle}>
                        Smartlead dry run: {r.routePlan.smartlead.campaignId || `Missing ${r.routePlan.smartlead.campaignEnv}`}
                      </p>
                      {r.routePlan.missingEnv.length > 0 && (
                        <p style={{ ...routeTextStyle, color: 'var(--warning)' }}>
                          Missing env: {r.routePlan.missingEnv.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                  {r.error && (
                    <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: 4 }}>
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

const cardStyle: React.CSSProperties = {
  padding: '1.25rem',
  borderRadius: 12,
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border-primary)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 2,
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  marginBottom: 12,
};

const fileInputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  fontSize: '0.8rem',
  color: 'var(--text-secondary)',
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
  fontWeight: 600,
  textDecoration: 'none',
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
