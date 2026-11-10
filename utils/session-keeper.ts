// KLAS 탭이 열려 있는 동안 10분마다 세션을 연장한다. background에서 쓴다.
//
// - KLAS 학생 페이지의 content script가 열렸다고 알리면(registerTab) 탭 목록에 넣고,
//   알람이 없으면 만든다. 마지막 탭이 사라지면 알람을 지운다.
// - 알람이 울리면 설정이 켜져 있을 때 KLAS 탭 하나에 연장을 맡긴다. 그 탭의 content script가
//   같은 출처로 UpdateSession.do를 보낸다. content script 안의 타이머는 뒤에 숨은 탭에서
//   느려지므로 시점은 background의 알람이 정한다.
// - 답하지 않는 탭(닫혔거나 KLAS를 벗어남)은 목록에서 빼고 다음 탭에 맡긴다.

import type { KlasError, KlasResult, SessionStatus } from './klas/api';
import { sessionKeepAlive } from './settings';

export const KEEPALIVE_ALARM = 'session-keepalive';
export const KEEPALIVE_PERIOD_MINUTES = 10;

/** 지금 열려 있는 KLAS 학생 페이지 탭. service worker가 다시 시작돼도 남는다. */
export const klasTabs = storage.defineItem<number[]>('session:klasTabs', { fallback: [] });

export interface SessionKeeperDeps {
  /** 탭의 content script에 연장을 맡긴다. 답할 content script가 없으면 예외를 던진다. */
  extendInTab: (tabId: number) => Promise<KlasResult<SessionStatus>>;
  alarmExists: () => Promise<boolean>;
  createAlarm: () => Promise<void>;
  clearAlarm: () => Promise<void>;
}

export type KeepAliveResult =
  | { status: 'disabled' }
  | { status: 'no-tab' }
  | { status: 'extended'; tabId: number }
  | { status: 'failed'; tabId: number; error: KlasError };

export function createSessionKeeper(deps: SessionKeeperDeps) {
  // 탭 목록을 읽고 쓰는 사이에 다른 처리가 끼어들지 않도록 한 번에 하나씩 처리한다.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const removeTabs = async (removed: number[]) => {
    const tabs = (await klasTabs.getValue()).filter((id) => !removed.includes(id));
    await klasTabs.setValue(tabs);
    if (tabs.length === 0) await deps.clearAlarm();
  };

  return {
    /** KLAS 학생 페이지가 열렸다. 알람이 없으면 만든다. 이미 있으면 주기를 다시 시작하지 않는다. */
    registerTab(tabId: number): Promise<void> {
      return serial(async () => {
        const tabs = await klasTabs.getValue();
        if (!tabs.includes(tabId)) await klasTabs.setValue([...tabs, tabId]);
        if (!(await deps.alarmExists())) await deps.createAlarm();
      });
    },

    /** 탭이 닫혔다. */
    removeTab(tabId: number): Promise<void> {
      return serial(() => removeTabs([tabId]));
    },

    /** 알람이 울렸다. 설정이 켜져 있으면 KLAS 탭 하나에 연장을 맡긴다. */
    onAlarm(): Promise<KeepAliveResult> {
      return serial(async () => {
        const tabs = await klasTabs.getValue();
        if (tabs.length === 0) {
          await deps.clearAlarm();
          return { status: 'no-tab' };
        }
        const gone: number[] = [];
        try {
          for (const tabId of tabs) {
            if (!(await sessionKeepAlive.getValue())) return { status: 'disabled' };
            let result: KlasResult<SessionStatus>;
            try {
              result = await deps.extendInTab(tabId);
            } catch {
              gone.push(tabId);
              continue;
            }
            if (result.ok) return { status: 'extended', tabId };
            return { status: 'failed', tabId, error: result.error };
          }
          return { status: 'no-tab' };
        } finally {
          if (gone.length > 0) await removeTabs(gone);
        }
      });
    },
  };
}
