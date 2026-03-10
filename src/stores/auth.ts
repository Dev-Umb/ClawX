import { create } from 'zustand';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  phone?: string;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthStoreState {
  status: AuthStatus;
  user: UserProfile | null;
  accessToken: string | null;
  error: string | null;
  initialized: boolean;
  init: () => Promise<void>;
  checkAuth: () => Promise<void>;
  login: () => Promise<void>;
  loginWithMock: () => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  onAuthCallback: () => Promise<void>;
}

type AuthStatusResponse = {
  authenticated: boolean;
  user: UserProfile | null;
  accessToken?: string | null;
};

let authInitPromise: Promise<void> | null = null;
let authUnsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized) {
      return;
    }
    if (authInitPromise) {
      await authInitPromise;
      return;
    }

    authInitPromise = (async () => {
      if (!authUnsubscribe) {
        authUnsubscribe = subscribeHostEvent<{ authenticated: boolean; user: UserProfile | null; accessToken?: string | null }>(
          'auth:changed',
          (payload) => {
            set({
              status: payload.authenticated ? 'authenticated' : 'unauthenticated',
              user: payload.user,
              accessToken: payload.authenticated ? payload.accessToken || null : null,
              error: null,
            });
          },
        );
      }

      await get().checkAuth();
      set({ initialized: true });
    })();

    try {
      await authInitPromise;
    } finally {
      authInitPromise = null;
    }
  },

  checkAuth: async () => {
    set({ status: 'loading', error: null });
    try {
      const response = await invokeIpc<AuthStatusResponse>('auth:status');
      set({
        status: response.authenticated ? 'authenticated' : 'unauthenticated',
        user: response.user,
        accessToken: response.authenticated ? response.accessToken || null : null,
        error: null,
      });
    } catch (error) {
      set({
        status: 'unauthenticated',
        user: null,
        accessToken: null,
        error: String(error),
      });
    }
  },

  login: async () => {
    set({ error: null });
    try {
      await invokeIpc<{ success: boolean }>('auth:login');
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  loginWithMock: async () => {
    await get().login();
  },

  logout: async () => {
    set({ error: null });
    try {
      await invokeIpc<{ success: boolean }>('auth:logout');
      set({ status: 'unauthenticated', user: null, accessToken: null });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  refreshToken: async () => {
    set({ error: null });
    try {
      const response = await invokeIpc<{ success: boolean }>('auth:refresh');
      if (!response.success) {
        set({ status: 'unauthenticated', user: null, accessToken: null });
      }
      await get().checkAuth();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  onAuthCallback: async () => {
    await get().checkAuth();
  },
}));
