import clsx from "clsx";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../../lib/api";
import { Button, Dialog } from "./index";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface FeedbackApi {
  success(message: string): void;
  error(e: unknown): void;
  info(message: string): void;
  confirm(opts: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const [confirmState, setConfirmState] = useState<{ title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);

  const api: FeedbackApi = {
    success: (m) => push("success", m),
    info: (m) => push("info", m),
    error: (e) => push("error", errorMessage(e)),
    confirm: (opts) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
  };

  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={clsx(
              "pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg ring-1",
              t.tone === "success" && "bg-white text-slate-800 ring-emerald-200",
              t.tone === "error" && "bg-white text-red-800 ring-red-200",
              t.tone === "info" && "bg-white text-slate-800 ring-slate-200",
            )}
          >
            {t.tone === "success" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />}
            {t.tone === "error" && <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />}
            {t.tone === "info" && <Info className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <Dialog
        open={!!confirmState}
        onClose={() => close(false)}
        title={confirmState?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={confirmState?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {confirmState?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        <div className="text-sm text-slate-600">{confirmState?.message}</div>
      </Dialog>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside FeedbackProvider");
  return ctx;
}
