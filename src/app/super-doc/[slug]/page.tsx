import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { getLeadBySlug } from '@/lib/super-doc-db';
import { capitalizeNamePart, formatFullName } from '@/lib/super-doc-name';
import type { SuperDocDesign, SuperDocElementStyle, SuperDocTemplateContent } from '@/lib/super-doc-types';
import ViewTracker from './ViewTracker';
import FAQAccordion from './FAQAccordion';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const lead = await getLeadBySlug(slug);
  if (!lead) return { title: 'Not Found' };
  const fullName = formatFullName(lead.first_name, lead.last_name);
  return {
    title: `${fullName} — Super Doc`,
    description: `Personalized partnership proposal for ${fullName}`,
  };
}

function t(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

function renderTitle(template: string, serifWord: string, vars: Record<string, string>) {
  const filled = t(template, vars);
  const parts = filled.split(new RegExp(`(${serifWord})`, 'i'));
  return parts.map((part, i) =>
    part.toLowerCase() === serifWord.toLowerCase()
      ? <span key={i} className="sd-serif-word">{part}</span>
      : <span key={i}>{part}</span>
  );
}

function nl(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => (
    <span key={i}>{line}{i < text.split('\n').length - 1 && <br />}</span>
  ));
}

function canEmbedCalendar(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('calendly.com') || lower.includes('calendar.google.com/calendar/embed');
}

function CalendarBlock({ url }: { url: string }) {
  const calendarUrl = url.trim();
  if (!calendarUrl) return null;

  if (canEmbedCalendar(calendarUrl)) {
    return (
      <div className="sd-calendly-wrap">
        <iframe src={calendarUrl} title="Book a call" />
      </div>
    );
  }

  return (
    <div className="sd-calendar-card">
      <a className="sd-calendar-button" href={calendarUrl} target="_blank" rel="noreferrer">
        Book Your Call
      </a>
    </div>
  );
}

function designVars(design?: SuperDocDesign): CSSProperties {
  const flat = design || {};
  const desktop = { ...flat, ...(design?.desktop || {}) };
  const mobile = { ...flat, ...(design?.mobile || {}) };
  return {
    '--sd-desktop-active-font': desktop.fontFamily || 'Inter',
    '--sd-desktop-section-y': `${desktop.sectionPadding ?? 80}px`,
    '--sd-desktop-heading-scale': desktop.headingScale ?? 1,
    '--sd-desktop-body-scale': desktop.bodyScale ?? 1,
    '--sd-desktop-card-radius': `${desktop.cardRadius ?? 22}px`,
    '--sd-desktop-card-shadow': `${desktop.cardShadow ?? 4}px`,
    '--sd-mobile-active-font': mobile.fontFamily || desktop.fontFamily || 'Inter',
    '--sd-mobile-section-y': `${mobile.sectionPadding ?? 48}px`,
    '--sd-mobile-heading-scale': mobile.headingScale ?? 0.92,
    '--sd-mobile-body-scale': mobile.bodyScale ?? 0.95,
    '--sd-mobile-card-radius': `${mobile.cardRadius ?? 16}px`,
    '--sd-mobile-card-shadow': `${mobile.cardShadow ?? 3}px`,
  } as CSSProperties;
}

function cssPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function elementStyleRules(path: string, style?: SuperDocElementStyle): string {
  if (!style) return '';
  const rules = [
    style.fontSize ? `font-size:${style.fontSize}px!important;` : '',
    style.fontWeight ? `font-weight:${style.fontWeight}!important;` : '',
    style.color ? `color:${style.color}!important;` : '',
    style.textAlign ? `text-align:${style.textAlign}!important;` : '',
    typeof style.marginTop === 'number' ? `margin-top:${style.marginTop}px!important;` : '',
    typeof style.marginBottom === 'number' ? `margin-bottom:${style.marginBottom}px!important;` : '',
  ].join('');
  return rules ? `[data-sd-path="${cssPath(path)}"]{${rules}}` : '';
}

