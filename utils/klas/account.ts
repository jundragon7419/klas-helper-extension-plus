/** 읽기 전용 KLAS 홈 응답에서 현재 세션의 계정을 확인한다.
 * 이미 열려 있던 탭의 화면에는 이전 계정이 남아 있을 수 있다.
 */
export async function readAccountHash(): Promise<string | null> {
  try {
    const response = await fetch('/std/cmn/frame/Frame.do', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;

    const page = document.createElement('template');
    page.innerHTML = await response.text();
    const accountLinks = page.content.querySelectorAll(
      '.navtxt a[href="/std/ads/admst/MyInfoStdPage.do"]',
    );
    if (accountLinks.length !== 1) return null;
    const studentId = accountLinks[0]?.textContent?.match(/\(\s*(\d{10})\s*\)\s*$/)?.[1];
    if (!studentId) return null;

    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(studentId));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
