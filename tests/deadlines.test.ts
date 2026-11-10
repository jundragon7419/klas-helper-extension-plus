import { describe, expect, it } from 'vitest';
import { parseKlasDate } from '@/utils/date';
import { isFresh } from '@/utils/deadline-cache';
import {
  LIST_PAGES,
  normalizeSubject,
  pendingDeadlines,
  sortByDue,
  type Deadline,
  type SubjectLists,
} from '@/utils/klas/deadlines';
import type { KlasOnlineRow, KlasSemester, KlasTaskRow } from '@/utils/klas/schema';
import fixture from './fixtures/klas/2026-2.json';

const at = (text: string) => parseKlasDate(text)!;
const subject = { value: 'S1', label: '자료구조 (01)', name: '자료구조' };
const base = { semester: '2026,2', subject, now: at('2026-11-06 12:00') };

const lesson = (over: Partial<KlasOnlineRow> = {}): KlasOnlineRow => ({
  evltnSe: 'lesson',
  sbjt: '1주차 강의',
  moduletitle: '1주차',
  startDate: '2026-10-05 00:00',
  endDate: '2026-11-10 23:59',
  isonoff: 'ON',
  prog: 40,
  ...over,
});

const task = (over: Partial<KlasTaskRow> = {}): KlasTaskRow => ({
  title: '과제 1',
  startdate: '2026-11-01 00:00:00',
  expiredate: '2026-11-10 23:59:59',
  reexpiredate: null,
  submityn: 'N',
  ...over,
});

describe('normalizeSubject: 온라인 강의', () => {
  it('마감은 endDate의 그 분 끝(23:59:59)이고, 진도율 100이면 완료다', () => {
    const { deadlines } = normalizeSubject({
      ...base,
      lists: { online: [lesson({ oid: 'C1' }), lesson({ oid: 'C2', prog: 100 })] },
    });
    expect(deadlines).toHaveLength(2);
    expect(deadlines[0]).toMatchObject({
      id: 'online:S1:C1',
      kind: 'online',
      subjectName: '자료구조',
      title: '1주차 강의',
      startsAt: at('2026-10-05 00:00'),
      dueAt: at('2026-11-10 23:59') + 59_000,
      done: false,
      extended: false,
      listPage: LIST_PAGES.online,
    });
    expect(deadlines[1]?.done).toBe(true);
  });

  it('목록에 섞여 오는 퀴즈 줄과 오프라인(OFF) 강의는 넣지 않는다', () => {
    const quizRow = { ...lesson(), evltnSe: 'quiz', isonoff: undefined, prog: undefined };
    const { deadlines } = normalizeSubject({
      ...base,
      lists: { online: [quizRow, lesson({ isonoff: 'OFF' })] },
    });
    expect(deadlines).toEqual([]);
  });
});

