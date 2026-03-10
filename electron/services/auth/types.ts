export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  phone?: string;
}

export interface AuthState {
  tokens: AuthTokens | null;
  user: UserProfile | null;
  loginState: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  user: UserProfile | null;
  accessToken?: string | null;
}
