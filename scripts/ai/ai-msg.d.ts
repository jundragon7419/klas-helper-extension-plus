export const VERSION: string;

export const HEADER_KEYS: string[];

export type Role = 'codex' | 'claude' | 'maintainer';

export const ROLES: Role[];

export type MessageType =
  | 'plan'
  | 'start'
  | 'ask'
  | 'answer'
  | 'need-user'
  | 'plan-rev'
  | 'change'
  | 'objection'
  | 'report';

export interface MessageSpec {
  from: Role[];
  to: Role;
  mention?: string;
  header: string[];
  fields: string[];
  values?: Record<string, string[]>;
}

export const MESSAGE_TYPES: Record<MessageType, MessageSpec>;

export interface MessageMeta {
  type: string;
  issue?: string | number;
  pr?: string | number;
  head?: string;
  rev?: string | number;
  'reply-to'?: string | number;
}

export function formatHeader(meta: MessageMeta): string;

export function formatMessage(meta: MessageMeta, fields: Record<string, string>): string;

export interface ParsedMessage {
  version: string;
  mention: string | null;
  meta: Record<string, string>;
  fields: Record<string, string>;
  duplicates: string[];
}

export function parseMessage(body: string | null | undefined): ParsedMessage | null;

export function validateMessage(
  comment: { login: string; body: string },
  roles: Record<Role, string[]>,
): { message: ParsedMessage | null; errors: string[] };

export function formatErrorBody(input: { login: string; url: string; errors: string[] }): string;
