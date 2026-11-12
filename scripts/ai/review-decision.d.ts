export const MAX_ROUNDS: number;

export interface CodexReviewState {
  commit_sha: string | null;
  has_any_findings: boolean | null;
  has_unresolved_findings: boolean | null;
  status: string | null;
}

export function parseCodexState(body: string | null | undefined): CodexReviewState | null;

export interface CheckRun {
  id?: number;
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
