/**
 * Every emoji, for the reaction picker — built from Unicode's own emoji
 * properties at first use, so there's no data file or package to ship.
 * Categories come from where Unicode put each block; search knows the
 * common ones by name.
 */

export interface EmojiCategory {
  id: string;
  label: string;
  icon: string;
  emoji: string[];
}

type Range = [number, number];

const CATEGORY_RANGES: Array<{ id: string; label: string; icon: string; ranges: Range[] }> = [
  {
    id: 'smileys', label: 'Smileys & emotion', icon: '😀',
    ranges: [[0x1f600, 0x1f64f], [0x1f910, 0x1f92f], [0x1f970, 0x1f97f], [0x1fae0, 0x1faef], [0x263a, 0x263a], [0x1f47b, 0x1f480], [0x1f4a9, 0x1f4a9],
      [0x2763, 0x2764], [0x1f493, 0x1f49f], [0x1f5a4, 0x1f5a4], [0x1f90d, 0x1f90e], [0x1f9e1, 0x1f9e1], [0x1fa75, 0x1fa77], [0x1f4a2, 0x1f4ab], [0x1f4ac, 0x1f4ad]],
  },
  {
    id: 'people', label: 'People & body', icon: '👋',
    ranges: [[0x1f440, 0x1f450], [0x1f466, 0x1f487], [0x1f4aa, 0x1f4aa], [0x1f590, 0x1f596], [0x1f918, 0x1f91f], [0x1f930, 0x1f93e], [0x1f9b5, 0x1f9bb],
      [0x1f9d1, 0x1f9df], [0x1fac0, 0x1fac5], [0x1faf0, 0x1faf8], [0x270a, 0x270d], [0x261d, 0x261d], [0x1f574, 0x1f57a], [0x1f6b6, 0x1f6b6], [0x1f3c3, 0x1f3c4]],
  },
  {
    id: 'nature', label: 'Animals & nature', icon: '🐶',
    ranges: [[0x1f400, 0x1f43f], [0x1f980, 0x1f9ae], [0x1fab0, 0x1fabf], [0x1f330, 0x1f344], [0x1f490, 0x1f490], [0x1f4ae, 0x1f4ae], [0x1f300, 0x1f30c], [0x1f311, 0x1f321],
      [0x2600, 0x2604], [0x26c4, 0x26c5], [0x26a1, 0x26a1], [0x2744, 0x2744], [0x1f325, 0x1f32c]],
  },
  { id: 'food', label: 'Food & drink', icon: '🍔', ranges: [[0x1f345, 0x1f37f], [0x1f950, 0x1f96f], [0x1f9c0, 0x1f9cf], [0x1fad0, 0x1fadf], [0x2615, 0x2615]] },
  {
    id: 'activities', label: 'Activities', icon: '⚽',
    ranges: [[0x1f380, 0x1f393], [0x1f396, 0x1f3cf], [0x26bd, 0x26be], [0x1f93f, 0x1f94f], [0x1f3f8, 0x1f3ff], [0x1f9e9, 0x1f9e9], [0x265f, 0x265f], [0x1fa80, 0x1fa8f], [0x26f3, 0x26f3], [0x26f8, 0x26f8]],
  },
  {
    id: 'travel', label: 'Travel & places', icon: '🚗',
    ranges: [[0x1f680, 0x1f6ff], [0x1f3d4, 0x1f3f0], [0x1f30d, 0x1f310], [0x26f0, 0x26fd], [0x2708, 0x2708], [0x1f5fa, 0x1f5ff], [0x1f6f0, 0x1f6fc], [0x2693, 0x2693], [0x231a, 0x231b], [0x23f0, 0x23f3]],
  },
  {
    id: 'objects', label: 'Objects', icon: '💡',
    ranges: [[0x1f4a0, 0x1f4ff], [0x1f500, 0x1f53d], [0x1f550, 0x1f567], [0x1f56f, 0x1f5e3], [0x1f9e0, 0x1f9ff], [0x1fa70, 0x1faaf], [0x2328, 0x2328], [0x260e, 0x260e],
      [0x2702, 0x2702], [0x2709, 0x2709], [0x270f, 0x270f], [0x2712, 0x2712], [0x1f3a8, 0x1f3a8], [0x1f6d2, 0x1f6d2]],
  },
  {
    id: 'symbols', label: 'Symbols', icon: '❤️',
    ranges: [[0x2600, 0x27bf], [0x1f170, 0x1f251], [0x2b05, 0x2b55], [0x3030, 0x3030], [0x303d, 0x303d], [0x3297, 0x3299], [0x203c, 0x2049], [0x2122, 0x2139], [0x2194, 0x21aa],
      [0x23e9, 0x23fa], [0x25aa, 0x25fe], [0x2934, 0x2935], [0x1f7e0, 0x1f7f0]],
  },
];

