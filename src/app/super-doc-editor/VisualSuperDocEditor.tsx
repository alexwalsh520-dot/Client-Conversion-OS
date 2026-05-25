'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ExternalLink, FileText, LayoutTemplate, Monitor, Plus, Save, Smartphone, Square, Trash2, Type } from 'lucide-react';
import type {
  SuperDocBreakpointDesign,
  SuperDocDesign,
  SuperDocDevice,
  SuperDocElementStyle,
  SuperDocTemplateContent,
  SuperDocTemplateVariant,
} from '@/lib/super-doc-types';

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
  variant?: SuperDocTemplateVariant;
}

const DEFAULT_DESKTOP: Required<SuperDocBreakpointDesign> = {
  fontFamily: 'Inter',
  sectionPadding: 80,
  headingScale: 1,
  bodyScale: 1,
  cardRadius: 22,
  cardShadow: 4,
};

const DEFAULT_MOBILE: Required<SuperDocBreakpointDesign> = {
  fontFamily: 'Inter',
  sectionPadding: 48,
  headingScale: 0.92,
  bodyScale: 0.95,
  cardRadius: 16,
  cardShadow: 3,
};

const FONT_OPTIONS = ['Inter', 'Arial', 'Georgia', 'Times New Roman'];
const SECTION_ORDER = [
  'hero',
  'warning',
  'how_doc_helps',
  'special_package',
  'whats_inside',
  'how_we_help',
  'how_it_works',
  'team',
  'mission',
  'tyson',
  'promotion',
  'booking',
  'cash',
  'coaching',
  'results',
  'offer',
  'next_steps',
  'cta',
  'faqs',
  'about',
];

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function titleize(key: string): string {
  return key
    .replace(/\.\d+\./g, ' ')
    .replace(/\d+/g, (n) => ` ${Number(n) + 1} `)
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sectionKeys(content: SuperDocTemplateContent): string[] {
  const hidden = new Set(content.design?.hiddenSections || []);
  const keys = Object.keys(content).filter((key) => key !== 'design' && key !== 'variant_templates' && !hidden.has(key));
  return SECTION_ORDER.filter((key) => keys.includes(key)).concat(keys.filter((key) => !SECTION_ORDER.includes(key)));
}

function getFlatDesign(design?: SuperDocDesign): SuperDocBreakpointDesign {
  if (!design) return {};
  const flat = { ...design };
  delete flat.desktop;
  delete flat.mobile;
  delete flat.elementStyles;
  delete flat.hiddenSections;
  return flat;
}

function normalizeDesign(design?: SuperDocDesign): SuperDocDesign {
  const flat = getFlatDesign(design);
  return {
    ...(design || {}),
    desktop: { ...DEFAULT_DESKTOP, ...flat, ...(design?.desktop || {}) },
    mobile: { ...DEFAULT_MOBILE, ...flat, ...(design?.mobile || {}) },
    elementStyles: design?.elementStyles || {},
    hiddenSections: design?.hiddenSections || [],
  };
}

function normalizeContent(content: SuperDocTemplateContent): SuperDocTemplateContent {
  return { ...content, design: normalizeDesign(content.design) };
}

function getDeviceDesign(content: SuperDocTemplateContent, device: SuperDocDevice): Required<SuperDocBreakpointDesign> {
  const design = normalizeDesign(content.design);
  const defaults = device === 'desktop' ? DEFAULT_DESKTOP : DEFAULT_MOBILE;
  return { ...defaults, ...(design[device] || {}) };
}

function getAtPath(content: SuperDocTemplateContent, path: string): JsonValue {
  const keys = path.split('.');
  let cursor: unknown = content;
  for (const key of keys) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = Array.isArray(cursor) ? cursor[Number(key)] : (cursor as Record<string, unknown>)[key];
  }
  return cursor as JsonValue;
}

function setAtPath(content: SuperDocTemplateContent, path: string, value: JsonValue): SuperDocTemplateContent {
  const next = deepClone(content) as unknown as Record<string, JsonValue>;
  const keys = path.split('.');
  let cursor: JsonValue = next;

  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor === null || typeof cursor !== 'object') return next as unknown as SuperDocTemplateContent;
    cursor = Array.isArray(cursor) ? cursor[Number(keys[i])] : cursor[keys[i]];
  }

  const last = keys[keys.length - 1];
  if (cursor && typeof cursor === 'object') {
    if (Array.isArray(cursor)) cursor[Number(last)] = value;
    else cursor[last] = value;
  }

  return next as unknown as SuperDocTemplateContent;
}

