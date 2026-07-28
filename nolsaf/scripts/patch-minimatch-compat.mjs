import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pluginVersions = {
  "eslint-plugin-import": "2.32.0",
  "eslint-plugin-jsx-a11y": "6.10.2",
  "eslint-plugin-react": "7.37.5",
};

for (const [pluginName, expectedVersion] of Object.entries(pluginVersions)) {
  const packageJsonPath = path.join(repositoryRoot, "node_modules", pluginName, "package.json");
  const installedVersion = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version;

  if (installedVersion !== expectedVersion) {
    throw new Error(
      `${pluginName} ${installedVersion} is installed; review the minimatch compatibility patch before replacing ${expectedVersion}.`,
    );
  }
}

const patches = [
  ...[
    "forbid-component-props.js",
    "jsx-handler-names.js",
    "jsx-pascal-case.js",
    "no-danger.js",
    "no-unstable-nested-components.js",
  ].map((fileName) => ({
    relativePath: path.join("eslint-plugin-react", "lib", "rules", fileName),
    original: "const minimatch = require('minimatch');",
    replacement:
      "const minimatchModule = require('minimatch');\nconst minimatch = minimatchModule.minimatch || minimatchModule;",
  })),
  ...["mayHaveAccessibleLabel.js", "mayContainChildComponent.js"].map((fileName) => ({
    relativePath: path.join("eslint-plugin-jsx-a11y", "lib", "util", fileName),
    original: 'var _minimatch = _interopRequireDefault(require("minimatch"));',
    replacement:
      'var _minimatchModule = require("minimatch");\nvar _minimatch = _interopRequireDefault(_minimatchModule.minimatch || _minimatchModule);',
  })),
  ...[
    "extensions.js",
    "no-extraneous-dependencies.js",
    "no-import-module-exports.js",
    "no-internal-modules.js",
    "no-namespace.js",
    "no-unassigned-import.js",
    "order.js",
  ].map((fileName) => ({
    relativePath: path.join("eslint-plugin-import", "lib", "rules", fileName),
    original: "_interopRequireDefault(_minimatch);",
    replacement: "_interopRequireDefault(_minimatch.minimatch || _minimatch);",
  })),
];

let patchedFileCount = 0;

for (const patch of patches) {
  const filePath = path.join(repositoryRoot, "node_modules", patch.relativePath);
  const source = fs.readFileSync(filePath, "utf8");

  if (source.includes(patch.replacement)) {
    continue;
  }

  const matchCount = source.split(patch.original).length - 1;
  if (matchCount !== 1) {
    throw new Error(
      `Expected one compatibility patch target in ${patch.relativePath}, found ${matchCount}.`,
    );
  }

  fs.writeFileSync(filePath, source.replace(patch.original, patch.replacement));
  patchedFileCount += 1;
}

console.log(
  patchedFileCount === 0
    ? "Minimatch compatibility patches already applied."
    : `Applied minimatch compatibility patches to ${patchedFileCount} lint plugin files.`,
);
