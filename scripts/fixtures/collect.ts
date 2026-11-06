// KLAS 탭에서 실행해 테스트용 응답을 모은다.
// 원본은 브라우저 밖으로 보내지 않고, 개인정보를 지운 결과만 돌려준다.

import { anonymize } from './anonymize.ts';

export const ENDPOINTS = {
  subjects: '/std/cmn/frame/YearhakgiAtnlcSbjectList.do',
  online: '/std/lis/evltn/SelectOnlineCntntsStdList.do',
  task: '/std/lis/evltn/TaskStdList.do',
  project: '/std/lis/evltn/PrjctStdList.do',
  quiz: '/std/lis/evltn/AnytmQuizStdList.do',
} as const;

type ListKind = 'online' | 'task' | 'project' | 'quiz';
const LIST_KINDS: ListKind[] = ['online', 'task', 'project', 'quiz'];

interface Semester {
  value: string;
  label: string;
  subjList: { value: string; label: string; name: string }[];
}

export interface KlasFixture {
  /** 수집한 날 (YYYY-MM-DD). 시각은 남기지 않는다. */
  collectedOn: string;
  /** 목록을 모은 학기. 예: "2026,2" */
  semester: string;
  /** 과목 목록 응답 그대로 (익명화됨) */
  subjects: Semester[];
  /** 과목별 네 종류 목록. 키는 익명화된 과목 코드 */
  lists: Record<string, Record<ListKind, unknown[]>>;
  /** 세션이 없을 때의 응답 */
  sessionExpired: { status: number; contentType: string; path: string; bodyStart: string };
}

export interface CollectResult {
  fixture: KlasFixture;
  leaks: string[];
  counts: Record<ListKind, number>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new Error(
      `${path}: JSON이 아닌 응답 (${res.status} ${contentType}). KLAS에 로그인했는지 확인하세요.`,
    );
  }
  return res.json();
}

/** 로그인 쿠키 없이 요청해 세션이 없을 때의 응답을 얻는다. 입력값과 스크립트는 지운다. */
async function sessionExpiredSample(): Promise<KlasFixture['sessionExpired']> {
  const res = await fetch(ENDPOINTS.subjects, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const html = await res.text();
  const bodyStart = html
    .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/\svalue="[^"]*"/gi, ' value=""')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    path: new URL(res.url).pathname,
    bodyStart,
  };
}

/**
 * 현재 학기(과목 목록의 첫 학기)의 모든 과목에 대해 네 종류 목록을 모은다.
 * 요청은 과목 수 × 4 + 2번이고, 서버 부담을 줄이려고 요청 사이에 쉰다.
 */
export async function collectKlasFixture(delayMs = 300): Promise<CollectResult> {
  const subjects = (await postJson(ENDPOINTS.subjects, {})) as Semester[];
  const current = subjects[0];
  if (!current) throw new Error('과목 목록이 비어 있습니다.');

  const lists: KlasFixture['lists'] = {};
  const counts: Record<ListKind, number> = { online: 0, task: 0, project: 0, quiz: 0 };
  for (const subject of current.subjList) {
    const entry = {} as Record<ListKind, unknown[]>;
    for (const kind of LIST_KINDS) {
      const rows = await postJson(ENDPOINTS[kind], {
        selectSubj: subject.value,
        selectYearhakgi: current.value,
        selectChangeYn: 'Y',
      });
      entry[kind] = Array.isArray(rows) ? rows : [];
      counts[kind] += entry[kind].length;
      await sleep(delayMs);
    }
    lists[subject.value] = entry;
  }

  // lists의 키(과목 코드)도 익명화하려고 { value, entry } 배열로 바꿨다가 되돌린다.
  const { data, leaks } = anonymize({
    subjects,
    lists: Object.entries(lists).map(([value, entry]) => ({ value, entry })),
  });

  const fixture: KlasFixture = {
    collectedOn: new Date().toISOString().slice(0, 10),
    semester: current.value,
    subjects: data.subjects,
    lists: Object.fromEntries(data.lists.map(({ value, entry }) => [value, entry])),
    // 로그인 쿠키 없이 받은 응답이라 개인정보가 없다. 익명화하면 판단에 쓰는 값까지 지워지므로 그대로 둔다.
    sessionExpired: await sessionExpiredSample(),
  };
  return { fixture, leaks, counts };
}
