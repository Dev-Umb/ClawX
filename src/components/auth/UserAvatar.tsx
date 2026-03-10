import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'md';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join('');
  return initials || 'U';
}

export function UserAvatar({ name, avatarUrl, size = 'md' }: UserAvatarProps) {
  const sizeClass = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn('rounded-full object-cover', sizeClass)}
      />
    );
  }

  return (
    <div className={cn(
      'flex items-center justify-center rounded-full bg-primary/15 text-primary font-semibold',
      sizeClass,
    )}
    >
      {name ? getInitials(name) : <User className="h-4 w-4" />}
    </div>
  );
}
