// 마감 조회 결과의 캐시 (storage.local). 마지막으로 성공한 결과와 마지막 실패를 담고,
// 브라우저를 껐다 켜도 남는다. content script와 background가 함께 쓴다.
//
// 이 파일은 content script도 불러오므로 storage.session 항목을 두지 않는다.
// WXT의 defineItem은 정의하는 순간 값을 읽는데, content script는 storage.session에
// 접근할 수 없어서 오류가 난다. 세션 항목은 background 전용 파일에 둔다.

import type { KlasError } from './klas/api';
import type { CollectOutcome, DeadlineSnapshot } from './klas/collect-deadlines';

/** 이 시간 안의 결과는 다시 조회하지 않는다. */
export const FRESH_FOR_MS = 5 * 60_000;

/** 세션 만료가 아닌 실패 뒤에는 이 시간 동안 다시 조회하지 않는다. KLAS 서버에 부담을 주지 않으려고 둔다. */
export const RETRY_AFTER_FAILURE_MS = 60_000;

/**
 * 조회권의 유효 시간. 조회 중인 탭이 응답 없이 멈춰도 이 시간이 지나면 다른 탭이 이어받는다.
 * 요청 하나의 제한 시간이 15초이고 조회는 과목 목록 1번과 과목 수만큼 차례로 부르므로,
 * 과목 10개까지 모두 제한 시간을 채워도(15초 × 11 = 165초) 만료되지 않게 3분으로 둔다.
 * 조회 중인 탭이 닫히면 이 시간과 관계없이 바로 돌려받는다.
 */
export const LEASE_MS = 3 * 60_000;

export interface DeadlineCache {
  /** 현재 캐시의 계정. 이전 버전에서 저장한 캐시는 이 값이 없다. */
  accountHash?: string;
  /** 계정이 바뀔 때마다 새로 발급하는 조회권 범위. */
  fetchScope?: string;
  /** 마지막으로 성공한 결과 */
  snapshot: DeadlineSnapshot | null;
  /** 마지막 실패 기록. 실패 이후 시작한 조회가 성공하면 지운다. */
  lastError: (KlasError & { at: number }) | null;
}

export const EMPTY_CACHE: DeadlineCache = { snapshot: null, lastError: null };

export const deadlineCache = storage.defineItem<DeadlineCache>('local:deadlineCache', {
  fallback: EMPTY_CACHE,
  version: 1,
});

/** 이전 확장이 진단에 덧붙인 응답 원문만 제거한다. */
function redactLegacyError<T extends KlasError>(error: T): T {
  if (error.kind === 'schema') {
    const suffix = ': 형식이 다름';
    const start = error.message.indexOf(suffix + ' (');
    if (start !== -1) return { ...error, message: error.message.slice(0, start + suffix.length) };
  }
  if (error.kind === 'not-json' && error.message.startsWith('JSON이 아닌 응답 (')) {
    return { ...error, message: 'JSON이 아닌 응답' };
  }
  return error;
}

function redactLegacySnapshot(snapshot: DeadlineSnapshot | null): DeadlineSnapshot | null {
  if (!snapshot || (snapshot.failures.length === 0 && snapshot.skipped.length === 0)) {
    return snapshot;
  }
  return {
    ...snapshot,
    failures: snapshot.failures.map(redactLegacyError),
    skipped: snapshot.skipped.map((row) =>
      row.reason.startsWith('마감 날짜를 읽을 수 없음:')
        ? { ...row, reason: '마감 날짜를 읽을 수 없음' }
        : row,
    ),
  };
}

/** 조회 결과를 캐시에 반영한다. 실패하면 이전 결과를 그대로 두고 실패만 기록한다. */
export function applyOutcome(
  cache: DeadlineCache,
  outcome: CollectOutcome,
  now: number,
): DeadlineCache {
  if (outcome.ok) {
    const { lastError } = cache;
    const { snapshot } = outcome;
    const keepError = lastError !== null && snapshot.checkedAt <= lastError.at;
    return {
      ...cache,
      snapshot: redactLegacySnapshot(snapshot),
      lastError: keepError ? redactLegacyError(lastError) : null,
    };
  }
  return {
    ...cache,
    snapshot: redactLegacySnapshot(cache.snapshot),
    lastError: { ...redactLegacyError(outcome.error), at: now },
  };
}

/**
 * 지금 다시 조회하지 않아도 되는지 본다.
 * - 5분 안에 성공한 결과가 있으면 그것을 쓴다.
 * - 1분 안에 실패했으면 기다린다. 단, 세션 만료는 다시 로그인한 뒤 바로 조회해야 하므로 기다리지 않는다.
 */
export function isFresh(cache: DeadlineCache, now: number): boolean {
  const { snapshot, lastError } = cache;
  if (lastError && lastError.kind !== 'session' && now - lastError.at < RETRY_AFTER_FAILURE_MS) {
    return true;
  }
  if (lastError) return false;
  if (snapshot === null || now - snapshot.checkedAt >= FRESH_FOR_MS) return false;
  // 이전 캐시의 과제와 팀 프로젝트에는 추가 제출 기한을 다시 계산할 정보가 없다.
  return !snapshot.deadlines.some(
    (item) =>
      (item.kind === 'task' || item.kind === 'project') && item.submissionWindow === undefined,
  );
}
