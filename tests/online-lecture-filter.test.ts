import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchCompletedLectureFilter } from '@/utils/ui/online-lecture-filter';

// 학생 정보가 없는 임의 값으로 만든 최소 목록이다.
const video = (title: string, progress: string, extra = '') =>
  `<td>강의영상</td><td class="lft">${title}</td>` +
  `<td> 2026-10-01 ~ 2026-10-05<br><font color="green"> ~ </font><br>${progress}</td>` +
  `<td> 55분 </td><td><button type="button">보기</button></td>${extra}`;
const quiz = (title: string) =>
  `<td>퀴즈</td><td class="lft">${title}</td><td> 기간<br><font color="blue">[30분]</font></td>` +
  `<td> 30분 </td><td><button type="button">이동</button></td>`;
const done = '<font color="blue">[53분, 100%]</font>';
const todo = '<font color="red">[0분, 0%]</font>';
const partial = '<font color="red">[20분, 40%]</font>';

/** rows: 주차 하나의 행들. 첫 행 앞에 공통 칸을 붙인다. */
const week = (no: number, rows: string[]) =>
  rows
    .map((row, index) =>
      index === 0
        ? `<tr><td class="weekNo-${no}" rowspan="${rows.length}">${no}</td>` +
          `<td class="lft" rowspan="${rows.length}">단원 ${no}</td>${row}` +
          `<td class="totalTime-${no}" rowspan="${rows.length}">0/0</td></tr>`
        : `<tr>${row}</tr>`,
    )
    .join('');
const desktop = (body: string) =>
  `<div class="tablelistbox"><table id="prjctList"><thead><tr><th>주차</th></tr></thead>` +
  `<tbody>${body}</tbody></table></div>`;
const mobileItem = (title: string, progress: string) =>
  `<tr><td rowspan="2">강의영상</td><td class="lft">${title}</td><td> 55 분 </td></tr>` +
  `<tr><td>기간<br>${progress}</td><td><button type="button">보기</button></td></tr>`;
const mobile = (no: number, items: string) =>
  `<div class="mtablelistbox"><table id="prjctList"><tbody>` +
  `<tr><th>${no}주차</th><th>단원</th><th>0/0</th></tr>${items}</tbody></table></div>`;

