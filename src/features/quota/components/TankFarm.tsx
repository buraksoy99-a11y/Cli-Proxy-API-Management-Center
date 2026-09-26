/**
 * Tank farm: every credential drawn as a liquid tank.
 *
 * The level is the short window's remaining capacity, the thin tube beside it
 * the weekly window. An empty tank "rests": it drips and shows when it refills.
 *
 * Motion that explains a change, not decoration:
 * - a level change (a refresh, a free reset) animates the liquid to its new height;
 * - a credential that appears drops in and fills from empty;
 * - a credential that disappears drains in place while the rest slide into its gap (FLIP).
 * All of it is skipped under `prefers-reduced-motion`.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ResolvedTheme } from '@/types';
import { prefersReducedMotion } from '@/hooks/motion';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { levelTone, type TankModel } from '../tankModel';
import { formatTankDuration, formatTankPercent } from '../tankFormat';
import styles from './TankFarm.module.scss';

/* Tank geometry, in SVG user units. The body spans x 12..96 and the view box
   starts at -6 so the body, not body + tube, is what sits centred. */
const TOP = 18;
const BOT = 180;
const BODY_H = BOT - TOP;
const TUBE_TOP = 40;
const TUBE_H = 132;
const LEAVE_MS = 950;
const MOVE_MS = 520;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Wave spanning -60..240 with a 60-unit period, so a -60 drift loops seamlessly. */
const WAVE_PATH = (() => {
  let d = `M-60 ${TOP}`;
  for (let x = -60; x < 240; x += 30) d += ` q15 ${x % 60 === 0 ? -5 : 5} 30 0`;
  return `${d} V${BOT + 20} H-60 Z`;
})();

