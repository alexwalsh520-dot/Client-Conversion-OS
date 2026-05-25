'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, LayoutTemplate, Save } from 'lucide-react';
import type { SuperDocDesign, SuperDocTemplateContent } from '@/lib/super-doc-types';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type EditorMode = 'template' | 'lead';

interface LeadSummary {
  slug: string;
  first_name: string;
  last_name: string;
  email: string;
  lead_type: string;
  created_at: string;
  view_count: number;
}

interface VisualSuperDocEditorProps {
  mode: EditorMode;
  slug?: string;
}

const DEFAULT_DESIGN: Required<SuperDocDesign> = {
  fontFamily: 'Inter',
  sectionPadding: 80,
  headingScale: 1,
  bodyScale: 1,
  cardRadius: 22,
  cardShadow: 4,
};

const FONT_OPTIONS = ['Inter', 'Arial', 'Georgia', 'Times New Roman'];

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function titleize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDesign(content: SuperDocTemplateContent): Required<SuperDocDesign> {
  return { ...DEFAULT_DESIGN, ...(content.design || {}) };
}

function setAtPath(content: SuperDocTemplateContent, path: string, value: JsonValue): SuperDocTemplateContent {
  const next = deepClone(content) as unknown as Record<string, JsonValue>;
  const keys = path.split('.');
  let cursor: JsonValue = next;

  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor === null || typeof cursor !== 'object') return next as unknown as SuperDocTemplateContent;
    const key = keys[i];
    cursor = Array.isArray(cursor) ? cursor[Number(key)] : cursor[key];
  }

  const lastKey = keys[keys.length - 1];
  if (cursor && typeof cursor === 'object') {
    if (Array.isArray(cursor)) cursor[Number(lastKey)] = value;
    else cursor[lastKey] = value;
  }

  return next as unknown as SuperDocTemplateContent;
}

function sectionKeys(content: SuperDocTemplateContent): string[] {
  return Object.keys(content).filter((key) => key !== 'design');
}