// Flags: two regional indicators per country, from its ISO code.
const COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET EU FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UN US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW';
const flag = (code: string): string => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const IS_EMOJI = /\p{Emoji}/u;
const SHOWS_AS_EMOJI = /\p{Emoji_Presentation}/u;
const NOT_A_PICTURE = /[0-9#*©®]/u;

let built: EmojiCategory[] | null = null;

/** The picker's categories, built once. */
export function emojiCategories(): EmojiCategory[] {
  if (built) return built;
  const seen = new Set<string>();
  const out: EmojiCategory[] = [];
  for (const c of CATEGORY_RANGES) {
    const list: string[] = [];
    for (const [a, b] of c.ranges) {
      for (let cp = a; cp <= b; cp += 1) {
        const ch = String.fromCodePoint(cp);
        if (!IS_EMOJI.test(ch) || NOT_A_PICTURE.test(ch)) continue;
        // Text-style symbols (☀, ✈, ❤) need the emoji variation selector.
        const e = SHOWS_AS_EMOJI.test(ch) ? ch : `${ch}️`;
        if (seen.has(e)) continue;
        seen.add(e);
        list.push(e);
      }
    }
    out.push({ id: c.id, label: c.label, icon: c.icon, emoji: list });
  }
  out.push({ id: 'flags', label: 'Flags', icon: '🏁', emoji: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏴‍☠️', ...COUNTRIES.split(' ').map(flag)] });
  built = out;
  return out;
}

/** Names for the ones people look for. */
const NAMES: Record<string, string> = {
  '👍': 'thumbs up like yes ok good agree', '👎': 'thumbs down no dislike bad', '❤️': 'heart love red', '😂': 'laugh joy tears funny lol',
  '🤣': 'rofl laugh rolling', '😮': 'wow surprised open mouth', '😢': 'sad cry tear', '😭': 'sob crying loud', '🙏': 'pray please thanks folded hands',
  '🔥': 'fire lit hot', '👀': 'eyes look see watching', '🎉': 'party tada celebrate congrats', '✅': 'check done yes tick', '❌': 'cross no wrong x',
  '😍': 'heart eyes love', '🥰': 'smiling hearts love', '😊': 'smile blush happy', '🙂': 'slight smile', '😀': 'grin smile happy', '😅': 'sweat smile phew',
  '😉': 'wink', '😎': 'cool sunglasses', '🤔': 'thinking hmm', '🤯': 'mind blown exploding', '😴': 'sleep tired zzz', '🥳': 'party face celebrate birthday',
  '😡': 'angry mad', '😤': 'huff frustrated', '😬': 'grimace awkward yikes', '🙄': 'eye roll', '😇': 'angel innocent', '🤝': 'handshake deal agree',
  '👏': 'clap applause', '🙌': 'raised hands hooray', '💪': 'muscle strong flex', '👋': 'wave hello hi bye', '✌️': 'peace victory', '🤞': 'fingers crossed luck',
  '👌': 'ok perfect', '🫡': 'salute', '💯': 'hundred perfect', '⭐': 'star', '✨': 'sparkles', '💡': 'idea bulb', '🚀': 'rocket launch ship',
  '💔': 'broken heart', '💙': 'blue heart', '💚': 'green heart', '💛': 'yellow heart', '💜': 'purple heart', '🖤': 'black heart', '🤍': 'white heart',
  '😱': 'scream shocked', '🫠': 'melting', '🥲': 'smile tear', '😌': 'relieved', '🤗': 'hug', '🤩': 'star struck excited', '😋': 'yum delicious',
  '☕': 'coffee', '🍕': 'pizza', '🍔': 'burger', '🎂': 'cake birthday', '🍻': 'cheers beer', '🥂': 'cheers toast', '⚽': 'football soccer',
  '🏆': 'trophy win', '🎯': 'target bullseye', '📌': 'pin', '📎': 'paperclip', '📅': 'calendar date', '✈️': 'plane flight travel', '🏨': 'hotel',
  '🍽️': 'restaurant dinner', '💸': 'money spend', '💰': 'money bag', '📈': 'chart up growth', '📉': 'chart down', '⚠️': 'warning', '❓': 'question',
  '❗': 'exclamation important', '💤': 'sleep zzz', '🐛': 'bug', '🛠️': 'tools fix', '🔒': 'lock secure', '🤖': 'robot bot', '👻': 'ghost', '💀': 'skull dead',
};

export function searchEmoji(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = Object.entries(NAMES).filter(([, words]) => words.split(' ').some((w) => w.startsWith(q))).map(([e]) => e);
  for (const c of emojiCategories()) {
    if (c.label.toLowerCase().includes(q)) for (const e of c.emoji) if (!hits.includes(e)) hits.push(e);
  }
  return hits.slice(0, 120);
}

const RECENT_KEY = 'dex.emoji.recent';

export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function noteRecentEmoji(emoji: string): void {
  try {
    const next = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 24);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage off: no recents */ }
}