function isPrimitive(value: JsonValue): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function firstText(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(firstText).find(Boolean) || '';
  if (value && typeof value === 'object') return Object.values(value).map(firstText).find(Boolean) || '';
  return '';
}

function firstEditablePath(value: JsonValue, basePath: string): string | null {
  if (isPrimitive(value)) return basePath;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const path = firstEditablePath(value[index], `${basePath}.${index}`);
      if (path) return path;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const heading = entries.find(([key]) => ['heading', 'section_heading', 'title_template', 'text'].includes(key));
    const ordered = heading ? [heading, ...entries.filter(([key]) => key !== heading[0])] : entries;

    for (const [key, child] of ordered) {
      if (key === 'serif_word') continue;
      const path = firstEditablePath(child, `${basePath}.${key}`);
      if (path) return path;
    }
  }

  return null;
}

function getElementStyle(content: SuperDocTemplateContent, path: string, device: SuperDocDevice): SuperDocElementStyle {
  const design = normalizeDesign(content.design);
  return design.elementStyles?.[path]?.[device] || {};
}

function elementButtonStyle(content: SuperDocTemplateContent, path: string, device: SuperDocDevice, selected: boolean): CSSProperties {
  const style = getElementStyle(content, path, device);
  return {
    ...canvasElementStyle,
    ...(style.fontSize ? { fontSize: style.fontSize } : {}),
    ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.textAlign ? { textAlign: style.textAlign } : {}),
    marginTop: style.marginTop ?? 0,
    marginBottom: style.marginBottom ?? 8,
    outline: selected ? '2px solid #ff7a1a' : '1px solid transparent',
    background: selected ? 'rgba(255,122,26,0.08)' : 'transparent',
  };
}

