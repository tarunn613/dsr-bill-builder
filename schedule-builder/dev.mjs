// One command to run both processes in development:
//   npm run dev
// Backend (API, :5175) with --watch + Vite dev server (:5173) with HMR.
// Open http://localhost:5173  (Vite proxies /api -> :5175)
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Resolve backend/frontend from this file's own location so the dev runner
// works no matter which directory it is launched from (e.g. a git worktree).
const HERE = dirname(fileURLToPath(import.meta.url));
const procs = [
  // Pin the API to 5175 (Vite proxies /api there). A launcher may inject PORT
  // for the web server; don't let the backend inherit it, or both fight for it.
  { name: 'api', color: '\x1b[36m', cmd: 'npm', args: ['--prefix', join(HERE, 'backend'), 'run', 'dev'], env: { PORT: '5175' } },
  { name: 'web', color: '\x1b[35m', cmd: 'npm', args: ['--prefix', join(HERE, 'frontend'), 'run', 'dev'] },
];

const children = procs.map(({ name, color, cmd, args, env }) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: { ...process.env, ...env } });
  const tag = `${color}[${name}]\x1b[0m `;
  const pipe = (stream) => stream.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach((line) => process.stdout.write(tag + line + '\n'));
  });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    process.stdout.write(tag + `exited (${code})\n`);
    shutdown();
  });
  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* ignore */ } }
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('\x1b[32mSchedule Builder (dev)\x1b[0m  →  open http://localhost:5173');
