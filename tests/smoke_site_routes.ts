import './support/isolate';
/**
 * Remembering the way around a site whose pages do not say what they are.
 *
 *     npm run test:routes
 *
 * The case this exists for: a university portal where nothing is labelled
 * "curriculum". The link that leads there is called something else, inside a
 * menu called something else again. A model can find it by reading every page
 * and guessing — expensively, and differently each run. A person shown once
 * never thinks about it again.
 *
 * Three properties carry the weight, and each is a way this could be worse than
 * having no memory at all:
 *
 *   - **Matching is fuzzy enough to be useful and strict enough to be safe.**
 *     The owner records "course curriculum" and later asks for "my RL syllabus".
 *     Requiring those to be equal makes the memory useless; matching on one
 *     stray word makes it replay the wrong route confidently.
 *   - **A route is a hint, not a cage.** `describeRoute` has to tell the agent
 *     to check as it goes, or a stale route walks it off a cliff.
 *   - **A route that stops working is forgotten.** Otherwise one recording made
 *     on a day the site was odd is followed forever.
 */
import assert from 'assert';
import { SiteRouteStore, describeRoute, normaliseOrigin } from '../core/memory/site_routes';

let failures = 0;
function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${err instanceof Error ? err.message : err}`);
  }
}

const store = new SiteRouteStore();

const CURRICULUM = [
  { text: 'Academics', selector: '#menu-academics' },
  { text: 'Course Page', selector: 'a[name="coursePage"]' },
  { text: 'Course Details', url: 'https://vtop.vit.ac.in/vtop/academics/course' },
];

console.log('— what was recorded is what the links are actually called —');

check('a route is saved with its steps in order', () => {
  const saved = store.save({
    origin: 'https://vtop.vit.ac.in/vtop/login',
    goal: 'course curriculum',
    steps: CURRICULUM,
  });
  assert.strictEqual(saved.origin, 'vtop.vit.ac.in', 'the origin was not normalised');
  assert.deepStrictEqual(saved.steps.map((s) => s.text),
    ['Academics', 'Course Page', 'Course Details']);
});

check('the origin is the hostname however the url was written', () => {
  for (const written of [
    'vtop.vit.ac.in',
    'https://vtop.vit.ac.in',
    'https://vtop.vit.ac.in/vtop/content?x=1',
    'HTTPS://VTOP.VIT.AC.IN/vtop',
  ]) {
    assert.strictEqual(normaliseOrigin(written), 'vtop.vit.ac.in', written);
  }
});

console.log('\n— found again when the owner asks differently —');

check('the exact words match', () => {
  assert.ok(store.find('vtop.vit.ac.in', 'course curriculum'));
});

check('and so does a rephrasing', () => {
  // The whole point. Nobody says the same sentence twice.
  assert.ok(store.find('vtop.vit.ac.in', 'get my reinforcement learning course curriculum'));
  assert.ok(store.find('https://vtop.vit.ac.in/vtop', 'the curriculum for my course'));
});

check('a different site does not match, however similar the goal', () => {
  assert.strictEqual(store.find('example.edu', 'course curriculum'), undefined);
});

check('an unrelated goal on the same site does not match', () => {
  // "wifi password" shares no meaningful word with "course curriculum".
  // Replaying the curriculum route for it would waste more time than having
  // no memory at all.
  assert.strictEqual(store.find('vtop.vit.ac.in', 'wifi password'), undefined);
});

check('one incidental shared word is not enough', () => {
  store.save({
    origin: 'portal.test',
    goal: 'exam timetable download',
    steps: [{ text: 'Exams' }],
  });
  // "download" is a stop word; nothing meaningful is shared.
  assert.strictEqual(store.find('portal.test', 'download my photos'), undefined);
});

console.log('\n— a route is a hint, not a cage —');

check('the description lists the steps in order', () => {
  const route = store.find('vtop.vit.ac.in', 'course curriculum')!;
  const text = describeRoute(route);
  assert.ok(text.indexOf('Academics') < text.indexOf('Course Page'), 'out of order');
  assert.ok(text.includes('Course Details'));
});

check('and tells the agent to check rather than to obey', () => {
  const text = describeRoute(store.find('vtop.vit.ac.in', 'course curriculum')!);
  assert.ok(/check|if something has moved|find it yourself/i.test(text),
    'nothing tells the agent what to do when the route is stale');
});

console.log('\n— a second recording corrects the first —');

check('re-recording the same goal replaces it', () => {
  const before = store.forOrigin('vtop.vit.ac.in').length;
  store.save({
    origin: 'vtop.vit.ac.in',
    goal: 'course curriculum',
    steps: [{ text: 'Academics' }, { text: 'Curriculum' }],
  });
  assert.strictEqual(store.forOrigin('vtop.vit.ac.in').length, before,
    'a correction created a rival route');
  assert.strictEqual(store.find('vtop.vit.ac.in', 'course curriculum')!.steps.length, 2);
});

check('a different goal on the same site is kept separately', () => {
  const before = store.forOrigin('vtop.vit.ac.in').length;
  store.save({
    origin: 'vtop.vit.ac.in',
    goal: 'attendance record',
    steps: [{ text: 'Academics' }, { text: 'Attendance' }],
  });
  assert.strictEqual(store.forOrigin('vtop.vit.ac.in').length, before + 1);
});

console.log('\n— a route that stops working is forgotten —');

check('one failure is not enough — a bad day is not a bad route', () => {
  assert.strictEqual(store.markFailed('vtop.vit.ac.in', 'attendance record'), false);
  assert.ok(store.find('vtop.vit.ac.in', 'attendance record'));
});

check('two in a row and it is gone', () => {
  assert.strictEqual(store.markFailed('vtop.vit.ac.in', 'attendance record'), true);
  assert.strictEqual(store.find('vtop.vit.ac.in', 'attendance record'), undefined);
});

check('a success in between resets the count', () => {
  store.save({
    origin: 'vtop.vit.ac.in',
    goal: 'exam schedule',
    steps: [{ text: 'Examination' }],
  });
  store.markFailed('vtop.vit.ac.in', 'exam schedule');
  store.markWorked('vtop.vit.ac.in', 'exam schedule');
  assert.strictEqual(store.markFailed('vtop.vit.ac.in', 'exam schedule'), false,
    'forgotten despite working in between');
  assert.ok(store.find('vtop.vit.ac.in', 'exam schedule'));
});

check('a route that keeps working is counted', () => {
  store.markWorked('vtop.vit.ac.in', 'course curriculum');
  store.markWorked('vtop.vit.ac.in', 'course curriculum');
  assert.strictEqual(store.find('vtop.vit.ac.in', 'course curriculum')!.runCount, 2);
});

console.log('\n— refusals —');

check('a route with no steps is refused', () => {
  assert.throws(
    () => store.save({ origin: 'x.test', goal: 'something', steps: [] }),
    /not a route/,
  );
});

check('a route with no goal is refused', () => {
  assert.throws(
    () => store.save({ origin: 'x.test', goal: '  ', steps: [{ text: 'a' }] }),
    /goal/,
  );
});

console.log();
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('PASSED  Dex remembers the way, loosely enough to be found and strictly enough to be right.');
