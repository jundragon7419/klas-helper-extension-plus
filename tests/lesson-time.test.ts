import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lessonTimeRange } from '@/utils/lesson-time';
import { showLessonTimes, watchLessonTimes } from '@/utils/ui/lesson-time';

describe('lessonTimeRange', () => {
  it('단일 교시의 시작과 종료 시각을 돌려준다', () => {
    expect(lessonTimeRange(0, 1)).toBe('08:00 ~ 08:45');
    expect(lessonTimeRange(1, 1)).toBe('09:00 ~ 10:15');
    expect(lessonTimeRange(7, 1)).toBe('18:00 ~ 18:45');
    expect(lessonTimeRange(9, 1)).toBe('20:00 ~ 20:45');
  });

  it('연속 교시는 첫 교시 시작부터 마지막 교시 종료까지로 계산한다', () => {
    expect(lessonTimeRange(1, 2)).toBe('09:00 ~ 11:45');
    expect(lessonTimeRange(6, 2)).toBe('16:30 ~ 18:45');
    expect(lessonTimeRange(8, 2)).toBe('19:00 ~ 20:45');
  });

  it('해석할 수 없으면 null이다', () => {
    expect(lessonTimeRange(10, 1)).toBeNull();
    expect(lessonTimeRange(9, 2)).toBeNull();
    expect(lessonTimeRange(-1, 1)).toBeNull();
    expect(lessonTimeRange(1, 0)).toBeNull();
    expect(lessonTimeRange(Number.NaN, 1)).toBeNull();
    expect(lessonTimeRange(1, Number.NaN)).toBeNull();
  });
});

const lesson = (cls: string, extra = '') =>
  `<div class="${cls}"><p>예시 과목 (가101)</p>${extra}</div>`;
const table = (rows: [string, string][]) =>
  `<table class="scheduletb"><tbody>${rows
    .map(([period, cell]) => `<tr><td class="time">${period}</td><td>${cell}</td></tr>`)
    .join('')}</tbody></table>`;