function TankArt({
  tank,
  nowMs,
  svgId,
  entering,
  t,
}: {
  tank: TankModel;
  nowMs: number;
  svgId: string;
  entering: boolean;
  t: TFunction;
}) {
  const loaded = tank.status === 'success';
  const level = loaded && tank.level !== null ? clamp(tank.level) : 0;
  const tone = loaded ? levelTone(tank.level) : 'none';
  const drop = (1 - level / 100) * BODY_H;
  const weekly = loaded && tank.weekly !== null ? clamp(tank.weekly) : null;
  const tubeY = weekly === null ? 0 : TUBE_TOP + (1 - weekly / 100) * TUBE_H;
  const resting = loaded && tank.resting;
  const midY = TOP + BODY_H / 2;

  const liquidStyle = {
    transform: `translateY(${drop}px)`,
    '--tank-empty': `${BODY_H + 12}px`,
  } as CSSProperties;

  const sessionText = loaded && tank.level !== null ? formatTankPercent(t, tank.level) : '?';
  const weeklyText = weekly !== null ? formatTankPercent(t, weekly) : '—';

  return (
    <svg
      className={styles.art}
      viewBox="-6 0 120 196"
      role="img"
      aria-label={t('quota_tank.tank_aria', {
        name: tank.shortName,
        session: sessionText,
        weekly: weeklyText,
      })}
    >
      <defs>
        <clipPath id={`${svgId}-clip`}>
          <rect x="12" y={TOP} width="84" height={BODY_H} rx="16" />
        </clipPath>
        <pattern
          id={`${svgId}-hatch`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="3" height="8" className={styles.hatchStroke} />
        </pattern>
      </defs>

      <rect className={styles.cap} x="40" y="6" width="28" height="10" rx="3" />
      <rect
        className={`${styles.shell} ${tank.status === 'idle' ? styles.shellIdle : ''}`}
        x="12"
        y={TOP}
        width="84"
        height={BODY_H}
        rx="16"
      />

      <g clipPath={`url(#${svgId}-clip)`}>
        {(loaded || tank.status === 'loading') && (
          <g
            className={`${styles.liquid} ${entering ? styles.fillIn : ''} ${
              tank.status === 'loading' ? styles.liquidLoading : ''
            }`}
            data-tone={tone}
            style={tank.status === 'loading' ? undefined : liquidStyle}
          >
            <path className={styles.waveBack} d={WAVE_PATH} />
            <path className={styles.waveFront} d={WAVE_PATH} />
            {level > 8 &&
              [30, 56, 78].map((cx, index) => (
                <circle
                  key={cx}
                  className={styles.bubble}
                  cx={cx}
                  cy={BOT - 6}
                  r={2 + (index % 2)}
                  style={{ animationDelay: `${index * 1.3}s` }}
                />
              ))}
          </g>
        )}
        {tank.status === 'error' && (
          <rect
            x="12"
            y={TOP}
            width="84"
            height={BODY_H}
            fill={`url(#${svgId}-hatch)`}
            className={styles.hatch}
          />
        )}
        {resting && <rect className={styles.puddle} x="12" y={BOT - 5} width="84" height="5" />}
      </g>

      {resting && (
        <g className={styles.rest} aria-hidden="true">
          <circle className={styles.drip} cx="54" cy="16" r="3.4" />
          <circle className={`${styles.drip} ${styles.dripLate}`} cx="54" cy="16" r="2.6" />
          <ellipse className={styles.ripple} cx="54" cy={BOT - 5} rx="16" ry="3.2" />
          <ellipse
            className={`${styles.ripple} ${styles.rippleLate}`}
            cx="54"
            cy={BOT - 5}
            rx="16"
            ry="3.2"
          />
          {tank.levelResetMs !== null && (
            <>
              <text className={styles.restTime} x="54" y={midY} textAnchor="middle">
                {formatTankDuration(t, tank.levelResetMs - nowMs)}
              </text>
              <text className={styles.restCaption} x="54" y={midY + 18} textAnchor="middle">
                {t('quota_tank.tank_until_refill')}
              </text>
            </>
          )}
        </g>
      )}

      {tank.status === 'idle' && (
        <g className={styles.idleMark} aria-hidden="true">
          <path d={`M54 ${midY - 10} V${midY + 10} M44 ${midY} H64`} />
        </g>
      )}

      <g className={styles.ticks} aria-hidden="true">
        <line x1="12" x2="22" y1={TOP + BODY_H * 0.25} y2={TOP + BODY_H * 0.25} />
        <line x1="12" x2="26" y1={TOP + BODY_H * 0.5} y2={TOP + BODY_H * 0.5} />
        <line x1="12" x2="22" y1={TOP + BODY_H * 0.75} y2={TOP + BODY_H * 0.75} />
      </g>
      <path className={styles.shine} d={`M84 ${TOP + 16} V${TOP + 60}`} />

      {weekly !== null && (
        <>
          <rect
            className={styles.tubeTrack}
            x="104"
            y={TUBE_TOP}
            width="8"
            height={TUBE_H}
            rx="4"
          />
          <rect
            className={styles.tubeFill}
            data-tone={levelTone(weekly)}
            x="104"
            y={tubeY}
            width="8"
            height={TUBE_TOP + TUBE_H - tubeY}
            rx="4"
          />
        </>
      )}
      <rect className={styles.base} x="8" y={BOT + 2} width="92" height="6" rx="3" />
    </svg>
  );
}

function tankMeta(tank: TankModel, nowMs: number, t: TFunction): { text: string; tone?: string } {
  if (tank.status === 'error') return { text: t('quota_tank.tank_failed'), tone: 'bad' };
  if (tank.status === 'idle') return { text: t('quota_tank.tank_idle') };
  if (tank.status === 'loading') return { text: t('quota_tank.tank_loading') };
  if (tank.resting) return { text: t('quota_tank.tank_resting'), tone: 'bad' };
  if (tank.level !== null && tank.level < 20 && tank.levelResetMs !== null) {
    return {
      text: t('quota_tank.tank_refills_in', {
        time: formatTankDuration(t, tank.levelResetMs - nowMs),
      }),
      tone: 'warn',
    };
  }
  if (tank.weekly !== null) {
    return { text: t('quota_tank.tank_weekly', { percent: formatTankPercent(t, tank.weekly) }) };
  }
  if (tank.levelResetMs !== null) {
    return {
      text: t('quota_tank.tank_refills_in', {
        time: formatTankDuration(t, tank.levelResetMs - nowMs),
      }),
    };
  }
  return { text: '' };
}

/** Renders `%72` / `72%` with the sign set smaller, whichever side the locale puts it on. */
function PercentFigure({ text }: { text: string }) {
  const parts = text.split('%');
  if (parts.length !== 2) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <small>%</small>
      {parts[1]}
    </>
  );
}

