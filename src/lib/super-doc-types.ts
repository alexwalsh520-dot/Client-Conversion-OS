export type SuperDocDevice = 'desktop' | 'mobile';
export type SuperDocTemplateVariant = 'creator' | 'agency';

export interface SuperDocElementStyle {
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
  marginTop?: number;
  marginBottom?: number;
}

export interface SuperDocBreakpointDesign {
  fontFamily?: string;
  sectionPadding?: number;
  headingScale?: number;
  bodyScale?: number;
  cardRadius?: number;
  cardShadow?: number;
}

export interface SuperDocDesign extends SuperDocBreakpointDesign {
  desktop?: SuperDocBreakpointDesign;
  mobile?: SuperDocBreakpointDesign;
  elementStyles?: Record<string, Partial<Record<SuperDocDevice, SuperDocElementStyle>>>;
  hiddenSections?: string[];
}

export interface SuperDocTemplateContent {
  design?: SuperDocDesign;
  variant_templates?: Partial<Record<Exclude<SuperDocTemplateVariant, 'creator'>, SuperDocTemplateContent>>;
  hero: {
    title_template: string;
    serif_word: string;
  };
  warning: { text: string };
  how_doc_helps: { heading: string; body: string };
  special_package: { heading: string };
  whats_inside: {
    heading: string;
    items: { number: number; title: string; description: string }[];
  };
  how_we_help: { heading: string; body: string };
  how_it_works: { heading: string; body: string; callout: string };
  team: {
    heading: string;
    subtitle: string;
    subtitle_sub: string;
    founders: {
      name: string;
      role: string;
      description: string;
    }[];
    operations: {
      count: string;
      role: string;
      description: string;
    }[];
  };
  mission: { heading: string; bullets: string[]; body: string };
  tyson: {
    section_heading: string;
    name: string;
    heading: string;
    who_cards: { title: string; description: string }[];
    situation_heading: string;
    situation_cards: string[];
    responsibilities_heading: string;
    responsibilities_cards: string[];
    responsibilities_callout: string;
    how_helped_heading: string;
    how_helped_steps: { number: number; title: string; description: string }[];
  };
  promotion: {
    section_heading: string;
    heading: string;
    toc: string[];
    steps: { heading: string; body: string; callout?: string }[];
  };
  booking: {
    section_heading: string;
    heading: string;
    toc: string[];
    steps: { heading: string; body: string }[];
  };
  cash: {
    section_heading: string;
    heading: string;
    toc: string[];
    steps: { heading: string; body: string }[];
  };
  coaching: {
    section_heading: string;
    heading: string;
    toc: string[];
    steps: { heading: string; body: string }[];
  };
  results: { heading: string; body: string; callout: string };
  offer: {
    heading: string;
    columns: { title: string; items: string[] }[];
    you_just: string[];
  };
  next_steps: {
    heading: string;
    steps: { number: number; title: string; description: string }[];
  };
  cta: {
    option1_text: string;
    option2_text: string;
    calendly_url: string;
  };
  faqs: {
    videos: { title: string; video_url: string }[];
    text: { question: string; answer: string }[];
  };
  about: {
    heading: string;
    body: string;
    founders: { name: string; role: string; focus: string[] }[];
    closing: string;
  };
}

export interface SuperDocLead {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  email: string;
  lead_type: string;
  video_url: string;
  content_snapshot: SuperDocTemplateContent;
  created_at: string;
  opened_at: string | null;
  view_count: number;
}

export interface SuperDocTemplate {
  id: string;
  content: SuperDocTemplateContent;
  updated_at: string;
}
