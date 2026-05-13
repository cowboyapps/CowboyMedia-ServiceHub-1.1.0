import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { randomBytes } from "crypto";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Stamp the service worker with a unique build id so its cache version
  // automatically rotates on every deploy. This avoids stale-shell white
  // screens after a release.
  const buildId = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const swPath = "dist/public/sw.js";
  try {
    const swSrc = await readFile(swPath, "utf-8");
    const swStamped = swSrc.split("__BUILD_ID__").join(buildId);
    await writeFile(swPath, swStamped, "utf-8");
    console.log(`stamped service worker with build id: ${buildId}`);
  } catch (err) {
    console.warn(`could not stamp service worker (${swPath}):`, err);
  }

  // Stamp the build with the current git SHA so the running server can report
  // it via /api/health without shelling out per request. deploy/update.sh
  // diffs this against the SHA it just pushed to detect the "deploy ran but
  // HEAD never moved" failure mode.
  let gitSha = "";
  try {
    gitSha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch (err) {
    console.warn("could not capture git SHA for build:", err);
  }
  if (gitSha) {
    await mkdir("dist", { recursive: true });
    await writeFile("dist/.git-sha", gitSha + "\n", "utf-8");
    console.log(`stamped build with git sha: ${gitSha}`);
  }

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
