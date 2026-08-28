/**
 * When a schedule fires.
 *
 * A deliberately restricted cron — five fields, `*`, numbers, lists, ranges and
 * steps — plus a small front end for the phrases people actually type. No
 * dependency: a parser this size is easier to own than to audit, and owning it
 * means the error messages can say what was wrong rather than "invalid
 * expression".
 *
 * Everything is local time. A schedule that says 8am means 8am where the
 * machine is, and Dex runs on one desktop.
 */

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** The expression this came from, kept for display. */
  source: string;
}

const RANGES: Array<[keyof Omit<Cron, 'source'>, number, number]> = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['dayOfMonth', 1, 31],
  ['month', 1, 12],
  ['dayOfWeek', 0, 6],
];

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

export class CronError extends Error {}

/**
 * Parse a 5-field cron expression.
 *
 * Field order is the standard one: minute hour day-of-month month day-of-week.
 */
export function parseCron(expression: string): Cron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronError(
      `A cron expression has 5 fields (minute hour day month weekday), got ${fields.length}: "${expression}"`,
    );
  }

  const parsed: Partial<Cron> = { source: expression.trim() };

  RANGES.forEach(([name, min, max], index) => {
    parsed[name] = parseField(fields[index], min, max, name);
  });

  return parsed as Cron;
}

function parseField(
  field: string,
  min: number,
  max: number,
  name: string,
): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const [spec, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);

    if (!Number.isInteger(step) || step < 1) {
      throw new CronError(`Step must be a positive whole number in "${part}" (${name})`);
    }

    let from: number;
    let to: number;

    if (spec === '*') {
      from = min;
      to = max;
    } else if (spec.includes('-')) {
      const [a, b] = spec.split('-');
      from = numberIn(a, min, max, name);
      to = numberIn(b, min, max, name);
      if (from > to) {
        throw new CronError(`Range runs backwards in "${part}" (${name})`);
      }
    } else {
      from = numberIn(spec, min, max, name);
      to = from;
    }

    for (let v = from; v <= to; v += step) values.add(v);
  }

  if (values.size === 0) {
    throw new CronError(`"${field}" matches nothing (${name})`);
  }
  return values;
}

function numberIn(text: string, min: number, max: number, name: string): number {
  const named = DAY_NAMES[text.toLowerCase()];
  const value = named ?? Number(text);

  if (!Number.isInteger(value)) {
    throw new CronError(`"${text}" is not a number (${name})`);
  }
  // Sunday is both 0 and 7 in every cron anyone has used.
  const normalised = name === 'dayOfWeek' && value === 7 ? 0 : value;
  if (normalised < min || normalised > max) {
    throw new CronError(`${name} must be ${min}-${max}, got ${text}`);
  }
  return normalised;
}

/** Does this cron fire at the given local minute? */
export function matches(cron: Cron, when: Date): boolean {
  if (!cron.minute.has(when.getMinutes())) return false;
  if (!cron.hour.has(when.getHours())) return false;
  if (!cron.month.has(when.getMonth() + 1)) return false;

  // Standard cron quirk, kept because deviating from it surprises anyone who
  // has written one before: when BOTH day fields are restricted, either
  // matching is enough. `0 0 1 * mon` is "the 1st, and every Monday".
  const domRestricted = cron.dayOfMonth.size < 31;
  const dowRestricted = cron.dayOfWeek.size < 7;
  const domHit = cron.dayOfMonth.has(when.getDate());
  const dowHit = cron.dayOfWeek.has(when.getDay());

  if (domRestricted && dowRestricted) return domHit || dowHit;
  if (domRestricted) return domHit;
  if (dowRestricted) return dowHit;
  return true;
}

/** Search bound: beyond this a cron is unsatisfiable in practice (e.g. Feb 30). */
const MAX_MINUTES_AHEAD = 400 * 24 * 60;

/**
 * The next local time at or after `after` when this fires, or null.
 *
 * Steps a minute at a time. Not clever, but a year of minutes is half a million
 * cheap comparisons, and "clever" here means date arithmetic that is wrong
 * across a DST boundary.
 */
