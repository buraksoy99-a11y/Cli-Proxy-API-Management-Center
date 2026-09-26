/**
 * Refill forecast: which account gets capacity back in the next 24 hours.
 *
 * One lane per provider, a pill per refill. Pills that land close together
 * stack into extra rows (packForecastLane) instead of overlapping. The track
 * width is measured so packing uses real pixels.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import { FORECAST_SPAN_MS, packForecastLane, type ForecastEvent } from '../tankModel';
import styles from './RefillForecast.module.scss';

const TICK_HOURS = [4, 8, 12, 16, 20, 24];
const ROW_HEIGHT = 30;

/** Rough pill width: pin + padding + ~7px per character at 12px. */
const pillWidth = (event: ForecastEvent) => event.shortName.length * 7 + 30;

export interface RefillForecastProps {
  events: ForecastEvent[];
  providers: QuotaProviderType[];
  nowMs: number;
  resolvedTheme: ResolvedTheme;
  onJump: (tankKey: string) => void;
}

export function RefillForecast({
  events,
  providers,
  nowMs,
  resolvedTheme,
  onJump,
}: RefillForecastProps) {
  const { t, i18n } = useTranslation();
  const lanesRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(800);

  // Measured on the always-mounted lanes wrapper: lane elements come and go
  // with the provider tab, and the track is whatever the label column leaves.
  useEffect(() => {
    const node = lanesRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const track = node.querySelector<HTMLElement>('[data-track]');
      if (track) setTrackWidth(track.getBoundingClientRect().width);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);

  const clock = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: '2-digit', minute: '2-digit' }),
    [i18n.resolvedLanguage]
  );

  const lanes = providers.map((provider) => {
    const laneEvents = events.filter((event) => event.provider === provider);
    return { provider, ...packForecastLane(laneEvents, nowMs, trackWidth, pillWidth) };
  });

  return (
    <section className={styles.forecast} aria-label={t('quota_tank.forecast_label')}>
      {events.length === 0 && <p className={styles.empty}>{t('quota_tank.forecast_empty')}</p>}
      <div className={styles.lanes} ref={lanesRef}>
        {lanes.map((lane) => {
          const icon = getAuthFileIcon(lane.provider, resolvedTheme);
          return (
            <div
              key={lane.provider}
              className={styles.lane}
              style={{ minHeight: Math.max(44, 20 + Math.max(1, lane.rows) * ROW_HEIGHT) }}
            >
              <div className={styles.laneName}>
                {icon && <img src={icon} alt="" />}
                <span>{getTypeLabel(t, lane.provider)}</span>
              </div>
              <div className={styles.track} data-track>
                {lane.placed.map((event) => {
                  const label = t(
                    event.kind === 'short'
                      ? 'quota_tank.forecast_event_short'
                      : 'quota_tank.forecast_event_weekly',
                    { name: event.shortName, time: clock.format(event.atMs) }
                  );
                  return (
                    <button
                      key={event.key}
                      type="button"
                      className={`${styles.pill} ${event.kind === 'weekly' ? styles.weekly : ''} ${
                        event.flipped ? styles.flipped : ''
                      }`}
                      data-tone={event.tone}
                      style={{ left: `${event.leftPercent}%`, top: 10 + event.row * ROW_HEIGHT }}
                      title={label}
                      aria-label={label}
                      onClick={() => onJump(event.tankKey)}
                    >
                      <span className={styles.pin} />
                      {event.shortName}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className={styles.now} aria-hidden="true">
          <span>{t('quota_tank.forecast_now')}</span>
        </div>
      </div>
      <div className={styles.axis} aria-hidden="true">
        <div />
        <div className={styles.axisTrack}>
          {TICK_HOURS.map((hours) => (
            <span key={hours} style={{ left: `${(hours / 24) * 100}%` }}>
              {clock.format(nowMs + (hours / 24) * FORECAST_SPAN_MS)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.legend}>
        <span>
          <i />
          {t('quota_tank.forecast_legend_short')}
        </span>
        <span>
          <i className={styles.legendWeekly} />
          {t('quota_tank.forecast_legend_weekly')}
        </span>
      </div>
    </section>
  );
}
