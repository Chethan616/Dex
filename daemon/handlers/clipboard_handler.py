"""
The Windows clipboard — reading what is on it, and putting something there.

Read is the interesting half, and not because it is technically hard. The
clipboard is the one place on a desktop where a password routinely sits in
plain text: a manager copies it there, the owner pastes it, and it stays until
something else overwrites it. An assistant that reads the clipboard on request
will eventually read one, put it in a task transcript, and send it to a model.

So reading is guarded, and the guard is a property of the content rather than a
list of applications:

  - a value that looks like a credential is reported as *present* and its text
    is withheld. The owner learns the clipboard holds something and Dex does
    not learn what.
  - a value copied out of a password manager is usually marked by the manager
    itself with a clipboard format asking for it to be excluded from history
    and cloud sync. Those formats are honoured: if the source said "do not
    keep this", Dex does not read it.

Three kinds of content are understood, because they are the three a person
means by "what did I copy": text, a list of files copied in Explorer, and an
image. An image is reported by its dimensions rather than its bytes — a bitmap
does not belong in a task transcript either.

Writing is the simple half, and it is deliberately text-only.
"""
from __future__ import annotations

import ctypes
import logging
import re
import time
from ctypes import wintypes

log = logging.getLogger('ClipboardHandler')

user32 = ctypes.WinDLL('user32', use_last_error=True)
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
shell32 = ctypes.WinDLL('shell32', use_last_error=True)

# Prototypes, declared once.
#
# Not optional on 64-bit Windows: ctypes defaults an undeclared return type to
# a 32-bit int, so a HANDLE comes back with its top half cut off. The first
# version of this file wrote to the clipboard successfully, read the truncated
# handle straight back, and dereferenced it — an access violation at an
# address that was a real pointer with half its bits missing.
user32.GetClipboardData.restype = ctypes.c_void_p
user32.GetClipboardData.argtypes = [wintypes.UINT]
user32.SetClipboardData.restype = ctypes.c_void_p
user32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]
user32.RegisterClipboardFormatW.restype = wintypes.UINT
user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
user32.EnumClipboardFormats.restype = wintypes.UINT
user32.EnumClipboardFormats.argtypes = [wintypes.UINT]

kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
kernel32.GlobalFree.restype = ctypes.c_void_p
kernel32.GlobalFree.argtypes = [ctypes.c_void_p]

CF_TEXT = 1
CF_BITMAP = 2
CF_DIB = 8
CF_UNICODETEXT = 13
CF_HDROP = 15

GMEM_MOVEABLE = 0x0002

# What a password manager registers to say "this is a secret".
#
# These are conventions rather than an API: KeePass, 1Password, Bitwarden and
# the Windows clipboard history all agree on them, and honouring them is how
# Dex avoids reading a password without having to recognise one.
EXCLUSION_FORMATS = (
    'ExcludeClipboardContentFromMonitorProcessing',
    'CanIncludeInClipboardHistory',
    'CanUploadToCloudClipboard',
    'ClipboardViewerIgnore',
    'org.nspasteboard.ConcealedType',
)

# What a credential looks like when nobody has labelled it.
#
# Deliberately about *shape*, and deliberately not clever. Each of these is a
# thing that should never end up in a transcript, and a false positive costs
# the owner one re-read of their own clipboard while a false negative costs
# them a leaked secret.
SECRET_SHAPES = (
    (re.compile(r'^[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}$'), 'a JWT'),
    (re.compile(r'^(sk|pk|rk)-[A-Za-z0-9_\-]{16,}$'), 'an API key'),
    (re.compile(r'^gh[pousr]_[A-Za-z0-9]{16,}$'), 'a GitHub token'),
    (re.compile(r'^AKIA[0-9A-Z]{16}$'), 'an AWS access key'),
    (re.compile(r'^xox[baprs]-[A-Za-z0-9-]{10,}$'), 'a Slack token'),
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----'), 'a private key'),
    (re.compile(r'^[A-Za-z0-9+/]{40,}={0,2}$'), 'a long encoded value'),
)

# A short line with no spaces and a mix of character classes: the shape of a
# generated password. Checked separately because the length bounds matter.
PASSWORD_LIKE = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{10,64}$'
)

MAX_TEXT = 100_000


def _open_clipboard(attempts: int = 10) -> bool:
    """
    Take the clipboard, retrying briefly.

    Only one process may hold it at a time, and on a busy desktop something
    else often has it for a few milliseconds. Failing on the first attempt
    would make this intermittently and inexplicably unavailable.
    """
    for _ in range(attempts):
        if user32.OpenClipboard(None):
            return True
        time.sleep(0.02)
    return False


def _registered(name: str) -> int:
    return user32.RegisterClipboardFormatW(name)


def _formats() -> list:
    """Every format currently on the clipboard, by numeric id."""
    out = []
    current = 0
    while True:
        current = user32.EnumClipboardFormats(current)
        if not current:
            break
        out.append(current)
    return out


def _excluded() -> str | None:
    """The name of the exclusion marker present, if the source set one."""
    present = set(_formats())
    for name in EXCLUSION_FORMATS:
        code = _registered(name)
        if code and code in present:
            return name
    return None


