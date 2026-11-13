import type { Roles, ThreadComment } from './relay.js';

export const MAX_CHANGES: number;

export interface Revision {
  id: number;
  where: 'issue' | 'pr';
  type: 'plan-rev' | 'change';
  rev: number;
  fields: Record<string, string>;
  /** change의 근거. review는 리뷰 정리 요청, user는 사용자 수정 요청 */
  source?: 'review' | 'user';
}

export function changeSource(
  comments: { id: number; body: string }[],
  replyTo: number,
): 'review' | 'user';

export function collectRevisions(input: {
  issue: number;
  pr?: number | null;
  issueComments: ThreadComment[];
  prComments?: ThreadComment[];
  roles: Roles;
}): Revision[];

export interface ChangeReply {
  kind: 'none' | 'invalid' | 'limit' | 'run';
  errors: string[];
  changeId?: number;
  rev?: number;
  replyTo?: number;
}

export function classifyChange(input: {
  comment: ThreadComment;
  comments: ThreadComment[];
  issueComments: ThreadComment[];
  roles: Roles;
  issue: number | null;
  pr: number;
}): ChangeReply;

export function decideChange(input: {
  labels: string[];
  open: boolean;
  sameRepo: boolean;
  reply: ChangeReply;
}): {
  action: 'none' | 'reject' | 'halt' | 'fix';
  reason: string;
  task?: string;
  addLabels: string[];
  removeLabels: string[];
};

export function formatPlan(input: {
  issue: number;
  title: string;
  body: string;
  revisions: Revision[];
}): string;

export function revisionRecordBody(input: {
  pr: number;
  rev: number;
  url: string;
  fields: Record<string, string>;
}): string;
