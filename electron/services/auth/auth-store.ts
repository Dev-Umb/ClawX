import { safeStorage } from 'electron';
import type { AuthState, AuthTokens, UserProfile } from './types';

type AuthStoreShape = {
  tokens: string | AuthTokens | null;
  tokensEncrypted: boolean;
  user: UserProfile | null;
  loginState: string | null;
};

let authStoreInstance: {
  get: <K extends keyof AuthStoreShape>(key: K) => AuthStoreShape[K];
  set: <K extends keyof AuthStoreShape>(key: K, value: AuthStoreShape[K]) => void;
  clear: () => void;
} | null = null;

const AUTH_STORE_NAME = 'clawx-auth';

const AUTH_STORE_DEFAULTS: AuthStoreShape = {
  tokens: null,
  tokensEncrypted: false,
  user: null,
  loginState: null,
};

async function getAuthStore() {
  if (!authStoreInstance) {
    const Store = (await import('electron-store')).default;
    authStoreInstance = new Store<AuthStoreShape>({
      name: AUTH_STORE_NAME,
      defaults: AUTH_STORE_DEFAULTS,
    }) as typeof authStoreInstance;
  }
  return authStoreInstance;
}

function encryptTokens(tokens: AuthTokens): { payload: string | AuthTokens; encrypted: boolean } {
  const serialized = JSON.stringify(tokens);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(serialized).toString('base64');
    return { payload: encrypted, encrypted: true };
  }
  return { payload: tokens, encrypted: false };
}

function parseTokens(raw: string | AuthTokens | null, encrypted: boolean): AuthTokens | null {
  if (!raw) {
    return null;
  }
  if (!encrypted && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    if (encrypted && safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(Buffer.from(raw, 'base64'));
      return JSON.parse(decrypted) as AuthTokens;
    }
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

class AuthStore {
  async getTokens(): Promise<AuthTokens | null> {
    const store = await getAuthStore();
    const encrypted = Boolean(store.get('tokensEncrypted'));
    return parseTokens(store.get('tokens'), encrypted);
  }

  async setTokens(tokens: AuthTokens): Promise<void> {
    const store = await getAuthStore();
    const serialized = encryptTokens(tokens);
    store.set('tokens', serialized.payload);
    store.set('tokensEncrypted', serialized.encrypted);
  }

  async clearTokens(): Promise<void> {
    const store = await getAuthStore();
    store.set('tokens', null);
    store.set('tokensEncrypted', false);
  }

  async getUser(): Promise<UserProfile | null> {
    const store = await getAuthStore();
    return store.get('user');
  }

  async setUser(user: UserProfile | null): Promise<void> {
    const store = await getAuthStore();
    store.set('user', user);
  }

  async getLoginState(): Promise<string | null> {
    const store = await getAuthStore();
    return store.get('loginState');
  }

  async setLoginState(state: string | null): Promise<void> {
    const store = await getAuthStore();
    store.set('loginState', state);
  }

  async getState(): Promise<AuthState> {
    const [tokens, user, loginState] = await Promise.all([
      this.getTokens(),
      this.getUser(),
      this.getLoginState(),
    ]);

    return {
      tokens,
      user,
      loginState,
    };
  }

  async clearAll(): Promise<void> {
    const store = await getAuthStore();
    store.clear();
  }
}

const authStore = new AuthStore();

export function getAuthStoreService(): AuthStore {
  return authStore;
}
