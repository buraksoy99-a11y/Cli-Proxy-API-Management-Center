/**
 * Locale-aware text for the tank farm: countdowns and percentages.
 *
 * Kept apart from tankModel.ts so the model stays free of i18n. Percent order
 * is a translation concern (Turkish writes `%72`), so it goes through
 * `quota_tank.percent` rather than string concatenation.
 */

import type { TFunction } from 'i18next';
import { durationParts } from './tankModel';

export function formatTankDuration(t: TFunction, ms: number): string {
  const parts = durationParts(ms);
  return t(`quota_tank.${parts.key}`, parts.values);
}

export function formatTankPercent(t: TFunction, value: number): string {
  return t('quota_tank.percent', { value: Math.round(value) });
}
