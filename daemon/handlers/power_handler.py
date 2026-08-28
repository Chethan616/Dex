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
