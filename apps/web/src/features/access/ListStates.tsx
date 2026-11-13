import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { describeAccessError } from './labels';

interface ListStatesProps {
  isPending: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  onRetry: () => void;
  children: ReactNode;
}

/** The three states every list must handle before showing rows: loading, error, empty. */
export function ListStates({
  isPending,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  onRetry,
  children,
}: ListStatesProps) {
  const { t } = useTranslation();
  if (isPending) return <LoadingState label={t('app.loading')} />;
  if (error) {
    return (
      <ErrorState
        title={t('errors.title')}
        description={describeAccessError(error, t)}
        action={<Button onClick={onRetry}>{t('common.retry')}</Button>}
      />
    );
  }
  if (isEmpty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}
