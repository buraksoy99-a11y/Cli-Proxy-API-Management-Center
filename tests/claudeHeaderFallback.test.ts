import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  buildClaudeWindowsFromHeaders,
  isClaudeLoginLost,
} from '@/features/quota/providers/claude/data';
import type { AuthFileItem } from '@/types';

const t = ((key: string) => key) as TFunction;
const NOW = Date.parse('2026-11-26T17:00:00+03:00');
const FUTURE_5H = Math.floor(NOW / 1000) + 2 * 3600;
const FUTURE_7D = Math.floor(NOW / 1000) + 4 * 86400;
const PAST = Math.floor(NOW / 1000) - 3600;

const file = (extra: Record<string, unknown>): AuthFileItem =>
  ({ name: 'claude-b1.json', provider: 'claude', ...extra }) as AuthFileItem;

describe('Claude windows from proxy rate-limit headers', () => {
  test('maps 5h, 7d and the Fable bucket, newest snapshot wins per bucket', () => {
    const windows = buildClaudeWindowsFromHeaders(
      file({
        quota: {
          observed_at: '2026-11-26T16:00:00+03:00',
          signals: {
            'Anthropic-Ratelimit-Unified-5h-Utilization': '0.10',
            'Anthropic-Ratelimit-Unified-5h-Reset': String(FUTURE_5H),
          },
        },
        model_quotas: {
          'claude-fable-5-2': {
            observed_at: '2026-11-26T16:50:00+03:00',
            signals: {
              'Anthropic-Ratelimit-Unified-5h-Utilization': '0.89',
              'Anthropic-Ratelimit-Unified-5h-Reset': String(FUTURE_5H),
              'Anthropic-Ratelimit-Unified-7d-Utilization': '0.15',
              'Anthropic-Ratelimit-Unified-7d-Reset': String(FUTURE_7D),
              'Anthropic-Ratelimit-Unified-7d_oi-Utilization': '0.21',
              'Anthropic-Ratelimit-Unified-7d_oi-Reset': String(FUTURE_7D),
              'Anthropic-Ratelimit-Unified-Overage-Utilization': '0.5',
            },
          },
        },
      }),
      t,
      NOW
    );
    expect(windows.map((w) => [w.id, w.usedPercent, w.periodHours])).toEqual([
      ['five-hour', 89, 5],
      ['seven-day', 15, 168],
      ['seven-day-fable', 21, 168],
    ]);
    expect(windows[0].resetAtMs).toBe(FUTURE_5H * 1000);
  });

  test('a window whose reset passed reads as started over', () => {
    const [w] = buildClaudeWindowsFromHeaders(
      file({
        model_quotas: {
          'claude-opus-5-5': {
            observed_at: '2026-11-26T10:00:00+03:00',
            signals: {
              'anthropic-ratelimit-unified-5h-utilization': '0.98',
              'anthropic-ratelimit-unified-5h-reset': String(PAST),
            },
          },
        },
      }),
      t,
      NOW
    );
    expect(w.usedPercent).toBe(0);
    expect(w.resetAtMs).toBeNull();
  });

  test('no snapshots means no windows (caller keeps the original error)', () => {
    expect(buildClaudeWindowsFromHeaders(file({}), t, NOW)).toEqual([]);
    expect(buildClaudeWindowsFromHeaders(file({ quota: { signals: {} } }), t, NOW)).toEqual([]);
  });
});

describe('Claude login-lost detection', () => {
  test('refresh-token failures and unauthorized count as lost, rate limits do not', () => {
    expect(isClaudeLoginLost(file({ statusMessage: 'unauthorized (refresh token invalid)' }))).toBe(
      true
    );
    expect(isClaudeLoginLost(file({ status_message: 'unauthorized' }))).toBe(true);
    expect(
      isClaudeLoginLost(file({ statusMessage: '{"error":{"type":"rate_limit_error"}}' }))
    ).toBe(false);
    expect(isClaudeLoginLost(file({}))).toBe(false);
  });
});
