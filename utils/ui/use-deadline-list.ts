import { useCallback, useRef, useState } from 'preact/hooks';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { EMPTY_CACHE, isFresh, type DeadlineCache } from '../deadline-cache';
import { checkAccount } from '../klas/account';
import { collectDeadlines } from '../klas/collect-deadlines';
import { refreshDeadlines } from '../refresh-deadlines';

export function useDeadlineList(ctx: ContentScriptContext) {
  const [cache, setCache] = useState(EMPTY_CACHE);
  const [checking, setChecking] = useState(false);
  const current = useRef<{ accountHash: string | null; cache: DeadlineCache }>({
    accountHash: null,
    cache: EMPTY_CACHE,
  });
  const inFlight = useRef(false);

  const check = useCallback(
    async (force = false) => {
      if (inFlight.current || ctx.isInvalid) return;
      inFlight.current = true;
      if (force || current.current.cache.snapshot === null) setChecking(true);
      try {
        const account = await checkAccount();
        const accountHash = 'hash' in account ? account.hash : null;
        if (ctx.isInvalid) return;

        const sameAccount = accountHash !== null && current.current.accountHash === accountHash;
        const previous = sameAccount ? current.current.cache : EMPTY_CACHE;
        if (!force && isFresh(previous, Date.now())) return;
        setCache(previous);
        setChecking(true);
        const result = await refreshDeadlines(
          { collect: collectDeadlines, now: Date.now, checkAccount },
          account,
          previous,
        );
        if (ctx.isInvalid) return;
        current.current = { accountHash, cache: result };
        setCache(result);
      } finally {
        inFlight.current = false;
        if (!ctx.isInvalid) setChecking(false);
      }
    },
    [ctx],
  );

  return { cache, checking, check };
}
