import clsx from "clsx";
import { Tabs as T } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

/** Arrow keys move between tabs; Home/End jump to the first/last tab. */
export const Tabs = (props: ComponentProps<typeof T.Root>) => <T.Root {...props} />;

export function TabsList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <T.List aria-label={label} className={clsx("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {children}
    </T.List>
  );
}

export function TabsTrigger({ value, children, disabled }: { value: string; children: ReactNode; disabled?: boolean }) {
  return (
    <T.Trigger
      value={value}
      disabled={disabled}
      className="-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50 data-[state=active]:border-brand-700 data-[state=active]:text-brand-800 [&_svg]:size-4"
    >
      {children}
    </T.Trigger>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <T.Content value={value} className={clsx("pt-4 outline-none", className)}>
      {children}
    </T.Content>
  );
}
