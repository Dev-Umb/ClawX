import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

type CallbackBody = {
  code?: string;
  state?: string;
};

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const status = await ctx.authService.getAuthStatus();
    sendJson(res, 200, status);
    return true;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      await ctx.authService.initiateLogin();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/auth/callback' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<CallbackBody>(req);
      if (!body.code || !body.state) {
        sendJson(res, 400, { success: false, error: 'Missing code or state' });
        return true;
      }

      await ctx.authService.exchangeCode(body.code, body.state);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/auth/refresh' && req.method === 'POST') {
    try {
      const refreshed = await ctx.authService.refreshAccessToken();
      if (!refreshed) {
        sendJson(res, 401, { success: false, error: 'Refresh token is invalid or expired' });
        return true;
      }

      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    await ctx.authService.logout();
    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}
