// 학부 강의계획서 검색(/std/cps/atnlc/LectrePlanStdPage.do)에서 Enter로 조회한다.
// KLAS는 이 화면의 텍스트 입력에서 Enter를 처리하지 않는다. 검색 함수와 검증은 새로 만들지 않고,
// KLAS의 조회 버튼을 그대로 눌러 같은 경로를 탄다.

/** 검색 조건 표와 같은 카드 안의 조회 버튼. 하나로 정해지지 않으면 null이다. */
function findSearchButton(input: HTMLInputElement): HTMLButtonElement | null {
  const table = input.closest('table');
  const card = table?.parentElement;
  if (!table || !card) return null;
  // 조회 버튼은 조건 표 바로 뒤의 .btnCon에 있다. 결과 표 같은 다른 표의 입력은 제외한다.
  const next = table.nextElementSibling;
  if (!next?.classList.contains('btnCon')) return null;
  const buttons = [...next.querySelectorAll('button')].filter(
    (button) => button.textContent?.trim() === '조회',
  );
  return buttons.length === 1 ? buttons[0]! : null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.defaultPrevented) return;
  // 한글 조합을 확정하는 Enter(일부 브라우저는 keyCode 229)와 키 반복은 검색하지 않는다.
  if (event.isComposing || event.keyCode === 229 || event.repeat) return;
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

  const target = event.target as Element | null;
  if (!target || target.localName !== 'input') return;
  const input = target as HTMLInputElement;
  if (input.type !== 'text') return;

  const button = findSearchButton(input);
  if (!button || button.disabled) return;
  event.preventDefault();
  button.click();
}

/**
 * 검색 조건 입력의 Enter를 조회 버튼 클릭으로 바꾼다.
 * document에 한 번만 달아 두므로 KLAS가 검색 영역을 다시 그려도 등록이 늘지 않는다.
 * 반환값으로 해제한다.
 */
export function enableSyllabusSearchEnter(doc: Document): () => void {
  doc.addEventListener('keydown', onKeydown);
  return () => doc.removeEventListener('keydown', onKeydown);
}
