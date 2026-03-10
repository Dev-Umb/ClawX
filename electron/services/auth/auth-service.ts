import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { shell } from 'electron';
import { logger } from '../../utils/logger';
import { getSetting } from '../../utils/store';
import { getAuthStoreService } from './auth-store';
import { TokenRefreshScheduler } from './token-refresh';
import type { AuthStatus, AuthTokens, UserProfile } from './types';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
};

type AuthChangedPayload = {
  authenticated: boolean;
  user: UserProfile | null;
  accessToken: string | null;
};

const DEFAULT_AUTH_SERVER_URL = 'http://127.0.0.1:8000';
const DEFAULT_CLIENT_ID = process.env.CLAWX_SSO_CLIENT_ID || 'clawx';
const DEFAULT_REDIRECT_URI = 'clawx://auth/callback';
const DEFAULT_DEV_CLIENT_SECRET = 'clawx-local-secret';

export class AuthService extends EventEmitter {
  private refreshInFlight: Promise<boolean> | null = null;

  private readonly authStore = getAuthStoreService();

  private readonly refreshScheduler = new TokenRefreshScheduler(this);

  async initialize(): Promise<void> {
    const tokens = await this.authStore.getTokens();
    if (!tokens) {
      return;
    }

    if (Date.now() >= tokens.expiresAt) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) {
        await this.logout();
        return;
      }
    } else {
      this.refreshScheduler.start();
    }
  }

  async initiateLogin(): Promise<void> {
    const existingState = await this.authStore.getLoginState();
    const state = existingState || randomUUID();
    if (!existingState) {
      await this.authStore.setLoginState(state);
    }

    const authServerUrl = await this.getAuthServerUrl();
    const clientId = this.getClientId();
    const loginUrl = new URL('/sso/login', authServerUrl);
    loginUrl.searchParams.set('client_id', clientId);
    loginUrl.searchParams.set('redirect_uri', DEFAULT_REDIRECT_URI);
    loginUrl.searchParams.set('state', state);

    await shell.openExternal(loginUrl.toString());
  }

  async exchangeCode(code: string, state: string): Promise<void> {
    const expectedState = await this.authStore.getLoginState();
    if (!expectedState || expectedState !== state) {
      throw new Error('SSO state mismatch, please retry login');
    }

    const tokenPayload = await this.requestJson<TokenResponse>('/api/v1/sso/token', {
      method: 'POST',
      body: {
        code,
        client_id: this.getClientId(),
        client_secret: this.getClientSecret(),
      },
      withAuth: false,
    });

    if (!tokenPayload.access_token || !tokenPayload.refresh_token) {
      throw new Error('Invalid token payload returned by auth server');
    }

    const tokens: AuthTokens = {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      expiresAt: Date.now() + tokenPayload.expires_in * 1000,
    };

    await this.authStore.setTokens(tokens);
    await this.authStore.setLoginState(null);
    await this.fetchUserProfile();
    this.refreshScheduler.start();
    await this.emitChanged();
  }

  async fetchUserProfile(): Promise<UserProfile | null> {
    const payload = await this.requestJson<Record<string, unknown>>('/api/v1/me', {
      method: 'GET',
      withAuth: true,
    });

    const userData = this.extractUserPayload(payload);
    if (!userData) {
      throw new Error('Invalid user profile payload from auth server');
    }

    const user: UserProfile = {
      id: String(userData.id ?? ''),
      name: String(userData.name ?? ''),
      email: String(userData.email ?? ''),
      avatarUrl: userData.avatar_url ? String(userData.avatar_url) : undefined,
      phone: userData.phone ? String(userData.phone) : undefined,
    };

    await this.authStore.setUser(user);
    return user;
  }

  async refreshAccessToken(): Promise<boolean> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.doRefreshAccessToken();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  async logout(): Promise<void> {
    this.refreshScheduler.stop();
    await this.authStore.clearTokens();
    await this.authStore.setUser(null);
    await this.authStore.setLoginState(null);
    await this.emitChanged();
  }

  async getAuthStatus(): Promise<AuthStatus> {
    const tokens = await this.authStore.getTokens();
    const user = await this.authStore.getUser();
    if (!tokens || Date.now() >= tokens.expiresAt) {
      return { authenticated: false, user: null, accessToken: null };
    }

    return {
      authenticated: true,
      user,
      accessToken: tokens.accessToken,
    };
  }

  async isAuthenticated(): Promise<boolean> {
    const status = await this.getAuthStatus();
    return status.authenticated;
  }

  async getTokens(): Promise<AuthTokens | null> {
    return this.authStore.getTokens();
  }

  private async doRefreshAccessToken(): Promise<boolean> {
    const tokens = await this.authStore.getTokens();
    if (!tokens?.refreshToken) {
      return false;
    }

    try {
      const payload = await this.requestJson<TokenResponse>('/api/v1/refresh', {
        method: 'POST',
        body: {
          refresh_token: tokens.refreshToken,
        },
        withAuth: false,
      });

      const nextTokens: AuthTokens = {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + payload.expires_in * 1000,
      };

      await this.authStore.setTokens(nextTokens);
      await this.emitChanged();
      return true;
    } catch (error) {
      logger.warn('refreshAccessToken failed:', error);
      return false;
    }
  }

  private async emitChanged(): Promise<void> {
    const status = await this.getAuthStatus();
    const payload: AuthChangedPayload = {
      authenticated: status.authenticated,
      user: status.user,
      accessToken: status.accessToken || null,
    };
    this.emit('changed', payload);
  }

  private async getAuthServerUrl(): Promise<string> {
    try {
      const value = await getSetting('authServerUrl');
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    } catch {
      // Ignore unknown setting key errors on older installations.
    }
    return process.env.CLAWX_AUTH_SERVER_URL || DEFAULT_AUTH_SERVER_URL;
  }

  private getClientId(): string {
    return process.env.CLAWX_SSO_CLIENT_ID || DEFAULT_CLIENT_ID;
  }

  private getClientSecret(): string {
    const clientSecret = process.env.CLAWX_SSO_CLIENT_SECRET || DEFAULT_DEV_CLIENT_SECRET;
    if (!clientSecret) {
      logger.warn('CLAWX_SSO_CLIENT_SECRET is not configured');
    }
    return clientSecret;
  }

  private extractUserPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
    if ('id' in payload && 'email' in payload) {
      return payload;
    }

    const nestedData = payload.data;
    if (nestedData && typeof nestedData === 'object') {
      const record = nestedData as Record<string, unknown>;
      if ('id' in record && 'email' in record) {
        return record;
      }
    }

    return null;
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: Record<string, unknown>;
      withAuth: boolean;
      retryOnUnauthorized?: boolean;
    },
  ): Promise<T> {
    const authServerUrl = await this.getAuthServerUrl();
    const url = new URL(path, authServerUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (options.withAuth) {
      const tokens = await this.authStore.getTokens();
      if (!tokens?.accessToken) {
        throw new Error('No access token available');
      }
      headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    const response = await fetch(url.toString(), {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && options.withAuth && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) {
        throw new Error('Authentication expired, please login again');
      }
      return this.requestJson<T>(path, { ...options, retryOnUnauthorized: false });
    }

    const json = await response.json().catch(() => ({})) as ApiEnvelope<T>;

    if (!response.ok || json.success === false) {
      const errorMessage = json.message || `Request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    if (json.data === undefined) {
      throw new Error('Auth server returned empty response data');
    }

    return json.data;
  }
}

const authService = new AuthService();

export function getAuthService(): AuthService {
  return authService;
}
