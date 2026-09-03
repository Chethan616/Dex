/**
 * History that is a record, not a list of requests.
 *
 *     npm run test:conversations
 *
 * What this replaces: the sidebar read the `tasks` table, so a row carried a
 * request and nothing else, and clicking one could only re-run it. Nothing on
 * disk held a sentence either side had said — which is why "open the
 * conversation" was not a feature that had been left out, it was a feature
 * with nowhere to read from.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-conversations-'));
process.env.DEX_DB = path.join(scratch, 'dex.db');

// eslint-disable-next-line import/first
import { Conversations } from '../core/memory/conversations';
// eslint-disable-next-line import/first
import { closeDb, db, quietSqliteWarning } from '../core/memory/db';

quietSqliteWarning();

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const store = new Conversations(db());

section('A turn is written as it happens');

store.append({ conversationId: 'c1', speaker: 'human', text: 'find my aadhaar card', at: 1_000 });
store.append({
  conversationId: 'c1',
  requestId: 'r1',
  speaker: 'step',
  text: 'Verified — found 2 files',
  detail: {
    action: 'find_files',
    verification: 'VERIFIED',
    artifact: { kind: 'files', title: '2 files found' },
  },
  at: 1_100,
});
store.append({
  conversationId: 'c1',
  requestId: 'r1',
  speaker: 'agent',
  text: 'Both copies are in your Documents folder.',
  at: 1_200,
});

const thread = store.messages('c1');
check('every message is there', thread.length === 3, String(thread.length));
check('in the order it happened', thread[0].speaker === 'human' && thread[2].speaker === 'agent');
check(
  'and the step keeps what it needs to be redrawn',
  (thread[1].detail?.artifact as Record<string, unknown> | undefined)?.title === '2 files found',
  JSON.stringify(thread[1].detail),
);
check(
  'including which task it came from',
  thread[1].requestId === 'r1',
  String(thread[1].requestId),
);

section('The list is what the owner will recognise');

store.append({ conversationId: 'c2', speaker: 'human', text: 'what is my power plan', at: 2_000 });
store.append({ conversationId: 'c2', requestId: 'r2', speaker: 'agent', text: 'Balanced.', at: 2_100 });

const listed = store.list();
check('one row per conversation, not per message', listed.length === 2, String(listed.length));
check('newest first', listed[0].id === 'c2', listed.map((c) => c.id).join(','));
check(
  'titled by what the owner said first',
  listed[1].title === 'find my aadhaar card',
  listed[1].title,
);
check('counting the messages in it', listed[1].messageCount === 3, String(listed[1].messageCount));

section('Failures stay findable');

db().prepare(
  'INSERT INTO tasks (request_id, text, shape, status, started_at) VALUES (?, ?, ?, ?, ?)',
).run('r2', 'what is my power plan', 'query', 'FAILED', 2_000);

check(
  'a conversation whose task failed says so',
  store.list().find((c) => c.id === 'c2')?.failed === true,
);
check(
  'and one that went fine does not',
  store.list().find((c) => c.id === 'c1')?.failed === false,
);

section('Search reaches inside the messages');

// The thing task history could never do: this phrase was in an *answer*, so
// searching requests would never have found it.
const found = store.search('Documents folder');
check('a word only Dex said is findable', found.length === 1 && found[0].id === 'c1',
  JSON.stringify(found.map((c) => c.id)));
check('a word nobody said is not', store.search('zzzznothing').length === 0);
check('an empty search is empty, not everything', store.search('   ').length === 0);

section('Renaming, and forgetting');

store.rename('c1', 'Aadhaar hunt');
check('a renamed conversation uses the new name',
  store.list().find((c) => c.id === 'c1')?.title === 'Aadhaar hunt');
store.rename('c1', '   ');
check('clearing the name falls back to the first thing said',
  store.list().find((c) => c.id === 'c1')?.title === 'find my aadhaar card');

const removed = store.remove('c1');
check('deleting removes its messages', removed === 3, String(removed));
check('and it leaves the list', store.list().every((c) => c.id !== 'c1'));
check(
  'but the task record survives, because the planner learns from it',
  (db().prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n === 1,
);

section('Bad input does not take the record down');

store.append({ conversationId: '', speaker: 'human', text: 'no conversation' });
store.append({ conversationId: 'c3', speaker: 'human', text: '   ' });
check('a message with no conversation is dropped, not thrown',
  store.list().every((c) => c.id !== ''));
check('and an empty one too', store.list().every((c) => c.id !== 'c3'));

closeDb();
fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