def looks_secret(text: str) -> str | None:
    """
    What kind of secret this looks like, or None.

    Shape only. This never sees a wordlist and never phones anywhere; it is
    the difference between "the clipboard has 47 characters on it" and those
    47 characters appearing in a log, a task record and a model prompt.
    """
    stripped = text.strip()
    if not stripped or len(stripped) > 4096:
        return None

    for pattern, description in SECRET_SHAPES:
        if pattern.search(stripped):
            return description

    if '\n' not in stripped and PASSWORD_LIKE.match(stripped):
        return 'a password'
    return None


def _read_text() -> str | None:
    handle = user32.GetClipboardData(CF_UNICODETEXT)
    if not handle:
        return None
    pointer = kernel32.GlobalLock(handle)
    if not pointer:
        return None
    try:
        return ctypes.wstring_at(pointer)[:MAX_TEXT]
    finally:
        kernel32.GlobalUnlock(handle)


def _read_files() -> list:
    """Paths copied in Explorer. This is what "the files I copied" means."""
    handle = user32.GetClipboardData(CF_HDROP)
    if not handle:
        return []

    shell32.DragQueryFileW.argtypes = [
        ctypes.c_void_p, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT,
    ]
    count = shell32.DragQueryFileW(handle, 0xFFFFFFFF, None, 0)
    out = []
    for index in range(min(count, 500)):
        length = shell32.DragQueryFileW(handle, index, None, 0)
        buffer = ctypes.create_unicode_buffer(length + 1)
        shell32.DragQueryFileW(handle, index, buffer, length + 1)
        out.append(buffer.value)
    return out


def _image_size() -> tuple | None:
    """An image's dimensions, read from the DIB header. The bytes stay put."""
    handle = user32.GetClipboardData(CF_DIB)
    if not handle:
        return None
    pointer = kernel32.GlobalLock(handle)
    if not pointer:
        return None
    try:
        # BITMAPINFOHEADER: biSize, biWidth, biHeight as the first three LONGs.
        header = (ctypes.c_int32 * 3).from_address(pointer)
        return abs(header[1]), abs(header[2])
    finally:
        kernel32.GlobalUnlock(handle)


class ClipboardHandler:

    @staticmethod
    def clipboard_read(params: dict) -> dict:
        """
        What is on the clipboard right now.

        Returns `kind` always, and `text` only when the content is safe to
        repeat. `withheld` says why it was not, so a refusal is a fact the
        owner can act on rather than an empty result that looks like an empty
        clipboard.
        """
        if not _open_clipboard():
            return {'kind': 'unavailable',
                    'reason': 'another program is holding the clipboard'}

        try:
            marker = _excluded()
            formats = _formats()

            if CF_HDROP in formats:
                files = _read_files()
                return {
                    'kind': 'files',
                    'count': len(files),
                    'files': files,
                    'excluded_by_source': marker,
                }

            if CF_UNICODETEXT in formats or CF_TEXT in formats:
                if marker:
                    return {
                        'kind': 'text',
                        'withheld': f'the program that copied it marked it private ({marker})',
                        'characters': None,
                    }

                text = _read_text() or ''
                secret = looks_secret(text)
                if secret and not params.get('allow_secret'):
                    return {
                        'kind': 'text',
                        'characters': len(text),
                        'withheld': f'it looks like {secret}',
                        'hint': 'ask again with allow_secret if this is not a credential',
                    }
                return {
                    'kind': 'text',
                    'characters': len(text),
                    'text': text,
                    'truncated': len(text) >= MAX_TEXT,
                }

            if CF_DIB in formats or CF_BITMAP in formats:
                size = _image_size()
                return {
                    'kind': 'image',
                    'width': size[0] if size else None,
                    'height': size[1] if size else None,
                    'note': 'an image; save it to a file to work with it',
                }

            return {'kind': 'empty', 'formats': len(formats)}
        finally:
            user32.CloseClipboard()

    @staticmethod
    def clipboard_write(params: dict) -> dict:
        """
        Put text on the clipboard.

        Text only. Writing a file list or an image means constructing shell
        structures for a gain nobody has asked for, and the failure modes are
        silent.
        """
        text = params.get('text')
        if not isinstance(text, str):
            raise ValueError('clipboard_write needs text')
        if len(text) > MAX_TEXT:
            raise ValueError(f'clipboard_write is limited to {MAX_TEXT} characters')

        if not _open_clipboard():
            raise RuntimeError('another program is holding the clipboard')

        try:
            user32.EmptyClipboard()
            encoded = text.encode('utf-16-le') + b'\x00\x00'
            handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(encoded))
            if not handle:
                raise RuntimeError('could not allocate clipboard memory')

            pointer = kernel32.GlobalLock(handle)
            if not pointer:
                kernel32.GlobalFree(handle)
                raise RuntimeError('could not lock clipboard memory')
            try:
                ctypes.memmove(pointer, encoded, len(encoded))
            finally:
                kernel32.GlobalUnlock(handle)

            if not user32.SetClipboardData(CF_UNICODETEXT, handle):
                kernel32.GlobalFree(handle)
                raise RuntimeError('the clipboard refused the data')

            # Ownership passes to the clipboard on success; freeing here would
            # hand the next reader a dangling pointer.
            return {'characters': len(text), 'ok': True}
        finally:
            user32.CloseClipboard()
