// content script가 background와 주고받으며 마감을 조회하는 흐름.
// 테스트할 수 있게 메시지 보내기, 조회 함수, 시계를 주입받는다.

import type { FetchDecision } from './fetch-coordinator';
import type { CollectOutcome } from './klas/collect-deadlines';
import type { ExtensionMessage } from './messages';

export interface RefreshDeps {
  send: (message: ExtensionMessage) => Promise<unknown>;
  collect: (now: number) => Promise<CollectOutcome>;
  now: () => number;
}

/** 조회 중에 난 예외를 결과로 바꾼다. 화면에는 보여 주지 않고 원인 확인용으로 남긴다. */
function unexpectedOutcome(error: unknown): CollectOutcome {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { ok: false, error: { kind: 'unexpected', path: '', message } };
}

/**
 * background에 묻고, 이 탭이 조회할 차례면 조회해서 결과를 알린다.
 * 조회 함수가 예외를 던져도 실패로 알려서, 조회권을 바로 돌려주고 실패를 캐시에 남긴다.
 */
export async function refreshDeadlines(deps: RefreshDeps, force = false): Promise<FetchDecision> {
  const decision = (await deps.send({ type: 'deadlines/request', force })) as FetchDecision;
  if (decision.action !== 'fetch') return decision;

  let outcome: CollectOutcome;
  try {
    outcome = await deps.collect(deps.now());
  } catch (error) {
    outcome = unexpectedOutcome(error);
  }
  await deps.send({ type: 'deadlines/report', leaseId: decision.leaseId, outcome });
  return decision;
}
