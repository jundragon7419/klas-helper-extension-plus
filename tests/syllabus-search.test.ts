import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableSyllabusSearchEnter } from '@/utils/klas/syllabus-search';

const PAGE = `
<div class="card content">
  <table class="tablegw"><tbody>
    <tr><th>과목명</th><td><input id="name" type="text"></td>
        <th>담당교수</th><td><input id="prof" type="text"></td></tr>
    <tr><td><select id="year"><option>2026</option></select>
        <input id="radio" type="radio" name="r" value="all"></td></tr>
  </tbody></table>
  <div class="btnCon"><button id="go" type="button" class="btn2">조회</button></div>
  <table class="tablegw"><tbody><tr><td><input id="result" type="text"></td></tr></tbody></table>
  <button id="other" type="button">다른 버튼</button>
</div>`;

let stop: (() => void) | undefined;

function setup(html = PAGE) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  stop = enableSyllabusSearchEnter(document);
  const clicks = vi.fn();
  document.querySelector('#go')?.addEventListener('click', clicks);
  return { document, clicks };
}

function press(document: Document, selector: string, init: Record<string, unknown> = {}) {
  // linkedom은 자기 Event 클래스만 받는다.
  const DomEvent = (document.defaultView as unknown as { Event: typeof Event }).Event;
  const event = new DomEvent('keydown', { bubbles: true, cancelable: true });
  Object.assign(event, { key: 'Enter', keyCode: 13, ...init });
  document.querySelector(selector)!.dispatchEvent(event);
  return { prevented: event.defaultPrevented };
}

afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('강의계획서 검색 Enter', () => {
  it('검색 조건 입력에서 Enter를 누르면 조회 버튼을 한 번 누른다', () => {
    const { document, clicks } = setup();
    expect(press(document, '#name').prevented).toBe(true);
    expect(clicks).toHaveBeenCalledTimes(1);
    press(document, '#prof');
    expect(clicks).toHaveBeenCalledTimes(2);
  });

  it('한글 조합 중 Enter와 키 반복, 보조 키 조합은 검색하지 않는다', () => {
    const { document, clicks } = setup();
    press(document, '#name', { isComposing: true });
    press(document, '#name', { keyCode: 229 });
    press(document, '#name', { repeat: true });
    press(document, '#name', { ctrlKey: true });
    press(document, '#name', { shiftKey: true });
    press(document, '#name', { key: 'a', keyCode: 65 });
    expect(clicks).not.toHaveBeenCalled();
  });

  it('이미 처리된 Enter(KLAS가 지원하는 경우)는 다시 조회하지 않는다', () => {
    const { document, clicks } = setup();
    // 입력의 핸들러가 문서 핸들러보다 먼저 실행된다.
    document.querySelector('#name')!.addEventListener('keydown', (e) => e.preventDefault());
    press(document, '#name');
    expect(clicks).not.toHaveBeenCalled();
  });

  it('검색 조건 밖의 입력과 다른 컨트롤은 가로채지 않는다', () => {
    const { document, clicks } = setup();
    expect(press(document, '#result').prevented).toBe(false);
    expect(press(document, '#year').prevented).toBe(false);
    expect(press(document, '#radio').prevented).toBe(false);
    expect(press(document, '#go').prevented).toBe(false);
    expect(press(document, '#other').prevented).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('검색 영역이 다시 그려져도 한 번만 조회한다', () => {
    const { document } = setup();
    const card = document.querySelector('.card')!;
    const html = card.innerHTML;
    card.innerHTML = '';
    card.innerHTML = html;
    const clicks = vi.fn();
    document.querySelector('#go')!.addEventListener('click', clicks);
    press(document, '#name');
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('조회 버튼이 없으면 아무것도 누르지 않는다', () => {
    const { document, clicks } = setup(PAGE.replace('조회</button>', '검색</button>'));
    expect(press(document, '#name').prevented).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('조회 버튼이 하나로 정해지지 않으면 아무것도 누르지 않는다', () => {
    const { document, clicks } = setup(
      PAGE.replace('</button></div>', '</button><button id="dup">조회</button></div>'),
    );
    const dup = vi.fn();
    document.querySelector('#dup')!.addEventListener('click', dup);
    expect(press(document, '#name').prevented).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
    expect(dup).not.toHaveBeenCalled();
  });

  it('비활성 조회 버튼은 누르지 않는다', () => {
    const { document, clicks } = setup(PAGE.replace('id="go"', 'id="go" disabled'));
    press(document, '#name');
    expect(clicks).not.toHaveBeenCalled();
  });

  it('해제하면 더는 반응하지 않는다', () => {
    const { document, clicks } = setup();
    stop?.();
    press(document, '#name');
    expect(clicks).not.toHaveBeenCalled();
  });
});
