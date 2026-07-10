// One command to run both processes in development:
//   npm run dev
// Backend (API, :5175) with --watch + Vite dev server (:5173) with HMR.
// Open http://localhost:5173  (Vite proxies /api -> :5175)
import { spawn } from 'child_process';

const procs = [
  { name: 'api', color: '\x1b[36m', cmd: 'npm', args: ['--prefix', 'backend', 'run', 'dev'] },
  { name: 'web', color: '\x1b[35m', cmd: 'npm', args: ['--prefix', 'frontend', 'run', 'dev'] },
];

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
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
