// 개발 빌드에서 KLAS API 다섯 개가 실제로 동작하는지 확인한다.
// 결과에는 개수와 실패 종류만 담고, 과목명 같은 내용은 담지 않는다.

import {
  fetchOnlineRows,
  fetchProjects,
  fetchQuizzes,
  fetchSemesters,
  fetchTasks,
  type KlasRequestOptions,
  type KlasResult,
} from './api';

export interface SelfCheckLine {
  api: 'semesters' | 'online' | 'task' | 'project' | 'quiz';
  /** 성공하면 항목 수, 실패하면 실패 종류 */
  result: number | string;
  detail?: string;
}

function line<T extends unknown[]>(
  api: SelfCheckLine['api'],
  response: KlasResult<T>,
): SelfCheckLine {
  return response.ok
    ? { api, result: response.data.length }
    : { api, result: response.error.kind, detail: response.error.message };
}

/**
 * 과목 목록을 받은 뒤, 현재 학기 첫 과목으로 나머지 네 API를 부른다. 요청은 다섯 번이다.
 * 과목 목록이 실패하면 거기서 멈춘다.
 */
export async function runSelfCheck(options?: KlasRequestOptions): Promise<SelfCheckLine[]> {
  const semesters = await fetchSemesters(options);
  if (!semesters.ok) return [line('semesters', semesters)];

  const lines = [line('semesters', semesters)];
  const current = semesters.data[0];
  const subject = current?.subjList[0];
  if (!current || !subject) return lines;

  const query = { subject: subject.value, semester: current.value };
  lines.push(line('online', await fetchOnlineRows(query, options)));
  lines.push(line('task', await fetchTasks(query, options)));
  lines.push(line('project', await fetchProjects(query, options)));
  lines.push(line('quiz', await fetchQuizzes(query, options)));
  return lines;
}
