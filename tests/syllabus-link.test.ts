import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showSyllabusLink, watchSyllabusLink } from '@/utils/ui/syllabus-link';

const page = (code: string | null) =>
  `<div class="subtitle"><span>예시 과목</span></div>` +
  (code === null ? '' : `<input name="selectedSubj" value="${code}">`);
const BASE = '/std/cps/atnlc/popup/LectrePlanStdView.do?selectSubj=';

describe('showSyllabusLink', () => {
  let doc: Document;
  const load = (html: string) => {
    doc = parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
    vi.stubGlobal('document', doc);
  };
  const links = () => [...doc.querySelectorAll('a[data-khp-syllabus-link]')];

  afterEach(() => vi.unstubAllGlobals());

  it('현재 과목의 강의계획서 링크를 새 탭으로 한 번만 붙인다', () => {
    load(page('A101'));
    showSyllabusLink(doc);
    showSyllabusLink(doc);
    expect(links()).toHaveLength(1);
    const link = links()[0]!;
    expect(link.getAttribute('href')).toBe(`${BASE}A101`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('강의계획서 조회');
    expect(link.querySelector('sup')?.textContent).toBe('+');
  });

  it('과목이 바뀌면 같은 링크의 대상을 새 과목으로 바꾼다', () => {
    load(page('A101'));
    showSyllabusLink(doc);
    doc.querySelector('input')!.setAttribute('value', 'B202');
    showSyllabusLink(doc);
    expect(links()).toHaveLength(1);
    expect(links()[0]!.getAttribute('href')).toBe(`${BASE}B202`);
  });

  it('머리말이 새로 그려져도 링크가 중복되지 않는다', () => {
    load(page('A101'));
    showSyllabusLink(doc);
    doc
      .querySelector('.subtitle')!
      .replaceWith(Object.assign(doc.createElement('div'), { className: 'subtitle' }));
    showSyllabusLink(doc);
    expect(links()).toHaveLength(1);
  });

  it('과목 코드가 없거나 올바르지 않으면 링크를 노출하지 않고 이전 링크도 지운다', () => {
    load(page(null));
    showSyllabusLink(doc);
    expect(links()).toHaveLength(0);

    load(page('A&b=1'));
    showSyllabusLink(doc);
    expect(links()).toHaveLength(0);

    load(page('A101'));
    showSyllabusLink(doc);
    doc.querySelector('input')!.setAttribute('value', '');
    showSyllabusLink(doc);
    expect(links()).toHaveLength(0);
  });
});

describe('watchSyllabusLink', () => {
  let doc: Document;
  let stop: (() => void) | undefined;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const load = (html: string) => {
    const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    doc = document;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('MutationObserver', window.MutationObserver);
  };
  const hrefs = () =>
    [...doc.querySelectorAll('a[data-khp-syllabus-link]')].map((a) => a.getAttribute('href'));

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
  });

  it('과목 코드가 바뀌면 변경 감지로 링크를 갱신한다', async () => {
    load(page('A101'));
    stop = watchSyllabusLink(doc.body);
    expect(hrefs()).toEqual([`${BASE}A101`]);
    doc.querySelector('input')!.setAttribute('value', 'B202');
    await settle();
    expect(hrefs()).toEqual([`${BASE}B202`]);
  });

  it('속성 변경 없이 value만 바뀌어도 누르는 순간 새 과목으로 이동한다', () => {
    load(page('A101'));
    stop = watchSyllabusLink(doc.body);
    doc.querySelector('input')!.value = 'B202';
    const link = doc.querySelector('a[data-khp-syllabus-link]')!;
    const event = new (doc.defaultView as unknown as { Event: typeof Event }).Event('click', {
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(event);
    expect(link.getAttribute('href')).toBe(`${BASE}B202`);
    expect(event.defaultPrevented).toBe(false);
  });

  it('누르는 순간 과목 코드가 없으면 이동을 막는다', () => {
    load(page('A101'));
    stop = watchSyllabusLink(doc.body);
    doc.querySelector('input')!.value = '';
    const link = doc.querySelector('a[data-khp-syllabus-link]')!;
    const event = new (doc.defaultView as unknown as { Event: typeof Event }).Event('click', {
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(hrefs()).toEqual([]);
  });
});
