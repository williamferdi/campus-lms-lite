import { GraduationCap } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { Button, FormError, LoadingState, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/query";
import type { User } from "../../lib/types";

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-rail px-4 py-10">
      <main className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <span className="flex size-11 items-center justify-center rounded-panel bg-white/15">
            <GraduationCap className="size-6" aria-hidden />
          </span>
          <span className="text-xl font-semibold">Campus LMS Lite</span>
        </div>
        <div className="rounded-panel bg-white p-6 shadow-xl sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const requested = (location.state as { from?: string } | null)?.from;
  const from = requested && !requested.startsWith("/login") ? requested : "/";

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Sign in" subtitle="Use the account provided by your institution.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={error} />
        <TextField label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

function PasswordForm({ token, kind }: { token: string; kind: "activation" | "password_reset" }) {
  const { adopt } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "activation") {
        const r = await api.post<{ user: User; csrfToken: string }>("/auth/activate", { token, password });
        adopt(r.user, r.csrfToken);
        navigate("/", { replace: true });
      } else {
        await api.post("/auth/reset-password", { token, password });
        setDone(true);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          Your password has been changed. All other sessions were signed out.
        </p>
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Continue to sign in
        </Link>
      </div>
    );

  const fieldErr = error instanceof ApiError ? error.fieldErrors().password : undefined;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!fieldErr && <FormError error={error} />}
      <TextField label="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters, including a letter and a number." error={fieldErr} />
      <TextField label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? "Passwords do not match." : undefined} />
      <Button type="submit" className="w-full" loading={busy} disabled={!password || mismatch}>
        {kind === "activation" ? "Activate account" : "Set new password"}
      </Button>
    </form>
  );
}

function TokenPage({ kind }: { kind: "activation" | "password_reset" }) {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const info = useApi<{ valid: boolean; kind?: string; name?: string; email?: string }>(token ? `/auth/token-info?token=${encodeURIComponent(token)}` : null);
  const title = kind === "activation" ? "Activate your account" : "Choose a new password";
  if (!token)
    return (
      <AuthCard title={title}>
        <p className="text-sm text-slate-600">This link is incomplete. Open the full link you received, or ask your administrator for a new one.</p>
      </AuthCard>
    );
  if (info.isPending) return <LoadingState />;
  if (!info.data?.valid || info.data.kind !== kind)
    return (
      <AuthCard title={title}>
        <p className="text-sm text-slate-600">This link is invalid or has expired. Ask your administrator for a new one.</p>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title={title} subtitle={`${info.data.name} · ${info.data.email}`}>
      <PasswordForm token={token} kind={kind} />
    </AuthCard>
  );
}

export const ActivatePage = () => <TokenPage kind="activation" />;
export const ResetPasswordPage = () => <TokenPage kind="password_reset" />;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ message: string; emailConfigured: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post("/auth/forgot-password", { email }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Reset your password" subtitle="Enter your account email.">
      {result ? (
        <div className="space-y-4">
          <p role="status" className={result.emailConfigured ? "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" : "rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"}>
            {result.message}
          </p>
          <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full" loading={busy} disabled={!email}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
