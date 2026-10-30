import clsx from "clsx";
import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link, type LinkProps } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import { errorMessage } from "../../lib/api";
import { Tooltip } from "./tooltip";

export { Tooltip } from "./tooltip";
export { Menu, MenuItem, MenuLabel, MenuLinkItem, MenuSeparator } from "./menu";
export { Sheet } from "./sheet";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

// ------------------------------------------------------------------ buttons
/**
 * primary: the page's main action · secondary: alternative action · outline: low-emphasis action
 * ghost: toolbar/navigation · danger: destructive (pair with a confirm dialog) · subtle: tinted helper action
 */
export type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "subtle";
export type Size = "sm" | "md" | "lg";

export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra?: string) =>
  clsx(
    "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:shrink-0",
    { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" }[size],
    {
      primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900",
      secondary: "border border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200",
      outline: "border border-brand-700 bg-white text-brand-700 hover:bg-brand-50",
      ghost: "text-slate-700 hover:bg-slate-100",
      danger: "bg-red-700 text-white hover:bg-red-800",
      subtle: "bg-brand-50 text-brand-800 hover:bg-brand-100",
    }[variant],
    extra,
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ variant, size, icon, className, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

/** Icon-only button. `label` is both the accessible name and the tooltip text. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md" }>(function IconButton(
  { label, children, className, size = "sm", ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={clsx(
        "inline-flex items-center justify-center rounded-control text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:shrink-0",
        size === "sm" ? "size-8" : "size-10",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
  return rest.disabled ? button : <Tooltip label={label}>{button}</Tooltip>;
});

// ------------------------------------------------------------------ form fields
const inputClass = (invalid?: boolean) =>
  clsx(
    "block w-full rounded-control border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-100",
    invalid ? "border-red-500 focus:ring-red-200" : "border-slate-300 focus:border-brand-600 focus:ring-brand-100",
  );

interface FieldProps {
  label: ReactNode;
  error?: string | undefined;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
}

function FieldShell({ id, label, error, hint, required, className, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: ReactNode) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

export function TextField({ label, error, hint, required, className, id: idProp, ...rest }: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "className">) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <input id={id} required={required} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, error, hint)} className={inputClass(!!error)} {...rest} />
    </FieldShell>
  );
}

export function TextAreaField({ label, error, hint, required, className, id: idProp, ...rest }: FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <textarea id={id} required={required} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, error, hint)} className={clsx(inputClass(!!error), "min-h-28")} {...rest} />
    </FieldShell>
  );
}

export function SelectField({ label, error, hint, required, className, id: idProp, children, ...rest }: FieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <select id={id} required={required} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, error, hint)} className={inputClass(!!error)} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(inputClass(), "w-auto", className)} {...rest} />;
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="search" className={clsx(inputClass(), className)} {...rest} />;
}

export function Checkbox({ label, hint, className, ...rest }: { label: ReactNode; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const id = useId();
  return (
    <div className={clsx("flex items-start gap-2.5", className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-4 rounded border-slate-300 text-brand-700 accent-brand-700" {...rest} />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-800">
          {label}
        </label>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

// ------------------------------------------------------------------ surfaces
export function Card({ className, children, as: As = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" }) {
  return <As className={clsx("rounded-panel border border-line bg-surface", className)}>{children}</As>;
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-line pb-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm font-medium text-brand-700">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "gray" | "green" | "amber" | "red" | "blue" | "brand" | "violet";
export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        {
          gray: "bg-slate-100 text-slate-700",
          green: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
          amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
          red: "bg-red-50 text-red-700 ring-1 ring-red-200",
          blue: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
          brand: "bg-brand-50 text-brand-800 ring-1 ring-brand-200",
          violet: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
        }[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${v}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ states
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-brand-700", className)} aria-hidden />;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-panel border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertTriangle className="size-8 text-red-600" aria-hidden />
      <p className="text-sm font-medium text-red-800">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="font-medium text-slate-800">{title}</p>
      {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Render a query's loading/error/success states consistently. */
export function Loadable<T>({ query, children, label }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; label?: string }) {
  if (query.isPending) return <LoadingState label={label} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

// ------------------------------------------------------------------ dialog
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={clsx(
        "m-auto w-[calc(100%-2rem)] rounded-panel border border-line bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40",
        { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size],
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            </div>
            <IconButton label="Close dialog" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ------------------------------------------------------------------ table & pagination
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className="w-full min-w-[560px] text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500 [&_thead]:bg-slate-50 [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-100 [&_tbody_tr:hover]:bg-slate-50/60">
        {children}
      </table>
    </div>
  );
}

export function Pagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return <p className="px-4 py-3 text-xs text-slate-500">{total} total</p>;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-slate-500">
        Page {page} of {pageCount} · {total} total
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

/** Sanitized HTML from the server (never user input rendered directly on the client). */
export function RichContent({ html, className }: { html: string; className?: string }) {
  if (!html) return null;
  return <div className={clsx("rich-content", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 text-sm text-slate-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}
