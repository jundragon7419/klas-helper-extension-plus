export const BRANCH_KINDS: string[];

export const BRANCH_PATTERN: RegExp;

export function closedIssues(body: string | null | undefined): number[];

export function checkPullRequest(pr: {
  head: string;
  base: string;
  body: string | null | undefined;
}): string[];
