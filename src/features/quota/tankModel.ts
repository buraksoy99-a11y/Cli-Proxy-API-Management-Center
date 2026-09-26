/**
 * Tank-farm model: one "tank" per credential, plus the page summary and the
 * 24-hour refill forecast built from the same tanks.
 *
 * The page answers three questions at a glance: can I keep working right now,
 * which account runs dry first, and when does capacity come back. Each tank is
 * therefore reduced to two levels (the short window it will hit first, and the
 * weekly window behind it) and the instants those refill.
 *
 * Pure and React-free: `nowMs` is always passed in and quota state is read
 * structurally. Provider-specific window reading is delegated to
 * `buildTimelineLane`, which already knows the five state shapes; this module
 * only chooses which lane is the tank level and which is the weekly tube.
 */

import { HOUR_MS } from '@/utils/time/durations';
import { buildTimelineLane, type TimelineLane } from './quotaTimelineModel';
import type { QuotaProviderType } from './providers/types';

/** Longest window that still counts as the "short" limit a tank shows. */
export const TANK_SESSION_MAX_HOURS = 5;
export const TANK_WEEK_HOURS = 24 * 7;
export const FORECAST_SPAN_MS = 24 * HOUR_MS;

export type TankStatus = 'idle' | 'loading' | 'success' | 'error';
export type TankTone = 'ok' | 'mid' | 'low' | 'rest' | 'none';

export interface TankModel {
  /** Stable identity across renders: `${provider}:${cacheKey}`. */
  key: string;
  /** Auth file name, used for actions and the full label. */
  name: string;
  /** Short label under the tank. */
  shortName: string;
  provider: QuotaProviderType;
  status: TankStatus;
  /** Remaining percent of the tank level window, 0..100, or null when unknown. */
  level: number | null;
  levelResetMs: number | null;
  /** The tank level is itself a weekly (or longer) window: the account has no short limit. */
  levelIsLong: boolean;
  /** Remaining percent of the weekly window, or null when the account has none. */
  weekly: number | null;
  weeklyResetMs: number | null;
  /** Spendable free resets (Claude grants, Codex reset credits). */
  freeResets: number;
  /** Loaded and the level window is empty. */
  resting: boolean;
}

