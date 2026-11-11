import { existsSync, renameSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Build beside dist, never inside it. Keep the previous tree until promotion
 * succeeds; even a failed rename must not destroy the only working artifacts.
 */
export async function withStagedBuild(
  build: (outDir: string) => Promise<void>,
  root = process.cwd(),
) {
  const live = path.join(root, "dist");
  const workspace = await mkdtemp(path.join(root, ".build-"));
  const candidate = path.join(workspace, "artifacts");
  const previous = path.join(workspace, "previous");
  let promoted = false;
  try {
    await build(candidate);
    for (const file of ["public/index.html", "public/sw.js", "index.cjs"]) {
      const info = await stat(path.join(candidate, file));
      if (!info.isFile() || info.size === 0) {
        throw new Error(`Build artifact is missing or empty: ${file}`);
      }
    }
    if ((await readFile(path.join(candidate, "public/sw.js"), "utf8")).includes("__BUILD_ID__")) {
      throw new Error("Service worker build ID was not stamped");
    }

    // Same-filesystem renames, with no asynchronous work between them. If the
    // second fails, immediately put the old directory back at its original path.
    if (existsSync(live)) renameSync(live, previous);
    try {
      renameSync(candidate, live);
      promoted = true;
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, live);
      throw error;
    }
  } finally {
    // A failed restore must leave the backup available for manual recovery.
    if (existsSync(previous) && !promoted) {
      console.error(`Previous build retained for recovery at ${previous}`);
    } else {
      // Cleanup is not a build failure after the new tree has been installed.
      // Reporting it as one would make update.sh reset an already-promoted build.
      await rm(workspace, { recursive: true, force: true }).catch((error) => {
        console.warn(`Could not clean build workspace ${workspace}:`, error);
      });
    }
  }
}
