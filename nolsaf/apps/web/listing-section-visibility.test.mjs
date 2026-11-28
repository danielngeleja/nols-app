import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const filename = fileURLToPath(new URL("./app/(owner)/owner/properties/add/_components/AddPropertySection.tsx", import.meta.url));
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const componentModule = new Module(filename);
componentModule.filename = filename;
componentModule.paths = Module._nodeModulePaths(path.dirname(filename));
componentModule._compile(compiled, filename);
const { AddPropertySection } = componentModule.exports;

function render(visible) {
  return renderToStaticMarkup(React.createElement(AddPropertySection, {
    as: "section", isVisible: visible, className: "add-property-step-surface",
  }, "Opening event details…"));
}

test("inactive event step uses explicit hiding rather than only a CSS utility", () => {
  const html = render(false);
  assert.match(html, /hidden=""/);
  assert.match(html, /style="display:none"/);
  // Its content remains mounted so moving between steps preserves the draft.
  assert.match(html, /Opening event details/);
});

test("active event step restores normal visibility", () => {
  const html = render(true);
  assert.doesNotMatch(html, /hidden=/);
  assert.doesNotMatch(html, /display:none/);
  assert.match(html, /block nls-flipbook/);
});
