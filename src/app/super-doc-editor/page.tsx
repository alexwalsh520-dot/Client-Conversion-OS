'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SuperDocTemplateContent } from '@/lib/super-doc-types';

type SectionKey = string;

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export default function SuperDocEditorPage() {
  const [template, setTemplate] = useState<SuperDocTemplateContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(new Set(['hero']));

  useEffect(() => {
    fetch('/api/super-doc/template')
      .then(r => r.json())
      .then(data => {
        if (data.content) setTemplate(data.content);
        else setMessage({ text: 'Template not found. Run POST /api/super-doc/setup first.', type: 'error' });
      })
      .catch(() => setMessage({ text: 'Failed to load template', type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: SectionKey) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const update = useCallback((path: string, value: unknown) => {
    setTemplate(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      const keys = path.split('.');
      let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (k.match(/^\d+$/)) {
          obj = (obj as unknown as unknown[])[parseInt(k)] as Record<string, unknown>;
        } else {
          obj = obj[k] as Record<string, unknown>;
        }
      }
      const lastKey = keys[keys.length - 1];
      if (lastKey.match(/^\d+$/)) {
        (obj as unknown as unknown[])[parseInt(lastKey)] = value;
      } else {
        obj[lastKey] = value;
      }
      return next;
    });
  }, []);

  const saveNewOnly = async () => {
    if (!template) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/super-doc/template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: template }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage({ text: 'Saved! New leads will use this template.', type: 'success' });
    } catch {
      setMessage({ text: 'Save failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const saveAndUpdateAll = async () => {
    if (!template) return;
    setSaving(true);
    setShowConfirm(false);
    setMessage(null);
    try {
      const res = await fetch('/api/super-doc/update-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: template }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMessage({ text: `Saved! Template + ${data.leadsUpdated} existing pages updated.`, type: 'success' });
    } catch {
      setMessage({ text: 'Save failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={pageStyle}><p style={{ color: 'var(--text-muted)' }}>Loading template...</p></div>;
  if (!template) return <div style={pageStyle}><p style={{ color: 'var(--danger)' }}>{message?.text || 'No template found'}</p></div>;

  return (
    <div style={pageStyle}>
      <h1 style={h1Style}>Super Doc Editor</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Edit the master template. Changes apply to new leads unless you choose &quot;Update All.&quot;
      </p>

      {message && (
        <div style={{ ...msgStyle, borderColor: message.type === 'success' ? 'var(--success)' : 'var(--danger)', color: message.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
          {message.text}
        </div>
      )}

      {/* ── SECTIONS ── */}
      <Accordion title="Hero" sectionKey="hero" open={openSections} toggle={toggle}>
        <Field label="Title template (use {{first_name}})" value={template.hero.title_template} onChange={v => update('hero.title_template', v)} />
        <Field label="Italic serif word (from title)" value={template.hero.serif_word} onChange={v => update('hero.serif_word', v)} />
      </Accordion>

      <Accordion title="Warning Panel" sectionKey="warning" open={openSections} toggle={toggle}>
        <TextArea label="Warning text" value={template.warning.text} onChange={v => update('warning.text', v)} rows={6} />
      </Accordion>

      <Accordion title="How This Document Can Help You" sectionKey="how_doc_helps" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.how_doc_helps.heading} onChange={v => update('how_doc_helps.heading', v)} />
        <TextArea label="Body" value={template.how_doc_helps.body} onChange={v => update('how_doc_helps.body', v)} rows={6} />
      </Accordion>

      <Accordion title="Your Special Package" sectionKey="special_package" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.special_package.heading} onChange={v => update('special_package.heading', v)} />
      </Accordion>

      <Accordion title="What's Inside" sectionKey="whats_inside" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.whats_inside.heading} onChange={v => update('whats_inside.heading', v)} />
        {template.whats_inside.items.map((item, i) => (
          <div key={i} style={subGroupStyle}>
            <p style={subLabel}>Card {item.number}</p>
            <Field label="Title" value={item.title} onChange={v => update(`whats_inside.items.${i}.title`, v)} />
            <Field label="Description" value={item.description} onChange={v => update(`whats_inside.items.${i}.description`, v)} />
          </div>
        ))}
      </Accordion>

      <Accordion title="How We Want To Help You" sectionKey="how_we_help" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.how_we_help.heading} onChange={v => update('how_we_help.heading', v)} />
        <TextArea label="Body (use {{first_name}})" value={template.how_we_help.body} onChange={v => update('how_we_help.body', v)} rows={5} />
      </Accordion>

      <Accordion title="Here's How It Works" sectionKey="how_it_works" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.how_it_works.heading} onChange={v => update('how_it_works.heading', v)} />
        <TextArea label="Body" value={template.how_it_works.body} onChange={v => update('how_it_works.body', v)} rows={8} />
        <Field label="Callout text" value={template.how_it_works.callout} onChange={v => update('how_it_works.callout', v)} />
      </Accordion>

      <Accordion title="Team" sectionKey="team" open={openSections} toggle={toggle}>
        <Field label="Section heading" value={template.team.heading} onChange={v => update('team.heading', v)} />
        <Field label="Subtitle" value={template.team.subtitle} onChange={v => update('team.subtitle', v)} />
        <Field label="Sub-subtitle" value={template.team.subtitle_sub} onChange={v => update('team.subtitle_sub', v)} />
        {template.team.founders.map((f, i) => (
          <div key={i} style={subGroupStyle}>
            <p style={subLabel}>Founder {i + 1}</p>
            <Field label="Name" value={f.name} onChange={v => update(`team.founders.${i}.name`, v)} />
            <Field label="Role" value={f.role} onChange={v => update(`team.founders.${i}.role`, v)} />
            <TextArea label="Description" value={f.description} onChange={v => update(`team.founders.${i}.description`, v)} rows={4} />
          </div>
        ))}
        {template.team.operations.map((op, i) => (
          <div key={i} style={subGroupStyle}>
            <p style={subLabel}>Team card {i + 1}</p>
            <Field label="Count" value={op.count} onChange={v => update(`team.operations.${i}.count`, v)} />
            <Field label="Role" value={op.role} onChange={v => update(`team.operations.${i}.role`, v)} />
            <Field label="Description" value={op.description} onChange={v => update(`team.operations.${i}.description`, v)} />
          </div>
        ))}
      </Accordion>

      <Accordion title="Mission" sectionKey="mission" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.mission.heading} onChange={v => update('mission.heading', v)} />
        {template.mission.bullets.map((b, i) => (
          <Field key={i} label={`Bullet ${i + 1}`} value={b} onChange={v => update(`mission.bullets.${i}`, v)} />
        ))}
        <TextArea label="Body" value={template.mission.body} onChange={v => update('mission.body', v)} rows={3} />
      </Accordion>

      <Accordion title="Tyson Case Study" sectionKey="tyson" open={openSections} toggle={toggle}>
        <Field label="Section heading" value={template.tyson.section_heading} onChange={v => update('tyson.section_heading', v)} />
        <Field label="Name" value={template.tyson.name} onChange={v => update('tyson.name', v)} />
        <Field label="Who heading" value={template.tyson.heading} onChange={v => update('tyson.heading', v)} />
        {template.tyson.who_cards.map((card, i) => (
          <div key={i} style={subGroupStyle}>
            <Field label={`Who card ${i+1} title`} value={card.title} onChange={v => update(`tyson.who_cards.${i}.title`, v)} />
            <Field label="Description" value={card.description} onChange={v => update(`tyson.who_cards.${i}.description`, v)} />
          </div>
        ))}
        <Field label="Situation heading" value={template.tyson.situation_heading} onChange={v => update('tyson.situation_heading', v)} />
        {template.tyson.situation_cards.map((text, i) => (
          <Field key={i} label={`Situation card ${i+1}`} value={text} onChange={v => update(`tyson.situation_cards.${i}`, v)} />
        ))}
        <Field label="Responsibilities heading" value={template.tyson.responsibilities_heading} onChange={v => update('tyson.responsibilities_heading', v)} />
        {template.tyson.responsibilities_cards.map((text, i) => (
          <Field key={i} label={`Responsibility ${i+1}`} value={text} onChange={v => update(`tyson.responsibilities_cards.${i}`, v)} />
        ))}
        <TextArea label="Responsibilities callout" value={template.tyson.responsibilities_callout} onChange={v => update('tyson.responsibilities_callout', v)} rows={2} />
      </Accordion>

      <StepsAccordion
        title="Promotion Steps"
        sectionKey="promotion"
        open={openSections}
        toggle={toggle}
        data={template.promotion}
        basePath="promotion"
        update={update}
      />

      <StepsAccordion
        title="Booking Steps"
        sectionKey="booking"
        open={openSections}
        toggle={toggle}
        data={template.booking}
        basePath="booking"
        update={update}
      />

      <StepsAccordion
        title="Cash Collection Steps"
        sectionKey="cash"
        open={openSections}
        toggle={toggle}
        data={template.cash}
        basePath="cash"
        update={update}
      />

      <StepsAccordion
        title="Coaching Steps"
        sectionKey="coaching"
        open={openSections}
        toggle={toggle}
        data={template.coaching}
        basePath="coaching"
        update={update}
      />

      <Accordion title="Results" sectionKey="results" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.results.heading} onChange={v => update('results.heading', v)} />
        <TextArea label="Body" value={template.results.body} onChange={v => update('results.body', v)} rows={6} />
        <TextArea label="Callout" value={template.results.callout} onChange={v => update('results.callout', v)} rows={3} />
      </Accordion>

      <Accordion title="Special Offer" sectionKey="offer" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.offer.heading} onChange={v => update('offer.heading', v)} />
        {template.offer.columns.map((col, i) => (
          <div key={i} style={subGroupStyle}>
            <Field label={`Column ${i+1} title`} value={col.title} onChange={v => update(`offer.columns.${i}.title`, v)} />
            {col.items.map((item, j) => (
              <Field key={j} label={`Item ${j+1}`} value={item} onChange={v => update(`offer.columns.${i}.items.${j}`, v)} />
            ))}
          </div>
        ))}
        <p style={subLabel}>You Just...</p>
        {template.offer.you_just.map((item, i) => (
          <Field key={i} label={`Item ${i+1}`} value={item} onChange={v => update(`offer.you_just.${i}`, v)} />
        ))}
      </Accordion>

      <Accordion title="Next Steps" sectionKey="next_steps" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.next_steps.heading} onChange={v => update('next_steps.heading', v)} />
        {template.next_steps.steps.map((step, i) => (
          <div key={i} style={subGroupStyle}>
            <Field label={`Step ${step.number} title`} value={step.title} onChange={v => update(`next_steps.steps.${i}.title`, v)} />
            <TextArea label="Description" value={step.description} onChange={v => update(`next_steps.steps.${i}.description`, v)} rows={2} />
          </div>
        ))}
      </Accordion>

      <Accordion title="CTA / Calendly" sectionKey="cta" open={openSections} toggle={toggle}>
        <Field label="Option 1 text" value={template.cta.option1_text} onChange={v => update('cta.option1_text', v)} />
        <Field label="Option 2 text" value={template.cta.option2_text} onChange={v => update('cta.option2_text', v)} />
        <Field label="Calendly / Booking URL" value={template.cta.calendly_url} onChange={v => update('cta.calendly_url', v)} />
      </Accordion>

      <Accordion title="FAQ Videos" sectionKey="faq_videos" open={openSections} toggle={toggle}>
        {template.faqs.videos.map((video, i) => (
          <div key={i} style={subGroupStyle}>
            <Field label={`Video ${i+1} title`} value={video.title} onChange={v => update(`faqs.videos.${i}.title`, v)} />
            <Field label="Video URL (Bunny embed)" value={video.video_url} onChange={v => update(`faqs.videos.${i}.video_url`, v)} />
          </div>
        ))}
      </Accordion>

      <Accordion title="FAQ Text" sectionKey="faq_text" open={openSections} toggle={toggle}>
        {template.faqs.text.map((faq, i) => (
          <div key={i} style={subGroupStyle}>
            <Field label={`Q${i+1}`} value={faq.question} onChange={v => update(`faqs.text.${i}.question`, v)} />
            <TextArea label="Answer" value={faq.answer} onChange={v => update(`faqs.text.${i}.answer`, v)} rows={3} />
          </div>
        ))}
      </Accordion>

      <Accordion title="About Us" sectionKey="about" open={openSections} toggle={toggle}>
        <Field label="Heading" value={template.about.heading} onChange={v => update('about.heading', v)} />
        <TextArea label="Body" value={template.about.body} onChange={v => update('about.body', v)} rows={5} />
        {template.about.founders.map((f, i) => (
          <div key={i} style={subGroupStyle}>
            <Field label={`Founder ${i+1} name`} value={f.name} onChange={v => update(`about.founders.${i}.name`, v)} />
            <Field label="Role" value={f.role} onChange={v => update(`about.founders.${i}.role`, v)} />
            {f.focus.map((item, j) => (
              <Field key={j} label={`Focus ${j+1}`} value={item} onChange={v => update(`about.founders.${i}.focus.${j}`, v)} />
            ))}
          </div>
        ))}
        <TextArea label="Closing line" value={template.about.closing} onChange={v => update('about.closing', v)} rows={2} />
      </Accordion>

      {/* ── SAVE BUTTONS ── */}
      <div style={{ display: 'flex', gap: 16, marginTop: '2rem', flexWrap: 'wrap' }}>
        <button onClick={saveNewOnly} disabled={saving} style={{ ...btnStyle, background: 'var(--accent)', color: '#000' }}>
          {saving ? 'Saving...' : 'Save for New Leads Only'}
        </button>
        <button onClick={() => setShowConfirm(true)} disabled={saving} style={{ ...btnStyle, background: 'var(--danger)', color: '#fff' }}>
          Save & Update All Existing Pages
        </button>
      </div>

      {/* ── CONFIRMATION MODAL ── */}
      {showConfirm && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Confirm Update All</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
              This will overwrite the content on <strong>every existing lead page</strong> with the current template.
              This cannot be undone. Proceed?
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowConfirm(false)} style={{ ...btnStyle, background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                Cancel
              </button>
              <button onClick={saveAndUpdateAll} style={{ ...btnStyle, background: 'var(--danger)', color: '#fff' }}>
                Yes, Update All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Sub-components ═══ */

function Accordion({ title, sectionKey, open, toggle, children }: {
  title: string;
  sectionKey: string;
  open: Set<string>;
  toggle: (k: string) => void;
  children: React.ReactNode;
}) {
  const isOpen = open.has(sectionKey);
  return (
    <div style={accordionStyle}>
      <button onClick={() => toggle(sectionKey)} style={accordionHeaderStyle}>
        <span>{title}</span>
        <span style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>
      {isOpen && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  );
}

function StepsAccordion({ title, sectionKey, open, toggle, data, basePath, update }: {
  title: string;
  sectionKey: string;
  open: Set<string>;
  toggle: (k: string) => void;
  data: { section_heading: string; heading: string; toc: string[]; steps: { heading: string; body: string; callout?: string }[] };
  basePath: string;
  update: (path: string, value: unknown) => void;
}) {
  return (
    <Accordion title={title} sectionKey={sectionKey} open={open} toggle={toggle}>
      <Field label="Section heading" value={data.section_heading} onChange={v => update(`${basePath}.section_heading`, v)} />
      <Field label="Heading" value={data.heading} onChange={v => update(`${basePath}.heading`, v)} />
      {data.steps.map((step, i) => (
        <div key={i} style={subGroupStyle}>
          <p style={subLabel}>Step {i + 1}</p>
          <Field label="Heading" value={step.heading} onChange={v => update(`${basePath}.steps.${i}.heading`, v)} />
          <TextArea label="Body" value={step.body} onChange={v => update(`${basePath}.steps.${i}.body`, v)} rows={5} />
          {step.callout !== undefined && (
            <Field label="Callout" value={step.callout || ''} onChange={v => update(`${basePath}.steps.${i}.callout`, v)} />
          )}
        </div>
      ))}
    </Accordion>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabelStyle}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabelStyle}>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
    </div>
  );
}

/* ═══ Styles ═══ */

const pageStyle: React.CSSProperties = {
  padding: '2rem',
  maxWidth: 900,
  margin: '0 auto',
};

const h1Style: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 600,
  marginBottom: '0.25rem',
  color: 'var(--text-primary)',
};

const msgStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 10,
  border: '1px solid',
  fontSize: '0.85rem',
  marginBottom: '1.5rem',
};

const accordionStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--border-primary)',
  backgroundColor: 'var(--bg-card)',
  marginBottom: 12,
  overflow: 'hidden',
};

const accordionHeaderStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 16px',
  background: 'none',
  border: 'none',
  color: 'var(--text-primary)',
  fontWeight: 600,
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-primary)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
};

const subGroupStyle: React.CSSProperties = {
  padding: '12px',
  borderRadius: 8,
  border: '1px solid var(--border-primary)',
  marginBottom: 12,
};

const subLabel: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--accent)',
  marginBottom: 8,
};

const btnStyle: React.CSSProperties = {
  padding: '12px 24px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50000,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 16,
  padding: '28px',
  maxWidth: 440,
  width: '90%',
};
