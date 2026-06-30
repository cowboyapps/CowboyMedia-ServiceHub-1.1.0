export const APP_VERSION = "8.0";

export function versionAnchor(version: string): string {
  return `version-${version.replace(/\./g, "-")}`;
}

export function shouldShowVersionWelcome(
  lastSeen: string | null | undefined,
  current: string,
): boolean {
  return (lastSeen ?? "") !== current;
}
