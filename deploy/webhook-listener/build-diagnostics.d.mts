export const BUILD_ERROR_MARKER: string;
export function redactDiagnostics(text: unknown): string;
export function formatBuildError(error: unknown): string;
export function extractFailureDiagnostics(logText: string): string;
export function formatFailureNotice(options: {
  sha: string;
  code: number | null;
  duration: string;
  verification: string;
  hint?: string | null;
  logText: string;
  logId: string;
}): string;
