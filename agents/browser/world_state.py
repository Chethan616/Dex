"""
What the browser loop already knows.

The loop in `bridge_agent.py` was given a system prompt, a list of tool names,
and the last twelve lines of what it had done. Nothing else. So every turn it
had to ask the page what page it was on, and nothing it had learned about a site
survived past the twelve-line window. The owner's description was exact: "its
lacking the knowledge like where the buttons will be."

This is Codex's world state, borrowed. Codex keeps a typed, model-visible
picture of what is true — environment, working directory, what is already known
— and each section "owns how its current state is rendered relative to an
earlier snapshot", so the model is told what **changed** rather than being
handed the whole world again every turn. Two things fall out of that and both
matter here:

  it stops rediscovering    the page it is on is stated, so the first move of a
                            turn is not another page_analyze to find out.
  it stops costing tokens   an unchanged section renders as nothing. A ten-turn
                            task pays for the browser section once.

**`known` is the part worth the file.** Dex already learns routes from runs that
worked — `SiteRouteStore` scores them and forgets the ones that stop working —
and the autonomous browser already gets them. The extension loop did not. So
"the GitHub status control is on the profile page, not in settings" was
relearned from scratch every single time. Here it is simply told.

Nothing site-specific is written down. A route is something a previous run
discovered; this is where it gets handed to the next one.
"""
from __future__ import annotations

from typing import Any


class WorldState:
    """A small typed picture of the browser, rendered by what changed."""

    def __init__(self) -> None:
        self._sections: dict[str, str] = {}
        self._shown: dict[str, str] = {}
        # Order is fixed rather than insertion-based: the model reads this
        # every turn and a block whose lines move around reads as new
        # information when it is not.
        self._order = ('goal', 'browser', 'known', 'page', 'done')

    # ── what is true ────────────────────────────────────────────────────────

    def set(self, section: str, text: str) -> None:
        cleaned = (text or '').strip()
        if cleaned:
            self._sections[section] = cleaned
        else:
            self._sections.pop(section, None)

    def browser(self, tools: int, profile: str = '') -> None:
        who = f' as {profile}' if profile else ''
        self.set('browser', f'The owner\'s browser{who}, attached, {tools} tools.')

    def page(self, url: str, title: str = '') -> None:
        """
        Where the browser is now.

        Kept as one line because that is all the loop needs to decide whether it
        has arrived. The page's contents belong in the turn that read them, not
        in a block restated every turn.
        """
        if not url:
            return
        self.set('page', f'{url}{f"  ·  {title}" if title else ""}')

    def known(self, route: dict | None) -> None:
        """
        What a previous run found out about this site.

        A hint, never a cage — the same rule the autonomous path already uses.
        A page that has been redesigned since simply does not match, and the
        loop falls back to looking, which is what it did before there was a
        route at all.
        """
        if not route:
            return
        steps = route.get('steps') or []
        if not steps:
            return
        path = ' -> '.join(str(s.get('text', ''))[:60] for s in steps[:6] if s.get('text'))
        if not path:
            return
        self.set(
            'known',
            f'A previous run did this here: {path}\n'
            'Check each step still exists rather than assuming it does.',
        )

    def did(self, what: str) -> None:
        """One more thing that has happened, appended to the running list."""
        if not what:
            return
        existing = self._sections.get('done', '')
        parts = [p for p in existing.split('\n') if p]
        parts.append(f'· {what}')
        # The tail, not the head: what happened recently is what the next
        # decision depends on. The whole history lives in the turn log.
        self.set('done', '\n'.join(parts[-8:]))

    # ── what to say about it ────────────────────────────────────────────────

    def render(self, *, full: bool = False) -> str:
        """
        The block to put in the prompt — only the parts that changed.

        `full=True` renders everything, for the first turn and after a
        compaction, where "unchanged since last turn" refers to a turn the model
        can no longer see.
        """
        lines: list[str] = []
        for name in self._order:
            value = self._sections.get(name)
            if value is None:
                continue
            if not full and self._shown.get(name) == value:
                continue
            lines.append(f'{name}: {value}')
            self._shown[name] = value

        if not lines:
            return ''
        return 'WHAT IS TRUE NOW\n' + '\n'.join(f'  {line}' for line in lines)

    def forget_what_was_shown(self) -> None:
        """After a compaction, everything has to be said again."""
        self._shown.clear()

    def snapshot(self) -> dict[str, Any]:
        return dict(self._sections)


def page_of(result: Any) -> tuple[str, str]:
    """
    The url and title in a tool result, if it says.

    Tools answer in whatever shape their own author chose, and this is the one
    place that has to know about that rather than every caller.
    """
    if not isinstance(result, dict):
        return '', ''

    url = ''
    title = ''
    for key in ('url', 'href', 'page_url', 'current_url'):
        value = result.get(key)
        if isinstance(value, str) and value:
            url = value
            break
    for key in ('title', 'page_title'):
        value = result.get(key)
        if isinstance(value, str) and value:
            title = value
            break

    # page_analyze and tab_list answer with the tab rather than the page.
    if not url:
        tabs = result.get('tabs')
        if isinstance(tabs, list):
            for tab in tabs:
                if isinstance(tab, dict) and tab.get('active'):
                    url = str(tab.get('url', ''))
                    title = str(tab.get('title', ''))
                    break

    return url, title
