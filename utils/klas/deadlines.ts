// 네 종류의 KLAS 목록을 하나의 마감 형식으로 정리한다.
// 판단 규칙은 docs/ARCHITECTURE.md의 "마감 판단 규칙"을 따른다.

import { parseKlasDate } from '../date';
import type { KlasOnlineRow, KlasQuizRow, KlasSubject, KlasTaskRow } from './schema';

export type DeadlineKind = 'online' | 'task' | 'project' | 'quiz';

/** 종류별 KLAS 목록 페이지. 과목을 골라 이동할 때 쓴다. */
export const LIST_PAGES: Record<DeadlineKind, string> = {
  online: '/std/lis/evltn/OnlineCntntsStdPage.do',
  task: '/std/lis/evltn/TaskStdPage.do',
  project: '/std/lis/evltn/PrjctStdPage.do',
  quiz: '/std/lis/evltn/AnytmQuizStdPage.do',
};

export interface Deadline {
  /** 같은 항목이면 다시 조회해도 같은 값. 예: "task:<과목 코드>:3" */
  id: string;
  kind: DeadlineKind;
  /** 학기 (예: "2026,2") */
  semester: string;
  subjectCode: string;
  subjectName: string;
  title: string;
  /** 시작 시각 (epoch ms). 해석할 수 없으면 null */
  startsAt: number | null;
  /** 마감 시각 (epoch ms) */
  dueAt: number;
  /** 제출 또는 수강을 마쳤는지 */
  done: boolean;
  /** 원래 기한이 지나 추가 제출 기한을 마감으로 쓰는지 (과제, 팀 프로젝트) */
  extended: boolean;
  /** 과제와 팀 프로젝트의 제출 기한. 이전 캐시에는 이 필드가 없다. */
  submissionWindow?: { originalDueAt: number; extraDueAt: number } | null;
  /** KLAS에서 이 항목이 있는 목록 페이지 */
  listPage: string;
}

/** 마감을 정리하지 못한 항목. 화면에는 보이지 않고 문제를 찾을 때 쓴다. */
export interface SkippedRow {
  kind: DeadlineKind;
  subjectCode: string;
  reason: string;
}

/** 한 과목의 네 종류 목록 */
export interface SubjectLists {
  online: KlasOnlineRow[];
  task: KlasTaskRow[];
  project: KlasTaskRow[];
  quiz: KlasQuizRow[];
}

export interface NormalizeInput {
  semester: string;
  subject: KlasSubject;
  lists: Partial<SubjectLists>;
  /** 추가 제출 기한을 쓸지 정하는 기준 시각 (epoch ms) */
  now: number;
}

export interface NormalizeResult {
  deadlines: Deadline[];
  skipped: SkippedRow[];
}

/** 분 단위까지만 있는 시각을 그 분의 마지막 초로 옮긴다. `23:59`는 `23:59:59`까지다. */
const END_OF_MINUTE_MS = 59_000;

/** 항목을 구분할 값. 번호 필드가 있으면 쓰고, 없으면 목록 안의 순서를 쓴다. */
function rowKey(value: unknown, index: number): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : `#${index}`;
}

export function normalizeSubject({
  semester,
  subject,
  lists,
  now,
}: NormalizeInput): NormalizeResult {
  const deadlines: Deadline[] = [];
  const skipped: SkippedRow[] = [];
  const base = { semester, subjectCode: subject.value, subjectName: subject.name };

  const add = (
    kind: DeadlineKind,
    key: string,
    fields: Pick<Deadline, 'title' | 'startsAt' | 'done' | 'extended' | 'submissionWindow'> & {
      dueAt: number | null;
    },
    rawDue: string,
  ) => {
    if (fields.dueAt === null) {
      skipped.push({
        kind,
        subjectCode: subject.value,
        reason: `마감 날짜를 읽을 수 없음: ${rawDue}`,
      });
      return;
    }
    deadlines.push({
      ...base,
      ...fields,
      dueAt: fields.dueAt,
      id: `${kind}:${subject.value}:${key}`,
      kind,
      listPage: LIST_PAGES[kind],
    });
  };

  // 온라인 강의: 강의(lesson)만 본다. 목록에 섞여 오는 퀴즈 줄은 퀴즈 목록과 겹친다.
  // 수업 방식이 오프라인(OFF)인 강의는 마감이 없다.
  for (const [index, row] of (lists.online ?? []).entries()) {
    if (row.evltnSe !== 'lesson' || row.isonoff === 'OFF') continue;
    const due = parseKlasDate(row.endDate);
    add(
      'online',
      rowKey(row.oid, index),
      {
        title: row.sbjt,
        startsAt: parseKlasDate(row.startDate),
        dueAt: due === null ? null : due + END_OF_MINUTE_MS,
        done: row.prog === 100,
        extended: false,
      },
      row.endDate,
    );
  }

  // 과제와 팀 프로젝트: 원래 기한이 지났고 추가 제출 기한이 있으면 그것을 마감으로 쓴다.
  for (const kind of ['task', 'project'] as const) {
    for (const [index, row] of (lists[kind] ?? []).entries()) {
      const original = parseKlasDate(row.expiredate);
      const extra = parseKlasDate(row.reexpiredate);
      const extended = original !== null && extra !== null && now > original;
      add(
        kind,
        rowKey(kind === 'task' ? row.taskNo : row.ordseq, index),
        {
          title: row.title,
          startsAt: parseKlasDate(row.startdate),
          dueAt: extended ? extra : original,
          done: row.submityn === 'Y',
          extended,
          submissionWindow:
            original !== null && extra !== null
              ? { originalDueAt: original, extraDueAt: extra }
              : null,
        },
        row.expiredate,
      );
    }
  }

  // 퀴즈
  for (const [index, row] of (lists.quiz ?? []).entries()) {
    add(
      'quiz',
      rowKey(row.papernum, index),
      {
        title: row.papernm,
        startsAt: parseKlasDate(row.sdt),
        dueAt: parseKlasDate(row.edt),
        done: row.issubmit === 'Y',
        extended: false,
      },
      row.edt,
    );
  }

  return { deadlines, skipped };
}

/** 마감 순으로 정렬한다. 마감이 같으면 과목명, 제목 순. 원래 배열은 바꾸지 않는다. */
export function sortByDue(deadlines: readonly Deadline[]): Deadline[] {
  return [...deadlines].sort(
    (a, b) =>
      a.dueAt - b.dueAt ||
      a.subjectName.localeCompare(b.subjectName, 'ko') ||
      a.title.localeCompare(b.title, 'ko'),
  );
}

/** 아직 하지 않았고 마감이 지나지 않은 항목만 마감 순으로 돌려준다. */
export function pendingDeadlines(deadlines: readonly Deadline[], now: number): Deadline[] {
  const pending: Deadline[] = [];
  for (const item of deadlines) {
    if (item.done) continue;
    const window = item.submissionWindow;
    const extended = window ? now > window.originalDueAt : item.extended;
    const dueAt = window ? (extended ? window.extraDueAt : window.originalDueAt) : item.dueAt;
    if (dueAt >= now) {
      pending.push(
        dueAt === item.dueAt && extended === item.extended ? item : { ...item, dueAt, extended },
      );
    }
  }
  return sortByDue(pending);
}
