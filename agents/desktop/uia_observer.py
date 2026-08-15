"""
UIA Observer: reads the Windows UI Automation tree for the Reliability Layer.
Used to verify that GUI actions actually changed application state.
"""
import logging

log = logging.getLogger('UiaObserver')


def get_focused_window_state() -> dict:
    """Capture UIA state of the currently focused window (up to 4 levels deep)."""
    try:
        import uiautomation as auto
        focused = auto.GetFocusedControl()
        if not focused:
            return {'error': 'No focused control'}
        top = focused.GetTopLevelControl()
        return _serialize(top, max_depth=4)
    except ImportError:
        return {'error': 'uiautomation not installed — run: pip install uiautomation'}
    except Exception as exc:
        return {'error': str(exc)}


def find_window(title_contains: str) -> dict | None:
    """Find a window whose title contains the given string."""
    try:
        import uiautomation as auto
        desktop = auto.GetRootControl()
        for win in desktop.GetChildren():
            name = getattr(win, 'Name', '') or ''
            if title_contains.lower() in name.lower():
                return _serialize(win, max_depth=3)
    except Exception as exc:
        log.warning(f'find_window("{title_contains}") failed: {exc}')
    return None


def window_exists(title_contains: str) -> bool:
    return find_window(title_contains) is not None


def _serialize(elem, depth: int = 0, max_depth: int = 4) -> dict:
    try:
        r = elem.BoundingRectangle
        rect = {'l': r.left, 't': r.top, 'r': r.right, 'b': r.bottom}
    except Exception:
        rect = {}

    node: dict = {
        'name': getattr(elem, 'Name', '') or '',
        'type': getattr(elem, 'ControlTypeName', '') or '',
        'class': getattr(elem, 'ClassName', '') or '',
        'rect': rect,
        'enabled': getattr(elem, 'IsEnabled', None),
    }

    if depth < max_depth:
        children = []
        try:
            for child in elem.GetChildren():
                children.append(_serialize(child, depth + 1, max_depth))
        except Exception:
            pass
        if children:
            node['children'] = children

    return node
