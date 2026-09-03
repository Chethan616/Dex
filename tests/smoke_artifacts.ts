/**
 * A result with structure is described, not narrated.
 *
 * The failure this covers, verbatim from the screen:
 *
 *     find files: count 20, root C:\Users\cheth\Downloads, query dex,
 *     query_terms dex, matches name=DEX_V3_Project_Report_final.docx
 *     path=C:\Users\cheth\Downloads\DEX_V3_Project_Report_final.docx
 *     directory=C:\Users\cheth\Downloads, name=… (+12 more)
 *
 * Two things had to be true to fix it, and both are checked here: the step
 * emits a description the app can draw, and the prose stops repeating what the
 * card already shows.
 */
import { describeArtifact } from '../core/events/artifacts';
import { factsForPhrasing, renderFacts } from '../core/brain/answer';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

const searchResult = {
  scope: 'pc',
  query: 'aadhaar card',
  count: 20,
  searched: '74,500 files indexed by name',
  matches: [
    {
      name: 'aadhar.pdf',
      path: 'C:\\Users\\cheth\\OneDrive\\Documents\\aadhar.pdf',
      directory: 'C:\\Users\\cheth\\OneDrive\\Documents',
      why: ['filename'],
      size: 1319046,
    },
    {
      name: 'scan001.jpg',
      path: 'C:\\Users\\cheth\\CrossDevice\\storage\\Download\\scan001.jpg',
      directory: 'C:\\Users\\cheth\\CrossDevice\\storage\\Download',
      why: ['OCR text', 'also called "uid"'],
      snippet: 'GOVERNMENT OF INDIA AADHAAR 1234 5678 9012',
    },
  ],
};

console.log('\nartifacts — a list is drawn, not read out');

const artifact = describeArtifact('find_files', searchResult);
check('a file search produces an artifact', artifact !== undefined);
check('titled by what was found', artifact?.title === '20 files found', artifact?.title);
check('carrying the total, not just what fits', artifact?.total === 20);
check('one item per match', artifact?.items.length === 2);
check(
  'each with the name and the full path',
  artifact?.items[0].label === 'aadhar.pdf' &&
    artifact?.items[0].detail?.endsWith('aadhar.pdf') === true,
);
check(
  'and why it matched',
  artifact?.items[1].reasons?.includes('OCR text') === true,
  JSON.stringify(artifact?.items[1].reasons),
);
check(
  'a content match carries the line that matched',
  artifact?.items[1].excerpt?.includes('AADHAAR') === true,
);

// A list of nine thousand files must not become a payload of nine thousand
// rows on the socket.
const many = {
  ...searchResult,
  count: 9000,
  matches: Array.from({ length: 9000 }, (_, i) => ({
    name: `file_${i}.png`,
    path: `C:\\x\\file_${i}.png`,
    why: ['filename'],
  })),
};
const capped = describeArtifact('find_files', many);
check('a huge result is capped', (capped?.items.length ?? 0) <= 12, String(capped?.items.length));
check('but still reports the true total', capped?.total === 9000);

check('an action with no structure gets no card', describeArtifact('set_volume', { level: 35 }) === undefined);
check('and neither does an empty search', describeArtifact('find_files', { count: 0, matches: [] }) === undefined);

console.log('\nreading -- one file, opened');

const described = describeArtifact('describe_file', {
  path: 'C:/Users/cheth/Desktop/UI/UI.png',
  name: 'UI.png',
  kind: 'image',
  bytes: 3116032,
  description: 'A grid of smartphone mockups showing the same interface in several colour themes.',
  read_by: 'haiku looking at the image',
});

check('a described file produces a reading card', described?.kind === 'reading');
check('titled by the file', described?.title === 'UI.png', described?.title);
check(
  'the description is the body, not a footnote',
  described?.body?.includes('smartphone mockups') === true,
);
check(
  'and the file is named so the card can show it',
  described?.file?.endsWith('UI.png') === true,
  described?.file,
);
check('with what read it', described?.note?.includes('haiku') === true, described?.note);

const read = describeArtifact('read_document', {
  path: 'C:/x/report.pdf',
  name: 'report.pdf',
  kind: 'document',
  pages: 12,
  text: 'Quarterly report. Revenue up.',
});
check('a document read produces one too', read?.kind === 'reading');
check('and says how long it was', read?.note?.includes('12 page') === true, read?.note);

check(
  'a file that could not be read produces no card',
  describeArtifact('describe_file', { name: 'x.bin', kind: 'unreadable' }) === undefined,
);

// The prose must not read the whole document out loud either.
const forModelReading = factsForPhrasing([{
  action: 'describe_file',
  name: 'UI.png',
  kind: 'image',
  description: 'A '.repeat(4000),
}])[0];
check(
  'a long description reaches the model clipped, not whole',
  String(forModelReading.description).length < 700,
  String(String(forModelReading.description).length),
);


console.log('\nprose — the sentence stops repeating the card');

const facts = [{ action: 'find_files', ...searchResult }];
const rendered = renderFacts(facts);
check(
  'the rendered line does not list the paths',
  !rendered.includes('name=') && !rendered.includes('directory='),
  rendered.slice(0, 120),
);
check('but still says how many', rendered.includes('20'), rendered);

const forModel = factsForPhrasing(facts)[0];
check(
  'the model is given a count, not twenty file records',
  typeof forModel.matches === 'string' && (forModel.matches as string).includes('2 results'),
  JSON.stringify(forModel.matches).slice(0, 120),
);
check(
  'and the closest match by name, so it can write a useful sentence',
  String(forModel.matches).includes('aadhar.pdf'),
  String(forModel.matches),
);

// The regression this rule caused on its first attempt: keyed off the field
// name alone, it swallowed `list_dir`'s entries, which have no card. Hiding
// information has to be tied to the thing that shows it instead.
const listing = renderFacts([
  { action: 'list_dir', path: 'C:', entries: ['a.txt', 'b.txt', 'c.txt'] },
]);
check(
  'an action with no card still reports its list in prose',
  listing.includes('a.txt'),
  listing,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
