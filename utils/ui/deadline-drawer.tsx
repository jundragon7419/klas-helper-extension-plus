import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import drawerCss from './deadline-drawer.css?inline';
import { DeadlinePanel } from './deadline-panel';
import { SessionSettings } from './session-settings';
import { useDeadlineList } from './use-deadline-list';
import { tokens, tokensToCss } from './tokens';

const NARROW_DRAWER_QUERY = `(width < ${tokens.size['narrow-breakpoint']}px)`;

function DeadlineDrawer({ ctx }: { ctx: ContentScriptContext }) {
  const { cache, checking, check } = useDeadlineList(ctx);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handle = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);

  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }

  useLayoutEffect(() => {
    if (open) closeButton.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      handle.current?.focus();
    }
  }, [open, check]);

  useEffect(() => {
    const panel = drawer.current;
    if (!open || !panel) return;
    const narrow = window.matchMedia(NARROW_DRAWER_QUERY);

    const onFocus = () => {
      if (!document.hidden) void check();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') close();
      if (
        event.key !== 'Tab' ||
        !narrow.matches ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const controls = [
        handle.current,
        ...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'),
      ].filter((control) => control && control.tabIndex >= 0 && control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      const active = event.composedPath()[0];
      const boundary = event.shiftKey ? first : last;
      const target = event.shiftKey ? last : first;

      if (target && (active === boundary || !controls.some((control) => control === active))) {
        event.preventDefault();
        target.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      const path = event.composedPath();
      if (!path.includes(panel) && (!handle.current || !path.includes(handle.current))) {
        if (narrow.matches) close();
        else setOpen(false);
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick, true);
    };
  }, [open, check]);

  return (
    <>
      <button
        ref={handle}
        class="drawer-handle"
        type="button"
        aria-label={open ? '손잡이로 마감 일정 닫기' : '마감 일정 열기'}
        aria-controls="deadline-drawer"
        aria-expanded={open}
        onClick={
          open
            ? close
            : () => {
                void check();
                setOpen(true);
              }
        }
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={open ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
        </svg>
      </button>
      <aside
        ref={drawer}
        id="deadline-drawer"
        class="drawer"
        aria-label="KLAS Helper+"
        data-open={open}
        inert={!open}
      >
        <header class="drawer-brand">
          <span>KLAS Helper+</span>
          <div class="drawer-brand-actions">
            <button
              class="drawer-settings-button"
              type="button"
              aria-controls="drawer-session-settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((shown) => !shown)}
            >
              설정
            </button>
            <button
              ref={closeButton}
              class="drawer-close"
              type="button"
              aria-label="마감 일정 닫기"
              onClick={close}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>
        <SessionSettings open={settingsOpen} />
        <div class="drawer-tabs" role="tablist" aria-label="KLAS Helper+ 기능">
          <button
            id="deadline-tab"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="deadline-tab-panel"
          >
            마감 일정
          </button>
        </div>
        <DeadlinePanel
          cache={cache}
          checking={checking}
          open={open}
          onRefresh={() => void check(true)}
        />
      </aside>
    </>
  );
}

export async function mountDeadlineDrawer(ctx: ContentScriptContext): Promise<void> {
  const ui = await createShadowRootUi(ctx, {
    name: 'klas-helper-plus-drawer',
    position: 'inline',
    inheritStyles: true,
    css: `${tokensToCss()}
${drawerCss}
@media ${NARROW_DRAWER_QUERY} {
  .drawer { width: 100%; }
  .drawer-handle[aria-expanded='true'] {
    inset-inline-start: 0;
    inset-inline-end: auto;
    border-radius: 0 var(--khp-radius-lg) var(--khp-radius-lg) 0;
  }
}`,
    onMount(container) {
      render(<DeadlineDrawer ctx={ctx} />, container);
      return container;
    },
    onRemove(container) {
      if (container) render(null, container);
    },
  });
  if (!ctx.isInvalid) ui.mount();
}
