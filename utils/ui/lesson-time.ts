import { lessonTimeRange } from '../lesson-time';
import { appendExtensionMarker } from './extension-marker';

const ATTRIBUTE = 'data-khp-lesson-time';

/**
 * 홈과 수업시간표의 수업 항목에 실제 시작·종료 시각을 붙인다.
 * 여러 번 실행해도 항목마다 하나만 남고, 해석할 수 없는 항목에는 붙이지 않는다.
 */
export function showLessonTimes(root: ParentNode): void {
  for (const lesson of root.querySelectorAll<HTMLElement>(
    'table.scheduletb div[class*="lessontime"]',
  )) {
    const range = rangeOf(lesson);
    const current = lesson.querySelector<HTMLElement>(`:scope > [${ATTRIBUTE}]`);
    if (!range) {
      current?.remove();
      continue;
    }
    // KLAS가 이미 같은 시간을 보여 주면 겹쳐 쓰지 않는다.
    const native = lesson.querySelector(':scope > span.time');
    if (native && normalize(native.textContent) === range) {
      current?.remove();
      continue;
    }
    if (current?.getAttribute(ATTRIBUTE) === range) continue;
    current?.remove();

    const label = document.createElement('span');
    label.setAttribute(ATTRIBUTE, range);
    label.className = 'khp-lesson-time';
    label.append(range);
    appendExtensionMarker(label, 'light');
    lesson.append(label);
  }
}

function normalize(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function rangeOf(lesson: HTMLElement): string | null {
  const count = Number(/(?:^|\s)lessontime(\d+)(?:\s|$)/.exec(lesson.className)?.[1]);
  const text = lesson.closest('tr')?.querySelector('td.time')?.textContent?.trim() ?? '';
  if (!/^\d$/.test(text)) return null;
  return lessonTimeRange(Number(text), count);
}

/** 화면이 다시 그려질 때마다 표시를 맞춘다. 반환값으로 감시를 멈춘다. */
export function watchLessonTimes(root: HTMLElement): () => void {
  let scheduled = false;
  const run = () => {
    scheduled = false;
    showLessonTimes(root);
  };
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(run, 0);
  });
  run();
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