describe('normalizeSubject: 과제와 팀 프로젝트', () => {
  it('제출했으면 완료다', () => {
    const { deadlines } = normalizeSubject({
      ...base,
      lists: { task: [task({ submityn: 'Y', taskNo: 3 })] },
    });
    expect(deadlines[0]).toMatchObject({ id: 'task:S1:3', done: true, extended: false });
  });

  it('원래 기한 안이면 원래 기한이 마감이다', () => {
    const row = task({ reexpiredate: '2026-11-14 23:59:59' });
    const { deadlines } = normalizeSubject({ ...base, lists: { task: [row] } });
    expect(deadlines[0]).toMatchObject({ dueAt: at('2026-11-10 23:59:59'), extended: false });
  });

  it('원래 기한이 지났고 추가 제출 기한이 있으면 추가 기한이 마감이다', () => {
    const row = task({ expiredate: '2026-11-05 23:59:59', reexpiredate: '2026-11-09 23:59:59' });
    const { deadlines } = normalizeSubject({ ...base, lists: { task: [row] } });
    expect(deadlines[0]).toMatchObject({ dueAt: at('2026-11-09 23:59:59'), extended: true });
  });

  it('원래 기한이 지났고 추가 기한이 없으면 원래 기한 그대로다 (지난 항목)', () => {
    const row = task({ expiredate: '2026-11-05 23:59:59' });
    const { deadlines } = normalizeSubject({ ...base, lists: { task: [row] } });
    expect(deadlines[0]).toMatchObject({ dueAt: at('2026-11-05 23:59:59'), extended: false });
  });

  it('캐시된 과제와 팀 프로젝트를 재조회 없이 추가 제출 기한으로 전환한다', () => {
    const original = at('2026-11-10 23:59:59');
    const extra = at('2026-11-14 23:59:59');
    const row = task({ reexpiredate: '2026-11-14 23:59:59' });
    const { deadlines } = normalizeSubject({
      ...base,
      lists: {
        task: [row, task({ title: '제출한 과제', submityn: 'Y', reexpiredate: row.reexpiredate })],
        project: [row],
      },
    });
    const cached = structuredClone(deadlines);
    expect(pendingDeadlines(cached, original)).toHaveLength(2);
    expect(pendingDeadlines(cached, original + 1)).toEqual([
      expect.objectContaining({ kind: 'task', dueAt: extra, extended: true }),
      expect.objectContaining({ kind: 'project', dueAt: extra, extended: true }),
    ]);
    expect(pendingDeadlines(cached, extra)).toHaveLength(2);
    expect(pendingDeadlines(cached, extra + 1)).toEqual([]);
    expect(cached).toEqual(deadlines);
  });

  it('이전 캐시는 저장된 마감으로 표시하되 다음 조회에서 갱신한다', () => {
    const { deadlines } = normalizeSubject({ ...base, lists: { task: [task()] } });
    const item = deadlines[0]!;
    const cache = {
      snapshot: {
        semester: base.semester,
        checkedAt: base.now,
        deadlines,
        skipped: [],
        failures: [],
      },
      lastError: null,
    };
    expect(isFresh(cache, base.now)).toBe(true);

    delete item.submissionWindow;
    expect(pendingDeadlines(deadlines, base.now)).toEqual([item]);
    expect(isFresh(cache, base.now)).toBe(false);
  });

  it('팀 프로젝트의 UTC 표기 마감도 같은 규칙으로 읽는다', () => {
    const row = task({ expiredate: '2026-11-13T14:59:59.000+00:00', ordseq: 2 });
    const { deadlines } = normalizeSubject({ ...base, lists: { project: [row] } });
    expect(deadlines[0]).toMatchObject({
      id: 'project:S1:2',
      kind: 'project',
      dueAt: at('2026-11-13 23:59:59'),
      listPage: LIST_PAGES.project,
    });
  });
});

describe('normalizeSubject: 퀴즈', () => {
  it('마감은 edt, 제출했으면 완료다', () => {
    const row = {
      papernm: '중간 퀴즈',
      sdt: '2026-10-27 00:00',
      edt: '2026-11-04 15:00',
      issubmit: 'Y',
      papernum: 8163,
    };
    const { deadlines } = normalizeSubject({ ...base, lists: { quiz: [row] } });
    expect(deadlines[0]).toMatchObject({
      id: 'quiz:S1:8163',
      title: '중간 퀴즈',
      dueAt: at('2026-11-04 15:00'),
      done: true,
    });
  });
});

describe('normalizeSubject: 읽을 수 없는 마감', () => {
  it('목록에서 빼고 skipped에 이유를 남긴다', () => {
    const { deadlines, skipped } = normalizeSubject({
      ...base,
      lists: { task: [task({ expiredate: '2026/11/10' })] },
    });
    expect(deadlines).toEqual([]);
    expect(skipped).toEqual([
      { kind: 'task', subjectCode: 'S1', reason: '마감 날짜를 읽을 수 없음: 2026/11/10' },
    ]);
  });

  it('번호 필드가 없으면 목록 안의 순서로 구분한다', () => {
    const { deadlines } = normalizeSubject({ ...base, lists: { task: [task(), task()] } });
    expect(deadlines.map((d) => d.id)).toEqual(['task:S1:#0', 'task:S1:#1']);
  });
});

