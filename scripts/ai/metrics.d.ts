export interface LabelEvent {
  event: string;
  label?: string;
  createdAt: string;
}

export interface IssueMetrics {
  issue: number;
  pr: number | null;
  leadTime: number | null;
  waited: number | null;
  starts: number;
  stops: number;
  asks: number;
  needUser: number;
  findings: number;
  answered: number;
}

export function labelSpans(
  events: LabelEvent[],
  label: string,
  until: number | null,
): [number, number][];
export function formatDuration(ms: number | null): string;
export function issueMetrics(input: {
  issue: { number: number; createdAt: string };
  pr: { number: number; mergedAt: string | null; head: string } | null;
  issueComments: { login: string; body: string }[];
  prComments: { login: string; body: string }[];
  issueEvents: LabelEvent[];
  prEvents: LabelEvent[];
  reviewComments: { login: string; body: string; originalCommitId: string }[];
  accounts: { maintainer: string; codexBot: string; claudeBot: string };
}): IssueMetrics;
export function metricsRow(m: IssueMetrics): string;
export function collectIssue(
  repo: string,
  number: number,
  accounts: { maintainer: string; codexBot: string; claudeBot: string },
): IssueMetrics;
