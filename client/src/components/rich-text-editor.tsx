import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TextAlign } from "@tiptap/extension-text-align";
import { Image } from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight, ImagePlus, Palette, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

const COLORS = [
  "#000000", "#374151", "#6b7280", "#9ca3af",
  "#dc2626", "#ea580c", "#d97706", "#ca8a04",
  "#16a34a", "#059669", "#0d9488", "#0891b2",
  "#2563eb", "#4f46e5", "#7c3aed", "#9333ea",
  "#c026d3", "#db2777", "#e11d48", "#ffffff",
];

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  testIdPrefix?: string;
}

export function RichTextEditor({ value, onChange, placeholder, testIdPrefix = "rich-editor" }: RichTextEditorProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: placeholder || "Write your content here..." }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none min-h-[180px] p-3 focus:outline-none",
        "data-testid": `${testIdPrefix}-content`,
      },
    },
  });

  const lastValueRef = useRef(value);
  useEffect(() => {
    if (editor && value !== lastValueRef.current) {
      const currentContent = editor.getHTML();
      if (currentContent !== value) {
        editor.commands.setContent(value || "");
      }
      lastValueRef.current = value;
    }
  }, [editor, value]);

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/admin/upload-inline-image", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      editor?.chain().focus().setImage({ src: url }).run();
    } catch {
      toast({ title: "Failed to upload image", variant: "destructive" });
    }
    setUploading(false);
  };

  if (!editor) return null;

  return (
    <div className="border rounded-md overflow-hidden bg-background" data-testid={`${testIdPrefix}-wrapper`}>
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          testId={`${testIdPrefix}-bold`}
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          testId={`${testIdPrefix}-italic`}
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          testId={`${testIdPrefix}-underline`}
          title="Underline"
        >
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-accent transition-colors"
              title="Text Color"
              data-testid={`${testIdPrefix}-color-trigger`}
            >
              <Palette className="w-4 h-4" style={{ color: editor.getAttributes("textStyle").color || undefined }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="grid grid-cols-5 gap-1">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="w-6 h-6 rounded-sm border border-border hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  onClick={() => editor.chain().focus().setColor(color).run()}
                  data-testid={`${testIdPrefix}-color-${color.replace("#", "")}`}
                />
              ))}
            </div>
            <button
              type="button"
              className="mt-1 w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => editor.chain().focus().unsetColor().run()}
            >
              Reset color
            </button>
          </PopoverContent>
        </Popover>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          testId={`${testIdPrefix}-align-left`}
          title="Align Left"
        >
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          testId={`${testIdPrefix}-align-center`}
          title="Align Center"
        >
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          testId={`${testIdPrefix}-align-right`}
          title="Align Right"
        >
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          active={false}
          onClick={() => fileInputRef.current?.click()}
          testId={`${testIdPrefix}-image`}
          title="Insert Image"
          disabled={uploading}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ToolbarButton({ active, onClick, children, testId, title, disabled }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`p-1.5 rounded transition-colors ${active ? "bg-accent text-accent-foreground" : "hover:bg-accent"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      onClick={onClick}
      title={title}
      data-testid={testId}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}
