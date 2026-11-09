import { useEffect, useState } from 'preact/hooks';
import type { DeadlineCache } from '../deadline-cache';
import { formatRemaining } from '../format';
import { OPEN_DEADLINE_LIST } from '../klas/deadline-navigation';
import type { Deadline } from '../klas/deadlines';
import { checkedTime, deadlineDisplay, deadlineTime } from './deadline-display';

const labels = { online: '강의', task: '과제', project: '팀 프로젝트', quiz: '퀴즈' };

interface DeadlinePanelProps {
  cache: DeadlineCache;
  checking: boolean;
  open: boolean;
  onRefresh: () => void;
}

export function DeadlinePanel({ cache, checking, open, onRefresh }: DeadlinePanelProps) {
  const [now, setNow] = useState(Date.now);
  const [navigationFailed, setNavigationFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    setNavigationFailed(false);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  const { groups, message, loginRequired, checkedAt } = deadlineDisplay(cache, checking, now);

  function navigate(item: Deadline) {
    const event = new CustomEvent(OPEN_DEADLINE_LIST, {
      detail: [item.listPage, item.semester, item.subjectCode].join('|'),
      cancelable: true,
    });
    setNavigationFailed(document.dispatchEvent(event));
  }

  return (
    <div id="deadline-tab-panel" role="tabpanel" aria-labelledby="deadline-tab">
      <div class="deadline-meta">
        <span>
          {checkedAt == null
            ? '아직 확인한 기록이 없습니다'
            : `마지막 확인 ${checkedTime.format(checkedAt)}`}
        </span>
        <button type="button" class="deadline-refresh" disabled={checking} onClick={onRefresh}>
          다시 확인
        </button>
      </div>
      <div role="status">
        {message && (message !== '아직 확인한 기록이 없습니다' || checkedAt != null) && (
          <p class="deadline-notice">{message}</p>
        )}
        {navigationFailed && <p class="deadline-notice">KLAS 목록으로 이동하지 못했습니다.</p>}
      </div>
      {loginRequired && (
        <a class="deadline-login" href="/usr/cmn/login/LoginForm.do">
          KLAS 로그인 화면으로
        </a>
      )}
      {groups.map(({ key, label, items }) => (
        <section key={key}>
          <h3 class="deadline-date">
            {label} <span>{items.length}개</span>
          </h3>
          <ul class="deadline-items">
            {items.map((item) => (
              <li key={item.id}>
                <button class="deadline-item" type="button" onClick={() => navigate(item)}>
                  <span class="deadline-body">
                    <span class="deadline-course">
                      <span class="deadline-kind">{labels[item.kind]}</span>
                      {item.subjectName}
                    </span>
                    <strong>{item.title}</strong>
                    <span class="deadline-time">
                      <time dateTime={new Date(item.dueAt).toISOString()}>
                        {deadlineTime.format(item.dueAt)}
                      </time>
                      {item.extended && <span class="deadline-extended">연장 기간</span>}
                    </span>
                  </span>
                  <span class="deadline-remaining" data-urgent={item.dueAt - now < 86_400_000}>
                    {formatRemaining(item.dueAt - now)} 남음
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
