export const TARGETS: Record<string, { background: 'service_worker' | 'scripts' }>;

export const ALLOWED_MATCH_PREFIX: string;

export interface AccessSummary {
  permissions: string[];
  optional_permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  content_script_matches: string[];
}

export function accessSummary(manifest: unknown): AccessSummary;

export function referencedFiles(manifest: unknown): string[];

export function checkManifest(input: {
  target: string;
  manifest: unknown;
  fileExists: (path: string) => boolean;
  expectedAccess: Partial<AccessSummary> | undefined;
}): string[];
