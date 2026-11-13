import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  PageHeader,
  RefreshIcon,
  Spinner,
  WifiOffIcon,
  type StatusTone,
} from '../../components/ui';
import { getCurrentLocale } from '../../i18n';
import { getApiBaseUrl, isApiRequestError } from '../../lib/api';
import { cx } from '../../lib/cx';
import { describeError } from '../../lib/errors';
import { useOnlineStatus } from '../../lib/hooks/useOnlineStatus';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import {
  getOverallState,
  getProbeState,
  useHealthProbe,
  type HealthProbe,
  type OverallState,
  type ProbeState,
} from './health';

const PROBE_TONES: Record<ProbeState, StatusTone> = {
  checking: 'neutral',
  ok: 'success',
  notReady: 'warning',
  unreachable: 'danger',
  offline: 'warning',
  error: 'danger',
};

const OVERALL_TONES: Record<OverallState, StatusTone> = {
  checking: 'neutral',
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
  offline: 'warning',
};

const SUMMARY_CLASSES: Record<StatusTone, string> = {
  success: 'border-success bg-success-surface text-success-fg',
  warning: 'border-warning bg-warning-surface text-warning-fg',
  danger: 'border-danger bg-danger-surface text-danger-fg',
  info: 'border-info bg-info-surface text-info-fg',
  neutral: 'border-neutral bg-neutral-surface text-neutral-fg',
};

interface ProbeRowProps {
  probe: HealthProbe;
  state: ProbeState;
  error: unknown;
}

function ProbeRow({ probe, state, error }: ProbeRowProps) {
  const { t } = useTranslation();

  let detail: string | undefined;
  if (state === 'notReady') detail = t('systemStatus.notReadyDetail');
  else if (state === 'offline') detail = t('errors.offline');
  else if (state === 'unreachable' || state === 'error') detail = describeError(error, t);

  const requestId = isApiRequestError(error) && state !== 'ok' ? error.requestId : undefined;

  return (
    <li
      data-testid={`probe-${probe}`}
      data-state={state}
      className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
    >
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-fg">{t(`systemStatus.${probe}.title`)}</h3>
        <p className="text-base text-fg-muted">{t(`systemStatus.${probe}.description`)}</p>
        {detail ? <p className="mt-1 text-base font-medium text-fg">{detail}</p> : null}
        {requestId ? (
          <p className="mt-1 font-mono text-sm break-all text-fg-muted">
            {t('common.reference', { id: requestId })}
          </p>
        ) : null}
      </div>
      <Badge
        tone={PROBE_TONES[state]}
        className="shrink-0 self-start"
        icon={
          state === 'checking' ? (
            <Spinner size="sm" />
          ) : state === 'offline' ? (
            <WifiOffIcon className="size-4 shrink-0" />
          ) : undefined
        }
      >
        {t(`systemStatus.state.${state}`)}
      </Badge>
    </li>
  );
}

function lastCheckedAt(queries: Array<UseQueryResult<true>>): number {
  return Math.max(...queries.flatMap((query) => [query.dataUpdatedAt, query.errorUpdatedAt]));
}

/**
 * Live proof that the web app can talk to the API: probes `/health/live` and
 * `/health/ready` and reports loading, success, degraded, unreachable and offline states.
 */
export default function SystemStatusPage() {
  const { t } = useTranslation();
  usePageTitle(t('systemStatus.title'));

  const online = useOnlineStatus();
  const live = useHealthProbe('live');
  const ready = useHealthProbe('ready');

  const liveState = getProbeState('live', live, online);
  const readyState = getProbeState('ready', ready, online);
  const overall = getOverallState(liveState, readyState);
  const checking = live.isFetching || ready.isFetching;

  const checkedAt = lastCheckedAt([live, ready]);
  const checkedAtLabel =
    checkedAt > 0
      ? new Intl.DateTimeFormat(getCurrentLocale(), { timeStyle: 'medium' }).format(checkedAt)
      : undefined;

  const recheck = () => {
    void live.refetch();
    void ready.refetch();
  };

  return (
    <>
      <PageHeader
        title={t('systemStatus.title')}
        description={t('systemStatus.description')}
        actions={
          <Button
            onClick={recheck}
            loading={checking}
            icon={<RefreshIcon className="size-5" />}
            className="w-full sm:w-auto"
          >
            {checking ? t('systemStatus.checking') : t('systemStatus.refresh')}
          </Button>
        }
      />

      <div className="flex flex-col gap-4 md:gap-6">
        <div
          role="status"
          data-testid="overall-status"
          data-state={overall}
          className={cx(
            'rounded-card border-2 p-4 text-lg font-semibold sm:px-6',
            SUMMARY_CLASSES[OVERALL_TONES[overall]],
          )}
        >
          <p>{t(`systemStatus.summary.${overall}`)}</p>
          {checkedAtLabel && !checking ? (
            <p className="mt-1 text-sm font-normal">
              {t('systemStatus.lastChecked', { time: checkedAtLabel })}
            </p>
          ) : null}
        </div>

        <Card title={t('systemStatus.checksTitle')}>
          <ul className="divide-y divide-line">
            <ProbeRow probe="live" state={liveState} error={live.error} />
            <ProbeRow probe="ready" state={readyState} error={ready.error} />
          </ul>
        </Card>

        <Card title={t('systemStatus.apiUrl')}>
          <p className="font-mono text-base break-all text-fg">{getApiBaseUrl()}</p>
        </Card>
      </div>
    </>
  );
}
