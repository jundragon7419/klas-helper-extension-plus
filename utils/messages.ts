// content script와 background가 주고받는 요청 메시지

import type { CollectOutcome } from './klas/collect-deadlines';

/** content script → background */
export type ExtensionMessage =
  /** KLAS 학생 페이지가 열렸다. 세션 연장 대상 탭으로 등록한다. */
  | { type: 'klas/opened' }
  /** KLAS 탭이 마감을 조회해도 되는지 묻는다. 답은 FetchDecision */
  | { type: 'deadlines/request'; accountHash: string | null; force?: boolean }
  /** 조회한 탭이 결과를 알린다. */
  | {
      type: 'deadlines/report';
      leaseId: string;
      accountHash: string;
      verifiedAccountHash: string | null;
      outcome: CollectOutcome;
    };

/** background → content script */
export type TabMessage =
  /** 세션을 연장하라. 답은 KlasResult<SessionStatus> */
  { type: 'session/extend' };

const EXTENSION_TYPES = new Set(['klas/opened', 'deadlines/request', 'deadlines/report']);

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (value === null || typeof value !== 'object') return false;
  const { type } = value as { type?: unknown };
  return typeof type === 'string' && EXTENSION_TYPES.has(type);
}

export function isTabMessage(value: unknown): value is TabMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'session/extend'
  );
}
