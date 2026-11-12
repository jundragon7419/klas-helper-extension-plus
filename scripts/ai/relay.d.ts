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
  options: { runUrl: string; key: string; askId?: number | null },
): string;

export interface ThreadComment {
  id: number;
  login: string;
  body: string;
}

export function decideRelayTarget(input: { comments: ThreadComment[]; roles: Roles }): {
  target: 'codex' | 'user';
  askId: number | null;
  reason: string;
};

export function classifyCodexReply(input: {
  comment: ThreadComment;
  comments: ThreadComment[];
  roles: Roles;
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
}

export function decidePing(input: PingInput): { ping: null | 'codex' | 'timeout'; key?: string };

export function pingBody(
  ping: 'codex' | 'timeout',
  options: { maintainer: string; key: string },
): string;

export function readCommentLines(text: string): ThreadComment[];
