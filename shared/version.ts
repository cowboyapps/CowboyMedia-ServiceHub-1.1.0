export const APP_VERSION = "9.6";

export function versionAnchor(version: string): string {
  return `version-${version.replace(/\./g, "-")}`;
}
