import { test } from "node:test";
import assert from "node:assert/strict";
import { appendDownloadLink, downloadLinkPath } from "../client/src/lib/download-links";
import { splitMessageLinks } from "../client/src/components/ticket/safe-message-links";

test("download links preserve the item ID and existing draft without auto-sending or embedding an external download URL", () => {
  const item = { id: "specific-download", title: "Cowboy Player" };
  assert.equal(appendDownloadLink("", item), "Download: Cowboy Player\n/downloads?download=specific-download");
  assert.equal(appendDownloadLink("Please install this.", item), "Please install this.\n\nDownload: Cowboy Player\n/downloads?download=specific-download");
  const parts = splitMessageLinks(appendDownloadLink("", item));
  assert.deepEqual(parts.filter(p => p.type === "link"), [{
    type: "link", href: "/downloads?download=specific-download", value: "/downloads?download=specific-download",
    label: "/downloads?download=specific-download", internal: true,
  }]);
});

test("download identifiers are encoded as a query value, not interpreted as navigation", () => {
  const id = "file/with spaces?x=1&other=2#end";
  assert.equal(new URLSearchParams(downloadLinkPath(id).split("?")[1]).get("download"), id);
  assert.equal(appendDownloadLink("", { id: "id", title: "App\nname" }), "Download: App name\n/downloads?download=id");
});
