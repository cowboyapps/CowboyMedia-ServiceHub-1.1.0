import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { privateUploadError, PRIVATE_VIDEO_MAX_BYTES, PRIVATE_FILE_MAX_BYTES, PRIVATE_UPLOAD_TIMEOUT_MS } from "../shared/private-message-uploads";
import { uploadPrivateMessage } from "../client/src/lib/private-message-upload";

test("video limit is 250 MB, generic files stay 25 MB, Android octet-stream videos are recognised", () => {
  for (const type of ["video/mp4", "video/quicktime", "video/webm"]) {
    assert.equal(privateUploadError({ type, size: 90 * 1024 * 1024 }), null);
    assert.equal(privateUploadError({ type, size: PRIVATE_VIDEO_MAX_BYTES }), null);
    assert.match(privateUploadError({ type, size: PRIVATE_VIDEO_MAX_BYTES + 1 })!, /250 MB/);
  }
  assert.equal(privateUploadError({ type: "application/octet-stream", name: "PHONE.MOV", size: PRIVATE_VIDEO_MAX_BYTES }), null);
  assert.equal(privateUploadError({ type: "application/pdf", name: "document.pdf", size: PRIVATE_FILE_MAX_BYTES }), null);
  assert.match(privateUploadError({ type: "image/png", size: PRIVATE_FILE_MAX_BYTES + 1 })!, /25 MB/);
});

test("private uploads expose actual progress and use an extended, finite deadline", async () => {
  const original = globalThis.XMLHttpRequest;
  const instances: FakeXHR[] = [];
  class FakeXHR {
    upload: Record<string, (event?: unknown) => void> = {};
    timeout = 0;
    withCredentials = false;
    status = 200;
    responseText = '{"message":{"id":"saved"}}';
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    constructor() { instances.push(this); }
    open(method: string, url: string) { assert.equal(method, "POST"); assert.equal(url, "/api/message-threads/thread/messages"); }
    getResponseHeader() { return "application/json"; }
    send(_form: FormData) {}
    abort() { this.onabort?.(); }
  }
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
  try {
    const progress: number[] = [];
    const response = uploadPrivateMessage("/api/message-threads/thread/messages", new FormData(), n => progress.push(n));
    const xhr = instances.at(-1)!;
    assert.equal(xhr.timeout, PRIVATE_UPLOAD_TIMEOUT_MS);
    assert.equal(xhr.withCredentials, true);
    xhr.upload.onprogress({ lengthComputable: true, loaded: 45, total: 90 });
    xhr.upload.onload();
    xhr.onload!();
    assert.deepEqual(progress, [50, 100]);
    assert.equal((await (await response).json()).message.id, "saved");
    const timeout = uploadPrivateMessage("/api/message-threads/thread/messages", new FormData(), () => {});
    instances.at(-1)!.ontimeout!();
    await assert.rejects(timeout, /timed out/);
    const failed = uploadPrivateMessage("/api/message-threads/thread/messages", new FormData(), () => {});
    instances.at(-1)!.onerror!();
    await assert.rejects(failed, /draft is still available/);
  } finally { globalThis.XMLHttpRequest = original; }
});

test("Nginx updater preserves TLS, webhook caps and other locations, and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "private-nginx-test-"));
  try {
    const file = join(dir, "servicehub");
    const old = "server {\n listen 443 ssl;\n ssl_certificate /etc/ssl/test.pem;\n client_max_body_size 30M;\n location = /_deploy { client_max_body_size 1M; }\n location / {\n proxy_pass http://servicehub_upstream;\n }\n}\n";
    writeFileSync(file, old);
    const run = () => spawnSync("python3", ["deploy/configure-private-uploads.py", "deploy/nginx.conf.template", file, "--render-only"], { encoding: "utf8" });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /client_max_body_size 260M/);
    assert.match(first.stdout, /ssl_certificate \/etc\/ssl\/test.pem/);
    assert.match(first.stdout, /client_max_body_size 30M/);
    assert.match(first.stdout, /location = \/_deploy \{ client_max_body_size 1M/);
    assert.match(first.stdout, /proxy_request_buffering off/);
    writeFileSync(file, first.stdout);
    assert.equal(run().stdout, first.stdout, "repeated deploys cannot duplicate the upload location");
    writeFileSync(file, "server { listen 443 ssl; }\n");
    assert.notEqual(run().status, 0, "unrecognised configs fail rather than being overwritten");
    const updater = readFileSync("deploy/update.sh", "utf8");
    assert.match(updater, /configure-private-uploads\.py/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
