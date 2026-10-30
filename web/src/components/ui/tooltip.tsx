import { Tooltip as T } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

/** Wrap one focusable element. Shows on hover and keyboard focus; Esc dismisses it. */
export function Tooltip({ label, children, side = "top", disabled }: { label: ReactNode; children: ReactElement; side?: "top" | "right" | "bottom" | "left"; disabled?: boolean }) {
  if (disabled) return children;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} collisionPadding={8} className="z-[60] max-w-xs animate-fade-in rounded-control bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg">
          {label}
          <T.Arrow className="fill-slate-900" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={300} skipDelayDuration={200}>
    {children}
  </T.Provider>
);