describe('watchCompletedLectureFilter', () => {
  let doc: Document;
  let stop: (() => void) | undefined;
  let win: ReturnType<typeof parseHTML>;
  const load = (html: string) => {
    win = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    doc = win.document;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('MutationObserver', win.window.MutationObserver);
    stop = watchCompletedLectureFilter(doc);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const button = () => doc.querySelector<HTMLButtonElement>('[data-khp-lecture-filter] button')!;
  const status = () => doc.querySelector('[data-khp-lecture-filter] [role="status"]')!.textContent;
  const visibleTitles = () =>
    [...doc.querySelectorAll('tr:not([data-khp-lecture="hidden"]) td.lft')]
      .filter((cell) => !cell.closest('tr')!.matches('[data-khp-lecture="shell"]'))
      .filter((cell) => !cell.hasAttribute('rowspan'))
      .map((cell) => cell.textContent);
  const click = async () => {
    button().click();
    await settle();
  };

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
  });

  it('처음에는 전체를 표시하고 버튼을 한 번만 둔다', async () => {
    load(desktop(week(1, [video('가', done), video('나', todo)])));
    await settle();
    expect(doc.querySelectorAll('[data-khp-lecture-filter]')).toHaveLength(1);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(doc.querySelectorAll('[data-khp-lecture]')).toHaveLength(0);
    expect(button().querySelector('sup')).not.toBeNull();
  });

  it('완료와 미완료가 섞이면 100%인 강의만 숨기고 rowspan을 맞춘다', async () => {
    load(
      desktop(
        week(1, [video('가', done), video('나', todo), quiz('퀴즈')]) +
          week(2, [video('다', done)]),
      ),
    );
    await click();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    // 1주차 첫 행은 공통 칸을 지키려고 남기고, 2주차는 전부 완료라 숨긴다.
    expect(doc.querySelectorAll('tr')[1]!.getAttribute('data-khp-lecture')).toBe('shell');
    expect(doc.querySelectorAll('tr')[4]!.getAttribute('data-khp-lecture')).toBe('hidden');
    expect(visibleTitles()).toEqual(['나', '퀴즈']);
    expect(doc.querySelector('.weekNo-1')!.getAttribute('rowspan')).toBe('3');
    expect(status()).toBe('완료한 강의 2개를 숨겼습니다.');
  });

  it('첫 행이 아닌 완료 강의는 행을 숨기고 rowspan을 줄인다', async () => {
    load(desktop(week(1, [video('가', todo), video('나', done), video('다', todo)])));
    await click();
    expect(doc.querySelector('.weekNo-1')!.getAttribute('rowspan')).toBe('2');
    expect(visibleTitles()).toEqual(['가', '다']);
    await click();
    expect(doc.querySelector('.weekNo-1')!.getAttribute('rowspan')).toBe('3');
    expect(doc.querySelectorAll('[data-khp-lecture]')).toHaveLength(0);
    expect(doc.querySelectorAll('[data-khp-rowspan]')).toHaveLength(0);
  });

  it('진도율 불명, 진행 중, 퀴즈는 숨기지 않는다', async () => {
    load(
      desktop(
        week(1, [
          video('가', partial),
          video('나', ''),
          quiz('퀴즈'),
          video('다', '<font>[3분, 100]</font>'),
        ]),
      ),
    );
    await click();
    expect(doc.querySelectorAll('[data-khp-lecture]')).toHaveLength(0);
    expect(status()).toBe('숨길 완료 강의가 없습니다.');
  });

  it('전부 완료여도 다시 표시 버튼으로 돌아오고 이유를 알린다', async () => {
    load(desktop(week(1, [video('가', done)]) + week(2, [video('나', done)])));
    await click();
    expect(doc.querySelectorAll('[data-khp-lecture="hidden"]')).toHaveLength(2);
    expect(status()).toContain('모두 숨겨 표시할 강의가 없습니다');
    await click();
    expect(doc.querySelectorAll('[data-khp-lecture]')).toHaveLength(0);
    expect(status()).toBe('');
  });

  it('모바일 표는 강의의 두 행을 함께 숨기고 전부 완료인 주차 표는 통째로 숨긴다', async () => {
    load(
      mobile(1, mobileItem('가', done) + mobileItem('나', todo)) +
        mobile(2, mobileItem('다', done)),
    );
    await click();
    const tables = doc.querySelectorAll('.mtablelistbox table');
    expect(tables[0]!.hasAttribute('data-khp-lecture')).toBe(false);
    expect(tables[0]!.querySelectorAll('tr[data-khp-lecture="hidden"]')).toHaveLength(2);
    expect(tables[1]!.getAttribute('data-khp-lecture')).toBe('hidden');
    await click();
    expect(doc.querySelectorAll('[data-khp-lecture]')).toHaveLength(0);
  });

  it('목록이 재사용된 행에 다른 내용으로 바뀌어도 다시 판정한다', async () => {
    load(desktop(week(1, [video('가', done), video('나', todo)])));
    await click();
    expect(visibleTitles()).toEqual(['나']);
    // KLAS가 같은 tbody와 tr에 다른 강의를 채운 경우
    const tbody = doc.querySelector('tbody')!;
    tbody.innerHTML = week(1, [video('라', todo), video('마', done)]);
    await settle();
    expect(doc.querySelectorAll('tr')[1]!.getAttribute('data-khp-lecture')).toBeNull();
    expect(doc.querySelectorAll('tr')[2]!.getAttribute('data-khp-lecture')).toBe('hidden');
    // 텍스트만 바뀌어도 반영한다.
    const font = doc.querySelectorAll('font[color="red"]')[0]!;
    font.textContent = '[53분, 100%]';
    await settle();
    expect(doc.querySelectorAll('[data-khp-lecture="hidden"]')).toHaveLength(2);
  });

  it('버튼이 지워지면 다시 하나만 만들고 현재 상태를 유지한다', async () => {
    load(desktop(week(1, [video('가', done), video('나', todo)])));
    await click();
    doc.querySelector('[data-khp-lecture-filter]')!.remove();
    await settle();
    expect(doc.querySelectorAll('[data-khp-lecture-filter]')).toHaveLength(1);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(status()).toBe('완료한 강의 1개를 숨겼습니다.');
  });

  it('과목을 바꾸면 전체 표시로 초기화한다', async () => {
    load(
      '<select name="selectSubj"><option>A</option></select>' +
        desktop(week(1, [video('가', done), video('나', todo)])),
    );
    await click();
    expect(doc.querySelectorAll('[data-khp-lecture]').length).toBeGreaterThan(0);
    doc.querySelector('select')!.dispatchEvent(new win.window.Event('change', { bubbles: true }));
    await settle();
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(doc.querySelectorAll('[data-khp-lecture]')).toHaveLength(0);
    expect(status()).toBe('');
  });

  it('종료하면 예약된 렌더링도 취소해 버튼을 다시 만들지 않는다', async () => {
    load(
      '<select name="selectSubj"><option>A</option></select>' +
        desktop(week(1, [video('가', done), video('나', todo)])),
    );
    doc.querySelector('select')!.dispatchEvent(new win.window.Event('change', { bubbles: true }));
    stop?.();
    stop = undefined;
    await settle();
    expect(doc.querySelectorAll('[data-khp-lecture-filter]')).toHaveLength(0);
  });

  it('목록이 없으면 버튼을 만들지 않고 빈 목록도 처리한다', async () => {
    load(
      '<div class="tablelistbox"><table><tbody><tr><td colspan="8">등록된 온라인강의가 없습니다.</td></tr></tbody></table></div>',
    );
    await click();
    expect(doc.querySelectorAll('[data-khp-lecture]')).toHaveLength(0);
    stop?.();
    stop = undefined;
    expect(doc.querySelectorAll('[data-khp-lecture-filter]')).toHaveLength(0);
  });
});
