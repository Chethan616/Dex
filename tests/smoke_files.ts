import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileAgent } from '../agents/files/file_agent';

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-files-'));
  const workspace = path.join(temp, 'workspace');
  const downloads = path.join(temp, 'Downloads');
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(downloads, 'aadhaar_card.pdf'), '');
  fs.writeFileSync(path.join(downloads, 'holiday.txt'), '');

  const previous = process.env.DEX_WORKSPACE;
  process.env.DEX_WORKSPACE = workspace;
  try {
    const agent = new FileAgent();
    const written = await agent.execute(
      'write_file',
      { path: 'hello.js', content: "process.stdout.write('file agent ok')" },
      'smoke',
      'write',
    );
    assert(written.success, written.error ?? 'write_file failed');
    const writtenData = written.data as { path: string; sha256: string };
    assert(fs.existsSync(writtenData.path), 'written file is missing');
    assert(writtenData.sha256.length === 64, 'write_file did not return a SHA-256');

    const found = await agent.execute(
      'find_files',
      { root: downloads, query: 'aadhar card related files' },
      'smoke',
      'find',
    );
    assert(found.success, found.error ?? 'find_files failed');
    const foundData = found.data as { count: number; matches: Array<{ name: string }> };
    assert(foundData.count === 1, `expected one match, got ${foundData.count}`);
    assert(foundData.matches[0]?.name === 'aadhaar_card.pdf', 'wrong filename match');

    const run = await agent.execute(
      'run_program',
      { path: 'hello.js', runtime: 'node', background: false },
      'smoke',
      'run',
    );
    assert(run.success, run.error ?? 'run_program failed');
    const runData = run.data as { returncode: number; stdout: string };
    assert(runData.returncode === 0, 'program returned a non-zero code');
    assert(runData.stdout.includes('file agent ok'), 'program output was not captured');
  } finally {
    if (previous === undefined) delete process.env.DEX_WORKSPACE;
    else process.env.DEX_WORKSPACE = previous;
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log('File-agent regression checks passed');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
