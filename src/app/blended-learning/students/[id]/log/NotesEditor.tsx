"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";

// The Conversation notes editor: headings, bold, italic, lists and tables
// only. Its HTML is untrusted input; the server sanitises it before saving.
// Table editing is desktop-only, so table controls show from 1024 px up; rows
// and columns are added after, or removed at, the cursor's cell.

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: false,
    strike: false,
    underline: false,
  }),
  TableKit.configure({ table: { resizable: false } }),
];

const CONTENT_CLASSES =
  "min-h-40 px-3 py-2.5 text-sm text-text-primary focus:outline-none [&_h3]:mt-2 [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_.tableWrapper]:overflow-x-auto";

function ToolbarButton({
  label,
  text,
  active,
  onClick,
  className = "",
}: {
  label: string;
  text: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // Keep focus and the selection in the editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm font-bold transition-colors ${
        active ? "bg-accent text-text-on-accent" : "text-text-secondary hover:bg-hover-bg hover:text-text-primary"
      } ${className}`}
    >
      {text}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      heading: current.isActive("heading", { level: 3 }),
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      inTable: current.isActive("table"),
    }),
  });
  const run = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Notes formatting" className="flex flex-wrap gap-1 border-b border-border p-1">
      <ToolbarButton label="Heading" text="H" active={state.heading} onClick={() => run().toggleHeading({ level: 3 }).run()} />
      <ToolbarButton label="Bold" text="B" active={state.bold} onClick={() => run().toggleBold().run()} />
      <ToolbarButton label="Italic" text="I" active={state.italic} onClick={() => run().toggleItalic().run()} className="italic" />
      <ToolbarButton label="Bulleted list" text="•" active={state.bulletList} onClick={() => run().toggleBulletList().run()} />
      <ToolbarButton label="Numbered list" text="1." active={state.orderedList} onClick={() => run().toggleOrderedList().run()} />
      <span className="hidden gap-1 lg:flex">
        <ToolbarButton
          label="Insert table"
          text="Table"
          onClick={() => run().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}
        />
        {state.inTable && (
          <>
            <ToolbarButton label="Add row" text="+ Row" onClick={() => run().addRowAfter().run()} />
            <ToolbarButton label="Remove row" text="− Row" onClick={() => run().deleteRow().run()} />
            <ToolbarButton label="Add column" text="+ Column" onClick={() => run().addColumnAfter().run()} />
            <ToolbarButton label="Remove column" text="− Column" onClick={() => run().deleteColumn().run()} />
            <ToolbarButton label="Delete table" text="Delete table" onClick={() => run().deleteTable().run()} />
          </>
        )}
      </span>
    </div>
  );
}

export function NotesEditor({
  labelId,
  initialHtml,
  onChange,
  onEdit,
}: {
  labelId: string;
  // Notes to start from: a Conversation Draft's (text already escaped), or the
  // editor's own HTML from before the form unmounted it.
  initialHtml?: string;
  onChange: (html: string) => void;
  // Called on each edit by the Mentor, not for the starting notes.
  onEdit?: () => void;
}) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    immediatelyRender: false,
    content: initialHtml || "",
    // Report the starting notes as the editor holds them.
    onCreate: ({ editor: current }) => {
      if (initialHtml) onChange(current.getHTML());
    },
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        class: CONTENT_CLASSES,
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getHTML());
      onEdit?.();
    },
  });

  return (
    <div className="max-w-full overflow-hidden rounded-lg border-2 border-border bg-bg-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
