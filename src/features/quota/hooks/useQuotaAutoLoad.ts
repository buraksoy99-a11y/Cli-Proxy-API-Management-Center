import { useEffect, useRef } from 'react';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';

/**
 * Loads each visible credential's quota once per page visit.
 *
 * The page summary ("6 accounts working…") only means something when every
 * tank is filled, so opening the page reads them all once. There is no polling:
 * Anthropic answers frequent usage reads with 429, so later reads stay manual.
 * A credential that appears during the visit (a new login) is read as it shows
 * up, which is what lets its tank drop in and fill.
 *
 * Runs before `useDevinQuotaAutoLoad` on the page: the loading state it writes
 * makes that hook skip credentials already being read here.
 */
export function useQuotaAutoLoad(
  entries: QuotaFileEntry[],
  disabled: boolean,
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  loadQuota: (targets: QuotaFileEntry[]) => Promise<boolean>
) {
  const attempted = useRef(new Set<string>());
  const session = useQuotaStore((state) => state.cacheGeneration);

  useEffect(() => {
    if (disabled) return;
    const targets = entries.filter((entry) => {
      const key = JSON.stringify([session, entry.type, getQuotaCacheKey(entry.file)]);
      if (attempted.current.has(key)) return false;
      return getQuota(entry)?.status !== 'loading';
    });
    if (targets.length === 0) return;

    const keys = targets.map((entry) =>
      JSON.stringify([session, entry.type, getQuotaCacheKey(entry.file)])
    );
    keys.forEach((key) => attempted.current.add(key));
    void loadQuota(targets).then((started) => {
      // Another batch was in flight; forget these so the next pass retries them.
      if (!started) keys.forEach((key) => attempted.current.delete(key));
    });
  }, [disabled, entries, getQuota, loadQuota, session]);
}
