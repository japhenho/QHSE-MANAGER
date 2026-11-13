import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Page-level actions, shown on the right on wide screens and below the title on phones. */
  actions?: ReactNode;
}

/** Every page starts with exactly one `PageHeader`: it owns the page's `<h1>`. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-balance text-fg sm:text-3xl">
          {title}
        </h1>
        {description ? <p className="mt-1 text-base text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
