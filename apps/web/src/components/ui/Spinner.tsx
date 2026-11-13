import { cx } from '../../lib/cx';

interface SpinnerProps {
  /** Accessible label announced to assistive technologies. Omit when adjacent text already says it. */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'size-4 border-2', md: 'size-6 border-[3px]', lg: 'size-10 border-4' } as const;

export function Spinner({ label, size = 'md', className }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className={cx('inline-flex', className)}>
      <span
        aria-hidden="true"
        className={cx(
          'inline-block animate-spin rounded-full border-current border-r-transparent',
          SIZES[size],
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Centered loading block for a page or a panel. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-fg-muted"
    >
      <Spinner size="lg" className="text-primary" />
      <p className="text-base font-medium">{label}</p>
    </div>
  );
}
