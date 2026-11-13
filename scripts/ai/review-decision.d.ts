export const MAX_ROUNDS: number;

export function isAiMessage(body: string): boolean;

export interface CodexTask {
  kind: 'review' | 'code-change' | 'other';
  findings: number;
  blocking: number;
}

export function classifyCodexTask(body: string, head: string): CodexTask | null;

export interface CodexComment {
  id?: number;
  login: string;
  body: string;
  /** 마지막 수정 시각 */
  at?: string;
}

export function codexResults(input: {
  head: string;
  codexBot: string;
  comments: CodexComment[];
  reviews: { login: string; commitId: string; at?: string }[];
}): {
  reviewed: boolean;
  reviewTasks: (CodexComment & { task: CodexTask })[];
  unresolvedChange: (CodexComment & { task: CodexTask }) | null;
};

export function codeChangeNotice(input: { maintainer: string; head: string; url: string }): string;

export interface CodexReviewState {
  commit_sha: string | null;
  has_any_findings: boolean | null;
  has_unresolved_findings: boolean | null;
  status: string | null;
}

export function parseCodexState(body: string | null | undefined): CodexReviewState | null;

export const CI_CHECKS: string[];

export interface CheckRun {
  id?: number;
  /** check run 이름. 있으면 CI_CHECKS의 이름마다 따로 본다. */
  name?: string;
  status: string;
  conclusion: string | null;
}

export function summarizeChecks(runs: CheckRun[]): 'missing' | 'pending' | 'success' | 'failure';

export interface ReviewInput {
  labels: string[];
  open: boolean;
  sameRepo: boolean;
  head: string;
  comments: CodexComment[];
  reviews: { id: number; login: string; commitId: string; inlineCount: number; at?: string }[];
  checkRuns: CheckRun[];
  codexBot: string;
  handlerBot: string;
}

export interface ReviewDecision {
  action: 'none' | 'fix' | 'ready' | 'stop' | 'halt';
  reason: string;
  /** halt일 때 사용자에게 알릴 Codex 작업 결과 댓글 ID */
  notice?: number | null;
  task?: string;
  round?: number;
  addLabels: string[];
  removeLabels: string[];
}

export function decideReview(input: ReviewInput): ReviewDecision;

export function decideAnswerRestart(input: {
  labels: string[];
  open: boolean;
  sameRepo: boolean;
  answerId: number;
}): ReviewDecision;
