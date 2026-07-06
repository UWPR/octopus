// Fills the {{APP_VERSION}} placeholder in the built documentation with the version
// from package.json, so the docs always match the app version with no manual step.
//
// Runs as a postbuild step, after react-scripts copies public/ into build/. It edits
// only the build/ copies, so the source public/*.md keep the placeholder and there is
// no per-release churn in git.

const fs = require('fs');
const path = require('path');

const version = require('../package.json').version;
const buildDir = path.resolve(__dirname, '..', 'build');
const docs = ['octopus_doc.md', 'quick-start-guide.md'];

let updated = 0;
for (const name of docs) {
  const file = path.join(buildDir, name);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/\{\{APP_VERSION\}\}/g, version);
  if (after !== before) {
    fs.writeFileSync(file, after);
    updated++;
  }
}

console.log(`sync-doc-version: set version ${version} in ${updated} doc file(s)`);
