import { DEFAULT_TEMPLATE } from './super-doc-template-default';
import { AGENCY_TM_TEMPLATE } from './super-doc-template-agency';
import type { SuperDocTemplateContent, SuperDocTemplateVariant } from './super-doc-types';
import { getSuperDocSegment } from './super-doc-routing';

export const DEFAULT_TEMPLATE_VARIANT: SuperDocTemplateVariant = 'creator';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeTemplateVariant(value?: string | null): SuperDocTemplateVariant {
  const normalized = (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return ['agency', 'agency_tm', 'talent_manager', 'tm', 'manager'].includes(normalized)
    ? 'agency'
    : DEFAULT_TEMPLATE_VARIANT;
}

export function getTemplateVariantForLeadType(leadType: string): SuperDocTemplateVariant {
  return getSuperDocSegment(leadType) === 'agency_tm' ? 'agency' : 'creator';
}

export function stripVariantTemplates(content: SuperDocTemplateContent): SuperDocTemplateContent {
  const clean = deepClone(content) as SuperDocTemplateContent & Record<string, unknown>;
  delete clean.variant_templates;
  return clean;
}

export function getInitialTemplateContent(): SuperDocTemplateContent {
  return {
    ...deepClone(DEFAULT_TEMPLATE),
    variant_templates: {
      agency: deepClone(AGENCY_TM_TEMPLATE),
    },
  };
}

export function getTemplateContentForVariant(
  rootContent: SuperDocTemplateContent,
  variant: SuperDocTemplateVariant,
): SuperDocTemplateContent {
  if (variant === 'agency') {
    return stripVariantTemplates(rootContent.variant_templates?.agency || AGENCY_TM_TEMPLATE);
  }

  return stripVariantTemplates(rootContent);
}

export function getTemplateContentForLeadType(
  rootContent: SuperDocTemplateContent,
  leadType: string,
): SuperDocTemplateContent {
  return getTemplateContentForVariant(rootContent, getTemplateVariantForLeadType(leadType));
}

export function mergeTemplateContentForVariant(input: {
  existingRootContent?: SuperDocTemplateContent | null;
  variant: SuperDocTemplateVariant;
  content: SuperDocTemplateContent;
}): SuperDocTemplateContent {
  const existingRoot = input.existingRootContent || getInitialTemplateContent();
  const cleanContent = stripVariantTemplates(input.content);

  if (input.variant === 'agency') {
    return {
      ...existingRoot,
      variant_templates: {
        ...(existingRoot.variant_templates || {}),
        agency: cleanContent,
      },
    };
  }

  return {
    ...cleanContent,
    variant_templates: existingRoot.variant_templates || {
      agency: deepClone(AGENCY_TM_TEMPLATE),
    },
  };
}
