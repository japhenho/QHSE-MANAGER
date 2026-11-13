import {
  createRoleSchema,
  PERMISSION_GROUPS,
  type PermissionKey,
  PERMISSIONS,
  type RoleSummary,
} from '@qhse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { rolePath, ROUTES } from '../../app/navigation';
import { Badge, Button, buttonClasses, PageHeader } from '../../components/ui';
import { usePermissions } from '../../lib/auth';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import { accessKeys, createRole, deleteRole, getRole, updateRole } from './api';
import { describeAccessError, GROUP_LABELS, PERMISSION_LABELS, roleLabel } from './labels';
import { ListStates } from './ListStates';

const INPUT_CLASSES =
  'min-h-touch-lg w-full rounded-control border-2 border-line-strong bg-surface-sunken px-3 text-base text-fg ' +
  'disabled:opacity-70 aria-invalid:border-danger';

/** `/roles/new` creates a role; `/roles/:id` shows and edits one. */
export default function RoleEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const role = useQuery({
    queryKey: accessKeys.role(id ?? ''),
    queryFn: ({ signal }) => getRole(id ?? '', signal),
    enabled: id !== undefined,
    // The form is filled once from this data: never refresh it under the user's hands.
    staleTime: Infinity,
    gcTime: 0,
  });
  usePageTitle(
    id === undefined
      ? t('roles.newTitle')
      : t('roles.editTitle', { name: role.data ? roleLabel(role.data, t) : '…' }),
  );

  if (id === undefined) return <RoleForm key="new" />;
  return (
    <ListStates
      isPending={role.isPending}
      error={role.error}
      isEmpty={false}
      emptyTitle=""
      onRetry={() => void role.refetch()}
    >
      {role.data ? (
        <RoleForm key={`${role.data.id}:${String(role.data.version)}`} role={role.data} />
      ) : null}
    </ListStates>
  );
}

function RoleForm({ role }: { role?: RoleSummary }) {
  const { t } = useTranslation();
  const can = usePermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formId = useId();

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<ReadonlySet<PermissionKey>>(
    new Set(role?.permissions ?? []),
  );
  const [nameInvalid, setNameInvalid] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saved, setSaved] = useState(false);

  const editable = can(PERMISSIONS.ROLE_MANAGE) && !role?.isSystem;

  const save = useMutation({
    mutationFn: (input: { name: string; description: string; permissions: PermissionKey[] }) =>
      role
        ? updateRole(role.id, {
            name: input.name,
            description: input.description === '' ? null : input.description,
            permissions: input.permissions,
            version: role.version,
          })
        : createRole({
            name: input.name,
            permissions: input.permissions,
            ...(input.description === '' ? {} : { description: input.description }),
          }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: accessKeys.allRoles });
      queryClient.setQueryData(accessKeys.role(result.id), result);
      setSaved(true);
      if (!role) void navigate(rolePath(result.id), { replace: true });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRole(role?.id ?? ''),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accessKeys.allRoles });
      void navigate(ROUTES.roles);
    },
  });

  function toggle(permission: PermissionKey) {
    setSaved(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const parsed = createRoleSchema.safeParse({
      name,
      permissions: [...selected],
      ...(description.trim() === '' ? {} : { description }),
    });
    if (!parsed.success) {
      setNameInvalid(parsed.error.issues.some((issue) => issue.path[0] === 'name'));
      return;
    }
    setNameInvalid(false);
    save.mutate({
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      permissions: parsed.data.permissions,
    });
  }

  const error = save.error ?? remove.error;
  const busy = save.isPending || remove.isPending;
  const title = role ? t('roles.editTitle', { name: roleLabel(role, t) }) : t('roles.newTitle');

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <Link to={ROUTES.roles} className={buttonClasses({ variant: 'secondary' })}>
            {t('roles.back')}
          </Link>
        }
      />

      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-6 rounded-card border border-line bg-surface p-4 sm:p-6"
      >
        {role?.isSystem ? (
          <p className="rounded-control border-2 border-info bg-info-surface px-3 py-2 text-info-fg">
            {t('roles.readOnlySystem')}
          </p>
        ) : !editable ? (
          <p className="rounded-control border-2 border-info bg-info-surface px-3 py-2 text-info-fg">
            {t('roles.readOnly')}
          </p>
        ) : null}

        <div role="alert">
          {error ? (
            <p className="rounded-control border-2 border-danger bg-danger-surface px-3 py-2 font-medium text-danger-fg">
              {describeAccessError(error, t)}
            </p>
          ) : null}
        </div>
        <div role="status">
          {saved && !error ? (
            <p className="rounded-control border-2 border-success bg-success-surface px-3 py-2 font-medium text-success-fg">
              {t('roles.saved')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-name`} className="font-semibold text-fg">
            {t('roles.name')}
          </label>
          <input
            id={`${formId}-name`}
            className={INPUT_CLASSES}
            value={name}
            maxLength={80}
            disabled={!editable || busy}
            aria-invalid={nameInvalid || undefined}
            aria-describedby={`${formId}-name-hint`}
            onChange={(event) => {
              setSaved(false);
              setName(event.target.value);
            }}
          />
          <p id={`${formId}-name-hint`} className="text-sm text-fg-muted">
            {nameInvalid ? (
              <span className="text-danger-fg">{t('roles.nameError')}</span>
            ) : (
              t('roles.nameHint')
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-description`} className="font-semibold text-fg">
            {t('roles.descriptionLabel')}
          </label>
          <textarea
            id={`${formId}-description`}
            className={`${INPUT_CLASSES} py-2`}
            rows={2}
            maxLength={500}
            value={description}
            disabled={!editable || busy}
            onChange={(event) => {
              setSaved(false);
              setDescription(event.target.value);
            }}
          />
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-lg font-semibold text-fg">
            {t('roles.permissionsLegend')}
          </legend>
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.resource}>
              <p className="mb-1 text-sm font-semibold tracking-wide text-fg-muted uppercase">
                {t(GROUP_LABELS[group.resource as keyof typeof GROUP_LABELS])}
              </p>
              <ul className="flex flex-col">
                {group.permissions.map((permission) => {
                  const held = can(permission);
                  const checked = role?.isSystem ? true : selected.has(permission);
                  const inputId = `${formId}-${permission}`;
                  return (
                    <li key={permission} className="flex min-h-touch items-start gap-3 py-2">
                      <input
                        id={inputId}
                        type="checkbox"
                        className="mt-1 size-6 shrink-0 accent-(--color-primary)"
                        checked={checked}
                        disabled={!editable || busy || !held}
                        aria-describedby={held ? undefined : `${inputId}-note`}
                        onChange={() => toggle(permission)}
                      />
                      <label htmlFor={inputId} className="min-w-0 text-fg">
                        {t(PERMISSION_LABELS[permission])}
                        <span className="ml-2 font-mono text-sm text-fg-muted">{permission}</span>
                        {editable && !held ? (
                          <span id={`${inputId}-note`} className="block text-sm text-warning-fg">
                            {t('roles.notHeld')}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </fieldset>

        {editable ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button type="submit" loading={save.isPending}>
              {save.isPending ? t('roles.saving') : t('roles.save')}
            </Button>
            {role && !confirmingDelete ? (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                {t('roles.delete')}
              </Button>
            ) : null}
            {role && confirmingDelete ? (
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={t('roles.delete')}
              >
                <Badge tone="warning">
                  {t('roles.deleteConfirm', { name: roleLabel(role, t) })}
                </Badge>
                <Button
                  variant="secondary"
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {t('roles.deleteConfirmYes')}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                  {t('roles.cancel')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </>
  );
}
