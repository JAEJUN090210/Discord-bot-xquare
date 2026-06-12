import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'scripts'];
const files = roots.flatMap((root) => collectJavaScriptFiles(root));
let failed = false;

for (const file of files) {
  const result = spawnSync('node', ['--check', file], {
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Checked ${files.length} JavaScript file(s).`);

function collectJavaScriptFiles(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      const stat = statSync(path);

      if (stat.isDirectory()) {
        return collectJavaScriptFiles(path);
      }

      return path.endsWith('.js') ? [path] : [];
    })
    .sort();
}