function collectText(value: JsonValue, limit = 8): string[] {
  const found: string[] = [];
  const walk = (item: JsonValue) => {
    if (found.length >= limit) return;
    if (typeof item === 'string' && item.trim()) {
      found.push(item.trim());
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (item && typeof item === 'object') {
      Object.values(item).forEach(walk);
    }
  };
  walk(value);
  return found;
}

export default function VisualSuperDocEditor({ mode, slug }: VisualSuperDocEditorProps) {
  const [content, setContent] = useState<SuperDocTemplateContent | null>(null);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [selectedSection, setSelectedSection] = useState<string>('hero');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const endpoint = mode === 'template' ? '/api/super-doc/template' : `/api/super-doc/lead/${slug}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const loaded = data.content as SuperDocTemplateContent;
      setContent({ ...loaded, design: { ...DEFAULT_DESIGN, ...(loaded.design || {}) } });
      setSelectedSection(sectionKeys(loaded)[0] || 'hero');
    } catch {
      setMessage({ type: 'error', text: mode === 'template' ? 'Template could not load.' : 'This Super Doc could not load.' });
    } finally {
      setLoading(false);
    }
  }, [mode, slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (mode !== 'template') return;
    fetch('/api/super-doc/leads')
      .then((res) => res.json())
      .then((data) => setLeads(data.leads || []))
      .catch(() => setLeads([]));
  }, [mode]);

  const sections = useMemo(() => (content ? sectionKeys(content) : []), [content]);
  const selectedValue = content ? (content as unknown as Record<string, JsonValue>)[selectedSection] : null;
  const design = content ? getDesign(content) : DEFAULT_DESIGN;

  const update = useCallback((path: string, value: JsonValue) => {
    setContent((prev) => (prev ? setAtPath(prev, path, value) : prev));
  }, []);

  const updateDesign = (key: keyof SuperDocDesign, value: string | number) => {
    setContent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        design: {
          ...getDesign(prev),
          [key]: value,
        },
      };
    });
  };

  const saveTemplate = async (updateAll: boolean) => {
    if (!content) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(updateAll ? '/api/super-doc/update-all' : '/api/super-doc/template', {
        method: updateAll ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => ({}));
      setMessage({
        type: 'success',
        text: updateAll
          ? `Saved. ${data.leadsUpdated || 0} existing docs were updated too.`
          : 'Saved. Future Super Docs will use this template.',
      });
    } catch {
      setMessage({ type: 'error', text: 'Save failed.' });
    } finally {
      setSaving(false);
      setShowConfirm(false);
    }
  };

  const saveLead = async () => {
    if (!content || !slug) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/super-doc/lead/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage({ type: 'success', text: 'Saved. Only this one Super Doc changed.' });
    } catch {
      setMessage({ type: 'error', text: 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={pageStyle}><p style={mutedStyle}>Loading builder...</p></div>;
  }

  if (!content) {
    return <div style={pageStyle}><p style={{ color: 'var(--danger)' }}>{message?.text || 'Nothing loaded.'}</p></div>;
  }

  return (
    <div style={pageStyle}>
      <div style={topBarStyle}>
        <div>
          <p style={eyebrowStyle}>{mode === 'template' ? 'Master Template' : 'Single Super Doc'}</p>
          <h1 style={h1Style}>{mode === 'template' ? 'Super Doc Builder' : `Edit ${slug}`}</h1>
        </div>
        <div style={topActionsStyle}>
          {mode === 'lead' && slug && (
            <Link href={`/super-doc/${slug}`} target="_blank" style={secondaryButtonStyle}>
              <ExternalLink size={16} />
              View Doc
            </Link>
          )}
          {mode === 'template' ? (
            <>
              <button onClick={() => saveTemplate(false)} disabled={saving} style={primaryButtonStyle}>
                <Save size={16} />
                {saving ? 'Saving...' : 'Save Template'}
              </button>
              <button onClick={() => setShowConfirm(true)} disabled={saving} style={dangerButtonStyle}>
                Update Existing Docs
              </button>
            </>
          ) : (
            <button onClick={saveLead} disabled={saving} style={primaryButtonStyle}>
              <Save size={16} />
              {saving ? 'Saving...' : 'Save This Doc'}
            </button>
          )}
        </div>
      </div>

      <p style={mutedStyle}>
        Edit text and page styling here. Template edits affect future Super Docs. Single-doc edits affect only that one page.
      </p>

      {message && (
        <div style={{ ...messageStyle, borderColor: message.type === 'success' ? 'var(--success)' : 'var(--danger)', color: message.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
          {message.text}
        </div>
      )}

      <div style={builderGridStyle}>
        <aside style={railStyle}>
          <div style={railHeaderStyle}>
            <LayoutTemplate size={16} />
            Sections
          </div>
          {sections.map((section) => (
            <button
              key={section}
              onClick={() => setSelectedSection(section)}
              style={section === selectedSection ? activeSectionButtonStyle : sectionButtonStyle}
            >
              {titleize(section)}
            </button>
          ))}

          {mode === 'template' && (
            <div style={docsPanelStyle}>
              <div style={railHeaderStyle}>
                <FileText size={16} />
                Existing Docs
              </div>
              {leads.length === 0 ? (
                <p style={smallMutedStyle}>No docs yet.</p>
              ) : (
                leads.slice(0, 12).map((lead) => (
                  <Link key={lead.slug} href={`/super-doc-editor/${lead.slug}`} style={docLinkStyle}>
                    <span>{`${lead.first_name} ${lead.last_name}`.trim() || lead.email}</span>
                    <small>{lead.slug}</small>
                  </Link>
                ))
              )}
            </div>
          )}
        </aside>

        <main style={previewPanelStyle}>
          <div style={previewFrameStyle}>
            <PreviewSection
              sectionKey={selectedSection}
              value={selectedValue}
              design={design}
            />
          </div>
        </main>

        <aside style={inspectorStyle}>
          <h2 style={panelTitleStyle}>Design</h2>
          <DesignControls design={design} updateDesign={updateDesign} />

          <h2 style={{ ...panelTitleStyle, marginTop: 24 }}>{titleize(selectedSection)}</h2>
          {selectedValue === null ? (
            <p style={smallMutedStyle}>Nothing to edit here.</p>
          ) : (
            <FieldTree value={selectedValue} basePath={selectedSection} update={update} />
          )}
        </aside>
      </div>

      {showConfirm && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3 style={modalTitleStyle}>Update all existing docs?</h3>
            <p style={mutedStyle}>
              This replaces every current personalized Super Doc with this template content. Use this only when you want all old docs changed too.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button onClick={() => setShowConfirm(false)} style={secondaryButtonStyle}>Cancel</button>
              <button onClick={() => saveTemplate(true)} style={dangerButtonStyle}>Yes, Update All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DesignControls({ design, updateDesign }: {
  design: Required<SuperDocDesign>;
  updateDesign: (key: keyof SuperDocDesign, value: string | number) => void;
}) {
  return (
    <div style={controlGridStyle}>
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>Font</span>
        <select
          value={design.fontFamily}
          onChange={(event) => updateDesign('fontFamily', event.target.value)}
          style={inputStyle}
        >
          {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
      </label>
      <NumberControl label="Section Spacing" value={design.sectionPadding} min={40} max={120} step={4} onChange={(value) => updateDesign('sectionPadding', value)} />
      <NumberControl label="Heading Size" value={design.headingScale} min={0.8} max={1.4} step={0.05} onChange={(value) => updateDesign('headingScale', value)} />
      <NumberControl label="Body Size" value={design.bodyScale} min={0.85} max={1.3} step={0.05} onChange={(value) => updateDesign('bodyScale', value)} />
      <NumberControl label="Card Roundness" value={design.cardRadius} min={0} max={32} step={2} onChange={(value) => updateDesign('cardRadius', value)} />
      <NumberControl label="Card Shadow" value={design.cardShadow} min={0} max={10} step={1} onChange={(value) => updateDesign('cardShadow', value)} />
    </div>
  );
}

function NumberControl({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={fieldWrapStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%' }}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={inputStyle}
      />
    </label>
  );
}

function FieldTree({ value, basePath, update }: {
  value: JsonValue;
  basePath: string;
  update: (path: string, value: JsonValue) => void;
}) {
  if (typeof value === 'string') {
    const multiline = value.length > 70 || value.includes('\n');
    return (
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>{titleize(basePath.split('.').at(-1) || basePath)}</span>
        {multiline ? (
          <textarea value={value} rows={5} onChange={(event) => update(basePath, event.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
        ) : (
          <input value={value} onChange={(event) => update(basePath, event.target.value)} style={inputStyle} />
        )}
      </label>
    );
  }

  if (typeof value === 'number') {
    return (
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>{titleize(basePath.split('.').at(-1) || basePath)}</span>
        <input type="number" value={value} onChange={(event) => update(basePath, Number(event.target.value))} style={inputStyle} />
      </label>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <label style={checkWrapStyle}>
        <input type="checkbox" checked={value} onChange={(event) => update(basePath, event.target.checked)} />
        <span>{titleize(basePath.split('.').at(-1) || basePath)}</span>
      </label>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {value.map((item, index) => (
          <div key={index} style={nestedBoxStyle}>
            <p style={nestedTitleStyle}>{titleize(basePath.split('.').at(-1) || basePath)} {index + 1}</p>
            <FieldTree value={item} basePath={`${basePath}.${index}`} update={update} />
          </div>
        ))}
      </div>
    );
  }

  if (value && typeof value === 'object') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {Object.entries(value).map(([key, child]) => (
          <FieldTree key={key} value={child} basePath={`${basePath}.${key}`} update={update} />
        ))}
      </div>
    );
  }

  return null;
}

function PreviewSection({ sectionKey, value, design }: {
  sectionKey: string;
  value: JsonValue;
  design: Required<SuperDocDesign>;
}) {
  const text = collectText(value, 10);
  const title = text[0] || titleize(sectionKey);
  const body = text.slice(1, 5);

  return (
    <section
      style={{
        ...previewSectionStyle,
        padding: `${Math.round(design.sectionPadding * 0.65)}px 28px`,
        borderRadius: design.cardRadius,
        fontFamily: design.fontFamily,
      }}
    >
      <p style={previewEyebrowStyle}>{titleize(sectionKey)}</p>
      <h2 style={{ ...previewTitleStyle, fontSize: `${32 * design.headingScale}px`, fontFamily: design.fontFamily }}>
        {title}
      </h2>
      {body.map((item, index) => (
        <p key={index} style={{ ...previewBodyStyle, fontSize: `${16 * design.bodyScale}px` }}>
          {item}
        </p>
      ))}
      <div style={previewCardGridStyle}>
        {text.slice(5, 8).map((item, index) => (
          <div key={index} style={{ ...previewCardStyle, borderRadius: design.cardRadius, boxShadow: `0 ${design.cardShadow}px 0 var(--sd-ink, #181612)` }}>
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

const pageStyle: React.CSSProperties = {
  padding: '2rem',
  minHeight: '100vh',
};

const topBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'center',
  marginBottom: 8,
  flexWrap: 'wrap',
};

const topActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
};

const eyebrowStyle: React.CSSProperties = {
  margin: '0 0 4px',
  color: 'var(--accent)',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const h1Style: React.CSSProperties = {
  margin: 0,
  color: 'var(--text-primary)',
  fontSize: '1.7rem',
  fontWeight: 700,
};

const mutedStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.9rem',
};

const smallMutedStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.78rem',
  margin: 0,
};

