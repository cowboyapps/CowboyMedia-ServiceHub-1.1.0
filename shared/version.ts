export const APP_VERSION = "10.0";

export function versionAnchor(version: string): string {
  return `version-${version.replace(/\./g, "-")}`;
}
