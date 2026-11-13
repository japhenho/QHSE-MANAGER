import type { AuditEventView } from '@qhse/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PageHeader, Pagination } from '../../components/ui';
import { getCurrentLocale } from '../../i18n';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import { accessKeys, type AuditFilters, listAuditEvents, PAGE_SIZE } from './api';
import { ListStates } from './ListStates';

const FIELD_CLASSES =
  'min-h-touch w-full rounded-control border-2 border-line-strong bg-surface-sunken px-3 text-base text-fg';

const NO_FILTER: AuditFilters = { page: 1, action: '', from: '', to: '' };

/** A `datetime-local` value is local time without zone: convert it to an absolute instant. */
function toIso(local: string): string {
  if (local === '') return '';
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function describeTarget(event: AuditEventView): string {
  if (!event.resourceType) return '—';
  return event.resourceId
    ? `${event.resourceType} ${event.resourceId.slice(-8)}`
    : event.resourceType;
}

function describeMetadata(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  usePageTitle(t('auditLog.title'));
  const formId = useId();

  const [draft, setDraft] = useState({ action: '', from: '', to: '' });
  const [filters, setFilters] = useState<AuditFilters>(NO_FILTER);
  const events = useQuery({
    queryKey: accessKeys.auditEvents(filters),
    queryFn: ({ signal }) => listAuditEvents(filters, signal),
    placeholderData: keepPreviousData,
    // A journal is read fresh: never show a cached page as if it were current.
    staleTime: 0,
  });

  const formatter = new Intl.DateTimeFormat(getCurrentLocale(), {
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({
      page: 1,
      action: draft.action.trim(),
      from: toIso(draft.from),
      to: toIso(draft.to),
    });
  }

  return (
    <>
      <PageHeader title={t('auditLog.title')} description={t('auditLog.description')} />

      <form
        onSubmit={onSubmit}
        className="mb-4 grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${formId}-action`} className="text-sm font-semibold text-fg">
            {t('auditLog.filterAction')}
          </label>
          <input
            id={`${formId}-action`}
            className={FIELD_CLASSES}
            placeholder={t('auditLog.filterActionHint')}
            maxLength={100}
            autoCapitalize="none"
            spellCheck={false}
            value={draft.action}
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${formId}-from`} className="text-sm font-semibold text-fg">
            {t('auditLog.filterFrom')}
          </label>
          <input
            id={`${formId}-from`}
            type="datetime-local"
            className={FIELD_CLASSES}
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${formId}-to`} className="text-sm font-semibold text-fg">
            {t('auditLog.filterTo')}
          </label>
          <input
            id={`${formId}-to`}
            type="datetime-local"
            className={FIELD_CLASSES}
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit">{t('auditLog.apply')}</Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({ action: '', from: '', to: '' });
              setFilters(NO_FILTER);
            }}
          >
            {t('auditLog.reset')}
          </Button>
        </div>
      </form>

      <ListStates
        isPending={events.isPending}
        error={events.error}
        isEmpty={events.data?.items.length === 0}
        emptyTitle={t('auditLog.emptyTitle')}
        emptyDescription={t('auditLog.emptyBody')}
        onRetry={() => void events.refetch()}
      >
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-line tracking-wide text-fg-muted uppercase">
              <tr>
                {(
                  [
                    'auditLog.columnWhen',
                    'auditLog.columnWho',
                    'auditLog.columnAction',
                    'auditLog.columnTarget',
                    'auditLog.columnDetail',
                  ] as const
                ).map((key) => (
                  <th key={key} scope="col" className="px-3 py-3 font-semibold">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.data?.items.map((event) => (
                <tr key={event.id} className="border-b border-line align-top last:border-b-0">
                  <td className="px-3 py-2.5 font-mono whitespace-nowrap text-fg">
                    <time dateTime={event.occurredAt}>
                      {formatter.format(new Date(event.occurredAt))}
                    </time>
                  </td>
                  <td className="px-3 py-2.5 break-all text-fg">
                    {event.actorType === 'SYSTEM'
                      ? t('auditLog.system')
                      : (event.actorEmail ?? '—')}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-fg">{event.action}</td>
                  <td className="px-3 py-2.5 font-mono text-fg-muted">{describeTarget(event)}</td>
                  <td className="px-3 py-2.5 text-fg-muted">
                    {event.fromStatus && event.toStatus ? (
                      <p className="text-fg">
                        {t('auditLog.transition', { from: event.fromStatus, to: event.toStatus })}
                      </p>
                    ) : null}
                    {event.reason ? <p>{event.reason}</p> : null}
                    <p className="break-words">{describeMetadata(event.metadata)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={events.data?.total ?? 0}
          onChange={(page) => setFilters({ ...filters, page })}
        />
      </ListStates>
    </>
  );
}