export interface TankInput {
  key: string;
  name: string;
  email?: string;
  provider: QuotaProviderType;
  quota: unknown;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function levelTone(percent: number | null): TankTone {
  if (percent === null || !Number.isFinite(percent)) return 'none';
  if (percent <= 0) return 'rest';
  if (percent < 20) return 'low';
  if (percent < 50) return 'mid';
  return 'ok';
}

/**
 * Short label under a tank: the local part of the account email when known,
 * otherwise the file stem without its provider prefix. A stem that is only a
 * number (Kimi names files `kimi-<timestamp>`) keeps its prefix, because a bare
 * timestamp names nothing.
 */
export function tankShortName(name: string, provider: string, email?: string): string {
  const fromEmail = email?.split('@')[0]?.trim();
  if (fromEmail) return fromEmail;
  const stem = name.replace(/\.json$/i, '');
  const unprefixed = stem.startsWith(`${provider}-`) ? stem.slice(provider.length + 1) : stem;
  const local = unprefixed.split('@')[0] || unprefixed;
  return /^\d+$/.test(local) ? stem : local;
}

interface NamedWindowLike {
  id?: string;
  usedPercent?: number | null;
  resetAtMs?: number | null;
}

interface WindowReading {
  remaining: number;
  resetMs: number | null;
}

/** Account-wide window ids for the providers whose windows are named. */
const NAMED_WINDOWS: Partial<Record<QuotaProviderType, { short: string; weekly: string }>> = {
  claude: { short: 'five-hour', weekly: 'seven-day' },
  codex: { short: 'five-hour', weekly: 'weekly' },
};

/**
 * Reads the account-wide short and weekly windows by id.
 *
 * Two reasons not to go through the generic lane picker here. Claude reports
 * several weekly windows (account-wide plus per model) and the picker takes
 * whichever resets first. And a window nobody has used yet comes back with no
 * reset instant (`resets_at: null`), which the picker skips, so a freshly
 * refilled account, right after a free reset, would read as unknown instead
 * of full.
 */
function readNamedWindows(
  provider: QuotaProviderType,
  quota: unknown
): { short: WindowReading | null; weekly: WindowReading | null } | null {
  const ids = NAMED_WINDOWS[provider];
  if (!ids) return null;
  const windows = (quota as { windows?: NamedWindowLike[] }).windows ?? [];
  const read = (id: string): WindowReading | null => {
    const window = windows.find((candidate) => candidate.id === id);
    if (!window || typeof window.usedPercent !== 'number') return null;
    return {
      remaining: clampPercent(100 - window.usedPercent),
      resetMs: typeof window.resetAtMs === 'number' ? window.resetAtMs : null,
    };
  };
  return { short: read(ids.short), weekly: read(ids.weekly) };
}

function freeResetsOf(provider: QuotaProviderType, quota: unknown): number {
  if (provider === 'claude') {
    const count = (quota as { resetGrants?: { availableCount?: number } | null }).resetGrants
      ?.availableCount;
    return typeof count === 'number' && count > 0 ? count : 0;
  }
  if (provider === 'codex') {
    const count = (quota as { rateLimitResetCreditsAvailableCount?: number | null })
      .rateLimitResetCreditsAvailableCount;
    return typeof count === 'number' && count > 0 ? count : 0;
  }
  return 0;
}

const laneFor = (input: TankInput, maxPeriodHours: number): TimelineLane =>
  buildTimelineLane({
    name: input.name,
    displayName: input.name,
    provider: input.provider,
    quota: input.quota as { status?: string } | undefined,
    maxPeriodHours,
  });

export function buildTankModel(input: TankInput): TankModel {
  const status = ((input.quota as { status?: TankStatus } | undefined)?.status ??
    'idle') as TankStatus;
  const base: TankModel = {
    key: input.key,
    name: input.name,
    shortName: tankShortName(input.name, input.provider, input.email),
    provider: input.provider,
    status,
    level: null,
    levelResetMs: null,
    levelIsLong: false,
    weekly: null,
    weeklyResetMs: null,
    freeResets: 0,
    resting: false,
  };
  if (status !== 'success') return base;

  const freeResets = freeResetsOf(input.provider, input.quota);
  const named = readNamedWindows(input.provider, input.quota);
  if (named?.short) {
    return {
      ...base,
      level: named.short.remaining,
      levelResetMs: named.short.resetMs,
      weekly: named.weekly?.remaining ?? null,
      weeklyResetMs: named.weekly?.resetMs ?? null,
      freeResets,
      resting: named.short.remaining <= 0,
    };
  }

  const session = laneFor(input, TANK_SESSION_MAX_HOURS);
  const week = laneFor(input, TANK_WEEK_HOURS);
  const levelIsLong = (session.periodHours ?? 0) > TANK_SESSION_MAX_HOURS;
  // With a single window the level already shows it (short or long), so a tube
  // would draw the same number twice and is left out.
  const weekIsDistinct = !levelIsLong && (week.periodHours ?? 0) > TANK_SESSION_MAX_HOURS;

  return {
    ...base,
    level: session.remaining,
    levelResetMs: session.anchorMs,
    levelIsLong,
    weekly: weekIsDistinct ? week.remaining : null,
    weeklyResetMs: weekIsDistinct ? week.anchorMs : null,
    freeResets,
    resting: session.remaining !== null && session.remaining <= 0,
  };
}

/* ------------------------------------------------------------------ summary */

export interface TankPool {
  provider: QuotaProviderType;
  /** Mean remaining level across loaded tanks of this provider. */
  percent: number;
  count: number;
}

export interface FarmSummary {
  total: number;
  working: number;
  resting: number;
  failed: number;
  /** Not loaded yet, or loading. */
  pending: number;
  /** Tank that refills first, among those with anything to recover. */
  next: { key: string; shortName: string; atMs: number } | null;
  freeResets: number;
  pools: TankPool[];
}

export function buildFarmSummary(
  tanks: readonly TankModel[],
  providerOrder: readonly QuotaProviderType[],
  nowMs: number
): FarmSummary {
  let working = 0;
  let resting = 0;
  let failed = 0;
  let pending = 0;
  let freeResets = 0;
  let next: FarmSummary['next'] = null;

  for (const tank of tanks) {
    if (tank.status === 'error') failed += 1;
    else if (tank.status !== 'success') pending += 1;
    else if (tank.resting) resting += 1;
    else working += 1;
    freeResets += tank.freeResets;

    const recovers =
      tank.status === 'success' &&
      tank.level !== null &&
      tank.level < 100 &&
      tank.levelResetMs !== null &&
      tank.levelResetMs > nowMs;
    if (recovers && (next === null || (tank.levelResetMs as number) < next.atMs)) {
      next = { key: tank.key, shortName: tank.shortName, atMs: tank.levelResetMs as number };
    }
  }

  const pools = providerOrder
    .map((provider): TankPool | null => {
      const levels = tanks
        .filter((tank) => tank.provider === provider && tank.status === 'success')
        .map((tank) => tank.level)
        .filter((level): level is number => level !== null);
      if (levels.length === 0) return null;
      const percent = Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length);
      return { provider, percent, count: levels.length };
    })
    .filter((pool): pool is TankPool => pool !== null);

