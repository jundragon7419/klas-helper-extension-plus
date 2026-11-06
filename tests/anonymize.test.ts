import { describe, expect, it } from 'vitest';
import { anonymize, findLeaks } from '../scripts/fixtures/anonymize.ts';

// 실제 KLAS 응답과 같은 모양의 가짜 데이터
const sample = {
  subjects: [
    {
      value: '2026,2',
      label: '2026년도 2학기',
      subjList: [
        { value: 'U2026210000123401', label: '자료구조 (홍길동)', name: '자료구조' },
        { value: 'U2026210000567801', label: '미시경제학 (김철수)', name: '미시경제학' },
      ],
    },
  ],
  online: [
    {
      userId: '2023203999',
      subj: 'U2026210000123401',
      sbjt: '자료구조 (홍길동)',
      moduletitle: '1주차 배열과 연결 리스트',
      evltnSe: 'lesson',
      isonoff: 'ON',
      firstEdu: '2026-10-10 14:22',
      prog: 100,
      endDate: '2026-10-12 23:59',
      sdate: '202610060000',
      sdateY: '20261006',
      connYn: 'Y',
      lrnPd: '2026.10.06 ~ 2026.10.12',
      pcond1: null,
    },
  ],
  quizInOnline: [{ evltnSe: 'quiz', examtype: 'Q', ptype: 'L' }],
  task: [
    {
      title: '과제 1: 스택 구현',
      startdate: '2026-10-01 00:00:00',
      expiredate: '2026-10-15 23:59:59',
      submityn: 'N',
      taskNo: 31,
    },
  ],
  project: [{ title: '팀 프로젝트', expiredate: '2026-11-13T14:59:59.000+00:00' }],
};

describe('anonymize', () => {
  const { data, leaks } = anonymize(sample);
  const json = JSON.stringify(data);

  it('원본의 이름, 제목, 학번, 과목 코드를 남기지 않는다', () => {
    for (const original of [
      '홍길동',
      '김철수',
      '자료구조',
      '미시경제학',
      '배열과 연결 리스트',
      '스택 구현',
      '2023203999',
      'U2026210000123401',
      '2026.10.06',
    ]) {
      expect(json).not.toContain(original);
    }
    expect(leaks).toEqual([]);
  });

  it('판단에 쓰는 값(날짜, 숫자, Y/N, 상태 코드, 학기)은 그대로 둔다', () => {
    const online = data.online[0]!;
    expect(online.endDate).toBe('2026-10-12 23:59');
    expect(online.sdate).toBe('202610060000');
    expect(online.sdateY).toBe('20261006');
    expect(online.prog).toBe(100);
    expect(online.connYn).toBe('Y');
    expect(online.evltnSe).toBe('lesson');
    expect(online.isonoff).toBe('ON');
    expect(online.pcond1).toBeNull();
    expect(data.task[0]!.expiredate).toBe('2026-10-15 23:59:59');
    expect(data.task[0]!.taskNo).toBe(31);
    expect(data.project[0]!.expiredate).toBe('2026-11-13T14:59:59.000+00:00');
    expect(data.subjects[0]!.value).toBe('2026,2');
    expect(data.subjects[0]!.label).toBe('2026년도 2학기');
    expect(data.quizInOnline[0]).toEqual({ evltnSe: 'quiz', examtype: 'Q', ptype: 'L' });
  });

  it('공부한 시각은 고정값으로 바꾼다', () => {
    expect(data.online[0]!.firstEdu).toBe('2000-01-01 00:00');
    expect(json).not.toContain('2026-10-10 14:22');
  });

  it('같은 과목 코드는 어디서나 같은 가짜 코드가 된다', () => {
    const fakeCode = data.subjects[0]!.subjList[0]!.value;
    expect(fakeCode).toHaveLength('U2026210000123401'.length);
    expect(data.online[0]!.subj).toBe(fakeCode);
    expect(data.subjects[0]!.subjList[1]!.value).not.toBe(fakeCode);
  });

  it('같은 과목명은 같은 가짜 이름이 된다', () => {
    expect(data.online[0]!.sbjt).toBe(data.subjects[0]!.subjList[0]!.label);
    expect(data.subjects[0]!.subjList[0]!.label).toMatch(/^과목 \d+$/);
  });

  it('처음 보는 필드의 자유 텍스트도 바꾼다', () => {
    expect(data.online[0]!.lrnPd).toMatch(/^lrnPd \d+$/);
  });
});

describe('findLeaks', () => {
  it('원본 값이나 학번 형식이 남아 있으면 찾아낸다', () => {
    expect(findLeaks({ a: '비밀 제목' }, ['비밀 제목'])).toEqual(['비밀 제목']);
    expect(findLeaks({ a: 'x 2023203999 y' }, [])).toEqual(['학번 형식: 2023203999']);
  });

  it('키 이름은 원본 값으로 보지 않는다', () => {
    expect(findLeaks({ quiz: ['x'] }, ['quiz'])).toEqual([]);
  });

  it('날짜 숫자열은 학번으로 보지 않는다', () => {
    expect(findLeaks({ sdate: '202610060000', sdateY: '20261006' }, [])).toEqual([]);
  });
});
