"""
Talking to a HID device by feature report, through Win32.

There is no HID library in this project and this adds none. `hidapi` would be a
native wheel to install, keep current and rebuild on every Python upgrade, for
what is three calls into `hid.dll` and one into `setupapi.dll`. The display
handler already reaches for ctypes rather than a dependency for exactly this
reason, and this follows it.

Feature reports rather than output reports: vendor control interfaces on
keyboards are almost universally feature reports, and a feature report is
delivered synchronously with a success code, so a failed write is a failed
write rather than a byte quietly dropped into a pipe.

What this deliberately does NOT do is claim the write had an effect. `HidD_SetFeature`
returning true means the device accepted the report — nothing more. Whether the
lights changed is a separate question, and the caller is expected to say so
honestly rather than report the return code as proof.
"""
from __future__ import annotations

import ctypes
import logging
from ctypes import wintypes

log = logging.getLogger('HidRaw')

# ---------------------------------------------------------------------------
# Win32
# ---------------------------------------------------------------------------

setupapi = ctypes.WinDLL('setupapi')
hid = ctypes.WinDLL('hid')
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

DIGCF_PRESENT = 0x02
DIGCF_DEVICEINTERFACE = 0x10

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_READ = 0x01
FILE_SHARE_WRITE = 0x02
OPEN_EXISTING = 3
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class GUID(ctypes.Structure):
    _fields_ = [
        ('Data1', ctypes.c_ulong),
        ('Data2', ctypes.c_ushort),
        ('Data3', ctypes.c_ushort),
        ('Data4', ctypes.c_ubyte * 8),
    ]


class SP_DEVICE_INTERFACE_DATA(ctypes.Structure):
    _fields_ = [
        ('cbSize', wintypes.DWORD),
        ('InterfaceClassGuid', GUID),
        ('Flags', wintypes.DWORD),
        ('Reserved', ctypes.POINTER(ctypes.c_ulong)),
    ]


class SP_DEVICE_INTERFACE_DETAIL_DATA_W(ctypes.Structure):
    # DevicePath is variable length; the struct is only ever used through a
    # buffer sized by the first, failing call to the same API.
    _fields_ = [('cbSize', wintypes.DWORD), ('DevicePath', ctypes.c_wchar * 1)]


class HIDD_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ('Size', ctypes.c_ulong),
        ('VendorID', ctypes.c_ushort),
        ('ProductID', ctypes.c_ushort),
        ('VersionNumber', ctypes.c_ushort),
    ]


class HIDP_CAPS(ctypes.Structure):
    _fields_ = [
        ('Usage', ctypes.c_ushort),
        ('UsagePage', ctypes.c_ushort),
        ('InputReportByteLength', ctypes.c_ushort),
        ('OutputReportByteLength', ctypes.c_ushort),
        ('FeatureReportByteLength', ctypes.c_ushort),
        ('Reserved', ctypes.c_ushort * 17),
        ('NumberLinkCollectionNodes', ctypes.c_ushort),
        ('NumberInputButtonCaps', ctypes.c_ushort),
        ('NumberInputValueCaps', ctypes.c_ushort),
        ('NumberInputDataIndices', ctypes.c_ushort),
        ('NumberOutputButtonCaps', ctypes.c_ushort),
        ('NumberOutputValueCaps', ctypes.c_ushort),
        ('NumberOutputDataIndices', ctypes.c_ushort),
        ('NumberFeatureButtonCaps', ctypes.c_ushort),
        ('NumberFeatureValueCaps', ctypes.c_ushort),
        ('NumberFeatureDataIndices', ctypes.c_ushort),
    ]


setupapi.SetupDiGetClassDevsW.restype = ctypes.c_void_p
kernel32.CreateFileW.restype = ctypes.c_void_p


