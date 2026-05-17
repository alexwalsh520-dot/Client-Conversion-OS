// HTML sanitization for SOP body content.
//
// All HTML that the TipTap editor produces is sanitized before storing
// to the DB AND before rendering in the viewer. Belt-and-suspenders:
// the editor itself emits a constrained set of tags, but we re-sanitize
// at both ends so a malicious admin (or a bug in the editor) can't
// inject scripts into SOP pages.

import DOMPurify from "isomorphic-dompurify";

/**
 * Allowed tags + attributes for SOP body content. Matches what the
 * TipTap configuration produces. Anything outside this list is stripped.
 */
const ALLOWED_TAGS = [
  "p", "br",
  "h1", "h2", "h3", "h4",
  "strong", "em", "u", "s", "code",
  "ul", "ol", "li",
  "blockquote",
  "a",
  "pre",
  "img",
  "hr",
];

const ALLOWED_ATTR = [
  "href", "target", "rel",
  "src", "alt", "title",
  "class",
];

export function sanitizeSopHtml(input: string): string {
  if (!input) return "";
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data:image\/[a-z]+;base64,):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    // Force noopener/noreferrer on outbound links
    ADD_ATTR: ["target"],
  });
}
