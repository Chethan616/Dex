/**
 * "Let DEX get to know you" — the optional questions in onboarding and in
 * Settings › About you. Quick to answer: most are a tap on a chip, any can be
 * skipped, and the ones that don't apply never show (no college questions
 * for someone who isn't studying).
 *
 * Each answer becomes one note in DEX's memory (main/memory/notes.ts), filed
 * under its topic, and replaces the note from the last time it was answered.
 * Nothing here assumes who the user is.
 */
import type { Topic } from './memoryTopics';

export type Answers = Record<string, string>;

export interface Question {
  id: string;
  ask: string;
  hint?: string;
  kind: 'text' | 'one' | 'many';
  options?: string[];
  /** A one/many question that also takes a typed answer. */
  other?: string;
  placeholder?: string;
  topic: Topic;
  /** Told to every task, not only the ones it bears on. */
  core?: boolean;
  /** Asked only when the earlier answers make it relevant. */
  when?: (a: Answers) => boolean;
  /** The note DEX keeps. */
  note: (answer: string) => string;
  /** A site the answer names, remembered under these nicknames too. */
  siteAliases?: string[];
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const has = (a: Answers, id: string, re: RegExp): boolean => re.test(a[id] ?? '');
const STUDYING = /student|studying|school|college/i;
const WORKING = /work|business|freelance|job/i;
/** The chips, as a fact about them. */
const DOING: Record<string, string> = {
  Student: 'Is a student',
  Working: 'Works',
  'Student and working': 'Studies and works',
  'Run my own business': 'Runs their own business',
  Freelance: 'Works freelance',
  'Between jobs': 'Is between jobs',
  Retired: 'Is retired',
};

export const QUESTIONS: Question[] = [
  {
    id: 'name', ask: 'What should DEX call you?', kind: 'text', placeholder: 'Your name, or what friends call you',
    topic: 'about', core: true, note: (v) => `Call them ${v}`,
  },
  {
    id: 'doing', ask: 'What do you do?', kind: 'one', other: 'Something else',
    options: ['Student', 'Working', 'Student and working', 'Run my own business', 'Freelance', 'Between jobs', 'Retired'],
    topic: 'about', core: true, note: (v) => DOING[v] ?? `What they do: ${v}`,
  },
  {
    id: 'study_where', ask: 'Where do you study?', kind: 'text', placeholder: 'School, college or university',
    topic: 'study', core: true, when: (a) => has(a, 'doing', STUDYING), note: (v) => `Studies at ${v}`,
  },
  {
    id: 'study_what', ask: 'What are you studying, and which year?', kind: 'text', placeholder: 'e.g. 2nd year, Computer Science',
    topic: 'study', when: (a) => has(a, 'doing', STUDYING), note: (v) => `Studying: ${v}`,
  },
  {
    id: 'study_portal', ask: 'Your student portal, for attendance and marks', hint: 'Its address. DEX remembers it, so "check my attendance" just works. Sign in there yourself the first time.',
    kind: 'text', placeholder: 'e.g. portal.youruniversity.edu',
    topic: 'study', when: (a) => has(a, 'doing', STUDYING), note: (v) => `Their student portal: ${v}`,
    siteAliases: ['student portal', 'college portal', 'uni portal', 'university portal', 'attendance', 'timetable', 'marks', 'grades', 'results'],
  },
  {
    id: 'work_role', ask: "What's your work?", kind: 'text', placeholder: 'e.g. Product designer at a fintech startup',
    topic: 'work', core: true, when: (a) => has(a, 'doing', WORKING), note: (v) => `Work: ${v}`,
  },
  {
    id: 'work_tools', ask: 'Which of these do you use for work?', kind: 'many', other: 'Others',
    options: ['Gmail', 'Outlook', 'Slack', 'Microsoft Teams', 'Zoom', 'Google Meet', 'Notion', 'Jira', 'GitHub', 'Google Docs', 'Excel', 'Figma'],
    topic: 'work', when: (a) => has(a, 'doing', WORKING), note: (v) => `Uses for work: ${v}`,
  },
  {
    id: 'city', ask: 'Which city are you in?', hint: 'For weather, travel, deliveries and time zones.', kind: 'text', placeholder: 'City, country',
    topic: 'home', core: true, note: (v) => `Lives in ${v}`,
  },
  {
    id: 'languages', ask: 'Languages you’re comfortable in', kind: 'many', other: 'Another',
    options: ['English', 'Hindi', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Urdu', 'Chinese', 'Japanese'],
    topic: 'about', note: (v) => `Comfortable in: ${v}`,
  },
  {
    id: 'replies', ask: 'How should DEX answer you?', kind: 'one',
    options: ['Short and to the point', 'A little detail', 'Thorough, with the reasoning', 'Simply — I’m new to tech'],
    topic: 'prefs', core: true, note: (v) => `Wants answers: ${lower(v)}`,
  },
  {
    id: 'tone', ask: 'When DEX writes messages for you, in what tone?', kind: 'one',
    options: ['Casual', 'Friendly', 'Professional', 'Match whoever I’m writing to'],
    topic: 'writing', note: (v) => `Tone for messages written for them: ${lower(v)}`,
  },
  {
    id: 'uses', ask: 'What will you hand DEX most?', kind: 'many', other: 'Something else',
    options: ['Email', 'Calendar', 'Research', 'Shopping', 'Travel bookings', 'Coding', 'Study and assignments', 'PC clean-up and fixes', '3D and design', 'Files and documents', 'Bills and payments', 'Social media'],
    topic: 'prefs', note: (v) => `Mostly uses DEX for: ${lower(v)}`,
  },
  {
    id: 'buying', ask: 'When DEX shops or books for you…', kind: 'one',
    options: ['Find the cheapest', 'Best value for money', 'Best quality', 'Always ask me first'],
    topic: 'money', note: (v) => `When buying or booking: ${lower(v)}`,
  },
  {
    id: 'shops', ask: 'Where do you usually buy things?', kind: 'many', other: 'Somewhere else',
    options: ['Amazon', 'Flipkart', 'Myntra', 'Walmart', 'Target', 'eBay', 'Etsy', 'AliExpress', 'Swiggy', 'Zomato', 'Blinkit', 'Instacart', 'DoorDash', 'Uber Eats'],
    topic: 'money', note: (v) => `Shops on: ${v}`,
  },
  {
    id: 'diet', ask: 'Anything about food?', kind: 'many', other: 'Allergies or other',
    options: ['No preference', 'Vegetarian', 'Vegan', 'Eggetarian', 'Non-vegetarian', 'Halal', 'Kosher', 'Jain', 'Gluten-free', 'Lactose-free'],
    topic: 'food', note: (v) => `Food: ${lower(v)}`,
  },
  {
    id: 'seat', ask: 'On flights and trains, you like…', kind: 'one', options: ['Window', 'Aisle', 'Doesn’t matter'],
    topic: 'travel', note: (v) => (/matter/i.test(v) ? 'No seat preference when travelling' : `Prefers ${lower(v)} seats when travelling`),
  },
  {
    id: 'from', ask: 'Your usual airport or station', kind: 'text', placeholder: 'e.g. HYD, or London Euston',
    topic: 'travel', note: (v) => `Usually travels from ${v}`,
  },
  {
    id: 'quiet', ask: 'When shouldn’t DEX disturb you?', kind: 'one', other: 'Another time',
    options: ['Any time is fine', 'After 10 pm', 'After midnight', 'During work or class hours'],
    topic: 'prefs', note: (v) => (/any time/i.test(v) ? 'Fine to be messaged any time' : `Don't disturb them: ${lower(v)}`),
  },
  {
    id: 'people', ask: 'Anyone DEX should know about?', hint: 'People you’ll mention by name or role.', kind: 'text',
    placeholder: 'e.g. my manager is Priya; my sister Anu lives in Pune',
    topic: 'people', note: (v) => v,
  },
  {
    id: 'never', ask: 'Anything DEX should never do?', kind: 'text', placeholder: 'e.g. send an email without showing me first',
    topic: 'prefs', core: true, note: (v) => `Never: ${v.replace(/^never[,:]?\s*/i, '')}`,
  },
  {
    id: 'else', ask: 'Anything else worth knowing?', kind: 'text', placeholder: 'Goals, habits, how you like to work…',
    topic: 'other', note: (v) => v,
  },
];

/** The questions that apply, given the answers so far. */
export function questionsFor(answers: Answers): Question[] {
  return QUESTIONS.filter((q) => !q.when || q.when(answers));
}

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

/** Answers to many/one questions are kept as "A, B, C". */
export const joinChoices = (choices: string[]): string => choices.join(', ');
export const splitChoices = (answer: string | undefined): string[] => (answer ? answer.split(/,\s*/).filter(Boolean) : []);
