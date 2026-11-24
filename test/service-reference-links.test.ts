import { test } from "node:test";
import assert from "node:assert/strict";
import { appendServiceReference, serviceReferencePath } from "../client/src/lib/service-reference-links";
import { splitMessageLinks } from "../client/src/components/ticket/safe-message-links";

for (const kind of ["alert", "update"] as const) {
  test(`${kind} references preserve draft text and become clickable in ticket messages`, () => {
    const reference = { kind, id: "specific-post", title: "VOD\nMaintenance" };
    const path = kind === "alert" ? "/alerts/specific-post" : "/service-updates?highlight=specific-post";
    const label = kind === "alert" ? "Service alert" : "Service update";
    assert.equal(serviceReferencePath(reference), path);
    const message = appendServiceReference("Please check this first.  ", reference);
    assert.equal(message, `Please check this first.\n\n${label}: VOD Maintenance\n${path}`);
    assert.deepEqual(splitMessageLinks(message).filter(p => p.type === "link"), [
      { type: "link", value: path, href: path, label: path, internal: true },
    ]);
    assert.equal(appendServiceReference("", reference), `${label}: VOD Maintenance\n${path}`);
  });
}

test("reference identifiers cannot inject extra query parameters", () => {
  const id = "post/with spaces?x=1&other=2#end";
  const updatePath = serviceReferencePath({ kind: "update", id });
  assert.equal(new URLSearchParams(updatePath.split("?")[1]).get("highlight"), id);
  const alertPath = serviceReferencePath({ kind: "alert", id });
  assert.equal(alertPath, `/alerts/${encodeURIComponent(id)}`);
  assert.equal(splitMessageLinks(alertPath).filter(p => p.type === "link")[0]?.value, alertPath);
});