export function nextRun(cron: Cron, after: Date = new Date()): Date | null {
  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < MAX_MINUTES_AHEAD; i += 1) {
    if (matches(cron, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/**
 * Turn what someone typed into a cron expression.
 *
 * Covers the shapes people actually ask for. Anything else falls through to
 * being read as raw cron, so power users are not boxed in.
 */
export function parseSchedule(text: string): Cron {
  const input = text.trim().toLowerCase().replace(/\s+/g, ' ');

  // Raw cron, if it looks like one.
  if (/^[\d*,\-/]+ +[\d*,\-/]+ +[\d*,\-/ ]+$/.test(input) && input.split(' ').length === 5) {
    return parseCron(input);
  }

  const time = (h: string, m?: string, meridiem?: string): [number, number] => {
    let hour = Number(h);
    const minute = m === undefined ? 0 : Number(m);
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) {
      throw new CronError(`"${h}:${m ?? '00'}" is not a time of day`);
    }
    return [hour, minute];
  };

  // every N minutes / hours
  const interval = input.match(/^every (\d+) (minute|minutes|hour|hours)$/);
  if (interval) {
    const n = Number(interval[1]);
    if (interval[2].startsWith('minute')) {
      if (n < 1 || n > 59) throw new CronError('Minutes must be 1-59');
      return parseCron(`*/${n} * * * *`);
    }
    if (n < 1 || n > 23) throw new CronError('Hours must be 1-23');
    return parseCron(`0 */${n} * * *`);
  }

  if (input === 'every minute') return parseCron('* * * * *');
  if (input === 'every hour' || input === 'hourly') return parseCron('0 * * * *');

  // every [day|weekday|<weekday>] at <time>
  const at = input.match(
    /^every (day|weekday|weekdays|weekend|weekends|[a-z]+) at (\d{1,2})(?::(\d{2}))? ?(am|pm)?$/,
  );
  if (at) {
    const [hour, minute] = time(at[2], at[3], at[4]);
    const when = at[1];

    if (when === 'day') return parseCron(`${minute} ${hour} * * *`);
    if (when.startsWith('weekday')) return parseCron(`${minute} ${hour} * * 1-5`);
    if (when.startsWith('weekend')) return parseCron(`${minute} ${hour} * * 0,6`);

    const day = DAY_NAMES[when];
    if (day === undefined) {
      throw new CronError(
        `"${when}" is not a day. Try: every day at 8, every monday at 9:30, ` +
          'every weekday at 07:00, every 30 minutes — or a cron expression.',
      );
    }
    return parseCron(`${minute} ${hour} * * ${day}`);
  }

  // daily / nightly shorthands
  const daily = input.match(/^(daily|nightly) at (\d{1,2})(?::(\d{2}))? ?(am|pm)?$/);
  if (daily) {
    const [hour, minute] = time(daily[2], daily[3], daily[4]);
    return parseCron(`${minute} ${hour} * * *`);
  }

  throw new CronError(
    `Could not read "${text}" as a schedule. Try: "every day at 8", ` +
      '"every weekday at 07:30", "every 30 minutes", "every monday at 9pm", ' +
      'or a 5-field cron expression like "0 8 * * 1-5".',
  );
}

/** A human-readable rendering, for listings. */
export function describeCron(cron: Cron): string {
  const set = (s: Set<number>, max: number) => (s.size > max ? '*' : [...s].sort((a, b) => a - b).join(','));
  const pad = (n: number) => String(n).padStart(2, '0');

  const everyMinute = cron.minute.size > 59;
  const everyHour = cron.hour.size > 23;
  const everyDay = cron.dayOfMonth.size > 30 && cron.dayOfWeek.size > 6;

  if (!everyMinute && !everyHour && everyDay && cron.minute.size === 1 && cron.hour.size === 1) {
    return `every day at ${pad([...cron.hour][0])}:${pad([...cron.minute][0])}`;
  }
  if (!everyMinute && !everyHour && cron.minute.size === 1 && cron.hour.size === 1 && cron.dayOfWeek.size < 7) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = [...cron.dayOfWeek].sort((a, b) => a - b).map((d) => names[d]).join(',');
    return `${days} at ${pad([...cron.hour][0])}:${pad([...cron.minute][0])}`;
  }
  return `${set(cron.minute, 59)} ${set(cron.hour, 23)} ${set(cron.dayOfMonth, 30)} ${set(cron.month, 11)} ${set(cron.dayOfWeek, 6)}`;
}