const messageStyle: React.CSSProperties = {
  padding: '12px 14px',
  border: '1px solid',
  borderRadius: 10,
  margin: '18px 0',
  fontSize: '0.85rem',
};

const builderGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '220px minmax(360px, 1fr) 360px',
  gap: 18,
  alignItems: 'start',
  marginTop: 24,
};

const railStyle: React.CSSProperties = {
  position: 'sticky',
  top: 20,
  display: 'grid',
  gap: 8,
  maxHeight: 'calc(100vh - 40px)',
  overflow: 'auto',
};

const railHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--text-secondary)',
  fontSize: '0.78rem',
  fontWeight: 700,
  margin: '8px 0',
};

const sectionButtonStyle: React.CSSProperties = {
  border: '1px solid var(--border-primary)',
  borderRadius: 10,
  padding: '10px 12px',
  background: 'var(--bg-card)',
  color: 'var(--text-secondary)',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const activeSectionButtonStyle: React.CSSProperties = {
  ...sectionButtonStyle,
  color: 'var(--text-primary)',
  borderColor: 'var(--accent)',
  background: 'rgba(255,255,255,0.07)',
};

const docsPanelStyle: React.CSSProperties = {
  marginTop: 18,
  display: 'grid',
  gap: 8,
};

const docLinkStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '9px 10px',
  borderRadius: 10,
  border: '1px solid var(--border-primary)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  fontSize: '0.78rem',
};