class HidDevice:
    """One open HID collection. Use as a context manager."""

    def __init__(self, path: str, caps: HIDP_CAPS) -> None:
        self.path = path
        self.usage_page = caps.UsagePage
        self.usage = caps.Usage
        self.feature_length = caps.FeatureReportByteLength
        self._handle = None

    def __enter__(self) -> 'HidDevice':
        self._handle = kernel32.CreateFileW(
            self.path,
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            0,
            None,
        )
        if not self._handle or self._handle == INVALID_HANDLE_VALUE:
            raise OSError(
                f'Could not open {self.path}: error {ctypes.get_last_error()}. '
                'Another program may hold the device exclusively.'
            )
        return self

    def __exit__(self, *_exc) -> None:
        if self._handle and self._handle != INVALID_HANDLE_VALUE:
            kernel32.CloseHandle(ctypes.c_void_p(self._handle))
        self._handle = None

    def set_feature(self, report: bytes) -> bool:
        """
        Send one feature report.

        Padded to the collection's own FeatureReportByteLength: HID is a
        fixed-length protocol and a short buffer is rejected outright, which
        looks like "the device refused the command" when it is really "the
        buffer was the wrong size".
        """
        size = max(self.feature_length, len(report))
        buffer = ctypes.create_string_buffer(bytes(report).ljust(size, b'\x00'), size)
        return bool(hid.HidD_SetFeature(ctypes.c_void_p(self._handle), buffer, size))


def find_devices(vendor_id: int, product_id: int) -> list[HidDevice]:
    """
    Every HID collection belonging to one device.

    A keyboard like the ROG Aura presents seven of these — a keyboard
    collection, a consumer-control collection, several vendor-defined ones —
    and only one of them accepts the lighting reports. They are returned in
    enumeration order and the caller picks by usage page, which is the only
    thing that distinguishes them.
    """
    guid = GUID()
    hid.HidD_GetHidGuid(ctypes.byref(guid))

    handle = setupapi.SetupDiGetClassDevsW(
        ctypes.byref(guid), None, None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
    )
    if not handle or handle == INVALID_HANDLE_VALUE:
        return []

    found: list[HidDevice] = []
    try:
        index = 0
        while True:
            interface = SP_DEVICE_INTERFACE_DATA()
            interface.cbSize = ctypes.sizeof(SP_DEVICE_INTERFACE_DATA)
            if not setupapi.SetupDiEnumDeviceInterfaces(
                ctypes.c_void_p(handle), None, ctypes.byref(guid), index,
                ctypes.byref(interface),
            ):
                break
            index += 1

            # Sized by asking, then asked again — the documented two-call form.
            needed = wintypes.DWORD()
            setupapi.SetupDiGetDeviceInterfaceDetailW(
                ctypes.c_void_p(handle), ctypes.byref(interface), None, 0,
                ctypes.byref(needed), None,
            )
            if not needed.value:
                continue

            buffer = ctypes.create_string_buffer(needed.value)
            detail = ctypes.cast(
                buffer, ctypes.POINTER(SP_DEVICE_INTERFACE_DETAIL_DATA_W),
            )
            # 8 on x64: DWORD plus the alignment before the wchar array.
            detail.contents.cbSize = 8
            if not setupapi.SetupDiGetDeviceInterfaceDetailW(
                ctypes.c_void_p(handle), ctypes.byref(interface), detail,
                needed.value, None, None,
            ):
                continue

            path = ctypes.wstring_at(ctypes.addressof(buffer) + 4)
            device = _describe(path, vendor_id, product_id)
            if device is not None:
                found.append(device)
    finally:
        setupapi.SetupDiDestroyDeviceInfoList(ctypes.c_void_p(handle))

    return found


def _describe(path: str, vendor_id: int, product_id: int) -> HidDevice | None:
    """Open just far enough to read the ids and capabilities, then close."""
    handle = kernel32.CreateFileW(
        path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, 0, None,
    )
    if not handle or handle == INVALID_HANDLE_VALUE:
        return None
    try:
        attributes = HIDD_ATTRIBUTES()
        attributes.Size = ctypes.sizeof(HIDD_ATTRIBUTES)
        if not hid.HidD_GetAttributes(ctypes.c_void_p(handle), ctypes.byref(attributes)):
            return None
        if attributes.VendorID != vendor_id or attributes.ProductID != product_id:
            return None

        preparsed = ctypes.c_void_p()
        if not hid.HidD_GetPreparsedData(
            ctypes.c_void_p(handle), ctypes.byref(preparsed),
        ):
            return None
        try:
            caps = HIDP_CAPS()
            hid.HidP_GetCaps(preparsed, ctypes.byref(caps))
        finally:
            hid.HidD_FreePreparsedData(preparsed)

        return HidDevice(path, caps)
    finally:
        kernel32.CloseHandle(ctypes.c_void_p(handle))
