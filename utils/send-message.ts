// content script에서 background로 메시지를 보낸다.
//
// background(service worker)가 막 시작했거나 다시 시작하는 중이면 리스너가 아직 없어서
// "Could not establish connection. Receiving end does not exist." 오류가 난다.
// 이 경우에만 잠시 기다렸다가 다시 보낸다.

/** background에 리스너가 없어서 난 오류인지 본다. */
export function isNoReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

export interface RetryOptions {
  /** 처음 시도를 빼고 다시 보내는 횟수 */
  retries?: number;
  /** 첫 대기 시간(ms). 다시 보낼 때마다 두 배로 늘린다. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * send를 부르고, 리스너가 없다는 오류면 0.5초, 1초, 2초를 기다리며 다시 부른다.
 * 그 밖의 오류나 마지막 시도의 오류는 그대로 던진다.
 */
export async function withReceiverRetry<T>(
  send: () => Promise<T>,
  { retries = 3, delayMs = 500, sleep = defaultSleep }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= retries || !isNoReceiverError(error)) throw error;
      await sleep(delayMs * 2 ** attempt);
    }
  }
}
