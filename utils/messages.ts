// content script와 background가 주고받는 메시지

import type { CollectOutcome } from './klas/collect-deadlines';

export type ExtensionMessage =
  /** KLAS 탭이 마감을 조회해도 되는지 묻는다. 답은 FetchDecision */
  | { type: 'deadlines/request'; force?: boolean }
  /** 조회한 탭이 결과를 알린다. */
  | { type: 'deadlines/report'; leaseId: string; outcome: CollectOutcome };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (value === null || typeof value !== 'object') return false;
  const { type } = value as { type?: unknown };
  return type === 'deadlines/request' || type === 'deadlines/report';
}
