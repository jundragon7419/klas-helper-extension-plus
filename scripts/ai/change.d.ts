import type { Roles, ThreadComment } from './relay.js';

export const MAX_CHANGES: number;

export interface Revision {
  id: number;
  where: 'issue' | 'pr';
  type: 'plan-rev' | 'change';
  rev: number;
  fields: Record<string, string>;
}

export function collectRevisions(input: {
  issue: number;
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
