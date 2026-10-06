// Static checks for the extension: JS syntax, manifest validity, every referenced file exists,
// and the manifest / package.json versions match.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ext = path.join(root, 'devicepeek');
let problems = 0;
const fail = (msg) => {
  problems++;
  console.error('  ✗ ' + msg);
};

// 1. JS syntax
const jsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})(ext);
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(`syntax error in ${path.relative(root, f)}\n${e.stderr}`);
  }
}
console.log(`JS syntax: ${jsFiles.length} files checked`);

// 2. Manifest
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
} catch (e) {
  fail('manifest.json is not valid JSON: ' + e.message);
}
if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  const refs = [
    manifest.background && manifest.background.service_worker,
    manifest.action && manifest.action.default_popup,
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action && manifest.action.default_icon) || {}),
    ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || [])
  ].filter(Boolean);
  for (const r of refs) if (!fs.existsSync(path.join(ext, r))) fail(`manifest references a missing file: ${r}`);
  console.log(`Manifest: v${manifest.version}, ${refs.length} file references checked`);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.version) fail(`version mismatch: manifest ${manifest.version} vs package.json ${pkg.version}`);
}

if (problems) {
  console.error(`\n${problems} problem(s) found`);
  process.exit(1);
}
console.log('All checks passed');