function elementStylesCss(design?: SuperDocDesign): string {
  const elementStyles = design?.elementStyles || {};
  const desktopRules: string[] = [];
  const mobileRules: string[] = [];

  Object.entries(elementStyles).forEach(([path, byDevice]) => {
    const desktop = elementStyleRules(path, byDevice.desktop);
    const mobile = elementStyleRules(path, byDevice.mobile);
    if (desktop) desktopRules.push(desktop);
    if (mobile) mobileRules.push(mobile);
  });

  return `${desktopRules.join('\n')}${mobileRules.length ? `\n@media (max-width: 640px){${mobileRules.join('\n')}}` : ''}`;
}

function sdPath(path: string) {
  return { 'data-sd-path': path };
}

function trackingVideoSrc(url: string, slug: string, slot: string) {
  if (!url || url === 'about:blank') return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}sd_track=${encodeURIComponent(`${slug}-${slot}`)}`;
}

export default async function SuperDocPage({ params }: Props) {
  const { slug } = await params;
  const lead = await getLeadBySlug(slug);
  if (!lead) notFound();

  const c = lead.content_snapshot as SuperDocTemplateContent;
  const vars = {
    first_name: capitalizeNamePart(lead.first_name),
    last_name: capitalizeNamePart(lead.last_name),
    video_url: lead.video_url,
  };
  const show = (section: string) => !(c.design?.hiddenSections || []).includes(section);

  return (
    <div className="sd-root" style={designVars(c.design)}>
      <style dangerouslySetInnerHTML={{ __html: elementStylesCss(c.design) }} />
      <ViewTracker slug={slug} />

      {/* ═══ 1. HERO ═══ */}
      <section className="sd-section sd-bg-cream">
        <div className="sd-container sd-text-center">
          <h1 className="sd-h1 sd-mb-32" {...sdPath('hero.title_template')}>
            {renderTitle(c.hero.title_template, c.hero.serif_word, vars)}
          </h1>
          <div className="sd-video-wrap">
            <iframe
              src={trackingVideoSrc(lead.video_url, slug, 'hero')}
              data-super-doc-video="hero"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* ═══ 2. WARNING PANEL ═══ */}
      <section hidden={!show('warning')} className="sd-section sd-bg-coral">
        <div className="sd-container sd-text-center">
          <h2 className="sd-h2 sd-text-white sd-whitespace-pre sd-mb-0" {...sdPath('warning.text')}>
            {nl(t(c.warning.text, vars))}
          </h2>
        </div>
      </section>

      {/* ═══ 3. HOW THIS DOCUMENT CAN HELP YOU ═══ */}
      <section hidden={!show('how_doc_helps')} className="sd-section sd-bg-sage">
        <div className="sd-container">
          <div className="sd-eyebrow">Guide</div>
          <h2 className="sd-h2 sd-mb-24" {...sdPath('how_doc_helps.heading')}>{c.how_doc_helps.heading}</h2>
          <p className="sd-body sd-whitespace-pre" {...sdPath('how_doc_helps.body')}>{nl(t(c.how_doc_helps.body, vars))}</p>
        </div>
      </section>

      {/* ═══ 4. YOUR SPECIAL PACKAGE (divider) ═══ */}
      <section hidden={!show('special_package')} className="sd-section sd-divider sd-bg-cream">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow" style={{ justifyContent: 'center' }}>Package</div>
          <h2 className="sd-h2" {...sdPath('special_package.heading')}>{c.special_package.heading}</h2>
        </div>
      </section>

      {/* ═══ 5. WHAT'S INSIDE ═══ */}
      <section hidden={!show('whats_inside')} className="sd-section sd-bg-paper">
        <div className="sd-container">
          <h2 className="sd-h2 sd-text-center sd-mb-48" {...sdPath('whats_inside.heading')}>{c.whats_inside.heading}</h2>
          <div className="sd-grid-3">
            {c.whats_inside.items.map((item, i) => (
              <div key={i} className="sd-card sd-text-center">
                <div className="sd-num-badge" style={{ margin: '0 auto 16px' }} {...sdPath(`whats_inside.items.${i}.number`)}>{item.number}</div>
                <h3 className="sd-h4 sd-mb-8" {...sdPath(`whats_inside.items.${i}.title`)}>{item.title}</h3>
                <p className="sd-body sd-body-center sd-text-mute" {...sdPath(`whats_inside.items.${i}.description`)}>{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 6. HOW WE WANT TO HELP YOU ═══ */}
      <section hidden={!show('how_we_help')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <div className="sd-eyebrow">Our Mission</div>
          <h2 className="sd-h2 sd-mb-24" {...sdPath('how_we_help.heading')}>{c.how_we_help.heading}</h2>
          <p className="sd-body sd-whitespace-pre" {...sdPath('how_we_help.body')}>{nl(t(c.how_we_help.body, vars))}</p>
        </div>
      </section>

      {/* ═══ 7. HERE'S HOW IT WORKS ═══ */}
      <section hidden={!show('how_it_works')} className="sd-section sd-bg-paper sd-divider">
        <div className="sd-container">
          <div className="sd-eyebrow">The Model</div>
          <h2 className="sd-h2 sd-mb-24" {...sdPath('how_it_works.heading')}>{c.how_it_works.heading}</h2>
          <p className="sd-body sd-whitespace-pre sd-mb-32" {...sdPath('how_it_works.body')}>{nl(c.how_it_works.body)}</p>
          <div className="sd-callout sd-callout-coral">
            <h3 className="sd-h2 sd-text-white sd-mb-0" {...sdPath('how_it_works.callout')}>{c.how_it_works.callout}</h3>
          </div>
        </div>
      </section>

      {/* ═══ 8–9. MEET OUR TEAM ═══ */}
      <section hidden={!show('team')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">Our Team</div>
          <h2 className="sd-h2 sd-mb-12" {...sdPath('team.heading')}>{c.team.heading}</h2>
          <p className="sd-h3 sd-mb-8" style={{ color: 'rgba(255,255,255,0.9)' }} {...sdPath('team.subtitle')}>{c.team.subtitle}</p>
          <p className="sd-body sd-body-center" style={{ color: 'rgba(255,255,255,0.7)' }} {...sdPath('team.subtitle_sub')}>{c.team.subtitle_sub}</p>
        </div>
      </section>

      {/* ═══ 10. FOUNDERS ═══ */}
      <section hidden={!show('team')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <div className="sd-eyebrow">Founders</div>
          <div className="sd-grid-2 sd-mt-24">
            {c.team.founders.map((f, i) => (
              <div key={i} className="sd-card">
                <div className="sd-photo sd-mb-16">👤</div>
                <h3 className="sd-h3 sd-mb-8" {...sdPath(`team.founders.${i}.name`)}>{f.name}</h3>
                <p className="sd-text-coral sd-font-bold sd-mb-16" style={{ fontSize: '0.85rem' }} {...sdPath(`team.founders.${i}.role`)}>{f.role}</p>
                <p className="sd-body" {...sdPath(`team.founders.${i}.description`)}>{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 11. OUR COMPLETE FITNESS OPERATION ═══ */}
      <section hidden={!show('team')} className="sd-section sd-bg-paper">
        <div className="sd-container">
          <div className="sd-eyebrow">Operations</div>
          <h2 className="sd-h2 sd-text-center sd-mb-48">Our Complete Fitness Operation</h2>
          <div className="sd-grid-6">
            {c.team.operations.map((op, i) => (
              <div key={i} className="sd-card sd-text-center">
                <div className="sd-h1 sd-text-coral sd-mb-8" {...sdPath(`team.operations.${i}.count`)}>{op.count}</div>
                <h4 className="sd-h4 sd-mb-8" {...sdPath(`team.operations.${i}.role`)}>{op.role}</h4>
                <p className="sd-text-mute" style={{ fontSize: '0.85rem' }} {...sdPath(`team.operations.${i}.description`)}>{op.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 12. EVERYTHING WE DO FOR YOU IS TO ═══ */}
      <section hidden={!show('mission')} className="sd-section sd-bg-cream">
        <div className="sd-container sd-text-center">
          <h2 className="sd-h2 sd-mb-24" {...sdPath('mission.heading')}>{c.mission.heading}</h2>
          <div className="sd-mb-24">
            {c.mission.bullets.map((b, i) => (
              <p key={i} className="sd-h3 sd-text-coral sd-mb-8" {...sdPath(`mission.bullets.${i}`)}>• {b}</p>
            ))}
          </div>
          <p className="sd-body sd-body-center sd-whitespace-pre" {...sdPath('mission.body')}>{nl(c.mission.body)}</p>
        </div>
      </section>

      {/* ═══ 13. TYSON STORY — section divider ═══ */}
      <section hidden={!show('tyson')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">Case Study</div>
          <h2 className="sd-h2" {...sdPath('tyson.section_heading')}>{c.tyson.section_heading}</h2>
        </div>
      </section>

      {/* ═══ 14. TYSON INTRO ═══ */}
      <section hidden={!show('tyson')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 32, flexWrap: 'wrap' }}>
            <div className="sd-photo sd-photo-lg">👤</div>
            <div>
              <h2 className="sd-h2 sd-mb-8" {...sdPath('tyson.name')}>{c.tyson.name}</h2>
              <p className="sd-text-mute" {...sdPath('tyson.heading')}>{c.tyson.heading}</p>
            </div>
          </div>
          <div className="sd-grid-3">
            {c.tyson.who_cards.map((card, i) => (
              <div key={i} className="sd-card">
                <h4 className="sd-h4 sd-mb-8" {...sdPath(`tyson.who_cards.${i}.title`)}>{card.title}</h4>
                <p className="sd-body sd-text-mute" {...sdPath(`tyson.who_cards.${i}.description`)}>{card.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 15. TYSON'S SITUATION ═══ */}
      <section hidden={!show('tyson')} className="sd-section sd-bg-peach">
        <div className="sd-container">
          <div className="sd-eyebrow">The Challenge</div>
          <h2 className="sd-h2 sd-mb-32" {...sdPath('tyson.situation_heading')}>{c.tyson.situation_heading}</h2>
          <div className="sd-grid-3">
            {c.tyson.situation_cards.map((text, i) => (
              <div key={i} className="sd-card">
                <p className="sd-body sd-font-bold" {...sdPath(`tyson.situation_cards.${i}`)}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 16. TYSON'S RESPONSIBILITIES ═══ */}
      <section hidden={!show('tyson')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <h2 className="sd-h2 sd-mb-32" {...sdPath('tyson.responsibilities_heading')}>{c.tyson.responsibilities_heading}</h2>
          <div className="sd-grid-3 sd-mb-32">
            {c.tyson.responsibilities_cards.map((text, i) => (
              <div key={i} className="sd-card">
                <p className="sd-body sd-font-bold" {...sdPath(`tyson.responsibilities_cards.${i}`)}>{text}</p>
              </div>
            ))}
          </div>
          <div className="sd-callout sd-callout-sage">
            <p className="sd-h3" {...sdPath('tyson.responsibilities_callout')}>{c.tyson.responsibilities_callout}</p>
          </div>
        </div>
      </section>

      {/* ═══ 17. HOW DID WE HELP HIM? ═══ */}
      <section hidden={!show('tyson')} className="sd-section sd-bg-paper sd-divider">
        <div className="sd-container">
          <div className="sd-eyebrow">The Process</div>
          <h2 className="sd-h2 sd-text-center sd-mb-48" {...sdPath('tyson.how_helped_heading')}>{c.tyson.how_helped_heading}</h2>
          <div className="sd-step-flow">
            {c.tyson.how_helped_steps.map((step, i) => (
              <div key={i} style={{ display: 'contents' }}>
                {i > 0 && <div className="sd-step-arrow">→</div>}
                <div className="sd-card sd-text-center">
                  <div className="sd-num-badge" style={{ margin: '0 auto 16px' }} {...sdPath(`tyson.how_helped_steps.${i}.number`)}>{step.number}</div>
                  <h4 className="sd-h4 sd-mb-8" {...sdPath(`tyson.how_helped_steps.${i}.title`)}>{step.title}</h4>
                  <p className="sd-text-mute" style={{ fontSize: '0.9rem' }} {...sdPath(`tyson.how_helped_steps.${i}.description`)}>{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 18. HERE'S EXACTLY HOW (divider) ═══ */}
      <section hidden={!show('promotion')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">Deep Dive</div>
          <h2 className="sd-h2" {...sdPath('promotion.section_heading')}>{c.promotion.section_heading}</h2>
        </div>
      </section>

      {/* ═══ 19. HOW WE PROMOTED — TOC ═══ */}
      <section hidden={!show('promotion')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <div className="sd-eyebrow">Promotion</div>
          <h2 className="sd-h2 sd-mb-24" {...sdPath('promotion.heading')}>{c.promotion.heading}</h2>
          <ul className="sd-toc">
            {c.promotion.toc.map((item, i) => (
              <li key={i} {...sdPath(`promotion.toc.${i}`)}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ═══ 20–23. PROMOTION STEPS ═══ */}
      {c.promotion.steps.map((step, i) => (
        <section hidden={!show('promotion')} key={`promo-${i}`} className={`sd-section ${i % 2 === 0 ? 'sd-bg-paper' : 'sd-bg-cream'} sd-divider`}>
          <div className="sd-container">
            <div className="sd-eyebrow">Step {i + 1}</div>
            <h2 className="sd-h3 sd-mb-24" {...sdPath(`promotion.steps.${i}.heading`)}>{step.heading}</h2>
            <p className="sd-body sd-whitespace-pre" {...sdPath(`promotion.steps.${i}.body`)}>{nl(step.body)}</p>
            {step.callout && (
              <div className="sd-callout sd-callout-coral sd-mt-32">
                <h3 className="sd-h2 sd-text-white sd-mb-0" {...sdPath(`promotion.steps.${i}.callout`)}>{step.callout}</h3>
              </div>
            )}
          </div>
        </section>
      ))}

      {/* ═══ 24. HOW WE BOOKED SALES CALLS (divider) ═══ */}
      <section hidden={!show('booking')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">Sales</div>
          <h2 className="sd-h2" {...sdPath('booking.section_heading')}>{c.booking.section_heading}</h2>
        </div>
      </section>

      {/* ═══ 25. BOOKING TOC ═══ */}
      <section hidden={!show('booking')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <ul className="sd-toc">
            {c.booking.toc.map((item, i) => (
              <li key={i} {...sdPath(`booking.toc.${i}`)}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ═══ 26. BOOKING STEPS ═══ */}
      {c.booking.steps.map((step, i) => (
        <section hidden={!show('booking')} key={`book-${i}`} className={`sd-section ${i % 2 === 0 ? 'sd-bg-paper' : 'sd-bg-cream'} sd-divider`}>
          <div className="sd-container">
            <h3 className="sd-h3 sd-mb-24" {...sdPath(`booking.steps.${i}.heading`)}>{step.heading}</h3>
            <p className="sd-body sd-whitespace-pre" {...sdPath(`booking.steps.${i}.body`)}>{nl(step.body)}</p>
          </div>
        </section>
      ))}

      {/* ═══ 27. HOW WE COLLECTED CASH (divider) ═══ */}
      <section hidden={!show('cash')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">Revenue</div>
          <h2 className="sd-h2" {...sdPath('cash.section_heading')}>{c.cash.section_heading}</h2>
        </div>
      </section>

      {/* ═══ 28. CASH TOC ═══ */}
      <section hidden={!show('cash')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <ul className="sd-toc">
            {c.cash.toc.map((item, i) => (
              <li key={i} {...sdPath(`cash.toc.${i}`)}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ═══ 29. CASH STEPS ═══ */}
      {c.cash.steps.map((step, i) => (
        <section hidden={!show('cash')} key={`cash-${i}`} className={`sd-section ${i % 2 === 0 ? 'sd-bg-paper' : 'sd-bg-cream'} sd-divider`}>
          <div className="sd-container">
            <h3 className="sd-h3 sd-mb-24" {...sdPath(`cash.steps.${i}.heading`)}>{step.heading}</h3>
            <p className="sd-body sd-whitespace-pre" {...sdPath(`cash.steps.${i}.body`)}>{nl(step.body)}</p>
          </div>
        </section>
      ))}

      {/* ═══ 30. HOW WE COACHED (divider) ═══ */}
      <section hidden={!show('coaching')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">Coaching</div>
          <h2 className="sd-h2" {...sdPath('coaching.section_heading')}>{c.coaching.section_heading}</h2>
        </div>
      </section>

      {/* ═══ 31. COACHING TOC ═══ */}
      <section hidden={!show('coaching')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <ul className="sd-toc">
            {c.coaching.toc.map((item, i) => (
              <li key={i} {...sdPath(`coaching.toc.${i}`)}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ═══ 32. COACHING STEPS ═══ */}
      {c.coaching.steps.map((step, i) => (
        <section hidden={!show('coaching')} key={`coach-${i}`} className={`sd-section ${i % 2 === 0 ? 'sd-bg-paper' : 'sd-bg-cream'} sd-divider`}>
          <div className="sd-container">
            <h3 className="sd-h3 sd-mb-24" {...sdPath(`coaching.steps.${i}.heading`)}>{step.heading}</h3>
            <p className="sd-body sd-whitespace-pre" {...sdPath(`coaching.steps.${i}.body`)}>{nl(step.body)}</p>
          </div>
        </section>
      ))}

      {/* ═══ 33–34. RESULTS ═══ */}
      <section hidden={!show('results')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">Results</div>
          <h2 className="sd-h2" {...sdPath('results.heading')}>{c.results.heading}</h2>
        </div>
      </section>
      <section hidden={!show('results')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <p className="sd-body sd-whitespace-pre sd-mb-32" {...sdPath('results.body')}>{nl(c.results.body)}</p>
          <div className="sd-callout sd-callout-sage">
            <p className="sd-h3" {...sdPath('results.callout')}>{c.results.callout}</p>
          </div>
        </div>
      </section>

      {/* ═══ 35–36. SPECIAL OFFER ═══ */}
      <section hidden={!show('offer')} className="sd-section sd-bg-coral sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow" style={{ justifyContent: 'center', color: '#fff' }}>
            <span style={{ color: '#fff' }}>Special Offer</span>
          </div>
          <h2 className="sd-h2 sd-text-white" {...sdPath('offer.heading')}>{c.offer.heading}</h2>
        </div>
      </section>
      <section hidden={!show('offer')} className="sd-section sd-bg-paper">
        <div className="sd-container">
          <div className="sd-offer-grid">
            {c.offer.columns.map((col, i) => (
              <div key={i} className="sd-offer-col">
                <div className="sd-card" style={{ height: '100%' }}>
                  <h3 className="sd-h4 sd-text-coral sd-mb-16" {...sdPath(`offer.columns.${i}.title`)}>{col.title}</h3>
                  {col.items.map((item, j) => (
                    <div key={j} className="sd-offer-item" {...sdPath(`offer.columns.${i}.items.${j}`)}>
                      <span className="sd-offer-check">✓</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="sd-card sd-mt-32">
            <h3 className="sd-h4 sd-mb-16">You Just…</h3>
            {c.offer.you_just.map((item, i) => (
              <div key={i} className="sd-offer-item" {...sdPath(`offer.you_just.${i}`)}>
                <span className="sd-offer-check">→</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 37. NEXT STEPS ═══ */}
      <section hidden={!show('next_steps')} className="sd-section sd-bg-cream sd-divider">
        <div className="sd-container">
          <div className="sd-eyebrow">Next Steps</div>
          <h2 className="sd-h2 sd-text-center sd-mb-48" {...sdPath('next_steps.heading')}>{c.next_steps.heading}</h2>
          <div className="sd-grid-3">
            {c.next_steps.steps.map((step, i) => (
              <div key={i} className="sd-card sd-text-center">
                <div className="sd-num-badge" style={{ margin: '0 auto 16px' }} {...sdPath(`next_steps.steps.${i}.number`)}>{step.number}</div>
                <h4 className="sd-h4 sd-mb-8" {...sdPath(`next_steps.steps.${i}.title`)}>{step.title}</h4>
                <p className="sd-body sd-body-center sd-text-mute" {...sdPath(`next_steps.steps.${i}.description`)}>{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 38. 2 OPTIONS CTA ═══ */}
      <section hidden={!show('cta')} className="sd-section sd-bg-paper sd-divider">
        <div className="sd-container">
          <h2 className="sd-h2 sd-text-center sd-mb-48">2 Options To See If This Is For You!</h2>
          <div className="sd-cta-grid">
            <div className="sd-cta-option">
              <div className="sd-cta-icon">💬</div>
              <h3 className="sd-h4" {...sdPath('cta.option1_text')}>{c.cta.option1_text}</h3>
            </div>
            <div className="sd-cta-option">
              <div className="sd-cta-icon">📅</div>
              <h3 className="sd-h4" {...sdPath('cta.option2_text')}>{c.cta.option2_text}</h3>
            </div>
          </div>
          <CalendarBlock url={c.cta.calendly_url} />
        </div>
      </section>

      {/* ═══ 39–40. FAQ VIDEOS ═══ */}
      <section hidden={!show('faqs')} className="sd-section sd-bg-forest sd-divider">
        <div className="sd-container sd-text-center">
          <div className="sd-eyebrow">FAQs</div>
          <h2 className="sd-h2">Frequently Asked Questions</h2>
        </div>
      </section>
      <section hidden={!show('faqs')} className="sd-section sd-bg-cream">
        <div className="sd-container">
          <h3 className="sd-h3 sd-text-center sd-mb-32">FAQ Videos</h3>
          <div className="sd-video-grid">
            {c.faqs.videos.map((video, i) => (
              <div key={i} className="sd-video-card">
                {video.video_url ? (
                  <div style={{ position: 'relative', paddingBottom: '56.25%' }}>
                    <iframe
                      src={video.video_url}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <div className="sd-video-placeholder">Video coming soon</div>
                )}
                <div className="sd-video-card-title" {...sdPath(`faqs.videos.${i}.title`)}>{video.title}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 41. FAQ TEXT ═══ */}
      <section hidden={!show('faqs')} className="sd-section sd-bg-paper sd-divider">
        <div className="sd-container">
          <h3 className="sd-h3 sd-mb-32">Common Questions</h3>
          <FAQAccordion items={c.faqs.text} basePath="faqs.text" />
        </div>
      </section>

      {/* ═══ 42. ABOUT US ═══ */}
      <section hidden={!show('about')} className="sd-section sd-bg-cream sd-divider">
        <div className="sd-container">
          <div className="sd-eyebrow">About</div>
          <h2 className="sd-h2 sd-mb-24" {...sdPath('about.heading')}>{c.about.heading}</h2>
          <p className="sd-body sd-whitespace-pre sd-mb-32" {...sdPath('about.body')}>{nl(c.about.body)}</p>
          <div className="sd-grid-2 sd-mb-32">
            {c.about.founders.map((f, i) => (
              <div key={i} className="sd-card">
                <div className="sd-photo sd-mb-16">👤</div>
                <h3 className="sd-h4 sd-mb-8" {...sdPath(`about.founders.${i}.name`)}>{f.name}</h3>
                <p className="sd-text-coral sd-mb-16" style={{ fontSize: '0.85rem', fontWeight: 600 }} {...sdPath(`about.founders.${i}.role`)}>{f.role}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {f.focus.map((item, j) => (
                    <li key={j} className="sd-offer-item" {...sdPath(`about.founders.${i}.focus.${j}`)}>
                      <span className="sd-offer-check">→</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="sd-callout sd-callout-peach">
            <p className="sd-h3" {...sdPath('about.closing')}>{c.about.closing}</p>
          </div>
        </div>
      </section>

      {/* ═══ 43. FINAL CTA ═══ */}
      <section hidden={!show('cta')} className="sd-section sd-bg-paper sd-divider">
        <div className="sd-container">
          <h2 className="sd-h2 sd-text-center sd-mb-48">2 Options</h2>
          <div className="sd-cta-grid">
            <div className="sd-cta-option">
              <div className="sd-cta-icon">✉️</div>
              <h3 className="sd-h4" {...sdPath('cta.option1_text')}>{c.cta.option1_text}</h3>
            </div>
            <div className="sd-cta-option">
              <div className="sd-cta-icon">📅</div>
              <h3 className="sd-h4" {...sdPath('cta.option2_text')}>{c.cta.option2_text}</h3>
            </div>
          </div>
          <CalendarBlock url={c.cta.calendly_url} />
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="sd-section sd-bg-forest" style={{ padding: '40px 0' }}>
        <div className="sd-container sd-text-center">
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>
            © {new Date().getFullYear()} Client Conversion. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
