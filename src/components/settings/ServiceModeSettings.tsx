import { Cloud, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from 'react-i18next';

export function ServiceModeSettings() {
  const { t } = useTranslation('settings');
  const serviceMode = useSettingsStore((state) => state.serviceMode);
  const setServiceMode = useSettingsStore((state) => state.setServiceMode);
  const authStatus = useAuthStore((state) => state.status);
  const authUser = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);

  return (
    <Card className="order-1">
      <CardHeader>
        <CardTitle>{t('serviceMode.title')}</CardTitle>
        <CardDescription>{t('serviceMode.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="radio"
            className="mt-1"
            checked={serviceMode === 'cloud'}
            onChange={() => setServiceMode('cloud')}
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              <Label>{t('serviceMode.cloud.title')}</Label>
            </div>
            <p className="text-sm text-muted-foreground">{t('serviceMode.cloud.description')}</p>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="radio"
            className="mt-1"
            checked={serviceMode === 'local'}
            onChange={() => setServiceMode('local')}
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              <Label>{t('serviceMode.local.title')}</Label>
            </div>
            <p className="text-sm text-muted-foreground">{t('serviceMode.local.description')}</p>
          </div>
        </label>

        {serviceMode === 'cloud' && (
          <div className="rounded-lg border bg-muted/30 p-3">
            {authStatus === 'authenticated' && authUser ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {t('serviceMode.cloud.loggedInAs', { email: authUser.email })}
                </p>
                <Button variant="outline" size="sm" onClick={() => { void logout(); }}>
                  {t('serviceMode.cloud.logout')}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{t('serviceMode.cloud.loginHint')}</p>
                <Button size="sm" onClick={() => { void login(); }}>
                  {t('serviceMode.cloud.login')}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
