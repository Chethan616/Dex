import re
import subprocess
import logging

log = logging.getLogger('NetworkHandler')


class NetworkHandler:

    @staticmethod
    def set_dns(params: dict) -> dict:
        primary = params.get('primary')
        secondary = params.get('secondary')
        adapter = params.get('adapter')  # None = all active adapters

        if not primary:
            raise ValueError('primary DNS address is required')
        _validate_ip(primary)
        if secondary:
            _validate_ip(secondary)

        adapters = [adapter] if adapter else _get_active_adapters()
        if not adapters:
            raise RuntimeError('No active network adapters found')

        configured = []
        for adp in adapters:
            _run(['netsh', 'interface', 'ipv4', 'set', 'dnsservers',
                  f'name={adp}', 'source=static', f'address={primary}', 'validate=no'])
            if secondary:
                _run(['netsh', 'interface', 'ipv4', 'add', 'dnsservers',
                      f'name={adp}', f'address={secondary}', 'index=2', 'validate=no'])
            configured.append(adp)
            log.info(f'DNS on "{adp}": primary={primary} secondary={secondary}')

        return {'adapters': configured, 'primary': primary, 'secondary': secondary}

    @staticmethod
    def get_dns(params: dict) -> dict:
        output = _run(['netsh', 'interface', 'ipv4', 'show', 'dnsservers'])
        return {'raw': output}

    @staticmethod
    def set_wifi(params: dict) -> dict:
        enabled = bool(params.get('enabled', True))
        action = 'enable' if enabled else 'disable'
        adapters = _get_wireless_adapters()
        if not adapters:
            raise RuntimeError('No wireless adapters found')
        for adp in adapters:
            _run(['netsh', 'interface', 'set', 'interface', adp, action])
        return {'adapters': adapters, 'enabled': enabled}

    @staticmethod
    def get_wifi_status(params: dict) -> dict:
        output = _run(['netsh', 'wlan', 'show', 'interfaces'])
        return {'raw': output}


# ── helpers ──────────────────────────────────────────────────────────────────

def _run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0 and result.stderr:
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def _validate_ip(ip: str) -> None:
    parts = ip.split('.')
    if len(parts) != 4:
        raise ValueError(f'Invalid IP: {ip}')
    for p in parts:
        if not p.isdigit() or not 0 <= int(p) <= 255:
            raise ValueError(f'Invalid IP: {ip}')


def _get_active_adapters() -> list[str]:
    output = _run(['netsh', 'interface', 'show', 'interface'])
    adapters = []
    for line in output.splitlines():
        if 'Connected' in line and 'Enabled' in line:
            parts = line.split()
            if len(parts) >= 4:
                adapters.append(' '.join(parts[3:]))
    return adapters or ['Ethernet', 'Wi-Fi']  # fallback


def _get_wireless_adapters() -> list[str]:
    output = _run(['netsh', 'wlan', 'show', 'interfaces'])
    names = re.findall(r'Name\s*:\s*(.+)', output)
    return [n.strip() for n in names]
