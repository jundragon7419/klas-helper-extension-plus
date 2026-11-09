import { describe, expect, it } from 'vitest';
import type { DeadlineCache } from '@/utils/deadline-cache';
import type { Deadline } from '@/utils/klas/deadlines';
import { deadlineDisplay, groupDeadlines } from '@/utils/ui/deadline-display';

const now = Date.parse('2026-11-09T12:00:00+09:00');
const item = (id: string, dueAt: string, done = false): Deadline => ({
  id,
  kind: 'task',
  semester: '2026,2',
  subjectCode: 'sample',
  subjectName: '예시 과목',
  title: id,
  startsAt: null,
  dueAt: Date.parse(dueAt),
  done,
  extended: false,
  listPage: '/std/lis/evltn/TaskStdPage.do',
});

const deadline = item('남은 항목', '2026-11-09T23:59:00+09:00');
const cache: DeadlineCache = {
  lastError: null,
  snapshot: {
    semester: '2026,2',
    checkedAt: now,
    deadlines: [deadline],
    failures: [],
    skipped: [],
  },
};

describe('마감 일정 표시', () => {
  it('한국 시간 자정을 기준으로 나누고 날짜 안에서 마감순으로 정렬한다', () => {
    const groups = groupDeadlines(
      [
        item('자정 직후', '2026-11-10T00:01:00+09:00'),
        deadline,
        item('오늘 저녁', '2026-11-09T18:00:00+09:00'),
        item('완료', '2026-11-09T13:00:00+09:00', true),
        item('지남', '2026-11-09T11:59:00+09:00'),
      ],
      now,
    );
    expect(groups.map((group) => group.items.map(({ id }) => id))).toEqual([
      ['오늘 저녁', '남은 항목'],
      ['자정 직후'],
    ]);
  });

  it('로그인 만료면 조회 중이어도 이전 목록과 확인 시각을 숨긴다', () => {
    const state = deadlineDisplay(
      { ...cache, lastError: { kind: 'session', at: now, path: '', message: '' } },
      true,
      now,
    );
    expect(state).toMatchObject({ groups: [], loginRequired: true, checkedAt: null });
  });

  it('누락이 있으면 목록이 비어도 일부를 확인하지 못했다고 표시한다', () => {
    const snapshot = {
      semester: '2026,2',
      checkedAt: now,
      deadlines: [],
      failures: [],
      skipped: [],
    };
    expect(deadlineDisplay({ snapshot, lastError: null }, false, now).message).toBe(
      '남은 마감이 없습니다',
    );
    const skipped = [{ kind: 'task' as const, subjectCode: 'sample', reason: '날짜 오류' }];
    expect(
      deadlineDisplay({ snapshot: { ...snapshot, skipped }, lastError: null }, false, now).message,
    ).toBe('일부 마감을 확인하지 못했습니다');
  });

  it('전체 조회 실패는 이전 결과가 있을 때만 저장된 목록을 표시한다', () => {
    const lastError = { kind: 'unexpected' as const, at: now, path: '', message: '' };
    const previous = deadlineDisplay({ ...cache, lastError }, false, now);
    expect(previous.groups[0]?.items).toEqual([deadline]);
    expect(previous.message).toBe('새로 확인하지 못했습니다. 저장된 목록을 보여 줍니다');
    expect(deadlineDisplay({ snapshot: null, lastError }, false, now).message).toBe(
      '마감 일정을 확인하지 못했습니다',
    );
  });
});
