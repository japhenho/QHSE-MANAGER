import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  DotIcon,
  InfoIcon,
  XCircleIcon,
  type IconComponent,
} from './icons';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<StatusTone, string> = {
  success: 'border-success bg-success-surface text-success-fg',
  warning: 'border-warning bg-warning-surface text-warning-fg',
  danger: 'border-danger bg-danger-surface text-danger-fg',
  info: 'border-info bg-info-surface text-info-fg',
  neutral: 'border-neutral bg-neutral-surface text-neutral-fg',
};

/** Each tone has its own icon so status is never conveyed by colour alone. */
const TONE_ICONS: Record<StatusTone, IconComponent> = {
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  danger: XCircleIcon,
  info: InfoIcon,
  neutral: DotIcon,
};

interface BadgeProps {
  tone?: StatusTone;
  /** Replaces the default tone icon (e.g. a spinner while checking). */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Status label used across QHSE screens. */
export function Badge({ tone = 'neutral', icon, className, children }: BadgeProps) {
  const ToneIcon = TONE_ICONS[tone];
  return (
    <span
      className={cx(
        'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-0.5 text-sm font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon ?? <ToneIcon className="size-4 shrink-0" />}
      {children}
    </span>
  );
}
