import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const desktopEntry = process.argv[2];

if (!desktopEntry) {
  console.error('Desktop entry path is required.');
  process.exit(1);
}

const electronCliEntry = resolve(process.cwd(), 'node_modules', 'electron', 'cli.js');
const childEnv = {
  ...process.env,
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [electronCliEntry, desktopEntry], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
