import clsx from "clsx";
import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";

/**
 * A side panel (tray or drawer). Modal: focus is trapped inside, Esc or the backdrop closes it,
 * and focus returns to the control that opened it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = "left",
  offsetLeft = false,
  className,
  hideTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  side?: "left" | "right";
  /** Start the panel to the right of the global rail (desktop trays). */
  offsetLeft?: boolean;
  className?: string;
  hideTitle?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-slate-900/40" />
        <D.Content
          className={clsx(
            "fixed inset-y-0 z-50 flex w-[22rem] max-w-[calc(100vw-3rem)] flex-col bg-white shadow-xl outline-none",
            side === "left" ? "animate-tray-in" : "right-0 animate-fade-in",
            side === "left" && (offsetLeft ? "left-0 md:left-[var(--rail-width)]" : "left-0"),
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <D.Title className={clsx("text-lg font-semibold text-slate-900", hideTitle && "sr-only")}>{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-slate-500">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-slate-600 hover:bg-slate-100 hover:text-slate-900" aria-label="Close">
              <X className="size-5" aria-hidden />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
