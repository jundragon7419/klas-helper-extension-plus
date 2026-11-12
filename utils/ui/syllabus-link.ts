import { appendExtensionMarker } from './extension-marker';

const ATTRIBUTE = 'data-khp-syllabus-link';
const SYLLABUS_PATH = '/std/cps/atnlc/popup/LectrePlanStdView.do';
const SUBJECT_INPUT = "input[name='selectedSubj']";

/** 현재 선택한 과목의 강의계획서 주소. 과목 코드를 확인할 수 없으면 null이다. */
function syllabusUrl(root: ParentNode): string | null {
  const code = root.querySelector<HTMLInputElement>(SUBJECT_INPUT)?.value.trim() ?? '';
  if (!/^[\w-]+$/.test(code)) return null;
  return `${SYLLABUS_PATH}?selectSubj=${encodeURIComponent(code)}`;
}

/**
 * 과목 머리말(.subtitle)에 현재 과목의 강의계획서 링크를 붙인다.
 * 여러 번 실행해도 머리말마다 하나만 남고, 과목 코드가 없으면 링크를 지운다.
 */
export function showSyllabusLink(root: ParentNode): void {
  const url = syllabusUrl(root);
  for (const subtitle of root.querySelectorAll<HTMLElement>('.subtitle')) {
    const current = subtitle.querySelector<HTMLAnchorElement>(`:scope > a[${ATTRIBUTE}]`);
    if (!url) {
      current?.remove();
      continue;
    }
    if (current) {
      if (current.getAttribute('href') !== url) current.setAttribute('href', url);
      continue;
    }
    const link = document.createElement('a');
    link.setAttribute(ATTRIBUTE, '');
    link.className = 'khp-syllabus-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append('강의계획서 조회');
    appendExtensionMarker(link, 'light');
    subtitle.append(link);
  }
}

/** 화면이 다시 그려지거나 과목이 바뀔 때마다 링크를 맞춘다. 반환값으로 감시를 멈춘다. */
export function watchSyllabusLink(root: HTMLElement): () => void {
  let scheduled = false;
  const run = () => {
    scheduled = false;
    showSyllabusLink(root);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(run, 0);
  };
  // 과목 코드가 value 속성이 아닌 프로퍼티로 바뀌면 변경 감지에 잡히지 않는다.
  // 누르는 순간 최신 과목으로 맞추고, 과목 코드가 없어졌으면 이동을 막는다.
  const onClick = (event: Event) => {
    const link = (event.target as Element | null)?.closest?.(`a[${ATTRIBUTE}]`);
    if (!link) return;
    showSyllabusLink(root);
    if (!link.isConnected) event.preventDefault();
  };
  const observer = new MutationObserver(schedule);
  run();
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['value'],
  });
  root.addEventListener('change', schedule);
  root.addEventListener('click', onClick, true);
  return () => {
    observer.disconnect();
    root.removeEventListener('change', schedule);
    root.removeEventListener('click', onClick, true);
  };
}