  return { total: tanks.length, working, resting, failed, pending, next, freeResets, pools };
}

/* ----------------------------------------------------------------- forecast */

export interface ForecastEvent {
  key: string;
  tankKey: string;
  provider: QuotaProviderType;
  shortName: string;
  atMs: number;
  kind: 'short' | 'weekly';
  /** Tone of the level that refills, so the pin matches the tank colour. */
  tone: TankTone;
}

/**
 * Refills inside the next `spanMs`. A window that is already full is not an
 * event — nothing comes back — and a tank whose level is the weekly window
 * reports it once, as weekly.
 */
export function buildForecastEvents(
  tanks: readonly TankModel[],
  nowMs: number,
  spanMs: number = FORECAST_SPAN_MS
): ForecastEvent[] {
  const inSpan = (atMs: number | null): atMs is number =>
    atMs !== null && atMs > nowMs && atMs <= nowMs + spanMs;
  const events: ForecastEvent[] = [];

  for (const tank of tanks) {
    if (tank.status !== 'success') continue;
    const levelRefills = tank.level !== null && tank.level < 100 && inSpan(tank.levelResetMs);
    if (levelRefills) {
      events.push({
        key: `${tank.key}:level`,
        tankKey: tank.key,
        provider: tank.provider,
        shortName: tank.shortName,
        atMs: tank.levelResetMs as number,
        kind: tank.levelIsLong ? 'weekly' : 'short',
        tone: levelTone(tank.level),
      });
    }
    const weeklyRefills =
      !tank.levelIsLong &&
      tank.weekly !== null &&
      tank.weekly < 100 &&
      inSpan(tank.weeklyResetMs) &&
      tank.weeklyResetMs !== tank.levelResetMs;
    if (weeklyRefills) {
      events.push({
        key: `${tank.key}:weekly`,
        tankKey: tank.key,
        provider: tank.provider,
        shortName: tank.shortName,
        atMs: tank.weeklyResetMs as number,
        kind: 'weekly',
        tone: levelTone(tank.weekly),
      });
    }
  }

  return events.sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
}

export interface PlacedForecastEvent extends ForecastEvent {
  /** Horizontal position of the refill instant, 0..100 of the track. */
  leftPercent: number;
  /** Pill hangs to the left of its pin because it would overflow the track. */
  flipped: boolean;
  row: number;
}

/**
 * Greedy row packing for one lane: pills that land close together stack
 * instead of overlapping. `labelWidthPx` estimates a pill's width.
 */
export function packForecastLane(
  events: readonly ForecastEvent[],
  nowMs: number,
  trackWidthPx: number,
  labelWidthPx: (event: ForecastEvent) => number,
  spanMs: number = FORECAST_SPAN_MS,
  gapPx = 6
): { placed: PlacedForecastEvent[]; rows: number } {
  const width = Math.max(1, trackWidthPx);
  const rowEnds: number[] = [];
  const placed = [...events]
    .sort((a, b) => a.atMs - b.atMs)
    .map((event) => {
      const x = ((event.atMs - nowMs) / spanMs) * width;
      const w = labelWidthPx(event);
      const flipped = x + w > width;
      const start = flipped ? x - w : x;
      const end = flipped ? x : x + w;
      let row = rowEnds.findIndex((rowEnd) => start >= rowEnd + gapPx);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(end);
      } else {
        rowEnds[row] = end;
      }
      return { ...event, leftPercent: clampPercent((x / width) * 100), flipped, row };
    });
  return { placed, rows: rowEnds.length };
}

/* ----------------------------------------------------------------- duration */

export interface DurationParts {
  key: 'duration_days' | 'duration_hours' | 'duration_minutes' | 'duration_now';
  values: { d?: number; h?: number; m?: number };
}

/** Countdown split into the coarsest two units, truncated (never claims more time than remains). */
export function durationParts(ms: number): DurationParts {
  if (!Number.isFinite(ms) || ms <= 0) return { key: 'duration_now', values: {} };
  const totalMinutes = Math.max(1, Math.floor(ms / 60_000));
  const d = Math.floor(totalMinutes / (24 * 60));
  const h = Math.floor((totalMinutes % (24 * 60)) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return { key: 'duration_days', values: { d, h } };
  if (h > 0) return { key: 'duration_hours', values: { h, m } };
  return { key: 'duration_minutes', values: { m } };
}
