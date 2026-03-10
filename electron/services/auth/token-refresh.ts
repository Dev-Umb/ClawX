import type { AuthService } from './auth-service';
import { logger } from '../../utils/logger';

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MIN_REFRESH_DELAY_MS = 5 * 1000;

export class TokenRefreshScheduler {
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly authService: AuthService) {}

  start(): void {
    this.stop();
    void this.scheduleNextRefresh();
  }

  stop(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async triggerRefreshIfNeeded(): Promise<void> {
    const tokens = await this.authService.getTokens();
    if (!tokens) {
      return;
    }

    if (Date.now() >= tokens.expiresAt - REFRESH_BUFFER_MS) {
      await this.safeRefresh();
    }
  }

  private async scheduleNextRefresh(): Promise<void> {
    const tokens = await this.authService.getTokens();
    if (!tokens) {
      return;
    }

    const delay = Math.max(tokens.expiresAt - Date.now() - REFRESH_BUFFER_MS, MIN_REFRESH_DELAY_MS);
    this.refreshTimer = setTimeout(() => {
      void this.safeRefresh();
    }, delay);
  }

  private async safeRefresh(): Promise<void> {
    try {
      const refreshed = await this.authService.refreshAccessToken();
      if (!refreshed) {
        await this.authService.logout();
        return;
      }
    } catch (error) {
      logger.warn('Token refresh failed, keeping current auth state:', error);
    } finally {
      await this.scheduleNextRefresh();
    }
  }
}
