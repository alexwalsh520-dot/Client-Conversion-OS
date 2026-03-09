"use client";

import { useMemo } from "react";

interface ReviewMarkdownProps {
  content: string;
}

interface ParsedBlock {
  type: "h2" | "h3" | "ol" | "ul" | "paragraph";
  text?: string;
  items?: string[];
}

function parseInline(text: string): JSX.Element[] {
  const elements: JSX.Element[] = [];
  // Match **bold** and `code` spans
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Add preceding plain text
    if (match.index > lastIndex) {
      elements.push(
        <span key={key++}>{text.slice(lastIndex, match.index)}</span>
      );
    }

    if (match[2]) {
      // **bold**
      elements.push(
        <strong
          key={key++}
          style={{ color: "var(--text-primary)", fontWeight: 600 }}
        >
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // `code`
      elements.push(
        <code
          key={key++}
          style={{
            color: "var(--accent)",
            background: "rgba(255,255,255,0.06)",
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: "0.9em",
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          {match[3]}
        </code>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Trailing text
  if (lastIndex < text.length) {
    elements.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  if (elements.length === 0) {
    elements.push(<span key={0}>{text}</span>);
  }

  return elements;
}

function parseBlocks(content: string): ParsedBlock[] {
  const lines = content.split("\n");
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // Skip empty lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ## Header
    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      i++;
      continue;
    }

    // ### Header
    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      i++;
      continue;
    }

    // Numbered list (1. 2. 3. etc.)
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const olLine = lines[i].trimEnd();
        const m = olLine.match(/^\d+\.\s+(.+)/);
        if (m) {
          items.push(m[1]);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Bullet list (- or * )
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const ulLine = lines[i].trimEnd();
        const m = ulLine.match(/^[-*]\s+(.+)/);
        if (m) {
          items.push(m[1]);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const pLine = lines[i].trimEnd();
      if (
        pLine.trim() === "" ||
        pLine.startsWith("## ") ||
        pLine.startsWith("### ") ||
        /^\d+\.\s+/.test(pLine) ||
        /^[-*]\s+/.test(pLine)
      ) {
        break;
      }
      paragraphLines.push(pLine);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
    }
  }

  return blocks;
}

export function ReviewMarkdown({ content }: ReviewMarkdownProps): JSX.Element {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div style={{ lineHeight: 1.7 }}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "h2":
            return (
              <h2
                key={idx}
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginTop: idx === 0 ? 0 : 24,
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--border-primary)",
                }}
              >
                {parseInline(block.text!)}
              </h2>
            );

          case "h3":
            return (
              <h3
                key={idx}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginTop: 20,
                  marginBottom: 8,
                }}
              >
                {parseInline(block.text!)}
              </h3>
            );

          case "ol":
            return (
              <ol
                key={idx}
                style={{
                  margin: "8px 0",
                  paddingLeft: 24,
                  color: "var(--text-secondary)",
                  fontSize: 13,
                }}
              >
                {block.items!.map((item, j) => (
                  <li key={j} style={{ marginBottom: 6 }}>
                    {parseInline(item)}
                  </li>
                ))}
              </ol>
            );

          case "ul":
            return (
              <ul
                key={idx}
                style={{
                  margin: "8px 0",
                  paddingLeft: 24,
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  listStyleType: "disc",
                }}
              >
                {block.items!.map((item, j) => (
                  <li key={j} style={{ marginBottom: 6 }}>
                    {parseInline(item)}
                  </li>
                ))}
              </ul>
            );

          case "paragraph":
            return (
              <p
                key={idx}
                style={{
                  margin: "8px 0",
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                {parseInline(block.text!)}
              </p>
            );
        }
      })}
    </div>
  );
}
