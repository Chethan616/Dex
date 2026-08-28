"""
Network — Tier 1.

DNS is read back per adapter, not as one blob of text. That matters more than it
looks: this machine has Ethernet statically set to 8.8.8.8 while Wi-Fi takes its
DNS from DHCP, so "is 8.8.8.8 somewhere in the netsh output" is true before Dex
does anything at all. A check that cannot fail is not a check.
"""
from __future__ import annotations

import logging
import re

from ._proc import CommandFailed, run

log = logging.getLogger('NetworkHandler')


class NetworkHandler:

    @staticmethod
    def set_dns(params: dict) -> dict:
        """
        Point an adapter at a DNS server, or hand it back to DHCP.

        `dhcp: true` exists because automatic is where most adapters started and
        there was previously no way back — Dex could take your DNS off DHCP and
        not return it.
        """
        adapter = params.get('adapter')  # None = every active adapter
        adapters = [adapter] if adapter else _active_adapters()
        if not adapters:
            raise RuntimeError('No active network adapters found')

        if params.get('dhcp'):
            for adp in adapters:
                run(['netsh', 'interface', 'ipv4', 'set', 'dnsservers',
                     f'name={adp}', 'source=dhcp'])
                log.info('DNS on "%s": back to DHCP', adp)
            return {'adapters': adapters, 'source': 'dhcp'}

        primary = params.get('primary')
        secondary = params.get('secondary')
        if not primary:
            raise ValueError('set_dns needs primary, or dhcp: true')
        _validate_ip(primary)
        if secondary:
            _validate_ip(secondary)

        configured = []
        for adp in adapters:
            run(['netsh', 'interface', 'ipv4', 'set', 'dnsservers',
                 f'name={adp}', 'source=static', f'address={primary}', 'validate=no'])
            if secondary:
                run(['netsh', 'interface', 'ipv4', 'add', 'dnsservers',
                     f'name={adp}', f'address={secondary}', 'index=2', 'validate=no'])
            configured.append(adp)
            log.info('DNS on "%s": primary=%s secondary=%s', adp, primary, secondary)

        return {
            'adapters': configured,
            'primary': primary,
            'secondary': secondary,
            'source': 'static',
            # Read back immediately so the caller is handed a fact rather than
            # an intention, the same way the audio handler does.
            'confirmed': {a: _dns_for(a) for a in configured},
        }

    @staticmethod
    def get_dns(params: dict) -> dict:
        adapter = params.get('adapter')
        table = _dns_table()
        if adapter:
            entry = table.get(adapter)
            if entry is None:
                raise ValueError(f'No such adapter: "{adapter}"')
            return {'adapter': adapter, **entry}
        return {
            'adapters': table,
            'active': _active_adapters(),
            # Kept because the existing verification path greps it.
            'raw': _raw_dns(),
        }

    @staticmethod
    def set_wifi(params: dict) -> dict:
        enabled = bool(params.get('enabled', True))
        action = 'enable' if enabled else 'disable'
        adapters = _wireless_adapters()
        if not adapters:
            raise RuntimeError('No wireless adapters found')
        for adp in adapters:
            run(['netsh', 'interface', 'set', 'interface', adp, action])
        return {'adapters': adapters, 'enabled': enabled}

    @staticmethod
    def get_wifi_status(params: dict) -> dict:
        adapters = _wireless_adapters()
        return {'raw': run(['netsh', 'wlan', 'show', 'interfaces']),
                'adapters': adapters,
                'enabled': bool(adapters)}


# ── helpers ──────────────────────────────────────────────────────────────────

def _raw_dns() -> str:
    return run(['netsh', 'interface', 'ipv4', 'show', 'dnsservers'])


def _dns_table() -> dict:
    """
    Every adapter's DNS configuration, keyed by name.

        {"Wi-Fi": {"source": "dhcp",   "servers": ["172.16.32.1"]},
         "Ethernet": {"source": "static", "servers": ["8.8.8.8", "8.8.4.4"]}}

    Parsed rather than grepped so a restore can put back exactly what was there,
    including "it was on DHCP".
    """
    table: dict = {}
    current: str | None = None

    for line in _raw_dns().splitlines():
        line = line.rstrip()
        if not line.strip():
            continue

        header = re.match(r'^Configuration for interface "(.+)"\s*$', line.strip())
        if header:
            current = header.group(1)
            table[current] = {'source': 'unknown', 'servers': []}
            continue

        if current is None:
            continue

        if 'through DHCP' in line:
            table[current]['source'] = 'dhcp'
            table[current]['servers'] = _addresses(line)
        elif 'Statically Configured' in line:
            table[current]['source'] = 'static'
            table[current]['servers'] = _addresses(line)
        elif re.match(r'^\s+\d+\.\d+\.\d+\.\d+\s*$', line):
            # Continuation line: the second and later servers sit alone.
            table[current]['servers'].append(line.strip())

    return table


def _addresses(line: str) -> list:
    """The IPs on a netsh value line. 'None' means configured with nothing."""
    value = line.split(':', 1)[-1].strip()
    if not value or value.lower() == 'none':
        return []
    return re.findall(r'\d+\.\d+\.\d+\.\d+', value)


def _dns_for(adapter: str) -> dict:
    return _dns_table().get(adapter, {'source': 'unknown', 'servers': []})


def _active_adapters() -> list:
    """
    Adapters that are both enabled and connected.

    No fallback list. Guessing ["Ethernet", "Wi-Fi"] when the parse failed meant
    netsh was handed an adapter that might not exist, and the error that came
    back described the wrong problem.
    """
    output = run(['netsh', 'interface', 'show', 'interface'])
    adapters = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0] == 'Enabled' and parts[1] == 'Connected':
            adapters.append(' '.join(parts[3:]))
    return adapters


def _wireless_adapters() -> list:
    try:
        output = run(['netsh', 'wlan', 'show', 'interfaces'])
    except CommandFailed:
        # No WLAN service on this machine is a fact about the hardware, not an
        # error worth propagating to a caller that just asked what exists.
        return []
    return [
        line.split(':', 1)[1].strip()
        for line in output.splitlines()
        if line.strip().startswith('Name')
    ]


def _validate_ip(ip: str) -> None:
    parts = ip.split('.')
    if len(parts) != 4:
        raise ValueError(f'Invalid IP: {ip}')
    for p in parts:
        if not p.isdigit() or not 0 <= int(p) <= 255:
            raise ValueError(f'Invalid IP: {ip}')
