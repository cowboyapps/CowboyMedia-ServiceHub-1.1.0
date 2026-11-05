export const APP_VERSION = "9.4";

export function versionAnchor(version: string): string {
  return `version-${version.replace(/\./g, "-")}`;
}
