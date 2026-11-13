import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import {
  anonymizeDom,
  findValueLeaks,
  formatDomFixture,
  parseDomFixture,
  PAGE_NAME_PATTERN,
} from '../scripts/fixtures/anonymize-dom.ts';

// KLAS 온라인 강의 목록과 같은 모양의 가짜 화면. 이름, 학번, 과목명은 모두 지어낸 값이다.
const page = `
<div class="contentWrap" id="appModule">
  <div class="userInfo" title="홍길동 (2023203999)">
    <span class="name">홍길동</span> <span class="num">2023203999</span>
    <a href="mailto:hong@example.com">hong@example.com</a> 010-1234-5678
  </div>
  <select id="selectSubj" name="selectSubj">
    <option value="U2026210000123401" selected>자료구조 (김철수)</option>
    <option value="U2026210000567801">미시경제학 (이영희)</option>
  </select>
  <!-- 담당 교수 김철수 -->
  <script>var userId = '2023203999';</script>
  <div class="tablelistbox">
    <table id="prjctList" class="AType">
      <thead><tr><th>주차</th><th>학습단원</th><th>구분</th><th>학습목차</th><th>학습기간/학습시간</th></tr></thead>
      <tbody>
        <tr>
          <td class="weekNo-5" rowspan="2">5</td>
          <td class="lft moduletitle-5" rowspan="2">배열과 연결 리스트</td>
          <td>강의영상</td>
          <td class="lft"><a href="#" onclick="goView('U2026210000123401', '2023203999')">자료구조 1주차 Stack 구현</a></td>
          <td> 2026-10-01 12:00 ~ 2026-10-05 23:59<br><font color="blue">[53분, 100%]</font></td>
        </tr>
        <tr>
          <td>퀴즈</td>
          <td class="lft" data-title="자료구조 퀴즈">자료구조 퀴즈</td>
          <td><font color="red">[30분]</font> ON Q</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>`;

const load = (html = page) =>
  parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
const keep = [
  '주차',
  '학습단원',
  '구분',
  '학습목차',
  '학습기간',
  '학습시간',
  '강의영상',
  '퀴즈',
  '분',
];

describe('anonymizeDom', () => {
  const doc = load();
  const root = doc.querySelector('#appModule')!;
  const { html, leaks } = anonymizeDom(root, keep);

  it('학번, 이름, 과목명, 강의명, 연락처를 남기지 않는다', () => {
    for (const original of [
      '2023203999',
      '홍길동',
      '김철수',
      '이영희',
      '자료구조',
      '미시경제학',
      '배열과 연결 리스트',
      'U2026210000123401',
      'hong@example.com',
      '010-1234-5678',
    ]) {
      expect(html).not.toContain(original);
    }
    expect(leaks).toEqual([]);
  });

  it('주석과 스크립트 내용을 지운다', () => {
    expect(html).not.toContain('<!--');
    expect(html).toContain('<script></script>');
  });

  it('구조, class, id, 속성 이름을 남긴다', () => {
    const out = load(html);
    expect(out.querySelectorAll('.tablelistbox > table#prjctList.AType tbody tr')).toHaveLength(2);
    expect(out.querySelector('td.weekNo-5')?.getAttribute('rowspan')).toBe('2');
    expect(out.querySelector('td.lft.moduletitle-5')).not.toBeNull();
    expect(out.querySelector('select#selectSubj option[selected]')).not.toBeNull();
    expect(out.querySelector('a[onclick]')).not.toBeNull();
    expect(out.querySelector('[data-title]')).not.toBeNull();
    expect(out.querySelector('font')?.getAttribute('color')).toBe('blue');
  });

  it('남길 낱말, 날짜, 시각, 진도율, 상태 코드는 그대로 둔다', () => {
    const out = load(html);
    expect([...out.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      '주차',
      '학습단원',
      '구분',
      '학습목차',
      '학습기간/학습시간',
    ]);
    expect(html).toContain('2026-10-01 12:00 ~ 2026-10-05 23:59');
    expect(html).toContain('[53분, 100%]');
    expect(html).toContain('ON Q');
    expect(out.querySelector('td.weekNo-5')?.textContent).toBe('5');
  });

  it('같은 원본은 같은 자리표시값이 되어 화면 사이의 연결이 남는다', () => {
    const out = load(html);
    const quiz = out.querySelector('[data-title]')!;
    expect(quiz.getAttribute('data-title')).toBe(quiz.textContent);
    const code = out.querySelector('option')!.getAttribute('value')!;
    expect(out.querySelector('a[onclick]')!.getAttribute('onclick')).toContain(code);
  });

  it('원본 화면은 바꾸지 않는다', () => {
    expect(root.querySelector('.name')?.textContent).toBe('홍길동');
  });

  it('남길 낱말은 고른 대로 두지만 학번 형식은 어디서든 막는다', () => {
    const r = anonymizeDom(load().querySelector('#appModule')!, [...keep, '홍길동']);
    expect(r.leaks).toEqual([]);
    // 남길 낱말은 사용자 책임이지만 학번 형식은 막는다.
    const number = load('<div id="r" class="s-2023203999">x</div>').querySelector('#r')!;
    expect(anonymizeDom(number).leaks).toContain('학번 형식: 2023203999');
  });

  it('바꾸지 않는 속성(class, id)에 남은 한글도 leaks로 알린다', () => {
    const el = load('<div id="r"><span class="홍길동">x</span></div>').querySelector('#r')!;
    expect(anonymizeDom(el).leaks).toContain('한글: 홍길동');
  });

  it('자리표시값으로 바꾼 한글 낱말을 후보로 돌려준다', () => {
    const r = anonymizeDom(load().querySelector('thead')!, ['주차']);
    expect(r.replacedWords).toEqual(['학습단원', '구분', '학습목차', '학습기간', '학습시간']);
  });
});