const previewPanelStyle: React.CSSProperties = {
  minWidth: 0,
};

const previewFrameStyle: React.CSSProperties = {
  border: '1px solid var(--border-primary)',
  borderRadius: 14,
  padding: 18,
  background: 'rgba(255,255,255,0.04)',
  minHeight: 560,
};

const inspectorStyle: React.CSSProperties = {
  position: 'sticky',
  top: 20,
  border: '1px solid var(--border-primary)',
  borderRadius: 14,
  background: 'var(--bg-card)',
  padding: 16,
  maxHeight: 'calc(100vh - 40px)',
  overflow: 'auto',
};

const panelTitleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  color: 'var(--text-primary)',
  fontSize: '0.95rem',
  fontWeight: 700,
};

const controlGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
};

const fieldWrapStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.75rem',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
  padding: '8px 10px',
  font: 'inherit',
};

const checkWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--text-secondary)',
  fontSize: '0.85rem',
};

const nestedBoxStyle: React.CSSProperties = {
  border: '1px solid var(--border-primary)',
  borderRadius: 10,
  padding: 12,
  display: 'grid',
  gap: 10,
};

const nestedTitleStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--accent)',
  fontSize: '0.78rem',
  fontWeight: 700,
};

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: 0,
  borderRadius: 10,
  background: 'var(--accent)',
  color: '#000',
  padding: '10px 14px',
  fontWeight: 700,
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid var(--border-primary)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
  padding: '10px 14px',
  fontWeight: 700,
  cursor: 'pointer',
  textDecoration: 'none',
};

const dangerButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: 'var(--danger)',
  color: '#fff',
};

const previewSectionStyle: React.CSSProperties = {
  minHeight: 520,
  background: '#FFFCF5',
  color: '#181612',
  border: '1.5px solid #181612',
  boxShadow: '0 4px 0 #181612',
};

const previewEyebrowStyle: React.CSSProperties = {
  margin: '0 0 12px',
  color: '#E66B4D',
  fontSize: '0.78rem',
  fontWeight: 800,
  textTransform: 'uppercase',
};

const previewTitleStyle: React.CSSProperties = {
  margin: '0 0 18px',
  lineHeight: 1.1,
  color: '#181612',
};

const previewBodyStyle: React.CSSProperties = {
  margin: '0 0 12px',
  maxWidth: 680,
  color: '#2B2722',
  lineHeight: 1.6,
  whiteSpace: 'pre-line',
};

const previewCardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 14,
  marginTop: 22,
};

const previewCardStyle: React.CSSProperties = {
  border: '1.5px solid #181612',
  background: '#F4EFE3',
  padding: 14,
  color: '#181612',
  fontWeight: 600,
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50000,
  background: 'rgba(0,0,0,0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const modalStyle: React.CSSProperties = {
  width: 'min(460px, 100%)',
  border: '1px solid var(--border-primary)',
  borderRadius: 16,
  background: 'var(--bg-secondary)',
  padding: 24,
};

const modalTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  color: 'var(--text-primary)',
  fontSize: '1.1rem',
};
