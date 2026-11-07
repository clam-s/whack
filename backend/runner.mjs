import { spawn } from 'node:child_process';

const OUTPUT_LIMIT = 16_384;

export function runJavaScript(code) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'run', '--rm', '--pull=never', '--interactive',
      '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--user=65534:65534',
      '--memory=128m', '--memory-swap=128m', '--cpus=0.5',
      '--pids-limit=32', '--log-driver=none',
      '--entrypoint=/usr/bin/timeout',
      'node:22-bookworm-slim', '--signal=KILL', '5s',
      'node', '--input-type=module', '-',
    ], {
      // The Docker CLI only needs the system path and its default local socket.
      env: { PATH: process.env.PATH },
    });

    const output = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let truncated = false;
    let clientTimedOut = false;

    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', (chunk) => {
        const retained = chunk.subarray(0, OUTPUT_LIMIT - sizes[stream]);
        if (retained.length) output[stream].push(retained);
        sizes[stream] += retained.length;
        truncated ||= retained.length < chunk.length;
      });
    }

    const timer = setTimeout(() => {
      clientTimedOut = true;
      child.kill('SIGKILL');
    }, 12_000);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (clientTimedOut || exitCode === null || [125, 126, 127].includes(exitCode)) {
        reject(new Error('Docker did not complete the execution request'));
        return;
      }

      resolve({
        stdout: Buffer.concat(output.stdout).toString('utf8'),
        stderr: Buffer.concat(output.stderr).toString('utf8'),
        exitCode,
        status: exitCode === 0 ? 'ok' : exitCode === 137 ? 'killed' : 'error',
        truncated,
      });
    });
    child.stdin.on('error', () => {
      // Docker can close stdin before reading the script if startup fails.
    });
    child.stdin.end(code);
  });
}
