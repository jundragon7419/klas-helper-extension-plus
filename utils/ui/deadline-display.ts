import type { DeadlineCache } from '../deadline-cache';
import { pendingDeadlines, type Deadline } from '../klas/deadlines';

const koreaTime = { timeZone: 'Asia/Seoul' };
const dayKey = new Intl.DateTimeFormat('en-CA', {
  ...koreaTime,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dateLabel = new Intl.DateTimeFormat('ko-KR', {
  ...koreaTime,
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});
export const deadlineTime = new Intl.DateTimeFormat('ko-KR', {
  ...koreaTime,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export const checkedTime = new Intl.DateTimeFormat('ko-KR', {
  ...koreaTime,
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function groupDeadlines(deadlines: readonly Deadline[], now: number) {
  const groups = new Map<string, { label: string; items: Deadline[] }>();
  for (const item of pendingDeadlines(deadlines, now)) {
    const key = dayKey.format(item.dueAt);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { label: dateLabel.format(item.dueAt), items: [item] });
  }
  return [...groups].map(([key, group]) => ({ key, ...group }));
}

export function deadlineDisplay(cache: DeadlineCache, checking: boolean, now: number) {
  const { snapshot, lastError } = cache;
  const loginRequired = lastError?.kind === 'session';
  const groups = loginRequired ? [] : groupDeadlines(snapshot?.deadlines ?? [], now);
  let message = '';
  if (loginRequired) message = 'KLAS 로그인이 필요합니다';
  else if (checking) message = '마감 일정을 확인하는 중입니다';
  else if (lastError) {
    message = snapshot
      ? '새로 확인하지 못했습니다. 이전 목록을 보여 줍니다'
      : '마감 일정을 확인하지 못했습니다';
  } else if (!snapshot) message = '아직 확인한 기록이 없습니다';
  else if (snapshot.failures.length || snapshot.skipped.length)
    message = '일부 마감을 확인하지 못했습니다';
  else if (groups.length === 0) message = '남은 마감이 없습니다';
  return { groups, message, loginRequired, checkedAt: loginRequired ? null : snapshot?.checkedAt };
}
