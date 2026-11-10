// KLAS 패널과 background가 함께 쓰는 사용자 설정.

/** KLAS 탭이 열려 있는 동안 10분마다 세션을 연장할지. 기본은 켜짐 (PRIVACY.md "세션 연장") */
export const sessionKeepAlive = storage.defineItem<boolean>('local:sessionKeepAlive', {
  fallback: true,
});
