// 자동 흐름 이슈 하나의 측정 값을 GitHub 기록에서 계산한다. 결과는 docs/AI-METRICS.md 표의 한 행이다.
// 실행: npm run ai:metrics -- <이슈 번호...> (gh CLI 로그인 필요). tests/metrics.test.ts가 계산을 검사한다.
// 정의는 docs/AI-METRICS.md "항목"에 있다. 머지 뒤 생긴 버그는 계산하지 않고 사람이 채운다.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { closedIssues } from '../ci/check-branch.js';
import { parseMessage } from './ai-msg.js';

const HOUR = 3_600_000;

/** 라벨이 붙어 있던 기간을 [시작, 끝] 목록으로 만든다. 끝나지 않았으면 until까지 본다. */
export function labelSpans(events, label, until) {
  const spans = [];
  let since = null;
  for (const e of [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (e.label !== label) continue;
    const at = Date.parse(e.createdAt);
    if (e.event === 'labeled' && since === null) since = at;
    if (e.event === 'unlabeled' && since !== null) {
      spans.push([since, at]);
      since = null;
    }
  }
  if (since !== null && until !== null && until > since) spans.push([since, until]);
  return spans;
}

const total = (spans) => spans.reduce((n, [a, b]) => n + (b - a), 0);
const count = (events, label) =>
  events.filter((e) => e.event === 'labeled' && e.label === label).length;

/** 시간(ms)을 `1일 3.5시간`, `2.0시간` 모양으로 쓴다. */
export function formatDuration(ms) {
  if (ms === null) return '-';
  const hours = ms / HOUR;
  if (hours < 24) return `${hours.toFixed(1)}시간`;
  const days = Math.floor(hours / 24);
  return `${days}일 ${(hours - days * 24).toFixed(1)}시간`;
}

/**
 * @param {object} input
 * @param {{number: number, createdAt: string}} input.issue
 * @param {{number: number, mergedAt: string | null, head: string} | null} input.pr 이슈를 닫은 PR
 * @param {{login: string, body: string}[]} input.issueComments
 * @param {{login: string, body: string}[]} input.prComments
 * @param {{event: string, label?: string, createdAt: string}[]} input.issueEvents 라벨 이벤트
 * @param {{event: string, label?: string, createdAt: string}[]} input.prEvents
 * @param {{login: string, body: string, originalCommitId: string}[]} input.reviewComments PR 줄 단위 리뷰 댓글
 * @param {{maintainer: string, codexBot: string, claudeBot: string}} input.accounts
 */
export function issueMetrics(input) {
  const { issue, pr, accounts } = input;
  const mergedAt = pr?.mergedAt ? Date.parse(pr.mergedAt) : null;
  const threads = [...input.issueComments, ...input.prComments];
  const messages = threads.map((c) => ({ login: c.login, message: parseMessage(c.body) }));
  const typed = (types, login) =>
    messages.filter((m) => m.login === login && types.includes(m.message?.meta.type)).length;

  // 사람이 기다린 시간: 자동 흐름이 멈춘 기간(ai:needs-human)과 확인 대기(ai:ready부터 머지까지)
  const stopped = [
    ...labelSpans(input.issueEvents, 'ai:needs-human', mergedAt),
    ...labelSpans(input.prEvents, 'ai:needs-human', mergedAt),
  ];
  const ready = labelSpans(input.prEvents, 'ai:ready', mergedAt).slice(-1);
  const waited = mergedAt === null ? null : total(stopped) + total(ready);

  const findings = input.reviewComments.filter((c) => c.login === accounts.codexBot);
  const answered = pr ? findings.filter((c) => c.originalCommitId !== pr.head).length : 0;

  return {
    issue: issue.number,
    pr: pr?.number ?? null,
    leadTime: mergedAt === null ? null : mergedAt - Date.parse(issue.createdAt),
    waited,
    starts: input.issueComments.filter(
      (c) => c.login === accounts.maintainer && c.body.trimStart().startsWith('@claude'),
    ).length,
    stops: count(input.issueEvents, 'ai:needs-human') + count(input.prEvents, 'ai:needs-human'),
    asks: typed(['ask', 'objection'], accounts.claudeBot),
    needUser: typed(['need-user'], accounts.codexBot),
    findings: findings.length,
    answered,
  };
}

/** docs/AI-METRICS.md 표의 한 행. 머지 뒤 버그 칸은 비워 둔다. */
export function metricsRow(m) {
  return `| #${m.issue} | ${m.pr ? `#${m.pr}` : '-'} | ${formatDuration(m.leadTime)} | ${formatDuration(m.waited)} | ${m.starts} | ${m.stops} | ${m.asks} | ${m.needUser} | ${m.findings} / ${m.answered} | |`;
}

function gh(path) {
  const out = execFileSync('gh', ['api', '--paginate', '--slurp', path], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out).flat();
}

const comments = (list) => list.map((c) => ({ login: c.user?.login ?? '', body: c.body ?? '' }));
const labelEvents = (list) =>
  list
    .filter((e) => e.event === 'labeled' || e.event === 'unlabeled')
    .map((e) => ({ event: e.event, label: e.label?.name, createdAt: e.created_at }));

/** gh CLI로 이슈 하나의 기록을 모아 계산한다. */
export function collectIssue(repo, number, accounts) {
  const [issue] = gh(`repos/${repo}/issues/${number}`);
  const pulls = gh(`repos/${repo}/pulls?state=closed&per_page=100`);
  const pull = pulls.find((p) => p.merged_at && closedIssues(p.body).includes(number)) ?? null;
  return issueMetrics({
    issue: { number, createdAt: issue.created_at },
    pr: pull && { number: pull.number, mergedAt: pull.merged_at, head: pull.head.sha },
    issueComments: comments(gh(`repos/${repo}/issues/${number}/comments?per_page=100`)),
    prComments: pull
      ? comments(gh(`repos/${repo}/issues/${pull.number}/comments?per_page=100`))
      : [],
    issueEvents: labelEvents(gh(`repos/${repo}/issues/${number}/events?per_page=100`)),
    prEvents: pull
      ? labelEvents(gh(`repos/${repo}/issues/${pull.number}/events?per_page=100`))
      : [],
    reviewComments: pull
      ? gh(`repos/${repo}/pulls/${pull.number}/comments?per_page=100`).map((c) => ({
          login: c.user?.login ?? '',
          body: c.body ?? '',
          originalCommitId: c.original_commit_id,
        }))
      : [],
    accounts,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GH_REPO ?? 'jundragon7419/klas-helper-extension-plus';
  const accounts = {
    maintainer: process.env.MAINTAINER ?? 'jundragon7419',
    codexBot: 'chatgpt-codex-connector[bot]',
    claudeBot: 'claude[bot]',
  };
  const numbers = process.argv.slice(2).map(Number).filter(Number.isInteger);
  if (numbers.length === 0) {
    console.error('사용법: npm run ai:metrics -- <이슈 번호...>');
    process.exit(1);
  }
  for (const n of numbers) console.log(metricsRow(collectIssue(repo, n, accounts)));
}
