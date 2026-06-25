import sys
from pathlib import Path

# Add parent directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Test approval.py
from _shared.approval import check_refusal, BROWSER_REFUSE_PATTERNS  # type: ignore
refusal = check_refusal("format c:")
assert refusal is not None, "Should refuse format c:"
print("OK COMMON_REFUSE_PATTERNS check passed")

refusal_browser = check_refusal("login to my bank", BROWSER_REFUSE_PATTERNS)
assert refusal_browser is not None, "Should refuse banking"
print("OK BROWSER_REFUSE_PATTERNS check passed")

# Test canvas_detection.py
sys.path.insert(0, str(Path(__file__).resolve().parent / "browser-control"))
from canvas_detection import is_canvas_dominant_url, make_canvas_hint  # type: ignore
assert is_canvas_dominant_url("https://figma.com/file/abc") is True, "Figma should be canvas dominant"
assert is_canvas_dominant_url("https://google.com") is False, "Google should not be canvas dominant"
hint = make_canvas_hint("https://miro.com/app/board/123")
assert hint is not None and "miro.com" in hint, "Miro should emit canvas hint"
print("OK canvas_detection checks passed")

print("All Python driver smoke tests passed successfully!")
