import type { ReactNode } from 'react';
import { InboxIcon, type IconComponent } from './icons';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: IconComponent;
  action?: ReactNode;
}

/** Explicit "nothing here" block for lists, tables and sections without data. */
export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-control border-2 border-dashed border-line-strong bg-page px-4 py-8 text-center">
      <Icon className="size-10 text-fg-muted" />
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-prose text-base text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
