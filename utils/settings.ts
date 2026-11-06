// 사용자 설정. 설정 화면은 KLAS 탭(마일스톤 2)에서 만든다.

/** KLAS 탭이 열려 있는 동안 10분마다 세션을 연장할지. 기본은 켜짐 (PRIVACY.md "세션 연장") */
export const sessionKeepAlive = storage.defineItem<boolean>('local:sessionKeepAlive', {
  fallback: true,
});
