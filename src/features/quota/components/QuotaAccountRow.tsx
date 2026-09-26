/**
 * One credential's detail row under the tank farm: every limit (rendered by
 * the provider's own quota body), the free-reset action and a refresh.
 *
 * The provider bodies are reused unchanged; only their class map is extended
 * so rows flow across the width and plan/credit blocks span the full row.
 */

import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { bindQuotaClasses, type QuotaClassMap } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaAccountRow.module.scss';

const baseClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');
const join = (...names: string[]) => names.filter(Boolean).join(' ');
const rowClasses: QuotaClassMap = {
  ...baseClasses,
  quotaRow: join(baseClasses.quotaRow, styles.cell),
  quotaMessage: join(baseClasses.quotaMessage, styles.full),
  codexPlan: join(baseClasses.codexPlan, styles.full),
  codexResetCredits: join(baseClasses.codexResetCredits, styles.full),
  antigravityQuotaGroup: join(baseClasses.antigravityQuotaGroup, styles.full),
};

export interface QuotaAccountRowProps {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  selected: boolean;
  canRefresh: boolean;
  resetting: boolean;
  freeResets: number;
  onRefresh: () => void;
  onReset: () => void;
}

export const QuotaAccountRow = forwardRef<HTMLElement, QuotaAccountRowProps>(
  function QuotaAccountRow(props, ref) {
    const { entry, quota, resolvedTheme, selected, canRefresh, resetting, freeResets } = props;
    const { t } = useTranslation();
    const adapter = QUOTA_ADAPTERS[entry.type];
    const status = quota?.status ?? 'idle';
    const loading = status === 'loading';
    const icon = getAuthFileIcon(entry.type, resolvedTheme);
    const typeLabel = getTypeLabel(t, entry.type);
    const showReset =
      status === 'success' &&
      Boolean(adapter.resetQuota) &&
      quota !== undefined &&
      Boolean(adapter.canResetQuota?.(quota));

    return (
      <article ref={ref} className={join(styles.row, selected ? styles.selected : '')}>
        <div className={styles.who}>
          <span
            className={styles.icon}
            style={
              isThemeSurfaceIconProvider(entry.type)
                ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                : undefined
            }
          >
            {icon ? <img src={icon} alt="" /> : typeLabel.slice(0, 1)}
          </span>
          <span className={styles.whoText}>
            <span className={styles.name} title={getQuotaDisplayName(entry.file)}>
              {entry.file.email?.trim() || getQuotaDisplayName(entry.file)}
            </span>
            <span className={styles.provider}>{typeLabel}</span>
          </span>
        </div>

        <div className={styles.body}>
          {status === 'idle' ? (
            <button
              type="button"
              className={styles.idle}
              onClick={props.onRefresh}
              disabled={!canRefresh}
            >
              {t(`${adapter.i18nPrefix}.idle`)}
            </button>
          ) : loading ? (
            <div className={styles.skeleton} aria-busy="true">
              <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
              <i />
              <i />
            </div>
          ) : status === 'error' ? (
            <div className={styles.error} role="alert">
              {t(`${adapter.i18nPrefix}.load_failed`, {
                message: resolveQuotaErrorMessage(
                  t,
                  quota?.errorStatus,
                  quota?.error || t('common.unknown_error')
                ),
              })}
            </div>
          ) : quota ? (
            <div className={styles.grid}>
              <adapter.Body quota={quota} classes={rowClasses} />
            </div>
          ) : null}
        </div>

        <div className={styles.actions}>
          {showReset && (
            <button
              type="button"
              className={styles.reset}
              onClick={props.onReset}
              disabled={!canRefresh || loading || resetting}
              title={t(`${adapter.i18nPrefix}.reset_button`)}
            >
              <span className={styles.resetDot} aria-hidden="true" />
              {t(`${adapter.i18nPrefix}.reset_button`)}
              {freeResets > 0 && <b>{freeResets}</b>}
            </button>
          )}
          <button
            type="button"
            className={styles.refresh}
            onClick={props.onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
            title={t('auth_files.quota_refresh_hint')}
            aria-label={t('auth_files.quota_refresh_single')}
          >
            <IconRefreshCw
              size={15}
              className={loading || resetting ? styles.spinning : undefined}
            />
          </button>
        </div>
      </article>
    );
  }
);
