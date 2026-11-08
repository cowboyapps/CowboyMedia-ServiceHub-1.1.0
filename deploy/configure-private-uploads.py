#!/usr/bin/env python3
"""Install the scoped upload location without replacing Certbot's TLS config."""
import pathlib
import re
import subprocess
import sys

BEGIN = "  # BEGIN PRIVATE MESSAGE UPLOADS"
END = "  # END PRIVATE MESSAGE UPLOADS"
BLOCK = re.compile(r"^[ \t]*# BEGIN PRIVATE MESSAGE UPLOADS.*?^[ \t]*# END PRIVATE MESSAGE UPLOADS\n?", re.M | re.S)


def render(template: str, existing: str) -> str:
    snippet = template[template.index(BEGIN):template.index(END) + len(END)] + "\n"
    if BLOCK.search(existing):
        return BLOCK.sub(lambda _: snippet, existing)
    updated, count = re.subn(r"^([ \t]*location\s+/\s*\{)", lambda m: snippet + "\n" + m.group(1), existing, flags=re.M)
    if not count:
        raise ValueError("No managed root location found; refusing to overwrite Nginx configuration")
    return updated


def main():
    template, target = map(pathlib.Path, sys.argv[1:3])
    existing = target.read_text()
    updated = render(template.read_text(), existing)
    if "--render-only" in sys.argv:
        print(updated, end="")
        return
    if updated == existing:
        print("Private-message Nginx upload limits already current.")
        return
    # Keep a recovery copy outside sites-enabled/available glob includes.
    backup = target.parent.parent / "servicehub-private-uploads.bak"
    backup.write_text(existing)
    try:
        target.write_text(updated)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except Exception:
        target.write_text(existing)
        raise
    print("Installed scoped private-message upload limits; existing TLS settings preserved.")


if __name__ == "__main__":
    main()
