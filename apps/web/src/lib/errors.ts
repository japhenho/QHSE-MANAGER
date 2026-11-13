import type { TFunction } from 'i18next';
import { isApiRequestError } from './api';

/** Translated, user-facing explanation for any error thrown by the data layer. */
export function describeError(error: unknown, t: TFunction): string {
  if (!isApiRequestError(error)) return t('errors.unexpected');
  switch (error.kind) {
    case 'offline':
      return t('errors.offline');
    case 'network':
      return t('errors.network');
    case 'timeout':
      return t('errors.timeout');
    case 'invalid_response':
      return t('errors.invalidResponse');
    case 'http':
      // The API envelope message is written for end users and localised by the server.
      if (error.apiError) return error.apiError.message;
      return error.status !== undefined && error.status >= 500
        ? t('errors.server')
        : t('errors.client');
  }
}
