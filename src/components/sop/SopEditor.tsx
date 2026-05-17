"use client";

/**
 * SopEditor — TipTap rich-text editor for SOP body content.
 *
 * Notion-style WYSIWYG. Looks identical to the viewer rendering. Dark
 * mode native, matches the CCOS aesthetic.
 *
 * Supports:
 *   - Headings (H1/H2/H3), bold, italic, lists, links, blockquote, code
 *   - Inline images via drag-drop or paste (uploaded to Supabase Storage,
 *     URL inserted at cursor)
 *   - Paste-from-Google-Docs / Word cleanup (StarterKit handles)
 *
 * The shape of HTML it produces matches the ALLOWED_TAGS list in
 * sop/sanitize.ts — server re-sanitizes on save.
 */

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Code,
  Sparkles,
} from "lucide-react";

interface Props {
  /** Initial HTML content (e.g. after PDF import or when editing). */
  initialHtml?: string;
  /** Called on every doc change with the latest HTML. */
  onChange: (html: string) => void;
  /** Slug used when uploading inline images (so storage paths group by SOP). */
  slug?: string;
  /** Called when the Polish button is clicked. Parent runs the API call. */
  onPolish?: () => Promise<void> | void;
  polishing?: boolean;
  /** Disable everything (e.g. while saving). */
  disabled?: boolean;
}

export default function SopEditor({
  initialHtml = "",
  onChange,
  slug,
  onPolish,
  polishing = false,
  disabled = false,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // we use inline code only for MVP; full code blocks later
      }),
      Image.configure({
        HTMLAttributes: { class: "sop-img" },
        allowBase64: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({
        placeholder: "Start writing the SOP. Use headings (H1/H2), bullet lists, and screenshots. Click \"Polish with AI\" any time.",
      }),
    ],
    content: initialHtml,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  const [imageUploading, setImageUploading] = useState(false);

  // Sync initial content if it changes after mount (e.g., import lands)
  useEffect(() => {
    if (editor && initialHtml && editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (slug) fd.append("slug", slug);
      const res = await fetch("/api/sop/embedded-image", { method: "POST", body: fd });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url ?? null;
    } catch {
      return null;
    } finally {
      setImageUploading(false);
    }
  }, [slug]);

  // Drop + paste handlers for images
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    async function insertImageFromFile(file: File) {
      if (!editor || !file.type.startsWith("image/")) return;
      const url = await uploadImage(file);
      if (url) {
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      }
    }

    function onDrop(e: DragEvent) {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (imgs.length === 0) return;
      e.preventDefault();
      imgs.forEach(insertImageFromFile);
    }

    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgs = items
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (imgs.length === 0) return;
      e.preventDefault();
      imgs.forEach(insertImageFromFile);
    }

    dom.addEventListener("drop", onDrop);
    dom.addEventListener("paste", onPaste);
    return () => {
      dom.removeEventListener("drop", onDrop);
      dom.removeEventListener("paste", onPaste);
    };
  }, [editor, uploadImage]);

  if (!editor) {
    return (
      <div className="glass-static" style={{ padding: 24, borderRadius: 12, color: "var(--text-muted)" }}>
        Loading editor...
      </div>
    );
  }

  function ToolbarButton({
    onClick,
    active = false,
    title,
    children,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        disabled={disabled}
        style={{
          padding: "6px 8px",
          background: active ? "var(--accent-soft)" : "transparent",
          color: active ? "var(--accent)" : "var(--text-secondary)",
          border: "1px solid transparent",
          borderColor: active ? "var(--accent)" : "transparent",
          borderRadius: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="glass-static" style={{ borderRadius: 12, overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-primary)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <ToolbarButton
          title="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Heading 3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 size={14} />
        </ToolbarButton>

        <span style={{ width: 1, height: 16, background: "var(--border-primary)", margin: "0 6px" }} />

        <ToolbarButton
          title="Bold (Cmd+B)"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Italic (Cmd+I)"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Inline code"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code size={14} />
        </ToolbarButton>

        <span style={{ width: 1, height: 16, background: "var(--border-primary)", margin: "0 6px" }} />

        <ToolbarButton
          title="Bulleted list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Quote / callout"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={14} />
        </ToolbarButton>

        <span style={{ width: 1, height: 16, background: "var(--border-primary)", margin: "0 6px" }} />

        <ToolbarButton
          title="Insert link"
          active={editor.isActive("link")}
          onClick={() => {
            const url = window.prompt("URL", editor.getAttributes("link").href ?? "https://");
            if (url === null) return;
            if (url === "") {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              return;
            }
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }}
        >
          <LinkIcon size={14} />
        </ToolbarButton>

        <ToolbarButton
          title="Insert image (or drag/paste directly)"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              const url = await uploadImage(file);
              if (url) editor.chain().focus().setImage({ src: url, alt: file.name }).run();
            };
            input.click();
          }}
        >
          <ImageIcon size={14} />
          {imageUploading && <span style={{ fontSize: 10 }}>uploading...</span>}
        </ToolbarButton>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {onPolish && (
            <button
              type="button"
              onClick={() => void onPolish()}
              disabled={polishing || disabled}
              title="Reformat the doc consistently using AI"
              style={{
                padding: "6px 10px",
                fontSize: 12,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                border: "1px solid var(--accent)",
                borderRadius: 6,
                cursor: polishing || disabled ? "not-allowed" : "pointer",
                opacity: polishing || disabled ? 0.6 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontWeight: 500,
              }}
            >
              <Sparkles size={13} />
              {polishing ? "Polishing..." : "Polish with AI"}
            </button>
          )}
        </div>
      </div>

      {/* Editor body — styled to match the viewer */}
      <div style={{ padding: "20px 28px", minHeight: 400 }}>
        <EditorContent editor={editor} />
      </div>

      <style jsx global>{`
        .ProseMirror {
          outline: none;
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.7;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--text-muted);
          pointer-events: none;
          height: 0;
        }
        .ProseMirror h1 {
          font-size: 26px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 24px 0 8px;
          line-height: 1.25;
        }
        .ProseMirror h2 {
          font-size: 19px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 20px 0 6px;
          line-height: 1.3;
        }
        .ProseMirror h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-secondary);
          margin: 16px 0 4px;
          line-height: 1.4;
        }
        .ProseMirror p { margin: 8px 0; }
        .ProseMirror ul, .ProseMirror ol {
          padding-left: 24px;
          margin: 8px 0;
        }
        .ProseMirror li { margin: 4px 0; }
        .ProseMirror li > p { margin: 0; }
        .ProseMirror blockquote {
          border-left: 3px solid var(--accent);
          padding: 6px 14px;
          margin: 12px 0;
          background: var(--accent-soft);
          color: var(--text-secondary);
          border-radius: 0 6px 6px 0;
        }
        .ProseMirror code {
          background: var(--bg-glass);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.92em;
          font-family: var(--font-mono), monospace;
          color: var(--accent);
        }
        .ProseMirror a {
          color: var(--accent);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .ProseMirror img.sop-img, .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 12px 0;
          border: 1px solid var(--border-primary);
        }
        .ProseMirror hr {
          border: none;
          border-top: 1px solid var(--border-primary);
          margin: 20px 0;
        }
        .ProseMirror strong { color: var(--text-primary); font-weight: 600; }
      `}</style>
    </div>
  );
}
