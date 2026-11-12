// Builds the real hosted image for the scenario; on failure it prints docker's own last lines before the assert fails.
// Why (12 Nov 2026, hi): the build ran with `-q`, so a failing `pip install` printed only "did not complete successfully" and the cause of the red on main (9-12 Nov) could not be read from the log.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

/** docker build of hosted/Dockerfile from `root`; `run` is spawnSync (a test passes a fake). Throws 'docker build' on a non-zero status. */
export function dockerBuild(image, root, run = spawnSync) {
  const built = run('docker', ['build', '--progress=plain', '-f', 'hosted/Dockerfile', '-t', image, '.'], {cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
  if (built.status !== 0) console.error(`hosted-e2e: docker build failed, last 40 lines:\n${`${built.stdout || ''}${built.stderr || ''}`.trimEnd().split('\n').slice(-40).join('\n')}`);
  assert.equal(built.status, 0, 'docker build');
}
