import type { ReactNode } from 'react';
import { AlertTriangleIcon } from './icons';

interface ErrorStateProps {
  title: string;
  description?: string;
  /** Extra line such as a support reference. */
  detail?: string;
  action?: ReactNode;
}

/** Blocking error for a page or a panel. Announced immediately (`role="alert"`). */
export function ErrorState({ title, description, detail, action }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border-2 border-danger bg-danger-surface p-4 text-danger-fg sm:flex-row sm:p-6"
    >
      <AlertTriangleIcon className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{title}</p>
        {description ? <p className="mt-1 text-base">{description}</p> : null}
        {detail ? <p className="mt-1 font-mono text-sm break-all">{detail}</p> : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}
