import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  applyOutcome,
  deadlineCache,
  EMPTY_CACHE,
  LEASE_MS,
  type DeadlineCache,
} from '../deadline-cache';
import { readAccountHash } from '../klas/account';
import { collectDeadlines } from '../klas/collect-deadlines';
import { refreshDeadlines, type RefreshDeps } from '../refresh-deadlines';

const WAIT_INTERVAL_MS = 2_000;

export function useDeadlineList(ctx: ContentScriptContext, send: RefreshDeps['send']) {
  const [shared, setShared] = useState(EMPTY_CACHE);
  const [local, setLocal] = useState<DeadlineCache | null>(null);
  const [accountHash, setAccountHash] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => deadlineCache.watch(setShared), []);

  const check = useCallback(
    async (force = false) => {
      if (inFlight.current || ctx.isInvalid) return;
      inFlight.current = true;
      setChecking(true);
      setAccountHash(null);
      setLocal(null);

      let verifiedCache = EMPTY_CACHE;
      try {
        const hash = await readAccountHash();
        if (ctx.isInvalid) return;
        setAccountHash(hash);
        const deps = {
          send,
          collect: collectDeadlines,
          now: Date.now,
          accountHash: hash,
          readAccountHash,
        };
        if (hash) {
          const cached = await deadlineCache.getValue();
          if (cached.accountHash === hash) verifiedCache = cached;
          setShared(cached);
        }

        let result = await refreshDeadlines(deps, force);
        const waitUntil = Date.now() + LEASE_MS + WAIT_INTERVAL_MS;
        while (result.action === 'wait' && !ctx.isInvalid) {
          await new Promise<void>((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
          if (ctx.isInvalid) return;
          if (Date.now() > waitUntil) throw new Error('다른 KLAS 탭의 조회 시간이 초과됐습니다.');
          if ((await deadlineCache.getValue()).accountHash !== hash) {
            setAccountHash(null);
            return;
          }
          result = await refreshDeadlines(deps);
        }
        if (ctx.isInvalid) return;
        if (result.action === 'fetch-uncached') {
          setLocal(applyOutcome(EMPTY_CACHE, result.outcome, Date.now()));
        } else if (result.action === 'account-unverified') {
          setAccountHash(null);
          setLocal({
            ...EMPTY_CACHE,
            lastError: {
              kind: result.sessionExpired ? 'session' : 'unexpected',
              at: Date.now(),
              path: '',
              message: '',
            },
          });
        } else if (hash) {
          setShared(await deadlineCache.getValue());
        }
      } catch (error) {
        if (ctx.isInvalid) return;
        console.warn('[KLAS Helper Plus] 마감 일정을 확인하지 못했습니다.', error);
        setLocal({
          ...verifiedCache,
          lastError: { kind: 'unexpected', at: Date.now(), path: '', message: '' },
        });
      } finally {
        inFlight.current = false;
        if (!ctx.isInvalid) setChecking(false);
      }
    },
    [ctx, send],
  );

  useEffect(() => {
    void check();
  }, [check]);

  const visibleShared = accountHash && shared.accountHash === accountHash ? shared : EMPTY_CACHE;
  const visibleLocal =
    local?.accountHash && local.accountHash !== shared.accountHash ? null : local;
  const cache =
    visibleShared.lastError?.kind === 'session' ? visibleShared : (visibleLocal ?? visibleShared);
  return { cache, checking, check };
}
