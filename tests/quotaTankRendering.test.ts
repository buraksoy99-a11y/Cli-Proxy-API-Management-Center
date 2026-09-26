import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { TankFarm } from '../src/features/quota/components/TankFarm';
import { QuotaSummary } from '../src/features/quota/components/QuotaSummary';
import type { TankModel } from '../src/features/quota/tankModel';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const H = 3_600_000;

const tank = (overrides: Partial<TankModel>): TankModel => ({
  key: 'claude:a.json',
  name: 'a.json',
  shortName: 'ana',
  provider: 'claude',
  status: 'success',
  level: 72,
  levelResetMs: NOW + 2 * H,
  levelIsLong: false,
  weekly: 58,
  weeklyResetMs: NOW + 60 * H,
  freeResets: 0,
  resting: false,
  ...overrides,
});

const renderFarm = (tanks: TankModel[]) =>
  renderToStaticMarkup(
    createElement(TankFarm, {
      tanks,
      nowMs: NOW,
      selectedKey: null,
      resolvedTheme: 'dark',
      onSelect: () => {},
    })
  );

describe('tank farm rendering', () => {
  let previousLanguage = 'en';
  beforeAll(async () => {
    previousLanguage = i18n.language;
    await i18n.changeLanguage('tr');
  });
  afterAll(async () => {
    await i18n.changeLanguage(previousLanguage);
  });

  test('centres the resting countdown inside the tank body instead of a ring', () => {
    const markup = renderFarm([
      tank({
        key: 'claude:r.json',
        shortName: 'yedek-2',
        level: 0,
        resting: true,
        levelResetMs: NOW + 78 * 60_000,
      }),
    ]);
    expect(markup).toContain('text-anchor="middle"');
    expect(markup).toContain('x="54"');
    expect(markup).toContain('1 sa 18 dk');
    expect(markup).toContain('sonra dolar');
    expect(markup).toContain('Dinleniyor');
    expect(markup).not.toContain('stroke-dasharray');
  });

  test('writes the Turkish percent sign first and shows the free-reset token', () => {
    const markup = renderFarm([tank({ freeResets: 2 })]);
    expect(markup).toContain('<small>%</small>72');
    expect(markup).toContain('2 bedava reset');
    expect(markup).toContain('Haftalık %58');
  });

  test('marks a failed tank and an unloaded one without inventing a level', () => {
    const markup = renderFarm([
      tank({ key: 'kimi:k.json', provider: 'kimi', status: 'error', level: null, weekly: null }),
      tank({ key: 'claude:i.json', status: 'idle', level: null, weekly: null }),
    ]);
    expect(markup).toContain('Yüklenemedi');
    expect(markup).toContain('-hatch)');
    expect(markup).not.toContain('<small>%</small>');
  });

  test('summarises working and resting accounts and the first refill', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaSummary, {
        summary: {
          total: 3,
          working: 2,
          resting: 1,
          failed: 0,
          pending: 0,
          next: { key: 'claude:r.json', shortName: 'deneme', atMs: NOW + 36 * 60_000 },
          freeResets: 3,
          pools: [{ provider: 'claude', percent: 42, count: 3 }],
        },
        nowMs: NOW,
        listLoading: false,
        resolvedTheme: 'light',
        onJump: () => {},
      })
    );
    expect(markup).toContain('2 hesap çalışıyor, 1 hesap dinleniyor.');
    expect(markup).toContain('deneme');
    expect(markup).toContain('36 dk');
    expect(markup).toContain('3 bedava reset');
    expect(markup).toContain('%42');
  });
});
