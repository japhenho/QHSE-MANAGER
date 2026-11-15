import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { cx } from '../../lib/cx';
import { ENTITIES, ENTITY_KINDS } from './entities';

/** Switches between the three lists of the organisation. */
export function OrganizationTabs() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('organization.tabsLabel')}
      className="mb-5 flex flex-wrap gap-2 border-b border-line pb-3"
    >
      {ENTITY_KINDS.map((kind) => (
        <NavLink
          key={kind}
          to={ENTITIES[kind].listPath}
          className={({ isActive }) =>
            cx(
              'inline-flex min-h-touch items-center rounded-control border-2 px-4 font-semibold',
              isActive
                ? 'border-primary bg-primary text-on-primary'
                : 'border-line-strong bg-surface text-fg hover:bg-surface-sunken',
            )
          }
        >
          {t(`organization.${kind}.tab`)}
        </NavLink>
      ))}
    </nav>
  );
}
