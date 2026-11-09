import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { sessionKeepAlive } from '../settings';
import { appendExtensionMarker } from './extension-marker';

export async function mountSessionIndicator(ctx: ContentScriptContext): Promise<void> {
  const counter = document.querySelector<HTMLElement>('.navtxt #remainingCounter');
  if (!counter) return;

  const indicator = document.createElement('span');
  indicator.className = 'khp-session-indicator';
  indicator.hidden = true;
  indicator.tabIndex = 0;
  indicator.textContent = '자동 연장 중';
  appendExtensionMarker(indicator, 'dark');

  const tooltip = document.createElement('span');
  tooltip.id = 'khp-session-remaining';
  tooltip.setAttribute('role', 'tooltip');
  indicator.setAttribute('aria-describedby', tooltip.id);
  indicator.append(tooltip);
  counter.after(indicator);

  const updateRemaining = () => {
    const time = counter.textContent?.trim();
    tooltip.textContent = time ? `남은 시간 ${time}` : '남은 시간을 확인할 수 없습니다';
  };
  updateRemaining();
  const observer = new MutationObserver(updateRemaining);
  observer.observe(counter, { childList: true, characterData: true, subtree: true });

  let settingChanged = false;
  const unwatch = sessionKeepAlive.watch((enabled) => {
    settingChanged = true;
    indicator.hidden = !enabled;
  });
  ctx.onInvalidated(() => {
    unwatch();
    observer.disconnect();
    indicator.remove();
  });

  const enabled = await sessionKeepAlive.getValue();
  if (!settingChanged && !ctx.isInvalid) indicator.hidden = !enabled;
}
