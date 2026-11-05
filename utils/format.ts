/** 남은 시간(ms)을 "3일 4시간" 같은 문자열로 바꾼다. 샘플 테스트용 함수. */
export function formatRemaining(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(0, Math.floor(ms / 60_000))}분`;
  if (hours < 48) return `${hours}시간`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
}
