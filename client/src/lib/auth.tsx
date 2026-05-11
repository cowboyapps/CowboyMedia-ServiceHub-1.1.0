import { createContext, useContext } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./queryClient";
import { getQueryFn } from "./queryClient";
import type { User, LoginData, RegisterData } from "@shared/schema";

export interface LoginResult {
  twoFactorRequired?: boolean;
  challengeId?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginData) => Promise<LoginResult>;
  verifyTwoFactor: (challengeId: string, code: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isMasterAdmin: boolean;
  permissions: string[];
  hasPermission: (key: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const isAdmin = user?.role === "admin" || user?.role === "master_admin";
  const isMasterAdmin = user?.role === "master_admin";

  const { data: roleData } = useQuery<{ permissions: string[] }>({
    queryKey: ["/api/admin/my-permissions"],
    enabled: isAdmin && !isMasterAdmin,
  });

  const permissions = isMasterAdmin ? ["*"] : (roleData?.permissions || []);

  const hasPermission = (key: string): boolean => {
    if (isMasterAdmin) return true;
    return permissions.includes(key);
  };

  const loginMutation = useMutation({
    mutationFn: async (data: LoginData): Promise<LoginResult> => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return await res.json();
    },
    onSuccess: (result) => {
      if (!result?.twoFactorRequired) {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
    },
  });

  const verifyTwoFactorMutation = useMutation({
    mutationFn: async ({ challengeId, code }: { challengeId: string; code: string }) => {
      await apiRequest("POST", "/api/auth/2fa/verify", { challengeId, code });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterData) => {
      await apiRequest("POST", "/api/auth/register", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: async () => {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.includes('-api')).map((k) => caches.delete(k)));
      }
      queryClient.clear();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const login = async (data: LoginData): Promise<LoginResult> => {
    return await loginMutation.mutateAsync(data);
  };

  const verifyTwoFactor = async (challengeId: string, code: string) => {
    await verifyTwoFactorMutation.mutateAsync({ challengeId, code });
  };

  const register = async (data: RegisterData) => {
    await registerMutation.mutateAsync(data);
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        login,
        verifyTwoFactor,
        register,
        logout,
        isAdmin,
        isMasterAdmin,
        permissions,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
