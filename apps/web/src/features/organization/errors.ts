import type { OrganizationErrorReason } from '@qhse/shared';
import type { TFunction } from 'i18next';
import { isApiRequestError } from '../../lib/api';
import { describeAccessError } from '../access/labels';

const REASON_LABELS = {
  code_taken: 'organization.errors.code_taken',
  name_taken: 'organization.errors.name_taken',
  stale_version: 'organization.errors.stale_version',
  has_active_children: 'organization.errors.has_active_children',
  parent_archived: 'organization.errors.parent_archived',
  archived: 'organization.errors.archived',
} as const satisfies Record<OrganizationErrorReason, string>;

/** Translated explanation of a failed organisation request. */
export function describeOrganizationError(error: unknown, t: TFunction): string {
  if (isApiRequestError(error) && error.kind === 'http') {
    const reason = (error.apiError?.details as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === 'string' && reason in REASON_LABELS) {
      return t(REASON_LABELS[reason as OrganizationErrorReason]);
    }
    if (error.status === 400) return t('organization.invalid');
  }
  return describeAccessError(error, t);
}
