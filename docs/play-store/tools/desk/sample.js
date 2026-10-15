// Sample tasks for the desktop store/README shots (same stories as the phone's).
(() => {
  const now = Date.now();
  const MIN = 60_000;
  const at = (m) => now - m * MIN;
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;

  const flightsCards = {
    type: 'cards', title: 'Hyderabad → Goa · Fri 17 Oct · 2 adults', icon: 'flight',
    items: [
      { title: 'IndiGo 6E 6421', subtitle: '06:10 → 07:25 · 1h 15m · Non-stop', lines: ['HYD → GOI', 'Cabin bag included'], price: '₹15,680', badge: 'Cheapest', icon: 'flight',
        actions: [{ label: 'Select', reply: 'Select IndiGo 6E 6421', primary: true }, { label: 'Open', url: 'https://www.kiwi.com' }] },
      { title: 'Air India Express IX 2934', subtitle: '09:45 → 11:05 · 1h 20m · Non-stop', lines: ['HYD → GOX (Mopa)', 'Cabin bag included'], price: '₹16,430', icon: 'flight',
        actions: [{ label: 'Select', reply: 'Select IX 2934', primary: true }, { label: 'Open', url: 'https://www.kiwi.com' }] },
      { title: 'Akasa Air QP 1347', subtitle: '13:30 → 14:50 · 1h 20m · Non-stop', lines: ['HYD → GOI'], price: '₹17,180', badge: 'Best time', icon: 'flight',
        actions: [{ label: 'Select', reply: 'Select QP 1347', primary: true }, { label: 'Open', url: 'https://www.kiwi.com' }] },
    ],
  };

  const wf = (n, name, description, trigger, steps) => ({
    id: `wf_sample${n}`, name, description, trigger, enabled: true, createdAt: at(4000), updatedAt: at(4000),
    steps: steps.map(([kind, title, detail], i) => ({ id: `s${i + 1}`, kind, title, ...(detail ? { detail } : {}) })),
  });
  const routines = {
    type: 'workflows', title: 'Your routines',
    items: [
      wf(1, 'Morning briefing', 'Mail, calendar and weather before work', { kind: 'daily', time: '07:30' },
        [['task', 'Check unread email', 'Gmail and Outlook'], ['web', "Today's weather", 'Hyderabad'], ['task', 'Summarise my calendar'], ['notify', 'Send me the summary']]),
      wf(2, 'Weekly tidy-up', 'Downloads sorted, bin emptied', { kind: 'weekly', time: '18:00', days: ['sun'] },
        [['pc', 'Sort the Downloads folder'], ['pc', 'Empty the recycle bin'], ['notify', 'Tell me what moved']]),
      wf(3, 'Pay-day check', 'Bills due this week', { kind: 'weekly', time: '09:00', days: ['fri'] },
        [['web', 'Check my bills'], ['ask', 'Ask before paying']]),
    ],
  };

  const sessions = [
    {
      id: id(1), prompt: 'Find the cheapest flight from Hyderabad to Goa this Friday for 2', status: 'idle', engine: 'claude-code', hasBrowser: false,
      createdAt: at(9), lastActivityAt: at(6), hasBrowser: false,
      output: [
        { type: 'user_input', text: 'Find the cheapest flight from Hyderabad to Goa this Friday for 2', at: at(9) },
        { type: 'tool_call', name: 'mcp__kiwi__search-flight', args: { flyFrom: 'Hyderabad', flyTo: 'Goa', departureDate: '17/10/2026', passengers: { adults: 2 } }, iteration: 1, at: at(9) },
        { type: 'tool_result', name: 'mcp__kiwi__search-flight', ok: true, preview: '38 flights', ms: 2100, at: at(8) },
        { type: 'thinking', text: 'The cheapest is **IndiGo at 6:10 am, ₹15,680 for both of you**. Air India Express is ₹750 more and leaves later; Akasa has the best time of day.', at: at(7) },
        { type: 'widget', id: 'w-flights', widget: flightsCards, at: at(7) },
        { type: 'done', summary: 'Found 3 non-stop flights; IndiGo 6E 6421 is the cheapest at ₹15,680 for 2.', iterations: 3, at: at(6) },
      ],
    },
    {
      id: id(2), prompt: 'My Wi-Fi keeps dropping. Find out why and fix it.', status: 'running', engine: 'claude-code', hasBrowser: false,
      createdAt: at(5), lastActivityAt: at(1),
      output: [
        { type: 'user_input', text: 'My Wi-Fi keeps dropping. Find out why and fix it.', at: at(5) },
        { type: 'tool_call', name: 'mcp__windows__system_info', args: { topic: 'network' }, iteration: 1, at: at(5) },
        { type: 'tool_result', name: 'mcp__windows__system_info', ok: true, preview: 'Intel Wi-Fi 6 AX201', ms: 1400, at: at(4) },
        { type: 'tool_call', name: 'mcp__windows__system_info', args: { topic: 'events', log: 'WLAN-AutoConfig' }, iteration: 2, at: at(4) },
        { type: 'tool_result', name: 'mcp__windows__system_info', ok: true, preview: '14 disconnects', ms: 900, at: at(3) },
        { type: 'thinking', text: 'Found it. Windows turns your Wi-Fi adapter off to save power, **14 times since yesterday**, and each time the connection drops. I can turn that setting off, and you can undo it any time.', at: at(2) },
        { type: 'confirmation', id: 'c1', title: 'Turn off power saving for the Wi-Fi adapter', detail: 'Intel Wi-Fi 6 AX201 · Device Manager › Power management', status: 'pending', at: at(1), category: 'desktop', tier: 2 },
      ],
    },
    {
      id: id(3), prompt: 'Show my routines', status: 'idle', engine: 'claude-code', hasBrowser: false, createdAt: at(30), lastActivityAt: at(29),
      output: [
        { type: 'user_input', text: '/workflow', at: at(30) },
        { type: 'widget', id: 'w-routines', widget: routines, at: at(29) },
      ],
    },
    {
      id: id(4), prompt: 'Turn Lease.pdf into a one-page summary and send it to my phone', status: 'idle', engine: 'codex', hasBrowser: false,
      createdAt: at(95), lastActivityAt: at(88),
      output: [
        { type: 'user_input', text: 'Turn Lease.pdf into a one-page summary and send it to my phone', at: at(95) },
        { type: 'tool_call', name: 'Read', args: { file_path: 'C:\\Users\\Alex\\Documents\\Lease.pdf' }, iteration: 1, at: at(94) },
        { type: 'tool_result', name: 'Read', ok: true, preview: '14 pages', ms: 1800, at: at(94) },
        { type: 'thinking', text: "It's a 12-month lease from 1 November: ₹28,000 a month, a 2-month deposit, 2 months' notice, and no pets without written consent.", at: at(92) },
        { type: 'file_output', name: 'Lease summary.pdf', path: 'C:\\Users\\Alex\\Documents\\Lease summary.pdf', size: 84211, mime: 'application/pdf', at: at(89) },
        { type: 'done', summary: 'A one-page summary is in Documents and on your phone.', iterations: 4, at: at(88) },
      ],
    },
    {
      id: id(5), prompt: 'Book a table for 4 at a rooftop place on Saturday', status: 'idle', engine: 'claude-code', hasBrowser: false,
      createdAt: at(260), lastActivityAt: at(250),
      output: [
        { type: 'user_input', text: 'Book a table for 4 at a rooftop place on Saturday', at: at(260) },
        { type: 'done', summary: 'Found 3 rooftop places with tables for 4 at 8 pm.', iterations: 5, at: at(250) },
      ],
    },
  ];

  window.__DEX_SAMPLE__ = {
    sessions,
    defaults: {
      'memory.list': [],
      'settings.connectors.list': [
        { id: 'notion', connected: true, toolCount: 14 },
        { id: 'kiwi', connected: true, toolCount: 3 },
        { id: 'trivago', connected: true, toolCount: 2 },
        { id: 'linear', connected: true, toolCount: 21 },
      ],
      'settings.accounts.list': [
        { provider: 'google', connected: true, available: true },
        { provider: 'github', connected: true, available: true },
        { provider: 'slack', connected: false, available: true },
        { provider: 'huggingface', connected: false, available: true },
        { provider: 'microsoft', connected: false, available: false },
        { provider: 'reddit', connected: false, available: false },
      ],
    },
  };
})();
