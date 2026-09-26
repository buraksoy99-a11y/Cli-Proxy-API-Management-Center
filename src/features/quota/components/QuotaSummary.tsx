/**
 * Page headline: one sentence that answers "can I keep working?", the account
 * that refills first, free resets on hand, and each provider pool's level.
 */

import { Trans, useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { levelTone, type FarmSummary } from '../tankModel';
import { formatTankDuration, formatTankPercent } from '../tankFormat';
import styles from './QuotaSummary.module.scss';

export interface QuotaSummaryProps {
  summary: FarmSummary;
  nowMs: number;
  listLoading: boolean;
  resolvedTheme: ResolvedTheme;
  onJump: (key: string) => void;
}

function headline(
  summary: FarmSummary,
  listLoading: boolean,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (listLoading && summary.total === 0) return t('quota_tank.headline_loading');
  if (summary.total === 0) return t('quota_tank.headline_empty');
  const loaded = summary.working + summary.resting;
  if (loaded === 0) {
    return summary.pending > 0 ? t('quota_tank.headline_loading') : t('quota_tank.headline_idle');
  }
  if (summary.working === 0)
    return t('quota_tank.headline_all_resting', { count: summary.resting });
  if (summary.resting === 0) return t('quota_tank.headline_working', { count: summary.working });
  return t('quota_tank.headline_mixed', { count: summary.working, resting: summary.resting });
}

export function QuotaSummary({
  summary,
  nowMs,
  listLoading,
  resolvedTheme,
  onJump,
}: QuotaSummaryProps) {
  const { t } = useTranslation();

  return (
    <section className={styles.summary}>
      <div className={styles.lead}>
        <h2 className={styles.headline}>{headline(summary, listLoading, t)}</h2>
        <p className={styles.subline}>
          {summary.next && (
            <span>
              <Trans
                i18nKey="quota_tank.next_refill"
                values={{
                  name: summary.next.shortName,
                  time: formatTankDuration(t, summary.next.atMs - nowMs),
                }}
                components={[
                  <button
                    key="name"
                    type="button"
                    className={styles.jump}
                    onClick={() => summary.next && onJump(summary.next.key)}
                  />,
                  <strong key="time" />,
                ]}
              />{' '}
            </span>
          )}
          {summary.freeResets > 0 && (
            <span>
              <Trans
                i18nKey="quota_tank.free_resets"
                count={summary.freeResets}
                values={{ count: summary.freeResets }}
                components={[<strong key="resets" className={styles.token} />]}
              />{' '}
            </span>
          )}
          {summary.failed > 0 && (
            <span className={styles.failed}>
              {t('quota_tank.unreadable', { count: summary.failed })}
            </span>
          )}
        </p>
      </div>

      {summary.pools.length > 0 && (
        <div className={styles.pools}>
          {summary.pools.map((pool) => {
            const icon = getAuthFileIcon(pool.provider, resolvedTheme);
            return (
              <div key={pool.provider} className={styles.pool}>
                <div className={styles.poolName}>
                  {icon && <img src={icon} alt="" />}
                  <span>
                    {t('quota_tank.pool_label', { provider: getTypeLabel(t, pool.provider) })}
                  </span>
                </div>
                <div className={styles.poolValue}>{formatTankPercent(t, pool.percent)}</div>
                <div className={styles.poolBar}>
                  <i data-tone={levelTone(pool.percent)} style={{ width: `${pool.percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
