import { useTranslation } from 'react-i18next';
import { Button } from './Button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

/** Previous / next controls with the position in the list. Hidden when everything fits on one page. */
export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  return (
    <nav
      aria-label={t('access.pagination.label')}
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-fg-muted" aria-live="polite">
        {t('access.pagination.status', { page, pages, total })}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          {t('access.pagination.previous')}
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          {t('access.pagination.next')}
        </Button>
      </div>
    </nav>
  );
}
