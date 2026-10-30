import clsx from "clsx";
import { useId, useState } from "react";
import { api } from "../../lib/api";
import { RichContent, Spinner } from "./index";

/**
 * Markdown editor with a server-rendered preview (uses the same sanitizer as saved content).
 * Supports headings, lists, links, tables, code and YouTube/Vimeo <iframe> embeds.
 */
export function MarkdownEditor({
  label,
  value,
  onChange,
  rows = 10,
  hint = "Markdown supported: **bold**, _italic_, # headings, - lists, [links](https://…), tables. Paste a YouTube or Vimeo <iframe> to embed video.",
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
}) {
  const id = useId();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const showPreview = async () => {
    setTab("preview");
    setLoading(true);
    try {
      const r = await api.post<{ html: string }>("/markdown/preview", { markdown: value });
      setPreview(r.html);
    } catch {
      setPreview("<p><em>Preview unavailable.</em></p>");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-slate-800">
          {label}
          {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
        </label>
        <div role="tablist" aria-label={`${label} editor mode`} className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => (t === "preview" ? void showPreview() : setTab("write"))}
              className={clsx("rounded-md px-2.5 py-1 font-medium capitalize", tab === t ? "bg-white shadow-sm text-slate-900" : "text-slate-600")}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === "write" ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={`${id}-hint`}
          className={clsx(
            "block w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm shadow-sm focus:outline-none focus:ring-2",
            error ? "border-red-500 focus:ring-red-200" : "border-slate-300 focus:border-brand-600 focus:ring-brand-100",
          )}
        />
      ) : (
        <div className="min-h-32 rounded-lg border border-slate-200 bg-white p-4">
          {loading ? <Spinner /> : preview ? <RichContent html={preview} /> : <p className="text-sm text-slate-400">Nothing to preview.</p>}
        </div>
      )}
      {error ? (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}
