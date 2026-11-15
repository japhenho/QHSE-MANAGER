import {
  COUNTRY_CODES,
  createCompanySchema,
  createDepartmentSchema,
  createSiteSchema,
  listCurrencies,
  listTimeZones,
  PERMISSIONS,
} from '@qhse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, buttonClasses, PageHeader } from '../../components/ui';
import { getCurrentLocale } from '../../i18n';
import { usePermissions } from '../../lib/auth';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import { useUnsavedChangesWarning } from '../../lib/hooks/useUnsavedChangesWarning';
import { ListStates } from '../access/ListStates';
import {
  createEntity,
  getEntity,
  listOptions,
  organizationKeys,
  setArchived,
  updateEntity,
} from './api';
import {
  detailPath,
  EMPTY_VALUES,
  ENTITIES,
  type EntityKind,
  type EntityView,
  type FieldName,
  type FormValues,
  valuesOf,
} from './entities';
import { describeOrganizationError } from './errors';

const INPUT_CLASSES =
  'min-h-touch-lg w-full rounded-control border-2 border-line-strong bg-surface-sunken px-3 text-base text-fg ' +
  'disabled:opacity-70 aria-invalid:border-danger';

const CREATE_SCHEMAS = {
  companies: createCompanySchema,
  sites: createSiteSchema,
  departments: createDepartmentSchema,
} as const;

const FIELD_LABELS = {
  companyId: 'organization.fields.company',
  siteId: 'organization.fields.site',
  code: 'organization.fields.code',
  name: 'organization.fields.name',
  countryCode: 'organization.fields.country',
  timeZone: 'organization.fields.timeZone',
  currencyCode: 'organization.fields.currency',
} as const satisfies Record<FieldName, string>;

const FIELD_HINTS: Partial<
  Record<FieldName, 'organization.fields.codeHint' | 'organization.fields.timeZoneHint'>
> = {
  code: 'organization.fields.codeHint',
  timeZone: 'organization.fields.timeZoneHint',
};

/** `/…/new` creates a record; `/…/:id` shows and edits one. */
export function OrganizationFormPage({ kind }: { kind: EntityKind }) {
  const { t } = useTranslation();
  const { id } = useParams();
  const entity = useQuery({
    queryKey: organizationKeys.detail(kind, id ?? ''),
    queryFn: ({ signal }) => getEntity(kind, id ?? '', signal),
    enabled: id !== undefined,
    // The form is filled once from this data: never refresh it under the user's hands.
    staleTime: Infinity,
    gcTime: 0,
  });
  usePageTitle(
    id === undefined
      ? t(`organization.${kind}.newTitle`)
      : t(`organization.${kind}.editTitle`, { name: entity.data?.name ?? '…' }),
  );

  if (id === undefined) return <EntityForm key="new" kind={kind} />;
  return (
    <ListStates
      isPending={entity.isPending}
      error={entity.error}
      isEmpty={false}
      emptyTitle=""
      onRetry={() => void entity.refetch()}
    >
      {entity.data ? (
        <EntityForm
          key={`${entity.data.id}:${String(entity.data.version)}`}
          kind={kind}
          entity={entity.data}
        />
      ) : null}
    </ListStates>
  );
}

