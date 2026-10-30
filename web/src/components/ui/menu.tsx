import clsx from "clsx";
import { DropdownMenu as M } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";

const itemClass = (danger?: boolean) =>
  clsx(
    "flex cursor-default select-none items-center gap-2 rounded px-2.5 py-2 text-sm outline-none [&_svg]:size-4 [&_svg]:shrink-0",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
    danger ? "text-red-700 data-[highlighted]:bg-red-50" : "text-slate-800 data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-800",
  );

/** Dropdown menu. `trigger` must be a button (for example an IconButton or Button). */
export function Menu({ trigger, children, align = "end", label }: { trigger: ReactElement; children: ReactNode; align?: "start" | "end"; label?: string }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
          className="z-50 min-w-48 max-w-[calc(100vw-16px)] animate-fade-in rounded-panel border border-line bg-white p-1 shadow-lg"
        >
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ children, onSelect, danger, disabled, icon }: { children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <M.Item className={itemClass(danger)} onSelect={onSelect} disabled={disabled}>
      {icon}
      {children}
    </M.Item>
  );
}

export function MenuLinkItem({ to, children, icon }: { to: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <M.Item asChild className={itemClass()}>
      <Link to={to}>
        {icon}
        {children}
      </Link>
    </M.Item>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</M.Label>;
