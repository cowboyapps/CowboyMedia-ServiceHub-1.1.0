import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const unit = readFileSync(
  new URL("../deploy/webhook-listener/servicehub-deploy.service", import.meta.url),
  "utf8",
);
const directives = unit.split(/\r?\n/).map(line => line.trim());
const writablePaths = directives
  .filter(line => line.startsWith("ReadWritePaths="))
  .flatMap(line => line.slice("ReadWritePaths=".length).split(/\s+/))
  .filter(Boolean);
const writable = (file: string) => writablePaths.some(
  directory => file === directory || file.startsWith(`${directory}/`),
);

test("deploy sandbox permits both the Nginx site update and its recovery backup", () => {
  assert.ok(writable("/etc/nginx/sites-available/servicehub"));
  assert.ok(writable("/etc/nginx/servicehub-private-uploads.bak"));
});

test("deploy sandbox retains its existing log access", () => {
  assert.ok(writable("/var/log/servicehub-deploy/delivery.log"));
});

test("Nginx exception does not disable protection or allow all system configuration writes", () => {
  assert.deepEqual(directives.filter(line => line.startsWith("ProtectSystem=")), [
    "ProtectSystem=full",
  ]);
  assert.ok(!writablePaths.some(directory => ["/", "/etc", "/usr", "/boot"].includes(directory)));
  assert.ok(!writable("/etc/servicehub-deploy.env"));
  assert.ok(!writable("/etc/ssh/sshd_config"));
});
