"""Power plans — Tier 1."""
from __future__ import annotations

import logging
import re

from ._proc import run

log = logging.getLogger('PowerHandler')

PLAN_GUIDS = {
    'balanced':         '381b4222-f694-41f0-9685-ff5bb260df2e',
    'high_performance': '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
    'power_saver':      'a1841308-3541-4fab-bc81-f71556f20b4a',
}

_BY_GUID = {guid: name for name, guid in PLAN_GUIDS.items()}

_GUID_RE = re.compile(
    r'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
)

# powercfg /change targets whichever scheme is CURRENTLY active — it has no
# /scheme flag, unlike most other powercfg subcommands. A friendly name here
# maps to the exact flag powercfg accepts; nothing scheme-specific about the
# names themselves, so any custom plan can set any of these.
_SETTING_FLAGS = {
    'monitor_timeout_ac': 'monitor-timeout-ac',
    'monitor_timeout_dc': 'monitor-timeout-dc',
    'monitor_dim_timeout_ac': 'monitor-dim-timeout-ac',
    'monitor_dim_timeout_dc': 'monitor-dim-timeout-dc',
    'disk_timeout_ac': 'disk-timeout-ac',
    'disk_timeout_dc': 'disk-timeout-dc',
    'standby_timeout_ac': 'standby-timeout-ac',
    'standby_timeout_dc': 'standby-timeout-dc',
    'hibernate_timeout_ac': 'hibernate-timeout-ac',
    'hibernate_timeout_dc': 'hibernate-timeout-dc',
}


def _find_scheme_by_name(name: str) -> str | None:
    """The GUID of an existing scheme whose display name matches, or None.

    Read via `powercfg /list` rather than assumed — this is what makes
    create_power_plan idempotent: asking for the same named plan twice
    updates the one plan already on the machine instead of leaving behind a
    second, near-identical one under the same name every time the request
    is repeated (including a retried step after a transient failure).
    """
    output = run(['powercfg', '/list'])
    wanted = name.strip().lower()
    for line in output.splitlines():
        match = _GUID_RE.search(line)
        if not match:
            continue
        label = line[match.end():].strip()
        # "  (Balanced) *" -> "Balanced"; the trailing "*" marks the active
        # scheme and is not part of the name.
        label = label.strip('* ').lstrip('(').rstrip(')').strip()
        if label.lower() == wanted:
            return match.group(1)
    return None


class PowerHandler:

    @staticmethod
    def set_power_plan(params: dict) -> dict:
        plan = str(params.get('plan', 'balanced')).lower().replace(' ', '_')
        guid = PLAN_GUIDS.get(plan)
        if not guid:
            raise ValueError(f'Unknown power plan "{plan}". Valid: {list(PLAN_GUIDS)}')

        run(['powercfg', '/setactive', guid])
        log.info('Power plan set to %s (%s)', plan, guid)

        # Read back, so what comes out is what the machine is on rather than
        # what it was told to do. A custom OEM plan can be active with a GUID
        # none of these three names covers, and saying so is more useful than
        # echoing the request.
        active = PowerHandler.get_power_plan({})
        return {'plan': plan, 'guid': guid, 'active': active}

    @staticmethod
    def get_power_plan(params: dict) -> dict:
        output = run(['powercfg', '/getactivescheme']).strip()
        found = re.search(
            r'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
            r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12})',
            output,
        )
        guid = found.group(1).lower() if found else None
        return {
            'guid': guid,
            'plan': _BY_GUID.get(guid),
            'raw': output,
        }

    @staticmethod
    def create_power_plan(params: dict) -> dict:
        """
        Duplicate a base plan, name it, tune whichever settings were asked
        for, and optionally activate it — one atomic, structured call.

        Replaces a fragile pattern: a model was hand-writing a chain of
        run_command steps that extracted a scheme GUID out of powercfg's
        human-readable text via string-templating into ANOTHER PowerShell
        command (`{{step_N.output.stdout}}` spliced into a -split/.Split()
        one-liner) and, separately, invented a `/scheme:` flag `powercfg
        /change` does not actually accept — /change always targets whatever
        scheme is currently active. Both mistakes are structural, not typos:
        there was no primitive that just did this, so the model built one
        out of shell text-parsing every time it was asked, and it broke on
        the real output shape. This does the same job as one real operation.

        Idempotent by name: asking for a plan called the same thing twice
        updates the one that already exists rather than leaving a second,
        near-identical plan behind every time — including a plain retry
        after a transient failure.
        """
        name = str(params.get('name', '')).strip()
        if not name:
            raise ValueError('create_power_plan needs a name')

        base = str(params.get('base', 'balanced')).lower().replace(' ', '_')
        base_guid = PLAN_GUIDS.get(base)
        if not base_guid:
            raise ValueError(f'Unknown base plan "{base}". Valid: {list(PLAN_GUIDS)}')

        existing = _find_scheme_by_name(name)
        if existing:
            guid = existing
            log.info('Power plan "%s" already exists (%s) — updating it, not duplicating again', name, guid)
        else:
            output = run(['powercfg', '/duplicatescheme', base_guid])
            found = _GUID_RE.search(output)
            if not found:
                raise RuntimeError(f'powercfg did not report a new scheme GUID. Output: {output.strip()[:200]}')
            guid = found.group(1)
            run(['powercfg', '/changename', guid, name])

        raw_settings = params.get('settings') or {}
        applied: dict[str, int] = {}
        if raw_settings:
            # /change has no way to target a scheme other than the active
            # one, so the new plan is switched to first and the previous
            # plan is restored afterward unless the caller actually wants
            # to end up on the new one.
            previous = PowerHandler.get_power_plan({}).get('guid')
            run(['powercfg', '/setactive', guid])
            try:
                for key, minutes in raw_settings.items():
                    flag = _SETTING_FLAGS.get(key)
                    if not flag:
                        raise ValueError(f'Unknown power setting "{key}". Valid: {list(_SETTING_FLAGS)}')
                    run(['powercfg', '/change', flag, str(int(minutes))])
                    applied[key] = int(minutes)
            finally:
                if not params.get('activate', True) and previous and previous != guid:
                    run(['powercfg', '/setactive', previous])

        activate = bool(params.get('activate', True))
        if activate:
            run(['powercfg', '/setactive', guid])

        log.info(
            'Power plan "%s" (%s): base=%s settings=%s active=%s',
            name, guid, base, applied, activate,
        )
        return {'name': name, 'guid': guid, 'base': base, 'settings': applied, 'active': activate}
