export const TRIAGE_TAG: string;
export const MAX_TRIAGES: number;

export interface InlineComment {
  id?: number;
  login: string;
  body: string;
  path?: string | null;
  line?: number | null;
  url: string;
  /** 지적을 처음 단 커밋 */
  originalCommitId?: string;
}

export interface Finding {
  level: number;
  path: string | null;
  line?: number | null;
  title: string;
  url?: string | null;
}

export interface Triage {
  head: string;
  findings: Finding[];
}

export function inlineFinding(c: InlineComment): Finding | null;
export function taskFindings(input: { body: string; url: string | null }): Finding[];
export function findingKey(f: Finding): string;
export function parseTriage(body: string | null | undefined): Triage | null;
export function triageRequestBody(input: {
  issue: number;
  pr: number;
  head: string;
  rev: number;
  findings: Finding[];
  runUrl: string;
}): string;
export function userChangeRequestBody(input: {
  issue: number;
  pr: number;
  rev: number;
  requestId: number;
  request: string;
}): string;
export function relayTemplates(input: { issue: number; pr: number | null; askId: number }): string;
export function decideTriage(input: { head: string; findings: Finding[]; triages: Triage[] }): {
  kind: 'wait' | 'repeat' | 'limit' | 'triage';
  repeated: Finding[];
};
export function parseUserChange(body: string | null | undefined): string | null;
export const REQUEST_TIMEOUT_MS: number;
export function overdueRequest(input: {
  comments: { id: number; login: string; body: string; at: string }[];
  maintainer: string;
  codexBot: string;
  now: number;
}): { id: number; login: string; body: string; at: string } | null;