describe('정렬과 거르기', () => {
  const make = (over: Partial<Deadline>): Deadline => ({
    id: over.title ?? 'x',
    kind: 'task',
    semester: '2026,2',
    subjectCode: 'S1',
    subjectName: '가',
    title: 'x',
    startsAt: null,
    dueAt: 0,
    done: false,
    extended: false,
    listPage: LIST_PAGES.task,
    ...over,
  });

  it('마감 순, 같으면 과목명과 제목 순이고 원래 배열은 그대로다', () => {
    const list = [
      make({ title: 'c', dueAt: 3 }),
      make({ title: 'b', dueAt: 1, subjectName: '나' }),
      make({ title: 'a', dueAt: 1, subjectName: '가' }),
    ];
    expect(sortByDue(list).map((d) => d.title)).toEqual(['a', 'b', 'c']);
    expect(list.map((d) => d.title)).toEqual(['c', 'b', 'a']);
  });

  it('pendingDeadlines는 하지 않았고 지나지 않은 항목만 남긴다', () => {
    const list = [
      make({ title: 'done', dueAt: 100, done: true }),
      make({ title: 'past', dueAt: 10 }),
      make({ title: 'now', dueAt: 50 }),
      make({ title: 'later', dueAt: 90 }),
    ];
    expect(pendingDeadlines(list, 50).map((d) => d.title)).toEqual(['now', 'later']);
  });
});

describe('실제 응답 (tests/fixtures/klas/2026-2.json)', () => {
  const current = (fixture.subjects as KlasSemester[])[0]!;
  const lists = fixture.lists as unknown as Record<string, SubjectLists>;
  // 자료를 모은 날 정오
  const now = at('2026-11-06 12:00');
  const results = current.subjList.map((s) =>
    normalizeSubject({ semester: current.value, subject: s, lists: lists[s.value] ?? {}, now }),
  );
  const all = results.flatMap((r) => r.deadlines);

  it('모든 항목을 읽고 빠진 것이 없다', () => {
    expect(results.flatMap((r) => r.skipped)).toEqual([]);
    // 온라인 강의 줄 21개 중 퀴즈 줄 2개를 뺀 19개 + 과제 14 + 팀 프로젝트 1 + 퀴즈 2
    const count = (kind: Deadline['kind']) => all.filter((d) => d.kind === kind).length;
    expect([count('online'), count('task'), count('project'), count('quiz')]).toEqual([
      19, 14, 1, 2,
    ]);
  });

  it('id가 겹치지 않는다', () => {
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
  });

  it('추가 제출 기한이 열린 과제는 추가 기한이 마감이다', () => {
    // 원래 기한 2026-11-06 23:59:59, 추가 기한 2026-11-11 23:59:59. 원래 기한이 지난 뒤 기준
    const later = at('2026-11-07 09:00');
    const extended = current.subjList
      .flatMap(
        (s) =>
          normalizeSubject({
            semester: current.value,
            subject: s,
            lists: lists[s.value] ?? {},
            now: later,
          }).deadlines,
      )
      .filter((d) => d.extended);
    expect(extended.map((d) => d.dueAt)).toContain(at('2026-11-11 23:59:59'));
  });

  it('그날 남은 마감은 제출하지 않은 과제뿐이고 마감 순이다', () => {
    const pending = pendingDeadlines(all, now);
    expect(pending.map((d) => d.kind)).toEqual(['task', 'task', 'task', 'task', 'task']);
    const dues = pending.map((d) => d.dueAt);
    expect(dues).toEqual([...dues].sort((a, b) => a - b));
  });
});
