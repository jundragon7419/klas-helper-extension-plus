export const PING_TIMEOUT_MS: number;

export type RelayKind = 'implement' | 'round-limit' | 'rebuttal' | 'fix-failed';

export function relayRequestBody(kind: RelayKind, options: { runUrl: string; key: string }): string;

export interface PingInput {
  comments: { login: string; body: string; createdAt: string }[];
  now: number;
  codexBot: string;
  maintainer: string;
  pingBot: string;
}

export function decidePing(input: PingInput): { ping: null | 'codex' | 'timeout'; key?: string };

export function pingBody(
  ping: 'codex' | 'timeout',
  options: { maintainer: string; key: string },
): string;
