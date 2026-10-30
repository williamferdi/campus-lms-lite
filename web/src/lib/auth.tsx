import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setCsrfToken } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  emailConfigured: boolean;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  /** Accept a session started by activation/reset flows. */
  adopt(user: User, csrfToken: string): void;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User | null; csrfToken: string | null; emailConfigured?: boolean }>("/auth/me");
      setCsrfToken(me.csrfToken);
      setUser(me.user);
      setEmailConfigured(!!me.emailConfigured);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setUser(null);
      setCsrfToken(null);
      qc.clear();
    };
    window.addEventListener("lms:unauthorized", onUnauthorized);
    return () => window.removeEventListener("lms:unauthorized", onUnauthorized);
  }, [refresh, qc]);

  const value: AuthState = {
    user,
    loading,
    emailConfigured,
    async login(email, password) {
      const r = await api.post<{ user: User; csrfToken: string }>("/auth/login", { email, password });
      setCsrfToken(r.csrfToken);
      qc.clear();
      setUser(r.user);
      void refresh();
      return r.user;
    },
    async logout() {
      try {
        await api.post("/auth/logout");
      } finally {
        setCsrfToken(null);
        setUser(null);
        qc.clear();
      }
    },
    adopt(u, token) {
      setCsrfToken(token);
      qc.clear();
      setUser(u);
    },
    refresh,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** The signed-in user (only use below a route guard). */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("Not signed in");
  return user;
}
