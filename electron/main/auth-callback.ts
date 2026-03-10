import type { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import type { AuthService } from '../services/auth/auth-service';

export function extractDeepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith('clawx://')) {
      return arg;
    }
  }
  return null;
}

export function parseAuthCallback(urlString: string): { code: string; state: string } | null {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'clawx:' || parsed.hostname !== 'auth' || parsed.pathname !== '/callback') {
      return null;
    }

    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    if (!code || !state) {
      return null;
    }

    return { code, state };
  } catch {
    return null;
  }
}

export async function handleAuthCallback(
  urlString: string,
  authService: AuthService,
  mainWindow: BrowserWindow | null,
): Promise<void> {
  const params = parseAuthCallback(urlString);
  if (!params) {
    return;
  }

  try {
    await authService.exchangeCode(params.code, params.state);
  } catch (error) {
    logger.warn('Failed to exchange SSO callback code:', error);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}