describe('showLessonTimes', () => {
  let doc: Document;
  const load = (html: string) => {
    doc = parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
    vi.stubGlobal('document', doc);
  };
  const ranges = () =>
    [...doc.querySelectorAll('[data-khp-lesson-time]')].map((el) =>
      el.getAttribute('data-khp-lesson-time'),
    );

  afterEach(() => vi.unstubAllGlobals());

  it('단일 교시와 연속 교시 항목에 시간을 붙인다', () => {
    load(
      table([
        ['1', lesson('namecol01 lessontime1')],
        ['2', lesson('namecol02 lessontime2')],
      ]),
    );
    showLessonTimes(doc);
    expect(ranges()).toEqual(['09:00 ~ 10:15', '10:30 ~ 13:15']);
    const label = doc.querySelector('[data-khp-lesson-time]')!;
    expect(label.textContent).toContain('09:00 ~ 10:15');
    expect(label.querySelector('sup')).not.toBeNull();
  });

  it('다시 실행해도 중복으로 붙이지 않는다', () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    showLessonTimes(doc);
    showLessonTimes(doc);
    expect(ranges()).toHaveLength(1);
  });

  it('과목명은 그대로 두고 항목 끝에만 붙인다', () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    showLessonTimes(doc);
    const item = doc.querySelector('.lessontime1')!;
    expect(item.querySelector('p')!.textContent).toBe('예시 과목 (가101)');
    expect(item.lastElementChild!.hasAttribute('data-khp-lesson-time')).toBe(true);
  });

  it('표가 새로 그려지면 새 항목에 맞게 표시한다', () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    showLessonTimes(doc);
    doc.body.innerHTML = table([['3', lesson('namecol01 lessontime1')]]);
    showLessonTimes(doc);
    expect(ranges()).toEqual(['12:00 ~ 13:15']);
  });

  it('같은 항목의 교시 수가 바뀌면 이전 표시를 지우고 다시 계산한다', () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    showLessonTimes(doc);
    doc.querySelector('.namecol01')!.className = 'namecol01 lessontime2';
    showLessonTimes(doc);
    expect(ranges()).toEqual(['09:00 ~ 11:45']);
  });

  it('KLAS가 이미 같은 시간을 보여 주면 붙이지 않는다', () => {
    load(
      table([['1', lesson('namecol01 lessontime1', '<span class="time">09:00 ~ 10:15</span>')]]),
    );
    showLessonTimes(doc);
    expect(ranges()).toHaveLength(0);
    expect(doc.querySelector('span.time')!.textContent).toBe('09:00 ~ 10:15');
  });

  it('KLAS의 기존 시간 표시가 다르면 지우지 않고 따로 붙인다', () => {
    load(table([['1', lesson('namecol01 lessontime1', '<span class="time">1교시</span>')]]));
    showLessonTimes(doc);
    expect(doc.querySelector('span.time')!.textContent).toBe('1교시');
    expect(ranges()).toHaveLength(1);
  });

  it('교시나 교시 수를 해석할 수 없는 항목에는 붙이지 않는다', () => {
    load(
      table([
        ['', lesson('namecol01 lessontime1')],
        ['abc', lesson('namecol01 lessontime1')],
        ['1', lesson('namecol01')],
        ['9', lesson('namecol01 lessontime2')],
      ]),
    );
    showLessonTimes(doc);
    expect(ranges()).toHaveLength(0);
  });

  it('수업시간표 표가 여러 개여도 모두 처리하고 다른 표는 건드리지 않는다', () => {
    load(
      table([['1', lesson('namecol01 lessontime1')]]) +
        table([['2', lesson('namecol02 lessontime1')]]) +
        '<table class="other"><tr><td class="time">1</td><td>' +
        lesson('namecol01 lessontime1') +
        '</td></tr></table>',
    );
    showLessonTimes(doc);
    expect(ranges()).toHaveLength(2);
  });
});

describe('watchLessonTimes', () => {
  let doc: Document;
  let stop: (() => void) | undefined;
  const load = (html: string) => {
    const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    doc = document;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('MutationObserver', window.MutationObserver);
  };
  const ranges = () =>
    [...doc.querySelectorAll('[data-khp-lesson-time]')].map((el) =>
      el.getAttribute('data-khp-lesson-time'),
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
  });

  it('수업 class가 바뀌면 시간을 다시 계산한다', async () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    stop = watchLessonTimes(doc.body);
    await settle();
    expect(ranges()).toEqual(['09:00 ~ 10:15']);
    doc.querySelector('.namecol01')!.className = 'namecol01 lessontime2';
    await settle();
    expect(ranges()).toEqual(['09:00 ~ 11:45']);
  });

  it('기존 교시 텍스트 노드 값이 바뀌면 시간을 다시 계산한다', async () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    stop = watchLessonTimes(doc.body);
    await settle();
    doc.querySelector('td.time')!.firstChild!.nodeValue = '3';
    await settle();
    expect(ranges()).toEqual(['12:00 ~ 13:15']);
  });

  it('교시 수 class가 사라지면 이전 표시를 지운다', async () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    stop = watchLessonTimes(doc.body);
    await settle();
    expect(ranges()).toHaveLength(1);
    doc.querySelector('.namecol01')!.className = 'namecol01';
    await settle();
    expect(ranges()).toHaveLength(0);
  });

  it('확장 표시 때문에 중복이나 반복 갱신이 생기지 않는다', async () => {
    load(table([['1', lesson('namecol01 lessontime1')]]));
    stop = watchLessonTimes(doc.body);
    await settle();
    await settle();
    expect(doc.querySelectorAll('[data-khp-lesson-time]')).toHaveLength(1);
    expect(doc.querySelector('.namecol01')!.children).toHaveLength(2);
  });
});
