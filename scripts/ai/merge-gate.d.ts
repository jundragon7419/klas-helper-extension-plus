import type { CheckRun } from './review-decision.js';

export const GATE_CONTEXT: string;

export interface GateInput {
  head: string;
  labels: string[];
  comments: { id?: number; login: string; body: string; at?: string }[];
  reviews: { login: string; commitId: string; at?: string }[];
  inlineComments: { login: string; originalCommitId: string; body: string }[];
  checkRuns: CheckRun[];
  codexBot: string;
}

export function decideGate(input: GateInput): {
  state: 'pending' | 'success' | 'failure';
  description: string;
};

export function updateGate(args: {
  github: unknown;
  context: unknown;
  core: unknown;
  number: number;
  codexBot: string;
  runUrl: string;
}): Promise<ReturnType<typeof decideGate> | null>;
