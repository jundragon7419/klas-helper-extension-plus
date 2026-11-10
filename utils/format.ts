/** 남은 시간을 계산할 수 없을 때 보여 주는 문구 */
export const UNKNOWN_REMAINING = '알 수 없음';

/** 남은 시간(ms)을 "3일 4시간" 같은 문자열로 바꾼다. 숫자가 아니거나 무한대면 "알 수 없음". */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms)) return UNKNOWN_REMAINING;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(0, Math.floor(ms / 60_000))}분`;
  if (hours < 48) return `${hours}시간`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
}