function ProviderMark({ provider, theme }: { provider: string; theme: ResolvedTheme }) {
  const { t } = useTranslation();
  const src = getAuthFileIcon(provider, theme);
  const label = getTypeLabel(t, provider);
  return (
    <span
      className={styles.provider}
      title={label}
      style={
        isThemeSurfaceIconProvider(provider)
          ? { background: getThemeSurfaceIconBackground(theme) }
          : undefined
      }
    >
      {src ? <img src={src} alt="" /> : <span>{label.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

function TankTile({
  tank,
  nowMs,
  theme,
  selected,
  entering,
  onSelect,
  registerNode,
}: {
  tank: TankModel;
  nowMs: number;
  theme: ResolvedTheme;
  selected: boolean;
  entering: boolean;
  onSelect?: (tank: TankModel) => void;
  registerNode?: (key: string, node: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const meta = tankMeta(tank, nowMs, t);
  const svgId = `tank-${tank.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const figure =
    tank.status === 'success' && tank.level !== null ? formatTankPercent(t, tank.level) : '—';

  return (
    <button
      type="button"
      className={`${styles.tank} ${selected ? styles.selected : ''} ${entering ? styles.dropIn : ''}`}
      ref={registerNode ? (node) => registerNode(tank.key, node) : undefined}
      onClick={onSelect ? () => onSelect(tank) : undefined}
      aria-label={t('quota_tank.tank_open', { name: tank.name })}
      aria-pressed={selected}
      tabIndex={onSelect ? 0 : -1}
    >
      <span className={styles.artBox}>
        <ProviderMark provider={tank.provider} theme={theme} />
        {tank.freeResets > 0 && (
          <span
            className={styles.token}
            title={t('quota_tank.tank_free_resets', { count: tank.freeResets })}
          >
            {tank.freeResets}
          </span>
        )}
        <TankArt tank={tank} nowMs={nowMs} svgId={svgId} entering={entering} t={t} />
      </span>
      <span className={styles.figure}>
        <PercentFigure text={figure} />
      </span>
      <span className={styles.name} title={tank.name}>
        {tank.shortName}
      </span>
      <span className={styles.meta} data-tone={meta.tone}>
        {meta.text}
      </span>
    </button>
  );
}

interface LeavingTank {
  tank: TankModel;
  left: number;
  top: number;
  width: number;
}

export interface TankFarmProps {
  tanks: TankModel[];
  nowMs: number;
  selectedKey: string | null;
  resolvedTheme: ResolvedTheme;
  onSelect: (tank: TankModel) => void;
}

export function TankFarm({ tanks, nowMs, selectedKey, resolvedTheme, onSelect }: TankFarmProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const previous = useRef<Map<string, TankModel> | null>(null);
  const [entering, setEntering] = useState<ReadonlySet<string>>(() => new Set());
  const [leaving, setLeaving] = useState<LeavingTank[]>([]);

  const registerNode = (key: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  };

  // FLIP + presence. Runs before paint so a moved tank never flashes at its new spot.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const origin = container.getBoundingClientRect();
    const reduce = prefersReducedMotion();
    const current = new Map(tanks.map((tank) => [tank.key, tank]));
    const before = previous.current;

    if (before) {
      const added = tanks.filter((tank) => !before.has(tank.key)).map((tank) => tank.key);
      const removed = [...before.values()].filter((tank) => !current.has(tank.key));

      if (!reduce) {
        if (added.length) setEntering(new Set(added));
        if (removed.length) {
          const ghosts = removed
            .map((tank): LeavingTank | null => {
              const rect = rects.current.get(tank.key);
              return rect ? { tank, left: rect.left, top: rect.top, width: rect.width } : null;
            })
            .filter((ghost): ghost is LeavingTank => ghost !== null);
          if (ghosts.length) {
            setLeaving((prev) => [...prev, ...ghosts]);
            const keys = new Set(ghosts.map((ghost) => ghost.tank.key));
            window.setTimeout(
              () => setLeaving((prev) => prev.filter((ghost) => !keys.has(ghost.tank.key))),
              LEAVE_MS
            );
          }
        }

        nodes.current.forEach((node, key) => {
          const old = rects.current.get(key);
          if (!old) return;
          const now = node.getBoundingClientRect();
          const dx = old.left - (now.left - origin.left);
          const dy = old.top - (now.top - origin.top);
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
              duration: MOVE_MS,
              easing: EASE,
            });
          }
        });
      }
    }

    const next = new Map<string, DOMRect>();
    nodes.current.forEach((node, key) => {
      const rect = node.getBoundingClientRect();
      next.set(
        key,
        new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height)
      );
    });
    rects.current = next;
    previous.current = current;
  }, [tanks]);

  // Keep the remembered positions true after a resize, so the next add/remove
  // slides tanks from where they actually are.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const origin = container.getBoundingClientRect();
      const next = new Map<string, DOMRect>();
      nodes.current.forEach((node, key) => {
        const rect = node.getBoundingClientRect();
        next.set(
          key,
          new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height)
        );
      });
      rects.current = next;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Tanks that appeared keep their "entering" class for one fill cycle only.
  useLayoutEffect(() => {
    if (entering.size === 0) return;
    const timer = window.setTimeout(() => setEntering(new Set()), 1600);
    return () => window.clearTimeout(timer);
  }, [entering]);

  return (
    <section className={styles.farm} aria-label={t('quota_tank.farm_label')}>
      <div className={styles.tanks} ref={containerRef}>
        {tanks.map((tank) => (
          <TankTile
            key={tank.key}
            tank={tank}
            nowMs={nowMs}
            theme={resolvedTheme}
            selected={tank.key === selectedKey}
            entering={entering.has(tank.key)}
            onSelect={onSelect}
            registerNode={registerNode}
          />
        ))}
        {leaving.map((ghost) => (
          <div
            key={`leaving-${ghost.tank.key}`}
            className={styles.leaving}
            style={{ left: ghost.left, top: ghost.top, width: ghost.width }}
            aria-hidden="true"
          >
            <TankTile
              tank={ghost.tank}
              nowMs={nowMs}
              theme={resolvedTheme}
              selected={false}
              entering={false}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
