import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from 'react-i18next';

interface LoginButtonProps {
  className?: string;
}

export function LoginButton({ className }: LoginButtonProps) {
  const { t } = useTranslation('common');
  const login = useAuthStore((state) => state.login);
  const status = useAuthStore((state) => state.status);

  const handleLogin = async () => {
    await login();
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => { void handleLogin(); }}
      disabled={status === 'loading'}
    >
      <LogIn className="mr-2 h-4 w-4" />
      {status === 'loading' ? t('auth.loggingIn') : t('auth.login')}
    </Button>
  );
}
