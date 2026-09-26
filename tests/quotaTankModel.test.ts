import { describe, expect, test } from 'bun:test';
import {
  buildFarmSummary,
  buildForecastEvents,
  buildTankModel,
  durationParts,
  levelTone,
  packForecastLane,
  tankShortName,
} from '@/features/quota/tankModel';

const H = 3_600_000;
const NOW = Date.parse('2026-09-26T12:00:00Z');

const claudeQuota = (fiveUsed: number, weekUsed: number, opusUsed = 10, grants = 0) => ({
  status: 'success',
  windows: [
    { id: 'five-hour', label: '5h', usedPercent: fiveUsed, resetAtMs: NOW + 2 * H, periodHours: 5 },
    {
      id: 'seven-day',
      label: '7d',
      usedPercent: weekUsed,
      resetAtMs: NOW + 60 * H,
      periodHours: 168,
    },
    // Resets sooner than the account-wide week, so a naive "soonest weekly" pick would take it.
    {
      id: 'seven-day-opus',
      label: 'opus',
      usedPercent: opusUsed,
      resetAtMs: NOW + 20 * H,
      periodHours: 168,
    },
  ],
  resetGrants: grants
    ? { availableCount: grants, nextGrantId: 'g1', expiresAt: null, cooldownUntil: null }
    : null,
});

const codexQuota = (fiveUsed: number, weekUsed: number, credits = 0) => ({
  status: 'success',
  windows: [
    { id: 'five-hour', label: '5h', usedPercent: fiveUsed, resetAtMs: NOW + 1 * H, periodHours: 5 },
    {
      id: 'weekly',
      label: 'week',
      usedPercent: weekUsed,
      resetAtMs: NOW + 30 * H,
      periodHours: 168,
    },
  ],
  rateLimitResetCreditsAvailableCount: credits,
  rateLimitResetCredits: [],
});

const kimiWeeklyOnly = {
  status: 'success',
  rows: [{ label: 'week', used: 30, limit: 100, resetAtMs: NOW + 10 * H, periodHours: 168 }],
};

const tank = (key: string, provider: 'claude' | 'codex' | 'kimi', quota: unknown, name = key) =>
  buildTankModel({ key, name, provider, quota });

describe('tank model', () => {
  test('uses the short window as the level and the account-wide week as the tube', () => {
    const model = tank('c1', 'claude', claudeQuota(28, 42, 90, 2));
    expect(model.level).toBe(72);
    expect(model.levelResetMs).toBe(NOW + 2 * H);
    expect(model.levelIsLong).toBeFalse();
    expect(model.weekly).toBe(58);
    expect(model.weeklyResetMs).toBe(NOW + 60 * H);
    expect(model.freeResets).toBe(2);
    expect(model.resting).toBeFalse();
  });

  test('marks an empty short window as resting and counts Codex reset credits', () => {
    const model = tank('x1', 'codex', codexQuota(100, 20, 1));
    expect(model.level).toBe(0);
    expect(model.resting).toBeTrue();
    expect(model.weekly).toBe(80);
    expect(model.freeResets).toBe(1);
  });

  test('reads a just-refilled account as full even though Anthropic sends no reset time', () => {
    const model = tank('c1', 'claude', {
      status: 'success',
      windows: [
        { id: 'five-hour', usedPercent: 0, resetAtMs: null, periodHours: 5 },
        { id: 'seven-day', usedPercent: 0, resetAtMs: null, periodHours: 168 },
      ],
    });
    expect(model.level).toBe(100);
    expect(model.levelResetMs).toBeNull();
    expect(model.weekly).toBe(100);
    expect(model.resting).toBeFalse();
  });

  test('falls back to the only window and draws no duplicate weekly tube', () => {
    const model = tank('k1', 'kimi', kimiWeeklyOnly);
    expect(model.level).toBe(70);
    expect(model.levelIsLong).toBeTrue();
    expect(model.weekly).toBeNull();
  });

  test('leaves levels unknown until the quota has loaded', () => {
    for (const quota of [undefined, { status: 'loading' }, { status: 'error', error: 'x' }]) {
      const model = tank('c1', 'claude', quota);
      expect(model.level).toBeNull();
      expect(model.weekly).toBeNull();
      expect(model.resting).toBeFalse();
    }
    expect(tank('c1', 'claude', undefined).status).toBe('idle');
    expect(tank('c1', 'claude', { status: 'error' }).status).toBe('error');
  });

  test('shortens labels to the account name', () => {
    expect(tankShortName('claude-ana@example.com.json', 'claude')).toBe('ana');
    expect(tankShortName('x.json', 'codex', 'burak@example.com')).toBe('burak');
    expect(tankShortName('kimi-1784450588458.json', 'kimi')).toBe('kimi-1784450588458');
    expect(tankShortName('work.json', 'codex')).toBe('work');
  });

  test('maps levels to tones at the documented thresholds', () => {
    expect([null, 0, 12, 20, 49, 50, 100].map(levelTone)).toEqual([
      'none',
      'rest',
      'low',
      'mid',
      'mid',
      'ok',
      'ok',
    ]);
  });
});

