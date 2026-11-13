export const PING_TIMEOUT_MS: number;

export const MAX_ASKS: number;

export type RelayKind = 'implement' | 'round-limit' | 'rebuttal' | 'fix-failed';

export interface Roles {
  codex: string[];
  claude: string[];
  maintainer: string[];
}

export function rolesOf(input: { codexBot: string; claudeBot?: string; maintainer: string }): Roles;

export function relayRequestBody(
  kind: RelayKind,
  options: {
    runUrl: string;
    key: string;
    askId?: number | null;
    issue?: number | null;
    pr?: number | null;
  },
): string;

export interface ThreadComment {
  id: number;
  login: string;
  body: string;
}

export function decideRelayTarget(input: {
  comments: ThreadComment[];
  history?: ThreadComment[];
  roles: Roles;
}): {
  target: 'codex' | 'user';
  askId: number | null;
  reason: string;
  errors: string[];
  /** Codex에게 넘길 때 ask의 이슈, PR 번호(답 틀을 채운다) */
  issue?: number | null;
  pr?: number | null;
};

export function expectedIssueOf(input: { number: number; headRef?: string | null }): number | null;

export function resolveExpectedIssue(input: {
  github: unknown;
  repo: { owner: string; repo: string };
  number: number;
}): Promise<number | null>;

export function classifyCodexReply(input: {
  comment: ThreadComment;
  comments: ThreadComment[];
  roles: Roles;
  expectedIssue: number | null | undefined;
}): {
  kind: 'restart' | 'hold' | 'need-user' | 'invalid' | 'other';
  errors: string[];
  replyTo?: number;
};

export interface PingInput {
  comments: { id?: number; login: string; body: string; createdAt: string }[];
  now: number;
  codexBot: string;
  maintainer: string;
  pingBot: string;
  roles?: Roles;
  expectedIssue?: number | null;
}

export function decidePing(input: PingInput): { ping: null | 'codex' | 'timeout'; key?: string };

export function pingBody(
  ping: 'codex' | 'timeout',
  options: { maintainer: string; key: string },
): string;

export function readCommentLines(text: string): ThreadComment[];
