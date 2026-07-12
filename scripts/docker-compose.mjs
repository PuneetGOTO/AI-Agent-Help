import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = resolve(process.cwd());
const composeDirectory = process.platform === 'win32' ? windowsSafePath(workspace) : workspace;
const result = spawnSync('docker', ['compose', ...process.argv.slice(2)], {
  cwd: composeDirectory,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(`Unable to start Docker Compose: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

function windowsSafePath(target) {
  if (/^[\x20-\x7e]+$/.test(target)) return target;
  const suffix = createHash('sha256').update(target.toLowerCase()).digest('hex').slice(0, 12);
  const junction = join(tmpdir(), `agent-platform-${suffix}`);
  if (existsSync(junction)) {
    if (realpathSync(junction).toLowerCase() !== realpathSync(target).toLowerCase()) {
      throw new Error(`Docker junction path is already used by another workspace: ${junction}`);
    }
  } else {
    symlinkSync(target, junction, 'junction');
  }
  console.log(`Docker Compose build context: ${junction}`);
  return junction;
}
