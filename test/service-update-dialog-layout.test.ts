import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Pin the actual Service Updates forms, not just the similarly named
// Service Alerts forms. Shared keyboard behavior is exercised by
// dialog-keyboard-inset.test.ts; jsdom cannot verify touch scrolling geometry.
const source = ts.createSourceFile(
  "admin-portal.tsx",
  readFileSync("client/src/pages/admin-portal.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const tab = source.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "ServiceUpdatesTab",
);
assert.ok(tab);

function elements(node: ts.Node, tag: string): ts.JsxElement[] {
  const matches: ts.JsxElement[] = [];
  function walk(child: ts.Node) {
    if (ts.isJsxElement(child) && child.openingElement.tagName.getText(source) === tag) matches.push(child);
    ts.forEachChild(child, walk);
  }
  walk(node);
  return matches;
}

function attribute(node: ts.JsxElement, name: string): string | undefined {
  const attr = node.openingElement.attributes.properties.find(
    (prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(source) === name,
  );
  return attr?.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : undefined;
}

for (const [dialogId, actionId, editorId, containerTag] of [
  ["dialog-create-service-update", "button-submit-service-update", "input-service-update-description", "form"],
  ["dialog-edit-service-update", "button-save-edit-update", "input-edit-update-description", "div"],
]) {
  test(`${dialogId} keeps the editor scrollable and its action outside the scrolling fields`, () => {
    const dialog = elements(tab!, "AlertEditorDialogContent").find(node => attribute(node, "data-testid") === dialogId);
    assert.ok(dialog, "service updates must use the viewport-bounded editor dialog");
    const areas = elements(dialog, "AlertEditorScrollArea");
    const actions = elements(dialog, "AlertEditorActions");
    assert.equal(areas.length, 1);
    assert.equal(actions.length, 1);
    assert.ok(areas[0].end < actions[0].pos, "footer follows, rather than belongs to, the scroll area");
    const editorText = areas[0].getText(source);
    assert.ok(editorText.includes(editorId), "actual service-update rich editor is in the scroll area");
    assert.ok(!editorText.includes(actionId), "submit action is never below the long message inside the scroll area");
    const button = elements(actions[0], "Button").find(node => attribute(node, "data-testid") === actionId);
    assert.ok(button, "existing action stays in the non-shrinking footer");
    const container = elements(dialog, containerTag).find(node =>
      node.pos < areas[0].pos && node.end > actions[0].end);
    assert.ok(container, "fields and actions share a sizing container");
    const classes = attribute(container, "className")?.split(" ");
    for (const cls of ["flex", "flex-col", "flex-1", "min-h-0"]) assert.ok(classes?.includes(cls), cls);
    if (containerTag === "form") {
      assert.equal(attribute(button, "type"), "submit", "create still submits the original form");
      assert.ok(container.openingElement.getText(source).includes("form.handleSubmit"));
    } else {
      assert.ok(button.getText(source).includes("editMutation.mutate"), "edit retains the real save action");
    }
  });
}
