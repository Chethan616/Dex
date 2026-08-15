import subprocess
import logging

log = logging.getLogger('PowerHandler')

PLAN_GUIDS = {
    'balanced':         '381b4222-f694-41f0-9685-ff5bb260df2e',
    'high_performance': '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
    'power_saver':      'a1841308-3541-4fab-bc81-f71556f20b4a',
}


class PowerHandler:

    @staticmethod
    def set_power_plan(params: dict) -> dict:
        plan = params.get('plan', 'balanced').lower().replace(' ', '_')
        guid = PLAN_GUIDS.get(plan)
        if not guid:
            raise ValueError(f'Unknown power plan "{plan}". Valid: {list(PLAN_GUIDS)}')

        result = subprocess.run(['powercfg', '/setactive', guid],
                                capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f'powercfg failed: {result.stderr.strip()}')

        log.info(f'Power plan set to {plan} ({guid})')
        return {'plan': plan, 'guid': guid}

    @staticmethod
    def get_power_plan(params: dict) -> dict:
        output = subprocess.run(['powercfg', '/getactivescheme'],
                                capture_output=True, text=True).stdout
        return {'raw': output.strip()}