function EntityForm({ kind, entity }: { kind: EntityKind; entity?: EntityView }) {
  const { t } = useTranslation();
  const can = usePermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formId = useId();
  const config = ENTITIES[kind];
  const locale = getCurrentLocale();

  const initial = useMemo(() => (entity ? valuesOf(entity) : EMPTY_VALUES), [entity]);
  const [values, setValues] = useState<FormValues>(initial);
  // What is known to be saved: the form is "dirty" when it differs from it.
  const [baseline, setBaseline] = useState<FormValues>(initial);
  const [invalid, setInvalid] = useState<ReadonlySet<FieldName>>(new Set());
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [saved, setSaved] = useState(false);

  const archived = entity?.archivedAt != null;
  const canManage = can(PERMISSIONS.ORGANIZATION_MANAGE);
  const editable = canManage && !archived;
  const dirty = config.fields.some((field) => values[field] !== baseline[field]);

  const parentKind: EntityKind | undefined =
    config.parent === 'companyId' ? 'companies' : config.parent === 'siteId' ? 'sites' : undefined;
  const parents = useQuery({
    queryKey: [...organizationKeys.all(parentKind ?? kind), 'options'],
    queryFn: ({ signal }) => listOptions(parentKind ?? kind, signal),
    enabled: parentKind !== undefined && entity === undefined,
  });

  const selectOptions = useMemo(() => {
    const regions = new Intl.DisplayNames([locale], { type: 'region' });
    const currencies = new Intl.DisplayNames([locale], { type: 'currency' });
    const byLabel = (x: { label: string }, y: { label: string }) =>
      x.label.localeCompare(y.label, locale);
    return {
      countryCode: COUNTRY_CODES.map((code) => ({
        value: code,
        label: regions.of(code) ?? code,
      })).sort(byLabel),
      timeZone: listTimeZones().map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') })),
      currencyCode: listCurrencies()
        .map((code) => ({ value: code, label: `${code} — ${currencies.of(code) ?? code}` }))
        .sort(byLabel),
    };
  }, [locale]);

  const { blocker, allowNextNavigation } = useUnsavedChangesWarning(dirty && editable);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['organization'] });

  const save = useMutation({
    mutationFn: (body: Record<string, string>) => {
      if (!entity) return createEntity(kind, body);
      // Send only what changed, with the version that was read. The parent never changes.
      const changes = Object.fromEntries(
        config.fields
          .filter((field) => field !== config.parent && body[field] !== initial[field])
          .map((field) => [field, body[field]]),
      );
      return updateEntity(kind, entity.id, { ...changes, version: entity.version });
    },
    onSuccess: async (result) => {
      await invalidate();
      queryClient.setQueryData(organizationKeys.detail(kind, result.id), result);
      setSaved(true);
      setValues(valuesOf(result));
      setBaseline(valuesOf(result));
      if (!entity) {
        // The input was just saved: going to the created record loses nothing.
        allowNextNavigation();
        void navigate(detailPath(kind, result.id), { replace: true });
      }
    },
  });

  const archive = useMutation({
    mutationFn: (toArchived: boolean) => setArchived(kind, entity?.id ?? '', toArchived),
    onSuccess: async (result) => {
      await invalidate();
      queryClient.setQueryData(organizationKeys.detail(kind, result.id), result);
      setConfirmingArchive(false);
    },
  });

  function set(field: FieldName, value: string) {
    setSaved(false);
    setValues((current) => ({ ...current, [field]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const candidate = Object.fromEntries(config.fields.map((field) => [field, values[field]]));
    const parsed = CREATE_SCHEMAS[kind].safeParse(candidate);
    if (!parsed.success) {
      setInvalid(new Set(parsed.error.issues.map((issue) => issue.path[0] as FieldName)));
      return;
    }
    setInvalid(new Set());
    save.mutate(parsed.data as Record<string, string>);
  }

  const error = save.error ?? archive.error;
  const busy = save.isPending || archive.isPending;
  const title = entity
    ? t(`organization.${kind}.editTitle`, { name: entity.name })
    : t(`organization.${kind}.newTitle`);

  function renderField(field: FieldName) {
    const inputId = `${formId}-${field}`;
    const hint = FIELD_HINTS[field];
    const isInvalid = invalid.has(field);
    const common = {
      id: inputId,
      className: INPUT_CLASSES,
      disabled: !editable || busy,
      'aria-invalid': isInvalid || undefined,
      'aria-describedby': isInvalid || hint ? `${inputId}-help` : undefined,
    };
    let control;
    if (field === config.parent) {
      const parentName = entity
        ? ((entity as { companyName?: string; siteName?: string }).companyName ??
          (entity as { siteName?: string }).siteName ??
          '')
        : undefined;
      control =
        parentName !== undefined ? (
          // The parent is fixed at creation.
          <input {...common} value={parentName} disabled readOnly />
        ) : (
          <select
            {...common}
            value={values[field]}
            onChange={(event) => set(field, event.target.value)}
          >
            <option value="">{t('organization.fields.choose')}</option>
            {parents.data?.items.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </select>
        );
    } else if (field === 'countryCode' || field === 'timeZone' || field === 'currencyCode') {
      control = (
        <select
          {...common}
          value={values[field]}
          onChange={(event) => set(field, event.target.value)}
        >
          <option value="">{t('organization.fields.choose')}</option>
          {selectOptions[field].map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    } else {
      control = (
        <input
          {...common}
          value={values[field]}
          maxLength={field === 'code' ? 20 : 120}
          autoCapitalize={field === 'code' ? 'characters' : undefined}
          spellCheck={field === 'code' ? false : undefined}
          onChange={(event) => set(field, event.target.value)}
        />
      );
    }
    return (
      <div key={field} className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="font-semibold text-fg">
          {t(FIELD_LABELS[field])}
        </label>
        {control}
        {isInvalid ? (
          <p id={`${inputId}-help`} className="text-sm text-danger-fg">
            {t(`organization.fieldErrors.${field}`)}
          </p>
        ) : hint ? (
          <p id={`${inputId}-help`} className="text-sm text-fg-muted">
            {t(hint)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <Link to={config.listPath} className={buttonClasses({ variant: 'secondary' })}>
            {t(`organization.${kind}.back`)}
          </Link>
        }
      />

      {blocker.state === 'blocked' ? (
        <div
          role="alertdialog"
          aria-labelledby={`${formId}-unsaved-title`}
          aria-describedby={`${formId}-unsaved-body`}
          className="mb-4 rounded-card border-2 border-warning bg-warning-surface p-4 text-warning-fg"
        >
          <p id={`${formId}-unsaved-title`} className="text-lg font-semibold">
            {t('organization.unsaved.title')}
          </p>
          <p id={`${formId}-unsaved-body`}>{t('organization.unsaved.body')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button autoFocus onClick={() => blocker.reset()}>
              {t('organization.unsaved.stay')}
            </Button>
            <Button variant="secondary" onClick={() => blocker.proceed()}>
              {t('organization.unsaved.leave')}
            </Button>
          </div>
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-5 rounded-card border border-line bg-surface p-4 sm:p-6"
      >
        {archived ? (
          <p className="rounded-control border-2 border-info bg-info-surface px-3 py-2 text-info-fg">
            {t('organization.archivedNotice')}
          </p>
        ) : !canManage ? (
          <p className="rounded-control border-2 border-info bg-info-surface px-3 py-2 text-info-fg">
            {t('organization.readOnly')}
          </p>
        ) : null}

        <div role="alert">
          {error || invalid.size > 0 ? (
            <p className="rounded-control border-2 border-danger bg-danger-surface px-3 py-2 font-medium text-danger-fg">
              {error ? describeOrganizationError(error, t) : t('organization.invalid')}
            </p>
          ) : null}
        </div>
        <div role="status">
          {saved && !error ? (
            <p className="rounded-control border-2 border-success bg-success-surface px-3 py-2 font-medium text-success-fg">
              {t('organization.saved')}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">{config.fields.map(renderField)}</div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {editable ? (
              <Button
                type="submit"
                loading={save.isPending}
                disabled={entity !== undefined && !dirty}
              >
                {save.isPending ? t('organization.saving') : t('organization.save')}
              </Button>
            ) : null}
            {entity && archived ? (
              <Button
                variant="secondary"
                loading={archive.isPending}
                onClick={() => archive.mutate(false)}
              >
                {t('organization.restore')}
              </Button>
            ) : null}
            {entity && !archived && !confirmingArchive ? (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmingArchive(true)}>
                {t('organization.archive')}
              </Button>
            ) : null}
            {entity && !archived && confirmingArchive ? (
              <div
                role="group"
                aria-label={t('organization.archive')}
                className="flex flex-wrap items-center gap-2 rounded-control border-2 border-warning bg-warning-surface p-2 text-warning-fg"
              >
                <p className="px-1">{t('organization.archiveConfirm', { name: entity.name })}</p>
                <Button
                  variant="secondary"
                  loading={archive.isPending}
                  onClick={() => archive.mutate(true)}
                >
                  {t('organization.archiveConfirmYes')}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmingArchive(false)}>
                  {t('organization.cancel')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </>
  );
}
