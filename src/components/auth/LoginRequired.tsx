import { Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginButton } from './LoginButton';
import { useTranslation } from 'react-i18next';

interface LoginRequiredProps {
  className?: string;
}

export function LoginRequired({ className }: LoginRequiredProps) {
  const { t } = useTranslation('common');

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" />
          {t('auth.loginRequired')}
        </CardTitle>
        <CardDescription>{t('auth.loginRequiredDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginButton className="w-full" />
      </CardContent>
    </Card>
  );
}
