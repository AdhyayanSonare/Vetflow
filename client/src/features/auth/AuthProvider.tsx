import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { can as roleCan, type Permission, type Role } from "@shared/permissions";
import { api, onUnauthenticated, setCsrfToken } from "@/api/client";

export type SessionUser = { name: string; email: string; role: Role };
export type Features = {
  voice: boolean;
  barcode: boolean;
  asrLanguage: string;
  /** What the server can actually do. A tenant can switch voice on while no provider is set up. */
  transcriptionAvailable: boolean;
  extractionAvailable: boolean;
};

type MeResponse = { user: SessionUser; csrfToken: string };

type AuthState = {
  status: "loading" | "signedOut" | "signedIn";
  user: SessionUser | null;
  features: Features;
  can: (p: Permission) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const DEFAULT_FEATURES: Features = { voice: false, barcode: false, asrLanguage: "en", transcriptionAvailable: false, extractionAvailable: false };
const AuthContext = createContext<AuthState | null>(null);

export const authKeys = { me: ["auth", "me"] as const, features: ["auth", "features"] as const };

/** Who is signed in, what they may do, and which features the clinic has switched on. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: authKeys.me,
    queryFn: async () => {
      try {
        const r = await api.get<MeResponse>("/api/auth/me");
        setCsrfToken(r.csrfToken);
        return r.user;
      } catch (e) {
        if (e instanceof Error && "status" in e && (e as { status: number }).status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
  const user = me.data ?? null;

  const features = useQuery({
    queryKey: authKeys.features,
    queryFn: () => api.get<Features>("/api/features"),
    enabled: !!user,
    staleTime: 60_000,
  });

  // When the server ends the session, go back to signed-out and drop everything cached for that user.
  useEffect(() => onUnauthenticated(() => {
    setCsrfToken("");
    qc.clear();
    qc.setQueryData(authKeys.me, null);
  }), [qc]);

  const login = useMutation({
    mutationFn: (v: { email: string; password: string }) => api.post<MeResponse>("/api/auth/login", v),
    onSuccess: r => {
      setCsrfToken(r.csrfToken);
      qc.clear();
      qc.setQueryData(authKeys.me, r.user);
    },
  });
  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSettled: () => {
      setCsrfToken("");
      qc.clear();
      qc.setQueryData(authKeys.me, null);
    },
  });

  const signIn = useCallback(async (email: string, password: string) => { await login.mutateAsync({ email, password }); }, [login]);
  const signOut = useCallback(async () => { await logout.mutateAsync().catch(() => {}); }, [logout]);

  const value = useMemo<AuthState>(() => ({
    status: me.isPending ? "loading" : user ? "signedIn" : "signedOut",
    user,
    features: features.data ?? DEFAULT_FEATURES,
    can: (p: Permission) => !!user && roleCan(user.role, p),
    signIn,
    signOut,
  }), [me.isPending, user, features.data, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** The signed-in user. Only for use below the sign-in gate. */
export function useUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called while signed out");
  return user;
}
