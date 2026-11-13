export const MAX_ROUNDS: number;

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
  comments: { login: string; body: string }[];
  reviews: { id: number; login: string; commitId: string; inlineCount: number }[];
  checkRuns: CheckRun[];
  codexBot: string;
  handlerBot: string;
}

export interface ReviewDecision {
  action: 'none' | 'fix' | 'ready' | 'stop';
  reason: string;
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
