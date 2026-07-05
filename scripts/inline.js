// Post-build step for the single-file offline build.
//
// Reads build/index.html and folds every referenced JS and CSS file inline, strips
// the favicon/manifest/apple-touch-icon links (there are no sibling files next to a
// lone .html), and writes build/octopus-<version>.html. The result is one
// self-contained page that runs from file:// with no network.
//
// Run this only after `react-scripts build` with PUBLIC_URL=. so the asset paths in
// index.html are relative (./static/...).

const fs = require('fs');
const path = require('path');

const buildDir = path.resolve(__dirname, '..', 'build');
const version = require('../package.json').version;
const indexPath = path.join(buildDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  throw new Error(`build/index.html not found. Run the build before the inliner.`);
}

// Turn "./static/js/main.js", "/static/js/main.js", or "static/js/main.js" into a
// path relative to the build directory.
function resolveAsset(ref) {
  const rel = ref.replace(/^\.?\//, '');
  return path.join(buildDir, rel);
}

// A literal "</script" or "</style" inside the file content would end the inline tag
// early. Escape it so the browser's HTML parser does not close the tag prematurely.
function escapeForInline(content) {
  return content.replace(/<\/(script|style)/gi, '<\\/$1');
}

let html = fs.readFileSync(indexPath, 'utf8');

// Inline stylesheets: <link rel="stylesheet" href="..."> (attribute order varies).
html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, (tag) => {
  const m = tag.match(/\bhref="([^"]+)"/);
  if (!m) return tag;
  const css = fs.readFileSync(resolveAsset(m[1]), 'utf8');
  return `<style>${escapeForInline(css)}</style>`;
});

// Inline scripts: <script ... src="..."></script>
// A `defer` script runs only after the DOM is parsed. An inline <script> ignores
// `defer` and would run immediately, before <div id="root"> exists (React error
// #299). So a deferred script is wrapped to run on DOMContentLoaded instead.
html = html.replace(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/gi, (tag, pre, src, post) => {
  const js = fs.readFileSync(resolveAsset(src), 'utf8');
  const isDefer = /\bdefer\b/i.test(pre + post);
  const body = isDefer
    ? `(function(){function __run(){${js}\n}\n` +
      `if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__run);}else{__run();}})();`
    : js;
  return `<script>${escapeForInline(body)}</script>`;
});

// Embed the favicon as a data URI so the single file has a browser-tab icon with
// no sibling file.
html = html.replace(/<link\b[^>]*\brel="icon"[^>]*>/gi, (tag) => {
  const m = tag.match(/\bhref="([^"]+)"/);
  if (!m) return '';
  const icoPath = resolveAsset(m[1]);
  if (!fs.existsSync(icoPath)) return '';
  const b64 = fs.readFileSync(icoPath).toString('base64');
  return `<link rel="icon" href="data:image/x-icon;base64,${b64}">`;
});

// Drop the manifest and apple-touch-icon links: they need the PNG files, which are
// not embedded, and are not the browser-tab icon.
html = html.replace(/<link\b[^>]*\brel="(manifest|apple-touch-icon)"[^>]*>/gi, '');

// Fail loudly if a resource the page would fetch at load still remains, so a broken
// build never ships. We check only for external <script src> and stylesheet <link>
// tags. URLs embedded in JS strings (React error links, license comments) do not
// trigger network requests, so they are fine.
const leftoverScript = /<script\b[^>]*\bsrc=/i.test(html);
const leftoverLink = /<link\b[^>]*\brel="stylesheet"/i.test(html);
if (leftoverScript || leftoverLink) {
  throw new Error('Inlining failed: an external script or stylesheet reference remains.');
}

const outName = `octopus-${version}.html`;
fs.writeFileSync(path.join(buildDir, outName), html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`Wrote build/${outName} (${kb} KB, self-contained)`);
