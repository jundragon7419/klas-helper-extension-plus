// 현재 학기의 모든 과목에서 마감을 모은다. KLAS 탭의 content script에서 실행한다.

import {
  fetchOnlineRows,
  fetchProjects,
  fetchQuizzes,
  fetchSemesters,
  fetchTasks,
  type KlasError,
  type KlasRequestOptions,
} from './api';
import { normalizeSubject, type Deadline, type SkippedRow, type SubjectLists } from './deadlines';
import { pickCurrentSemester } from './semester';

export interface DeadlineSnapshot {
  /** 조회한 학기. 고를 학기가 없었으면 null */
  semester: string | null;
  /** 조회를 시작한 시각 (epoch ms) */
  checkedAt: number;
  deadlines: Deadline[];
  /** 마감 날짜를 읽지 못해 뺀 항목 */
  skipped: SkippedRow[];
  /** 실패한 목록. 나머지 목록의 마감은 그대로 담는다. */
  failures: KlasError[];
}

export type CollectOutcome =
  { ok: true; snapshot: DeadlineSnapshot } | { ok: false; error: KlasError };

/**
 * 과목 목록을 받아 현재 학기를 고르고, 과목마다 네 목록을 불러 마감으로 정리한다.
 * 요청은 과목 목록 1번과 과목 수 × 4번이다. 과목 하나의 네 목록은 동시에, 과목은 차례로 부른다.
 *
 * - 과목 목록이나 모든 마감 목록의 조회가 실패하거나 도중에 로그인이 끊기면 전체를 실패로 돌려준다.
 * - 그 밖의 이유로 일부 목록이 실패하면 failures에 남기고 나머지는 계속 모은다.
 */
export async function collectDeadlines(
  now: number,
  options?: KlasRequestOptions,
): Promise<CollectOutcome> {
  const semesters = await fetchSemesters(options);
  if (!semesters.ok) return { ok: false, error: semesters.error };

  const current = pickCurrentSemester(semesters.data, now);
  const snapshot: DeadlineSnapshot = {
    semester: current?.value ?? null,
    checkedAt: now,
    deadlines: [],
    skipped: [],
    failures: [],
  };
  if (!current) return { ok: true, snapshot };

  let hasSuccessfulList = false;
  for (const subject of current.subjList) {
    const query = { subject: subject.value, semester: current.value };
    const results = await Promise.all([
      fetchOnlineRows(query, options),
      fetchTasks(query, options),
      fetchProjects(query, options),
      fetchQuizzes(query, options),
    ]);

    // 실패한 목록은 빼고 넘긴다. 로그인이 끊겼으면 나머지 과목도 실패하므로 바로 멈춘다.
    const failed = results.flatMap((r) => (r.ok ? [] : [r.error]));
    const sessionLost = failed.find((error) => error.kind === 'session');
    if (sessionLost) return { ok: false, error: sessionLost };
    snapshot.failures.push(...failed);
    if (failed.length < results.length) hasSuccessfulList = true;

    const [online, task, project, quiz] = results;
    const lists: Partial<SubjectLists> = {
      ...(online.ok && { online: online.data }),
      ...(task.ok && { task: task.data }),
      ...(project.ok && { project: project.data }),
      ...(quiz.ok && { quiz: quiz.data }),
    };

    const normalized = normalizeSubject({ semester: current.value, subject, lists, now });
    snapshot.deadlines.push(...normalized.deadlines);
    snapshot.skipped.push(...normalized.skipped);
  }

  const firstFailure = snapshot.failures[0];
  if (!hasSuccessfulList && firstFailure) return { ok: false, error: firstFailure };
  return { ok: true, snapshot };
}
