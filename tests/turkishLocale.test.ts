import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import { LANGUAGE_LABEL_KEYS, SUPPORTED_LANGUAGES } from '@/utils/constants';

/**
 * Turkish is intentionally a partial locale: only the quota page (plus the shared chrome it
 * renders) is translated, and every other key falls back to English through
 * `fallbackLng: { tr: ['en'] }`. That is why the four-locale parity checks elsewhere do not
 * include `tr`; this suite instead pins the namespaces Turkish must cover in full.
 */
const FULL_NAMESPACES = [
  'quota_tank',
  'quota_management',
  'claude_quota',
  'codex_quota',
  'kimi_quota',
] as const;

type Namespace = Record<string, string>;

const TOKEN_PATTERN = /\{\{[^}]+\}\}|<\/?\d+>/g;
const tokensOf = (value: string) => [...new Set(value.match(TOKEN_PATTERN) ?? [])].sort();

const namespaceOf = (locale: unknown, ns: string) =>
  (locale as Record<string, Namespace | undefined>)[ns];

describe('Turkish locale', () => {
  test('is a selectable language labelled Türkçe', () => {
    expect(SUPPORTED_LANGUAGES).toContain('tr');
    expect(LANGUAGE_LABEL_KEYS.tr).toBe('language.turkish');
    expect(tr.language.turkish).toBe('Türkçe');
  });

  test('covers every key of the quota namespaces', () => {
    for (const ns of FULL_NAMESPACES) {
      const reference = namespaceOf(en, ns);
      const local = namespaceOf(tr, ns);
      expect(reference).toBeDefined();
      expect(local).toBeDefined();
      const missing = Object.keys(reference ?? {}).filter((key) => !local?.[key]?.trim());
      expect({ ns, missing }).toEqual({ ns, missing: [] });
    }
  });

  test('keeps the placeholders and Trans slots of the English source', () => {
    for (const [ns, local] of Object.entries(tr as unknown as Record<string, Namespace>)) {
      const reference = namespaceOf(en, ns) ?? {};
      for (const [key, value] of Object.entries(local)) {
        expect(reference[key]).toBeDefined();
        expect({ key: `${ns}.${key}`, tokens: tokensOf(value) }).toEqual({
          key: `${ns}.${key}`,
          tokens: tokensOf(reference[key] ?? ''),
        });
      }
    }
  });

  test('falls back to English, not Chinese, for untranslated keys', async () => {
    const original = i18n.language;
    // A key from a page Turkish does not translate; guard the fixture so it stays meaningful.
    expect(namespaceOf(tr, 'nav')?.dashboard).toBeUndefined();
    expect(en.nav.dashboard).not.toBe(zhCN.nav.dashboard);

    try {
      await i18n.changeLanguage('tr');
      expect(i18n.t('nav.dashboard')).toBe(en.nav.dashboard);
      expect(i18n.t('nav.quota_management')).toBe(tr.nav.quota_management);
      expect(i18n.t('quota_tank.percent', { value: 40 })).toBe('%40');
    } finally {
      await i18n.changeLanguage(original);
    }
  });
});