describe('findValueLeaks', () => {
  it('자리표시값과 남길 낱말은 통과시킨다', () => {
    expect(findValueLeaks('텍스트12 주차 [30분]', ['주차', '분'])).toEqual([]);
  });

  it('학번, 한글, 전화번호, 이메일을 찾는다', () => {
    expect(findValueLeaks('2023203999', [])).toEqual(['학번 형식: 2023203999']);
    expect(findValueLeaks('홍길동', [])).toEqual(['한글: 홍길동']);
    expect(findValueLeaks('02-940-5000', [])).toEqual(['전화번호 형식: 02-940-5000']);
    expect(findValueLeaks('a.b@kw.ac.kr', [])).toEqual(['이메일 형식: a.b@kw.ac.kr']);
  });

  it('날짜와 시각은 전화번호로 보지 않는다', () => {
    expect(findValueLeaks('2026-10-01 12:00 ~ 2026-10-05 23:59 202610052359', [])).toEqual([]);
  });
});

describe('발췌 파일 형식', () => {
  const info = {
    page: 'online-lectures',
    path: '/std/lis/evltn/OnlineCntntsStdPage.do',
    selector: 'div.a--b > .c',
    collectedOn: '2026-11-13',
    keepText: ['주차'],
  };

  it('정보 줄과 본문을 쓰고 다시 읽는다', () => {
    const text = formatDomFixture(info, '<div>텍스트1</div>\n');
    expect(text.split('\n')[0]).toMatch(/^<!-- klas-dom:v1 \{.*\} -->$/);
    expect(text.split('\n')[0]).not.toContain('--b');
    expect(parseDomFixture(text)).toEqual({ info, html: '<div>텍스트1</div>\n' });
  });

  it('정보 줄이 없으면 null', () => {
    expect(parseDomFixture('<div></div>')).toBeNull();
  });

  it('페이지 이름은 영어 소문자, 숫자, 하이픈', () => {
    expect(PAGE_NAME_PATTERN.test('online-lectures')).toBe(true);
    expect(PAGE_NAME_PATTERN.test('Online')).toBe(false);
    expect(PAGE_NAME_PATTERN.test('../x')).toBe(false);
  });
});