export default function VisualSuperDocEditor({ mode, slug, variant = 'creator' }: VisualSuperDocEditorProps) {
  const [content, setContent] = useState<SuperDocTemplateContent | null>(null);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState('hero.title_template');
  const [selectedSection, setSelectedSection] = useState('hero');
  const [device, setDevice] = useState<SuperDocDevice>('desktop');
  const [inspectorTab, setInspectorTab] = useState<'general' | 'styles'>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAddSections, setShowAddSections] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const endpoint = mode === 'template'
        ? `/api/super-doc/template?variant=${variant}`
        : `/api/super-doc/lead/${slug}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const loaded = normalizeContent(data.content as SuperDocTemplateContent);
      const firstSection = sectionKeys(loaded)[0] || 'hero';
      setContent(loaded);
      setSelectedSection(firstSection);
      setSelectedPath(firstEditablePath((loaded as unknown as Record<string, JsonValue>)[firstSection], firstSection) || firstSection);
    } catch {
      setMessage({ type: 'error', text: mode === 'template' ? 'Template could not load.' : 'This Super Doc could not load.' });
    } finally {
      setLoading(false);
    }
  }, [mode, slug, variant]);

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
  const addableSections = useMemo(() => {
    if (!content) return [];
    const hidden = new Set(content.design?.hiddenSections || []);
    return SECTION_ORDER.filter((section) => hidden.has(section));
  }, [content]);
  const selectedValue = content ? getAtPath(content, selectedPath) : null;
  const currentDesign = content ? getDeviceDesign(content, device) : DEFAULT_DESKTOP;

  const selectSection = (section: string) => {
    if (!content) return;
    const sectionValue = (content as unknown as Record<string, JsonValue>)[section];
    setSelectedSection(section);
    setSelectedPath(firstEditablePath(sectionValue, section) || section);
    setInspectorTab('general');
    setShowAddSections(false);
  };

  const selectElement = (path: string) => {
    setSelectedPath(path);
    setSelectedSection(path.split('.')[0]);
    setInspectorTab('general');
    setShowAddSections(false);
  };

  const update = useCallback((path: string, value: JsonValue) => {
    setContent((prev) => (prev ? setAtPath(prev, path, value) : prev));
  }, []);

  const selectFirstTextInSection = () => {
    if (!content) return;
    const sectionValue = (content as unknown as Record<string, JsonValue>)[selectedSection];
    const path = firstEditablePath(sectionValue, selectedSection);
    if (!path) return;
    selectElement(path);
  };

  const hideSection = (section: string) => {
    if (!content || section === 'hero') return;
    const visibleSections = sections.filter((item) => item !== section);
    const fallbackSection = visibleSections[Math.max(0, sections.indexOf(section) - 1)] || 'hero';
    const fallbackValue = (content as unknown as Record<string, JsonValue>)[fallbackSection];
    setContent((prev) => {
      if (!prev) return prev;
      const design = normalizeDesign(prev.design);
      const hidden = Array.from(new Set([...(design.hiddenSections || []), section]));
      return {
        ...prev,
        design: {
          ...design,
          hiddenSections: hidden,
        },
      };
    });
    setSelectedSection(fallbackSection);
    setSelectedPath(firstEditablePath(fallbackValue, fallbackSection) || fallbackSection);
    setInspectorTab('general');
    setMessage({ type: 'success', text: `${titleize(section)} was removed from the page. Save when ready.` });
  };

  const showSection = (section: string) => {
    if (!content) return;
    const sectionValue = (content as unknown as Record<string, JsonValue>)[section];
    setContent((prev) => {
      if (!prev) return prev;
      const design = normalizeDesign(prev.design);
      return {
        ...prev,
        design: {
          ...design,
          hiddenSections: (design.hiddenSections || []).filter((item) => item !== section),
        },
      };
    });
    setSelectedSection(section);
    setSelectedPath(firstEditablePath(sectionValue, section) || section);
    setInspectorTab('general');
    setShowAddSections(false);
    setMessage({ type: 'success', text: `${titleize(section)} was added back. Save when ready.` });
  };

  const updateDeviceDesign = (key: keyof SuperDocBreakpointDesign, value: string | number) => {
    setContent((prev) => {
      if (!prev) return prev;
      const design = normalizeDesign(prev.design);
      return {
        ...prev,
        design: {
          ...design,
          [device]: {
            ...(design[device] || {}),
            [key]: value,
          },
        },
      };
    });
  };

  const updateElementStyle = (key: keyof SuperDocElementStyle, value: string | number) => {
    setContent((prev) => {
      if (!prev) return prev;
      const design = normalizeDesign(prev.design);
      const existing = design.elementStyles?.[selectedPath] || {};
      return {
        ...prev,
        design: {
          ...design,
          elementStyles: {
            ...(design.elementStyles || {}),
            [selectedPath]: {
              ...existing,
              [device]: {
                ...(existing[device] || {}),
                [key]: value,
              },
            },
          },
        },
      };
    });
  };

  const saveTemplate = async (updateAll: boolean) => {
    if (!content) return;
    setSaving(true);
    setMessage(null);
    try {
      const templateEndpoint = updateAll
        ? `/api/super-doc/update-all?variant=${variant}`
        : `/api/super-doc/template?variant=${variant}`;
      const res = await fetch(templateEndpoint, {
        method: updateAll ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => ({}));
      setMessage({
        type: 'success',
        text: updateAll
          ? `Saved. ${data.leadsUpdated || 0} existing ${variant === 'agency' ? 'agency/TM' : 'creator'} docs were updated too.`
          : `Saved. Future ${variant === 'agency' ? 'agency/TM' : 'creator'} Super Docs will use this template.`,
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

  if (loading) return <div className="super-doc-editor-fullbleed" style={pageStyle}><p style={mutedStyle}>Loading builder...</p></div>;
  if (!content) return <div className="super-doc-editor-fullbleed" style={pageStyle}><p style={{ color: 'var(--danger)' }}>{message?.text || 'Nothing loaded.'}</p></div>;

  return (
    <div className="super-doc-editor-fullbleed" style={pageStyle}>
      <div style={topBarStyle}>
        <Link href="/studio-2/auto-outreach-test" style={backLinkStyle}>Back</Link>
        <div style={topTitleStyle}>
          <p style={savePillStyle}>{mode === 'template' ? `${variant === 'agency' ? 'Agency/TM' : 'Creator'} template` : 'Personalized Super Doc'}</p>
          <strong style={{ color: 'var(--text-primary)' }}>{mode === 'template' ? 'Super Doc Builder' : `Editing ${slug}`}</strong>
        </div>
        <div style={topActionsStyle}>
          <button onClick={() => setDevice('desktop')} style={device === 'desktop' ? activeIconButtonStyle : iconButtonStyle} title="Desktop editor">
            <Monitor size={16} />
          </button>
          <button onClick={() => setDevice('mobile')} style={device === 'mobile' ? activeIconButtonStyle : iconButtonStyle} title="Mobile editor">
            <Smartphone size={16} />
          </button>
          {mode === 'lead' && slug && (
            <Link href={`/super-doc/${slug}`} target="_blank" style={iconButtonStyle} title="View live page">
              <ExternalLink size={16} />
            </Link>
          )}
          {mode === 'template' ? (
            <>
              <button onClick={() => saveTemplate(false)} disabled={saving} style={primaryButtonStyle}>
                <Save size={16} />
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setShowConfirm(true)} disabled={saving} style={publishButtonStyle}>
                Update Existing
              </button>
              <Link href={`/super-doc-editor?variant=${variant === 'agency' ? 'creator' : 'agency'}`} style={secondaryButtonStyle}>
                {variant === 'agency' ? 'Creator' : 'Agency/TM'}
              </Link>
            </>
          ) : (
            <button onClick={saveLead} disabled={saving} style={primaryButtonStyle}>
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Doc'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div style={{ ...messageStyle, borderColor: message.type === 'success' ? 'var(--success)' : 'var(--danger)', color: message.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
          {message.text}
        </div>
      )}

      <div style={builderGridStyle}>
        <aside style={leftPanelStyle}>
          <div style={toolbarStyle}>
            <button type="button" onClick={() => setShowAddSections((value) => !value)} style={showAddSections ? activeToolButtonStyle : toolButtonStyle} title="Add a removed section">
              <Plus size={16} />
            </button>
            <button type="button" onClick={() => selectSection(selectedSection)} style={toolButtonStyle} title="Select the current section">
              <LayoutTemplate size={16} />
            </button>
            <button type="button" onClick={selectFirstTextInSection} style={toolButtonStyle} title="Select the first text in this section">
              <Type size={16} />
            </button>
            <button type="button" onClick={() => setInspectorTab('styles')} style={inspectorTab === 'styles' ? activeToolButtonStyle : toolButtonStyle} title="Edit styles">
              <Square size={15} />
            </button>
          </div>
          {showAddSections && (
            <div style={addSectionPanelStyle}>
              <p style={smallMutedStyle}>Add back a section you removed.</p>
              {addableSections.length ? addableSections.map((section) => (
                <button key={section} type="button" onClick={() => showSection(section)} style={addSectionButtonStyle}>
                  <Plus size={14} />
                  {titleize(section)}
                </button>
              )) : (
                <p style={smallMutedStyle}>Nothing is removed right now.</p>
              )}
            </div>
          )}
          <div style={panelDividerStyle} />
          <div style={sideHeaderStyle}><LayoutTemplate size={15} /> Page</div>
          <div style={sectionListStyle}>
            {sections.map((section) => (
              <div key={section} style={sectionRowStyle}>
                <button
                  type="button"
                  onClick={() => selectSection(section)}
                  style={section === selectedSection ? activeSectionButtonStyle : sectionButtonStyle}
                >
                  {titleize(section)}
                </button>
                {section !== 'hero' && (
                  <button type="button" onClick={() => hideSection(section)} style={deleteSectionButtonStyle} title={`Remove ${titleize(section)}`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {mode === 'template' && (
            <>
              <div style={panelDividerStyle} />
              <div style={sideHeaderStyle}><FileText size={15} /> Docs</div>
              {leads.slice(0, 8).map((lead) => (
                <Link key={lead.slug} href={`/super-doc-editor/${lead.slug}`} style={docLinkStyle}>
                  {`${lead.first_name} ${lead.last_name}`.trim() || lead.email}
                </Link>
              ))}
            </>
          )}
        </aside>

        <main style={canvasShellStyle}>
          <div style={pageLabelStyle}>
            <span>{mode === 'template' ? `${variant === 'agency' ? 'Agency/TM' : 'Creator'} Template` : slug}</span>
            <span>{device === 'desktop' ? 'Desktop' : 'Mobile'} canvas</span>
          </div>
          <div style={canvasScrollStyle}>
            <div style={{
              ...canvasPageStyle,
              width: device === 'desktop' ? 1080 : 390,
              fontFamily: currentDesign.fontFamily,
            }}>
              <CanvasPage
                content={content}
                device={device}
                selectedPath={selectedPath}
                selectedSection={selectedSection}
                selectElement={selectElement}
              />
            </div>
          </div>
        </main>

        <aside style={inspectorStyle}>
          <div style={inspectorTitleRowStyle}>
            <h2 style={panelTitleStyle}>{selectedValue === null ? 'Page Settings' : titleize(selectedPath)}</h2>
            {selectedSection !== 'hero' && sections.includes(selectedSection) && (
              <button type="button" onClick={() => hideSection(selectedSection)} style={dangerSmallButtonStyle}>
                <Trash2 size={14} />
                Remove Section
              </button>
            )}
          </div>
          <div style={tabRowStyle}>
            <button onClick={() => setInspectorTab('general')} style={inspectorTab === 'general' ? activeTabStyle : tabStyle}>General</button>
            <button onClick={() => setInspectorTab('styles')} style={inspectorTab === 'styles' ? activeTabStyle : tabStyle}>Styles</button>
          </div>

          {inspectorTab === 'general' ? (
            <InspectorGeneral value={selectedValue} path={selectedPath} update={update} />
          ) : (
            <InspectorStyles
              device={device}
              design={currentDesign}
              elementStyle={getElementStyle(content, selectedPath, device)}
              updateDeviceDesign={updateDeviceDesign}
              updateElementStyle={updateElementStyle}
              selectedPath={selectedPath}
            />
          )}
        </aside>
      </div>

      {showConfirm && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3 style={modalTitleStyle}>Update all existing docs?</h3>
            <p style={mutedStyle}>This replaces the content snapshot on every current personalized Super Doc.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button onClick={() => setShowConfirm(false)} style={secondaryButtonStyle}>Cancel</button>
              <button onClick={() => saveTemplate(true)} style={publishButtonStyle}>Yes, Update All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CanvasPage({ content, device, selectedPath, selectedSection, selectElement }: {
  content: SuperDocTemplateContent;
  device: SuperDocDevice;
  selectedPath: string;
  selectedSection: string;
  selectElement: (path: string) => void;
}) {
  const sections = sectionKeys(content);
  return (
    <div>
      {sections.map((section) => (
        <CanvasSection
          key={section}
          sectionKey={section}
          value={(content as unknown as Record<string, JsonValue>)[section]}
          device={device}
          content={content}
          selectedPath={selectedPath}
          selectElement={selectElement}
          dimmed={selectedSection !== section}
        />
      ))}
    </div>
  );
}

function CanvasSection({ sectionKey, value, device, content, selectedPath, selectElement, dimmed }: {
  sectionKey: string;
  value: JsonValue;
  device: SuperDocDevice;
  content: SuperDocTemplateContent;
  selectedPath: string;
  selectElement: (path: string) => void;
  dimmed: boolean;
}) {
  const design = getDeviceDesign(content, device);
  const isHero = sectionKey === 'hero';
  const isDark = ['team', 'tyson', 'booking', 'cash', 'coaching', 'results'].includes(sectionKey);

  return (
    <section
      style={{
        ...canvasSectionStyle,
        padding: `${design.sectionPadding}px 48px`,
        background: isDark ? '#1F3D2E' : isHero ? '#F4EFE3' : '#FFFCF5',
        opacity: dimmed ? 0.35 : 1,
      }}
    >
      <div style={canvasSectionInnerStyle}>
        <div style={{ ...canvasEyebrowStyle, color: isDark ? '#F5D67A' : '#E66B4D' }}>{titleize(sectionKey)}</div>
        {isHero && (
          <div style={videoPlaceholderStyle}>
            <span>Personal video</span>
          </div>
        )}
        <CanvasNode
          value={value}
          path={sectionKey}
          device={device}
          content={content}
          selectedPath={selectedPath}
          selectElement={selectElement}
          depth={0}
          dark={isDark}
        />
      </div>
    </section>
  );
}

function CanvasNode({ value, path, device, content, selectedPath, selectElement, depth, dark }: {
  value: JsonValue;
  path: string;
  device: SuperDocDevice;
  content: SuperDocTemplateContent;
  selectedPath: string;
  selectElement: (path: string) => void;
  depth: number;
  dark: boolean;
}) {
  if (isPrimitive(value)) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          selectElement(path);
        }}
        style={{
          ...elementButtonStyle(content, path, device, selectedPath === path),
          color: getElementStyle(content, path, device).color || (dark ? '#fff' : '#181612'),
          fontSize: getElementStyle(content, path, device).fontSize || (depth === 0 ? 36 : depth === 1 ? 22 : 16),
          fontWeight: getElementStyle(content, path, device).fontWeight || (depth <= 1 ? 700 : 500),
          whiteSpace: 'pre-line',
        }}
      >
        {String(value)}
      </button>
    );
  }

  if (Array.isArray(value)) {
    const primitiveArray = value.every(isPrimitive);
    return (
      <div style={primitiveArray ? canvasListStyle : canvasGridStyle}>
        {value.map((item, index) => (
          <div key={index} style={primitiveArray ? canvasListItemStyle : canvasCardStyle}>
            <CanvasNode
              value={item}
              path={`${path}.${index}`}
              device={device}
              content={content}
              selectedPath={selectedPath}
              selectElement={selectElement}
              depth={depth + 1}
              dark={false}
            />
          </div>
        ))}
      </div>
    );
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const headingEntry = entries.find(([key]) => ['heading', 'section_heading', 'title_template', 'text'].includes(key));
    const rest = headingEntry ? entries.filter(([key]) => key !== headingEntry[0]) : entries;
    return (
      <div style={depth > 0 ? nestedCanvasGroupStyle : undefined}>
        {headingEntry && (
          <CanvasNode
            value={headingEntry[1]}
            path={`${path}.${headingEntry[0]}`}
            device={device}
            content={content}
            selectedPath={selectedPath}
            selectElement={selectElement}
            depth={depth}
            dark={dark}
          />
        )}
        <div style={depth > 0 ? undefined : canvasContentStackStyle}>
          {rest.map(([key, child]) => {
            if (key === 'serif_word') return null;
            const childText = firstText(child);
            return (
              <div key={key} style={typeof child === 'object' && child !== null ? nestedCanvasGroupStyle : undefined}>
                {typeof child === 'object' && child !== null && (
                  <p style={canvasFieldLabelStyle}>{titleize(key)}{childText ? ` · ${childText.slice(0, 30)}` : ''}</p>
                )}
                <CanvasNode
                  value={child}
                  path={`${path}.${key}`}
                  device={device}
                  content={content}
                  selectedPath={selectedPath}
                  selectElement={selectElement}
                  depth={depth + 1}
                  dark={dark && depth === 0}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}

function InspectorGeneral({ value, path, update }: {
  value: JsonValue;
  path: string;
  update: (path: string, value: JsonValue) => void;
}) {
  if (typeof value === 'string') {
    return (
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>Text</span>
        <textarea value={value} rows={8} onChange={(event) => update(path, event.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
      </label>
    );
  }

  if (typeof value === 'number') {
    return (
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>Number</span>
        <input type="number" value={value} onChange={(event) => update(path, Number(event.target.value))} style={inputStyle} />
      </label>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <label style={checkWrapStyle}>
        <input type="checkbox" checked={value} onChange={(event) => update(path, event.target.checked)} />
        <span>Enabled</span>
      </label>
    );
  }

  return <p style={mutedStyle}>Select text, a number, or a small item on the page to edit it here.</p>;
}

function InspectorStyles({ device, design, elementStyle, updateDeviceDesign, updateElementStyle, selectedPath }: {
  device: SuperDocDevice;
  design: Required<SuperDocBreakpointDesign>;
  elementStyle: SuperDocElementStyle;
  updateDeviceDesign: (key: keyof SuperDocBreakpointDesign, value: string | number) => void;
  updateElementStyle: (key: keyof SuperDocElementStyle, value: string | number) => void;
  selectedPath: string;
}) {
  return (
    <div style={controlGridStyle}>
      <p style={smallMutedStyle}>Editing {device}. These controls are separate for desktop and mobile.</p>
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>Page Font</span>
        <select value={design.fontFamily} onChange={(event) => updateDeviceDesign('fontFamily', event.target.value)} style={inputStyle}>
          {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
      </label>
      <NumberControl label="Section Padding" value={design.sectionPadding} min={32} max={130} step={4} onChange={(value) => updateDeviceDesign('sectionPadding', value)} />
      <NumberControl label="Heading Scale" value={design.headingScale} min={0.7} max={1.5} step={0.05} onChange={(value) => updateDeviceDesign('headingScale', value)} />
      <NumberControl label="Body Scale" value={design.bodyScale} min={0.75} max={1.35} step={0.05} onChange={(value) => updateDeviceDesign('bodyScale', value)} />
      <NumberControl label="Card Radius" value={design.cardRadius} min={0} max={36} step={2} onChange={(value) => updateDeviceDesign('cardRadius', value)} />

      <div style={panelDividerStyle} />
      <p style={panelTitleStyle}>Selected Element</p>
      <p style={smallMutedStyle}>{selectedPath}</p>
      <NumberControl label="Font Size" value={elementStyle.fontSize || 18} min={10} max={72} step={1} onChange={(value) => updateElementStyle('fontSize', value)} />
      <NumberControl label="Font Weight" value={elementStyle.fontWeight || 600} min={300} max={900} step={100} onChange={(value) => updateElementStyle('fontWeight', value)} />
      <NumberControl label="Top Margin" value={elementStyle.marginTop || 0} min={0} max={80} step={2} onChange={(value) => updateElementStyle('marginTop', value)} />
      <NumberControl label="Bottom Margin" value={elementStyle.marginBottom || 8} min={0} max={80} step={2} onChange={(value) => updateElementStyle('marginBottom', value)} />
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>Text Align</span>
        <select value={elementStyle.textAlign || 'left'} onChange={(event) => updateElementStyle('textAlign', event.target.value)} style={inputStyle}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label style={fieldWrapStyle}>
        <span style={labelStyle}>Color</span>
        <input type="color" value={elementStyle.color || '#181612'} onChange={(event) => updateElementStyle('color', event.target.value)} style={{ ...inputStyle, height: 42 }} />
      </label>
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
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ width: '100%' }} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} style={inputStyle} />
    </label>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: '#f3f4f7',
};

const topBarStyle: CSSProperties = {
  height: 68,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '0 18px',
  borderBottom: '1px solid #dde1ea',
  background: '#fff',
  position: 'sticky',
  top: 0,
  zIndex: 20,
};

const backLinkStyle: CSSProperties = {
  color: '#1f2937',
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: 14,
};

const topTitleStyle: CSSProperties = {
  flex: 1,
  textAlign: 'center',
};

const savePillStyle: CSSProperties = {
  margin: 0,
  color: '#667085',
  fontSize: 12,
};

const topActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const iconButtonStyle: CSSProperties = {
  width: 42,
  height: 38,
  borderRadius: 10,
  border: '1px solid #d8dde8',
  background: '#fff',
  color: '#344054',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  textDecoration: 'none',
};

const activeIconButtonStyle: CSSProperties = {
  ...iconButtonStyle,
  background: '#eef4ff',
  borderColor: '#4c7dff',
  color: '#2454d6',
};

const primaryButtonStyle: CSSProperties = {
  minHeight: 38,
  borderRadius: 10,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 14px',
  fontWeight: 800,
  cursor: 'pointer',
};

const publishButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: '#355bea',
};

const secondaryButtonStyle: CSSProperties = {
  ...iconButtonStyle,
  width: 'auto',
  padding: '0 14px',
  fontWeight: 700,
};

const builderGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '230px minmax(420px, 1fr) 350px',
  height: 'calc(100vh - 68px)',
};

const leftPanelStyle: CSSProperties = {
  borderRight: '1px solid #dde1ea',
  background: '#fff',
  padding: 14,
  overflow: 'auto',
};

const toolbarStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 38px)',
  gap: 6,
};

const toolButtonStyle: CSSProperties = {
  width: 38,
  height: 36,
  border: '1px solid #d8dde8',
  borderRadius: 10,
  background: '#fff',
  color: '#475467',
  fontWeight: 800,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const activeToolButtonStyle: CSSProperties = {
  ...toolButtonStyle,
  borderColor: '#2563eb',
  background: '#eef4ff',
  color: '#2454d6',
};

const addSectionPanelStyle: CSSProperties = {
  border: '1px solid #dde1ea',
  borderRadius: 12,
  background: '#f8fafc',
  padding: 10,
  marginTop: 10,
  display: 'grid',
  gap: 8,
};

const addSectionButtonStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 9,
  color: '#344054',
  textAlign: 'left',
  padding: '9px 10px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: '#fff',
};

const panelDividerStyle: CSSProperties = {
  height: 1,
  background: '#e5e7eb',
  margin: '12px 0',
};

const sideHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#667085',
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
  marginBottom: 8,
};

const sectionListStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const sectionRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 36px',
  gap: 6,
  alignItems: 'stretch',
};

const sectionButtonStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 9,
  background: '#fff',
  color: '#344054',
  textAlign: 'left',
  padding: '9px 10px',
  cursor: 'pointer',
  width: '100%',
};

const activeSectionButtonStyle: CSSProperties = {
  ...sectionButtonStyle,
  borderColor: '#ff7a1a',
  color: '#111827',
  background: '#fff7ed',
};

const deleteSectionButtonStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 9,
  background: '#fff',
  color: '#98a2b3',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const docLinkStyle: CSSProperties = {
  display: 'block',
  color: '#344054',
  textDecoration: 'none',
  fontSize: 12,
  padding: '8px 0',
  borderBottom: '1px solid #edf0f5',
};

const canvasShellStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: '38px 1fr',
};

const pageLabelStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  gap: 10,
  alignItems: 'center',
  color: '#3b82f6',
  fontSize: 13,
  background: '#f8fafc',
  borderBottom: '1px solid #dde1ea',
};

const canvasScrollStyle: CSSProperties = {
  overflow: 'auto',
  padding: 22,
};

const canvasPageStyle: CSSProperties = {
  margin: '0 auto',
  background: '#fff',
  minHeight: 1200,
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 10px 30px rgba(15,23,42,0.12)',
};

const inspectorStyle: CSSProperties = {
  borderLeft: '1px solid #dde1ea',
  background: '#fff',
  overflow: 'auto',
};

const inspectorTitleRowStyle: CSSProperties = {
  padding: '18px 18px 10px',
  borderBottom: '1px solid #edf0f5',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const panelTitleStyle: CSSProperties = {
  margin: 0,
  color: '#344054',
  fontSize: 16,
  fontWeight: 800,
};

const dangerSmallButtonStyle: CSSProperties = {
  border: '1px solid #fecaca',
  borderRadius: 9,
  background: '#fff7f7',
  color: '#b42318',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const tabRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  borderBottom: '1px solid #edf0f5',
};

const tabStyle: CSSProperties = {
  border: 0,
  background: '#fff',
  color: '#344054',
  padding: '12px 10px',
  fontWeight: 800,
  cursor: 'pointer',
};

const activeTabStyle: CSSProperties = {
  ...tabStyle,
  color: '#2563eb',
  borderBottom: '2px solid #2563eb',
};

const controlGridStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 18,
};

const fieldWrapStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 18,
};

const labelStyle: CSSProperties = {
  color: '#667085',
  fontSize: 12,
  fontWeight: 800,
};

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid #d8dde8',
  borderRadius: 10,
  background: '#fff',
  color: '#111827',
  padding: '10px 12px',
  font: 'inherit',
};

const checkWrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#344054',
  padding: 18,
};

const mutedStyle: CSSProperties = {
  color: '#667085',
  fontSize: 14,
};

const smallMutedStyle: CSSProperties = {
  ...mutedStyle,
  margin: 0,
  fontSize: 12,
};

const messageStyle: CSSProperties = {
  margin: 16,
  padding: '12px 14px',
  border: '1px solid',
  borderRadius: 10,
  background: '#fff',
};

const canvasSectionStyle: CSSProperties = {
  borderBottom: '1.5px solid #181612',
  transition: 'opacity 0.18s ease',
};

const canvasSectionInnerStyle: CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
};

const canvasEyebrowStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 10,
};

const videoPlaceholderStyle: CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  background: '#181612',
  borderRadius: 18,
  color: '#fff',
  display: 'grid',
  placeItems: 'center',
  marginBottom: 26,
  fontWeight: 800,
};

const canvasElementStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 0,
  padding: 4,
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const canvasContentStackStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const canvasGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
};

const canvasCardStyle: CSSProperties = {
  background: '#FFFCF5',
  border: '1.5px solid #181612',
  borderRadius: 16,
  padding: 16,
  color: '#181612',
};

const canvasListStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const canvasListItemStyle: CSSProperties = {
  borderBottom: '1px solid #E6DECB',
  padding: '4px 0',
};

const nestedCanvasGroupStyle: CSSProperties = {
  marginTop: 14,
};

const canvasFieldLabelStyle: CSSProperties = {
  color: '#E66B4D',
  fontSize: 12,
  fontWeight: 900,
  margin: '0 0 6px',
  textTransform: 'uppercase',
};

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  zIndex: 50000,
};

const modalStyle: CSSProperties = {
  width: 'min(460px, 100%)',
  background: '#fff',
  borderRadius: 16,
  padding: 24,
};

const modalTitleStyle: CSSProperties = {
  margin: '0 0 10px',
  color: '#111827',
  fontSize: 18,
};
