import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

interface CardProps {
  title?: string;
  /** Content aligned with the title (badge, action). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Titled content panel. Rendered as a labelled `<section>` when it has a title. */
export function Card({ title, aside, className, children }: CardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cx('rounded-card border border-line bg-surface p-4 shadow-card sm:p-6', className)}
    >
      {title ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id={titleId} className="text-lg font-semibold text-fg">
            {title}
          </h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}
