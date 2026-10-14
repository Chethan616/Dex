/**
 * Extensions DEX suggests in Settings › Extensions › Browse: popular, and
 * known to work in DEX's browser (main/extensions). Each id was checked
 * against the Chrome Web Store's update service on 2026-10-14; left out on
 * purpose are extensions built on APIs DEX doesn't offer yet (userScripts,
 * tabCapture, desktopCapture, new-tab overrides).
 *
 * Icons come from each store page at run time (main/extensions/catalogIcons.ts),
 * never bundled.
 */

export type ExtensionCategory =
  | 'Reading & writing'
  | 'Privacy & security'
  | 'Research & study'
  | 'Productivity'
  | 'Shopping'
  | 'Video'
  | 'Developer tools';

export interface CatalogExtension {
  id: string;
  name: string;
  blurb: string;
  category: ExtensionCategory;
  featured?: boolean;
  /** A password manager: the agent is never let near its pages (cdpBroker hooks). */
  passwords?: boolean;
}

export const EXTENSION_CATEGORIES: ExtensionCategory[] = [
  'Reading & writing', 'Privacy & security', 'Research & study', 'Productivity', 'Shopping', 'Video', 'Developer tools',
];

export const EXTENSION_CATALOG: CatalogExtension[] = [
  { id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader', blurb: 'Dark mode for every website, with your own brightness and contrast.', category: 'Reading & writing', featured: true },
  { id: 'kbfnbcaeplbcioakkpcpgfkobkghlhen', name: 'Grammarly', blurb: 'Spelling, grammar and tone suggestions as you write.', category: 'Reading & writing', featured: true },
  { id: 'aapbdbdomjkkjkaonfhkkikfgjllcleb', name: 'Google Translate', blurb: 'Translate a page, or any word you select.', category: 'Reading & writing', featured: true },
  { id: 'oldceeleldhonbafppcapldpdifcinji', name: 'LanguageTool', blurb: 'Grammar and style checks in more than 30 languages.', category: 'Reading & writing' },
  { id: 'mgijmajocgfcbeboacabfgobmjgjcoja', name: 'Google Dictionary', blurb: 'Double-click a word to see what it means.', category: 'Reading & writing' },
  { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite', blurb: 'Blocks ads, trackers and malware sites. Light on memory.', category: 'Privacy & security', featured: true },
  { id: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', name: 'Privacy Badger', blurb: 'Learns to block invisible trackers as you browse.', category: 'Privacy & security' },
  { id: 'bkdgflcldnnnapblkhphbgpggdiikppg', name: 'DuckDuckGo Privacy Essentials', blurb: 'Tracker blocking, private search and cookie-pop-up handling.', category: 'Privacy & security' },
  { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden', blurb: 'Open-source password manager: fill and save passwords.', category: 'Privacy & security', featured: true, passwords: true },
  { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', name: '1Password', blurb: 'Fill passwords, passkeys and cards from your 1Password vault.', category: 'Privacy & security', passwords: true },
  { id: 'hdokiejnpimakedhajhdlcegeplioahd', name: 'LastPass', blurb: 'Save and fill passwords from your LastPass vault.', category: 'Privacy & security', passwords: true },
  { id: 'jplgfhpmjnbigmhklmmbgecoobifkmpa', name: 'Proton VPN', blurb: 'A VPN for the browser, from the makers of Proton Mail.', category: 'Privacy & security' },
  { id: 'ekhagklcjbdpajgpjgmbionohlpdbjgc', name: 'Zotero Connector', blurb: 'Save papers and their citations to Zotero in one click.', category: 'Research & study', featured: true },
  { id: 'dagcmkpagjlhakfdhnbomgmjdpkdklff', name: 'Mendeley Web Importer', blurb: 'Import references and PDFs into your Mendeley library.', category: 'Research & study' },
  { id: 'knheggckgoiihginacbkhaalnibhilkk', name: 'Notion Web Clipper', blurb: 'Save any page to your Notion workspace.', category: 'Productivity' },
  { id: 'jldhpllghnbhlbpcmnajkpdmadaolakh', name: 'Todoist', blurb: 'Add a page or a task to Todoist without leaving it.', category: 'Productivity' },
  { id: 'bmnlcjabgnpnenekpadlanbbkooimhnj', name: 'Honey', blurb: 'Finds coupon codes at checkout and tracks prices.', category: 'Shopping' },
  { id: 'mnjggcdmjocbbbhaepdhchncahnbgone', name: 'SponsorBlock', blurb: 'Skips sponsor segments in YouTube videos.', category: 'Video' },
  { id: 'gebbhagfogifgggkldgodflihgfeippi', name: 'Return YouTube Dislike', blurb: 'Shows the dislike count on YouTube again.', category: 'Video' },
  { id: 'hkgfoiooedgoejojocmhlaklaeopbecg', name: 'Picture-in-Picture', blurb: 'Pop a video out into a small window that stays on top.', category: 'Video' },
  { id: 'fmkadmapgofadopljbjfkapdkoienihi', name: 'React Developer Tools', blurb: 'Inspect React components in the page’s Developer tools.', category: 'Developer tools' },
  { id: 'nhdogjmejiglipccpnnnanhbledajbpd', name: 'Vue.js devtools', blurb: 'Inspect Vue components and state in Developer tools.', category: 'Developer tools' },
  { id: 'bhlhnicpbhignbdhedgjhgdocnmhomnp', name: 'ColorZilla', blurb: 'Pick any colour on a page; gradients and palettes.', category: 'Developer tools' },
  { id: 'gppongmhjkpfnbhagpmjfkannfbllamg', name: 'Wappalyzer', blurb: 'See what a website is built with.', category: 'Developer tools' },
];