describe('farm summary', () => {
  const tanks = [
    tank('c1', 'claude', claudeQuota(28, 42)),
    tank('c2', 'claude', claudeQuota(100, 90)),
    tank('x1', 'codex', codexQuota(50, 10, 1)),
    tank('k1', 'kimi', { status: 'error', error: 'boom' }),
    tank('k2', 'kimi', undefined),
  ];

  test('counts working, resting, failed and pending tanks', () => {
    const summary = buildFarmSummary(tanks, ['claude', 'codex', 'kimi'], NOW);
    expect(summary).toMatchObject({ total: 5, working: 2, resting: 1, failed: 1, pending: 1 });
    expect(summary.freeResets).toBe(1);
  });

  test('picks the tank that refills first among those with something to recover', () => {
    const summary = buildFarmSummary(tanks, ['claude', 'codex', 'kimi'], NOW);
    expect(summary.next).toEqual({ key: 'x1', shortName: 'x1', atMs: NOW + 1 * H });
  });

  test('averages loaded levels per provider and skips providers with nothing loaded', () => {
    const summary = buildFarmSummary(tanks, ['claude', 'codex', 'kimi'], NOW);
    expect(summary.pools).toEqual([
      { provider: 'claude', percent: 36, count: 2 },
      { provider: 'codex', percent: 50, count: 1 },
    ]);
  });
});

describe('refill forecast', () => {
  test('lists short and weekly refills inside the span, soonest first', () => {
    const events = buildForecastEvents(
      [
        tank('c1', 'claude', claudeQuota(28, 42)),
        tank('x1', 'codex', codexQuota(50, 10)),
        tank('k1', 'kimi', kimiWeeklyOnly),
      ],
      NOW
    );
    expect(events.map((event) => [event.tankKey, event.kind, event.atMs - NOW])).toEqual([
      ['x1', 'short', 1 * H],
      ['c1', 'short', 2 * H],
      ['k1', 'weekly', 10 * H],
    ]);
  });

  test('skips full windows and instants outside the span', () => {
    const events = buildForecastEvents([tank('c1', 'claude', claudeQuota(0, 0))], NOW);
    expect(events).toEqual([]);
    const later = buildForecastEvents([tank('x1', 'codex', codexQuota(50, 10))], NOW, 30 * H);
    expect(later.map((event) => event.kind)).toEqual(['short', 'weekly']);
  });

  test('stacks pills that would overlap and flips the ones that would overflow', () => {
    const events = buildForecastEvents(
      [
        tank('a', 'claude', claudeQuota(50, 0)),
        tank('b', 'claude', claudeQuota(60, 0)),
        tank('x1', 'codex', codexQuota(50, 10)),
      ],
      NOW,
      30 * H
    );
    const { placed, rows } = packForecastLane(events, NOW, 300, () => 80, 30 * H);
    const byKey = Object.fromEntries(placed.map((event) => [event.key, event]));
    // x1 (+1h), a and b (+2h) are 10-20px apart with 80px pills: each needs its own row.
    expect(new Set([byKey['x1:level'].row, byKey['a:level'].row, byKey['b:level'].row])).toEqual(
      new Set([0, 1, 2])
    );
    // The weekly refill sits at the right edge, hangs left of its pin and reuses the first row.
    expect(byKey['x1:weekly'].flipped).toBeTrue();
    expect(byKey['x1:weekly'].row).toBe(0);
    expect(rows).toBe(3);
  });
});

describe('duration parts', () => {
  test('keeps the two coarsest units and truncates', () => {
    expect(durationParts(0)).toEqual({ key: 'duration_now', values: {} });
    expect(durationParts(30_000)).toEqual({ key: 'duration_minutes', values: { m: 1 } });
    expect(durationParts(78 * 60_000 + 59_000)).toEqual({
      key: 'duration_hours',
      values: { h: 1, m: 18 },
    });
    expect(durationParts(52 * H + 30 * 60_000)).toEqual({
      key: 'duration_days',
      values: { d: 2, h: 4 },
    });
  });
});
