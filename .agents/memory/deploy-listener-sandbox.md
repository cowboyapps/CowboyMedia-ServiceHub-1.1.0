---
name: Deploy listener sandbox
description: Why privileged deployment subprocesses can still see read-only server configuration
---

The VPS deployment listener's systemd filesystem sandbox is inherited by its privileged child processes. `sudo` does not escape that mount namespace, so a root deployment can still fail with a read-only filesystem error.

**Why:** The private-upload Nginx installer reached its backup step after a successful build but could not write under the listener's read-only `/etc` mount.

**How to apply:** Retain filesystem protection and grant only the directory the updater must modify. Updating the unit template in Git does not change an existing installed/running VPS service: apply the documented server-side override, reload systemd, and restart the listener while no deployment is active before retrying. Do not substitute broad chmod/chown, remounting, or disabling the sandbox.
