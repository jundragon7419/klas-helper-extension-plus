import { useEffect, useState } from 'preact/hooks';
import { sessionKeepAlive } from '../settings';

export function SessionSettings({ open }: { open: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    let changed = false;
    const unwatch = sessionKeepAlive.watch((value) => {
      changed = true;
      setEnabled(value);
    });
    setError('');
    void sessionKeepAlive.getValue().then(
      (value) => {
        if (active && !changed) setEnabled(value);
      },
      () => {
        if (active && !changed) {
          setEnabled(null);
          setError('설정을 불러오지 못했습니다. 설정을 다시 열어 주세요.');
        }
      },
    );
    return () => {
      active = false;
      unwatch();
      setEnabled(null);
    };
  }, [open]);

  async function toggle() {
    if (enabled === null || saving) return;
    setSaving(true);
    setError('');
    try {
      await sessionKeepAlive.setValue(!enabled);
    } catch {
      setError('설정을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="drawer-session-settings" class="drawer-session-settings" hidden={!open}>
      <button
        class="session-switch"
        type="button"
        role="switch"
        aria-checked={enabled === true}
        aria-disabled={enabled === null || saving}
        aria-labelledby="session-switch-label"
        aria-describedby="session-switch-description"
        onClick={() => void toggle()}
      >
        <span id="session-switch-label">세션 자동 연장</span>
        <span class="session-switch-value" aria-hidden="true">
          {enabled === null ? '확인 중' : enabled ? '켜짐' : '꺼짐'}
          <span class="session-switch-track" />
        </span>
      </button>
      <p id="session-switch-description">
        KLAS 탭이 열려 있는 동안 로그인 세션을 자동으로 연장합니다.
      </p>
      {error && <p role="status">{error}</p>}
    </section>
  );
}
