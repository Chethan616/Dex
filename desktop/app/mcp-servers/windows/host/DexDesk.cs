// DEX's Windows helper: drives apps through UI Automation patterns on
// windows that stay in the background, so the user keeps their mouse,
// keyboard and focus (docs/desktop-control/PLAN.md §0).
//
// Compiled once by host.ps1 with Add-Type, which means Windows PowerShell
// 5.1's C# 5 compiler: no string interpolation, no `?.`, no `out var`.
//
// Every UIA client here is created with AutoSetFocus = FALSE. With UIA's
// default, a pattern call makes the target window the foreground window —
// a real focus steal, measured on a real PC (RESEARCH §1.1).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Interop.UIAutomationClient;
using P = Interop.UIAutomationClient.UIA_PropertyIds;
using Pat = Interop.UIAutomationClient.UIA_PatternIds;

public class DexDeskError : Exception {
  public readonly string Code;
  public readonly string Hint;
  public readonly object Extra;
  public DexDeskError(string code, string message, string hint, object extra) : base(message) { Code = code; Hint = hint; Extra = extra; }
  public DexDeskError(string code, string message) : this(code, message, null, null) { }
}

public static class DexDesk {
  public const string Version = "1";

  // ── Win32 ──────────────────────────────────────────────────────────────
  delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)] struct WINDOWPLACEMENT { public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHELLEXECUTEINFO {
    public int cbSize; public uint fMask; public IntPtr hwnd; public string lpVerb; public string lpFile; public string lpParameters;
    public string lpDirectory; public int nShow; public IntPtr hInstApp; public IntPtr lpIDList; public string lpClass; public IntPtr hkeyClass;
    public uint dwHotKey; public IntPtr hIcon; public IntPtr hProcess;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct TOUCHPAD_PARAMETERS {
    public uint versionNumber, maxSupportedContacts; public int legacyTouchpadFeatures; public uint flags1, flags2;
    public int sensitivityLevel; public uint cursorSpeed, feedbackIntensity, clickForceSensitivity, rightClickZoneWidth, rightClickZoneHeight;
  }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, ref TOUCHPAD_PARAMETERS p, uint winIni);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int size);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ShellExecuteEx(ref SHELLEXECUTEINFO info);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int retLen);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);

  const int SW_SHOWMINNOACTIVE = 7, SW_SHOWNOACTIVATE = 4, SW_MINIMIZE = 6;
  const uint WM_CLOSE = 0x0010, WM_SETTEXT = 0x000C, WM_GETTEXT = 0x000D;
  const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80;
  const uint GW_OWNER = 4;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x0008;

  // ── State ──────────────────────────────────────────────────────────────
  static IUIAutomation2 uia2;
  static IUIAutomation uia;
  static IUIAutomationCacheRequest cache;
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 256 };
  static readonly object outLock = new object();
  /** Ops and the window watcher both touch the parked/launch tables. */
  static readonly object stateLock = new object();
  static string dexExe = "";
  static string home = "";
  static int nextHandle = 1;
  static int nextLaunch = 1;
  static bool selfElevated;

  class Node {
    public string H; public IUIAutomationElement El; public int[] Box; public string Name; public string Role;
  }
  class WinMap {
    public readonly Dictionary<string, string> ById = new Dictionary<string, string>();
    public readonly Dictionary<string, Node> ByHandle = new Dictionary<string, Node>();
    /** The handles the last window_tree showed: what a capture annotates. */
    public List<string> LastTree = new List<string>();
  }
  static readonly Dictionary<long, WinMap> maps = new Dictionary<long, WinMap>();
  /** Windows DEX opened, and parked off-screen: hwnd → launch id. */
  static readonly Dictionary<long, string> parked = new Dictionary<long, string>();
  static readonly Dictionary<string, long> launches = new Dictionary<string, long>();
  /** Windows the user took (brought to the front themselves). DEX leaves them alone. */
  static readonly HashSet<long> takenOver = new HashSet<long>();
  static Timer watcher;
  static uint watchedInput;

  public static void Init(string dexExePath, string homeDir) {
    dexExe = dexExePath ?? "";
    home = homeDir ?? "";
    uia2 = (IUIAutomation2)new CUIAutomation8Class();
    uia2.AutoSetFocus = 0;                    // required: see the top of this file
    uia2.ConnectionTimeout = 2000;
    uia2.TransactionTimeout = 5000;
    uia = uia2;
    cache = uia.CreateCacheRequest();
    foreach (int id in new[] {
      P.UIA_NamePropertyId, P.UIA_ControlTypePropertyId, P.UIA_AutomationIdPropertyId, P.UIA_BoundingRectanglePropertyId,
      P.UIA_IsEnabledPropertyId, P.UIA_IsOffscreenPropertyId, P.UIA_IsPasswordPropertyId, P.UIA_RuntimeIdPropertyId,
      P.UIA_NativeWindowHandlePropertyId, P.UIA_ClassNamePropertyId,
      P.UIA_IsInvokePatternAvailablePropertyId, P.UIA_IsValuePatternAvailablePropertyId, P.UIA_IsTogglePatternAvailablePropertyId,
      P.UIA_IsSelectionItemPatternAvailablePropertyId, P.UIA_IsExpandCollapsePatternAvailablePropertyId,
      P.UIA_IsScrollPatternAvailablePropertyId, P.UIA_IsWindowPatternAvailablePropertyId, P.UIA_IsRangeValuePatternAvailablePropertyId,
      P.UIA_ValueValuePropertyId, P.UIA_ValueIsReadOnlyPropertyId, P.UIA_ToggleToggleStatePropertyId,
      P.UIA_ExpandCollapseExpandCollapseStatePropertyId, P.UIA_SelectionItemIsSelectedPropertyId,
    }) cache.AddProperty(id);
    cache.TreeScope = TreeScope.TreeScope_Element;
    selfElevated = IsElevated((uint)Process.GetCurrentProcess().Id);
    watcher = new Timer(Watch, null, 2000, 2000);
  }

  /** One line of JSON to stdout, from the request loop or the watcher alike. */
  public static void Emit(string line) {
    lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
  }

  // ── Request entry ──────────────────────────────────────────────────────
  static readonly HashSet<string> Mutating = new HashSet<string> { "invoke", "set_text", "toggle", "select", "expand", "scroll", "launch", "window" };

  static readonly HashSet<string> Ops = new HashSet<string> {
    "hello", "windows", "tree", "find", "invoke", "set_text", "toggle", "select", "expand", "scroll", "wait", "capture", "launch", "window", "touchpad", "resolve",
  };

  /**
   * One request line, `{"id":7,"op":"tree","args":{…}}` → one response line,
   * or null when the op is one host.ps1 answers itself (media, system info).
   */
  public static string Handle(string line) {
    Dictionary<string, object> req;
    try { req = Json.DeserializeObject(line) as Dictionary<string, object>; } catch { req = null; }
    if (req == null) return Json.Serialize(new Dictionary<string, object> { { "id", null }, { "ok", false }, { "error", "bad_json" }, { "message", "Not a JSON request." } });
    string op = Str(req, "op") ?? "";
    if (!Ops.Contains(op)) return null;
    var body = Run(op, Obj(req, "args") ?? new Dictionary<string, object>());
    object id; req.TryGetValue("id", out id);
    body["id"] = id;
    return Json.Serialize(body);
  }

  /** Run one op; always returns a JSON response body (never throws). */
  public static string Call(string op, string argsJson) {
    var args = string.IsNullOrEmpty(argsJson) ? new Dictionary<string, object>() : (Json.DeserializeObject(argsJson) as Dictionary<string, object>) ?? new Dictionary<string, object>();
    return Json.Serialize(Run(op, args));
  }

  static Dictionary<string, object> Run(string op, Dictionary<string, object> args) {
    // Physical pixels everywhere: UIA reports them, and a DPI-unaware thread
    // would get scaled window rects that don't line up with them.
    SetThreadDpiAwarenessContext(PerMonitorAwareV2);
    lock (stateLock) return RunLocked(op, args);
  }

  static Dictionary<string, object> RunLocked(string op, Dictionary<string, object> args) {
    var res = new Dictionary<string, object>();
    Snapshot before = Mutating.Contains(op) ? Snap() : null;
    try {
      res["ok"] = true;
      res["result"] = Dispatch(op, args);
    } catch (DexDeskError e) {
      res["ok"] = false; res["error"] = e.Code; res["message"] = e.Message;
      if (e.Hint != null) res["hint"] = e.Hint;
      if (e.Extra != null) res["extra"] = e.Extra;
    } catch (COMException e) {
      res["ok"] = false;
      uint hr = (uint)e.HResult;
      if (hr == 0x80040201) { res["error"] = "stale_ref"; res["message"] = "That element is gone."; res["hint"] = "Call window_tree or window_find again."; }
      else if (hr == 0x80131505) { res["error"] = "provider_timeout"; res["message"] = "The app didn't answer in time."; res["hint"] = "It may be busy. Wait a moment and try again."; }
      else { res["error"] = "uia_error"; res["message"] = e.Message; }
    } catch (Exception e) {
      res["ok"] = false; res["error"] = "host_error"; res["message"] = e.GetType().Name + ": " + e.Message;
    }
    if (before != null) {
      Thread.Sleep(150);                       // Invoke returns before the app acts
      var incident = Incident(before, Snap());
      if (incident != null) res["focus"] = new Dictionary<string, object> { { "incident", incident } };
    }
    return res;
  }

  static object Dispatch(string op, Dictionary<string, object> a) {
    switch (op) {
      case "hello": return Hello();
      case "windows": return ListWindows(Bool(a, "includeMinimized", false));
      case "tree": return Tree(a);
      case "find": return Find(a);
      case "invoke": return Invoke(a);
      case "set_text": return SetText(a);
      case "toggle": return Toggle(a);
      case "select": return Select(a);
      case "expand": return Expand(a);
      case "scroll": return Scroll(a);
      case "wait": return Wait(a);
      case "capture": return Capture(a);
      case "launch": return Launch(a);
      case "window": return WindowAction(a);
      case "touchpad": return Touchpad();
      case "resolve": {
        var w = Resolve(a);
        return new Dictionary<string, object> {
          { "hwnd", w.H.ToInt64() }, { "title", w.Title }, { "process", w.Process }, { "className", w.Class },
          { "openedByDex", parked.ContainsKey(w.H.ToInt64()) || launches.ContainsValue(w.H.ToInt64()) },
          { "takenOver", takenOver.Contains(w.H.ToInt64()) },
        };
      }
      default: throw new DexDeskError("unknown_op", "Unknown op: " + op);
    }
  }

  // ── Args ───────────────────────────────────────────────────────────────
  static string Str(Dictionary<string, object> a, string k) { object v; return a.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null; }
  static int Int(Dictionary<string, object> a, string k, int d) { object v; return a.TryGetValue(k, out v) && v != null ? Convert.ToInt32(v) : d; }
  static bool Bool(Dictionary<string, object> a, string k, bool d) { object v; return a.TryGetValue(k, out v) && v is bool ? (bool)v : d; }
  static Dictionary<string, object> Obj(Dictionary<string, object> a, string k) { object v; return a.TryGetValue(k, out v) ? v as Dictionary<string, object> : null; }

  // ── Focus sentinel ─────────────────────────────────────────────────────
  class Snapshot { public IntPtr Fg; public POINT Cursor; public uint Input; }
  static Snapshot Snap() {
    var s = new Snapshot { Fg = GetForegroundWindow() };
    GetCursorPos(out s.Cursor);
    var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
    GetLastInputInfo(ref li);
    s.Input = li.dwTime;
    return s;
  }
  /** Something moved that the user didn't move: DEX did it. */
  static object Incident(Snapshot b, Snapshot a) {
    if (a.Input != b.Input) return null;     // the user was busy too: theirs
    if (a.Fg != b.Fg) {
      var w = Describe(a.Fg);
      return new Dictionary<string, object> { { "kind", "foreground" }, { "to", w } };
    }
    if (a.Cursor.X != b.Cursor.X || a.Cursor.Y != b.Cursor.Y) return new Dictionary<string, object> { { "kind", "cursor" } };
    return null;
  }

  // ── Processes ──────────────────────────────────────────────────────────
  static string ImagePath(uint pid) {
    IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      var sb = new StringBuilder(1024); int size = sb.Capacity;
      return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : null;
    } finally { CloseHandle(h); }
  }
  static bool IsElevated(uint pid) {
    IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (h == IntPtr.Zero) return true;        // can't even look: treat as above us
    try {
      IntPtr tok;
      if (!OpenProcessToken(h, TOKEN_QUERY, out tok)) return true;
      try { int elevated, len; return GetTokenInformation(tok, 20 /* TokenElevation */, out elevated, 4, out len) && elevated != 0; }
      finally { CloseHandle(tok); }
    } finally { CloseHandle(h); }
  }

  // ── Windows ────────────────────────────────────────────────────────────
  class Win { public IntPtr H; public string Title; public string Process; public string Path; public uint Pid; public string Class; public bool Minimized; public bool Cloaked; public int[] Bounds; }

  static Win Info(IntPtr h) {
    var w = new Win { H = h };
    int len = GetWindowTextLength(h);
    var sb = new StringBuilder(Math.Max(len + 1, 2)); GetWindowText(h, sb, sb.Capacity); w.Title = sb.ToString();
    var cls = new StringBuilder(256); GetClassName(h, cls, 256); w.Class = cls.ToString();
    GetWindowThreadProcessId(h, out w.Pid);
    w.Path = ImagePath(w.Pid);
    w.Process = w.Path != null ? System.IO.Path.GetFileName(w.Path) : null;
    if (w.Process == null) { try { w.Process = Process.GetProcessById((int)w.Pid).ProcessName + ".exe"; } catch { w.Process = "?"; } }
    w.Minimized = IsIconic(h);
    int cloaked; w.Cloaked = DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0;
    RECT r;
    if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    w.Bounds = new[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    return w;
  }

  static bool IsDex(Win w) {
    return !string.IsNullOrEmpty(dexExe) && w.Path != null && string.Equals(w.Path, dexExe, StringComparison.OrdinalIgnoreCase);
  }

  static Dictionary<string, object> Describe(IntPtr h) {
    if (h == IntPtr.Zero || !IsWindow(h)) return null;
    var w = Info(h);
    return new Dictionary<string, object> { { "hwnd", h.ToInt64() }, { "title", IsDex(w) ? "DEX" : w.Title }, { "process", w.Process } };
  }

  static List<Win> TopWindows(bool includeMinimized) {
    var list = new List<Win>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if (GetWindowTextLength(h) == 0) return true;
      if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
      var w = Info(h);
      if (w.Cloaked && !includeMinimized) return true;
      if (w.Minimized && !includeMinimized) return true;
      list.Add(w);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static object ListWindows(bool includeMinimized) {
    var fg = GetForegroundWindow();
    var vx = GetSystemMetrics(76); var vy = GetSystemMetrics(77); var vw = GetSystemMetrics(78); var vh = GetSystemMetrics(79);
    var outList = new List<object>();
    foreach (var w in TopWindows(includeMinimized)) {
      bool dex = IsDex(w);
      bool onScreen = w.Bounds[0] + w.Bounds[2] > vx && w.Bounds[0] < vx + vw && w.Bounds[1] + w.Bounds[3] > vy && w.Bounds[1] < vy + vh && !w.Minimized;
      outList.Add(new Dictionary<string, object> {
        { "hwnd", w.H.ToInt64() }, { "title", dex ? "DEX" : w.Title }, { "process", w.Process }, { "pid", w.Pid },
        { "className", w.Class }, { "foreground", w.H == fg }, { "minimized", w.Minimized }, { "cloaked", w.Cloaked },
        { "onScreen", onScreen }, { "bounds", w.Bounds }, { "openedByDex", parked.ContainsKey(w.H.ToInt64()) },
        { "elevated", !selfElevated && IsElevated(w.Pid) }, { "dex", dex },
      });
    }
    return new Dictionary<string, object> { { "windows", outList } };
  }

  /** A window selector → exactly one window DEX may touch, or a clear error. */
  static Win Resolve(Dictionary<string, object> a) {
    var sel = Obj(a, "window") ?? a;
    IntPtr h = IntPtr.Zero;
    string opened = Str(sel, "opened");
    if (sel.ContainsKey("hwnd")) h = new IntPtr(Convert.ToInt64(sel["hwnd"]));
    else if (opened != null) {
      long hw;
      if (!launches.TryGetValue(opened, out hw)) throw new DexDeskError("bad_window", "No window was opened as " + opened + ".");
      h = new IntPtr(hw);
    } else {
      string proc = Str(sel, "process"), title = Str(sel, "title"), match = Str(sel, "match") ?? "exact";
      if (proc == null && title == null) throw new DexDeskError("bad_window", "Name a window: {hwnd}, {process}, {title} or {opened}.");
      if (proc != null && !proc.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) proc += ".exe";
      var found = new List<Win>();
      foreach (var w in TopWindows(true)) {
        if (proc != null && !string.Equals(w.Process, proc, StringComparison.OrdinalIgnoreCase)) continue;
        if (title != null) {
          bool ok = match == "contains" ? w.Title.IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0 : string.Equals(w.Title, title, StringComparison.OrdinalIgnoreCase);
          if (!ok) continue;
        }
        found.Add(w);
      }
      if (found.Count == 0) throw new DexDeskError("no_window", "No such window is open.", "Call windows_list to see what's open, or app_launch it.", null);
      if (found.Count > 1) {
        var cands = new List<object>();
        foreach (var w in found) cands.Add(new Dictionary<string, object> { { "hwnd", w.H.ToInt64() }, { "title", IsDex(w) ? "DEX" : w.Title }, { "process", w.Process } });
        throw new DexDeskError("ambiguous_window", "More than one window matches.", "Pick one by hwnd.", new Dictionary<string, object> { { "candidates", cands } });
      }
      h = found[0].H;
    }
    if (!IsWindow(h)) throw new DexDeskError("no_window", "That window is closed.", "Call windows_list again.", null);
    var info = Info(h);
    if (IsDex(info)) throw new DexDeskError("refused", "DEX doesn't use its own windows.");
    if (!selfElevated && IsElevated(info.Pid)) throw new DexDeskError("elevated_window", "That window runs as administrator, which DEX's helper can't reach from here.", "Ask the user, or use the admin route when it's set up.", null);
    return info;
  }

  // ── Elements ───────────────────────────────────────────────────────────
  static readonly Dictionary<int, string> Roles = new Dictionary<int, string> {
    {50000,"Button"},{50001,"Calendar"},{50002,"CheckBox"},{50003,"ComboBox"},{50004,"Edit"},{50005,"Hyperlink"},{50006,"Image"},
    {50007,"ListItem"},{50008,"List"},{50009,"Menu"},{50010,"MenuBar"},{50011,"MenuItem"},{50012,"ProgressBar"},{50013,"RadioButton"},
    {50014,"ScrollBar"},{50015,"Slider"},{50016,"Spinner"},{50017,"StatusBar"},{50018,"Tab"},{50019,"TabItem"},{50020,"Text"},
    {50021,"ToolBar"},{50022,"ToolTip"},{50023,"Tree"},{50024,"TreeItem"},{50025,"Custom"},{50026,"Group"},{50027,"Thumb"},
    {50028,"DataGrid"},{50029,"DataItem"},{50030,"Document"},{50031,"SplitButton"},{50032,"Window"},{50033,"Pane"},{50034,"Header"},
    {50035,"HeaderItem"},{50036,"Table"},{50037,"TitleBar"},{50038,"Separator"},{50039,"SemanticZoom"},{50040,"AppBar"},
  };

  static WinMap MapFor(IntPtr h) {
    WinMap m;
    if (!maps.TryGetValue(h.ToInt64(), out m)) { m = new WinMap(); maps[h.ToInt64()] = m; }
    if (m.ByHandle.Count > 6000) { m.ByHandle.Clear(); m.ById.Clear(); }
    return m;
  }

  static object Cached(IUIAutomationElement el, int id) { try { return el.GetCachedPropertyValue(id); } catch { return null; } }
  static bool CachedBool(IUIAutomationElement el, int id) { var v = Cached(el, id); return v is bool && (bool)v; }

  static string HandleFor(WinMap m, IUIAutomationElement el) {
    var rid = Cached(el, P.UIA_RuntimeIdPropertyId) as int[];
    string key = rid != null ? string.Join(".", Array.ConvertAll(rid, x => x.ToString())) : null;
    string h;
    if (key != null && m.ById.TryGetValue(key, out h)) return h;
    h = "e" + (nextHandle++);
    if (key != null) m.ById[key] = h;
    return h;
  }

  static Dictionary<string, object> Describe(IUIAutomationElement el, WinMap m, Win w, int depth, out Node node) {
    string h = HandleFor(m, el);
    int ct = Convert.ToInt32(Cached(el, P.UIA_ControlTypePropertyId) ?? 0);
    string role; if (!Roles.TryGetValue(ct, out role)) role = "Custom";
    string name = Convert.ToString(Cached(el, P.UIA_NamePropertyId) ?? "");
    string id = Convert.ToString(Cached(el, P.UIA_AutomationIdPropertyId) ?? "");
    var rect = Cached(el, P.UIA_BoundingRectanglePropertyId) as double[];
    int[] box = rect != null && rect.Length == 4
      ? new[] { (int)rect[0] - w.Bounds[0], (int)rect[1] - w.Bounds[1], (int)rect[2], (int)rect[3] }
      : new[] { 0, 0, 0, 0 };
    bool password = CachedBool(el, P.UIA_IsPasswordPropertyId);
    var pats = new List<string>();
    if (CachedBool(el, P.UIA_IsInvokePatternAvailablePropertyId)) pats.Add("invoke");
    if (CachedBool(el, P.UIA_IsValuePatternAvailablePropertyId)) pats.Add("value");
    if (CachedBool(el, P.UIA_IsTogglePatternAvailablePropertyId)) pats.Add("toggle");
    if (CachedBool(el, P.UIA_IsSelectionItemPatternAvailablePropertyId)) pats.Add("select");
    if (CachedBool(el, P.UIA_IsExpandCollapsePatternAvailablePropertyId)) pats.Add("expand");
    if (CachedBool(el, P.UIA_IsScrollPatternAvailablePropertyId)) pats.Add("scroll");
    if (CachedBool(el, P.UIA_IsRangeValuePatternAvailablePropertyId)) pats.Add("range");
    var st = new List<string>();
    if (!CachedBool(el, P.UIA_IsEnabledPropertyId)) st.Add("disabled");
    if (CachedBool(el, P.UIA_IsOffscreenPropertyId)) st.Add("offscreen");
    if (password) st.Add("password");
    if (pats.Contains("toggle")) { var ts = Cached(el, P.UIA_ToggleToggleStatePropertyId); if (ts != null) st.Add(Convert.ToInt32(ts) == 1 ? "on" : Convert.ToInt32(ts) == 0 ? "off" : "mixed"); }
    if (pats.Contains("expand")) { var es = Cached(el, P.UIA_ExpandCollapseExpandCollapseStatePropertyId); if (es != null) st.Add(Convert.ToInt32(es) == 1 ? "expanded" : Convert.ToInt32(es) == 0 ? "collapsed" : "partial"); }
    if (pats.Contains("select") && CachedBool(el, P.UIA_SelectionItemIsSelectedPropertyId)) st.Add("selected");
    var d = new Dictionary<string, object> { { "h", h }, { "role", role } };
    if (name.Length > 0) d["name"] = name.Length > 200 ? name.Substring(0, 200) + "…" : name;
    if (id.Length > 0) d["id"] = id;
    if (pats.Contains("value")) {
      if (password) d["value"] = "•••";       // never read a password back
      else { var v = Convert.ToString(Cached(el, P.UIA_ValueValuePropertyId) ?? ""); if (v.Length > 0) d["value"] = v.Length > 200 ? v.Substring(0, 200) + "…" : v; }
    }
    if (pats.Count > 0) d["pat"] = pats;
    if (st.Count > 0) d["st"] = st;
    d["box"] = box;
    d["depth"] = depth;
    node = new Node { H = h, El = el, Box = box, Name = name, Role = role };
    m.ByHandle[h] = node;
    return d;
  }

  static bool Actionable(Dictionary<string, object> d) {
    return d.ContainsKey("pat") || d.ContainsKey("name") || d.ContainsKey("value");
  }

  /** Walk the control view to `maxDepth`, keeping up to `max` nodes. */
  static List<Dictionary<string, object>> Walk(Win w, IUIAutomationElement root, int maxDepth, int max, bool all, out bool truncated) {
    var m = MapFor(w.H);
    var walker = uia.ControlViewWalker;
    var nodes = new List<Dictionary<string, object>>();
    bool cut = false;
    Action<IUIAutomationElement, int> visit = null;
    visit = (parent, depth) => {
      if (cut || depth > maxDepth) return;
      IUIAutomationElement child = null;
      try { child = walker.GetFirstChildElementBuildCache(parent, cache); } catch (COMException) { return; }
      while (child != null && !cut) {
        Node node;
        var d = Describe(child, m, w, depth, out node);
        if (all || Actionable(d)) {
          nodes.Add(d);
          if (nodes.Count >= max) { cut = true; break; }
        }
        visit(child, depth + 1);
        try { child = walker.GetNextSiblingElementBuildCache(child, cache); } catch (COMException) { break; }
      }
    };
    visit(root, 1);
    truncated = cut;
    return nodes;
  }

  static IUIAutomationElement Root(Win w) { return uia.ElementFromHandleBuildCache(w.H, cache); }

  static object Tree(Dictionary<string, object> a) {
    var w = Resolve(a);
    var root = Root(w);
    string rootHandle = Str(a, "root");
    if (rootHandle != null) root = Element(w, rootHandle).El;
    int depth = Math.Max(1, Math.Min(12, Int(a, "depth", 6)));
    int max = Math.Max(1, Math.Min(600, Int(a, "max", 250)));
    bool truncated;
    var nodes = Walk(w, root, depth, max, Str(a, "mode") == "all", out truncated);
    var last = new List<string>(); foreach (var d in nodes) last.Add((string)d["h"]);
    MapFor(w.H).LastTree = last;
    return new Dictionary<string, object> {
      { "window", new Dictionary<string, object> { { "hwnd", w.H.ToInt64() }, { "title", w.Title }, { "process", w.Process } } },
      { "nodes", nodes }, { "truncated", truncated },
    };
  }

  // Accelerators and shortcut hints aren't part of what a person calls it.
  static string Clean(string s) {
    if (s == null) return "";
    s = s.Replace("&", "");
    s = Regex.Replace(s, @"\s*\((?:Ctrl|Alt|Shift|Win)\+[^)]*\)\s*$", "", RegexOptions.IgnoreCase);
    return Regex.Replace(s, @"\s+", " ").Trim().ToLowerInvariant();
  }

  /** The locator ladder: automation id, then exact name, prefix, whole word; a role that matches nothing enabled is dropped. */
  static List<Dictionary<string, object>> Match(List<Dictionary<string, object>> nodes, string name, string role, string id, string mode) {
    Func<Dictionary<string, object>, bool> enabled = d => !(d.ContainsKey("st") && ((List<string>)d["st"]).Contains("disabled"));
    Func<Dictionary<string, object>, string, bool> roleOk = (d, r) => r == null || string.Equals((string)d["role"], r, StringComparison.OrdinalIgnoreCase);
    if (id != null) {
      var byId = nodes.FindAll(d => d.ContainsKey("id") && string.Equals((string)d["id"], id, StringComparison.Ordinal) && roleOk(d, role));
      if (byId.Count > 0 || name == null) return byId;
    }
    if (name == null) return role != null ? nodes.FindAll(d => roleOk(d, role)) : new List<Dictionary<string, object>>();
    string want = Clean(name);
    Func<Dictionary<string, object>, string> nm = d => d.ContainsKey("name") ? Clean((string)d["name"]) : "";
    var tiers = new List<Func<string, bool>>();
    tiers.Add(n => n == want);
    if (mode != "exact") {
      tiers.Add(n => n.StartsWith(want, StringComparison.Ordinal));
      tiers.Add(n => Regex.IsMatch(n, @"(^|\W)" + Regex.Escape(want) + @"($|\W)"));
      if (mode == "contains") tiers.Add(n => n.Contains(want));
    }
    foreach (var r in role != null ? new[] { role, null } : new string[] { null }) {
      foreach (var tier in tiers) {
        var hits = nodes.FindAll(d => roleOk(d, r) && tier(nm(d)));
        var live = hits.FindAll(d => enabled(d));
        if (live.Count > 0) return live;
        if (hits.Count > 0 && r == null) return hits;
      }
    }
    return new List<Dictionary<string, object>>();
  }

  static object Find(Dictionary<string, object> a) {
    var w = Resolve(a);
    bool truncated;
    var nodes = Walk(w, Root(w), 12, 3000, false, out truncated);
    var hits = Match(nodes, Str(a, "name"), Str(a, "role"), Str(a, "automationId"), Str(a, "match") ?? "prefix");
    int limit = Math.Max(1, Math.Min(20, Int(a, "limit", 10)));
    var res = new Dictionary<string, object> { { "matches", hits.Count > limit ? hits.GetRange(0, limit) : hits } };
    if (hits.Count == 0) {
      var near = new List<string>();
      foreach (var d in nodes) if (d.ContainsKey("name") && d.ContainsKey("pat") && near.Count < 15) near.Add((string)d["name"]);
      res["near"] = near;
    }
    return res;
  }

  /** A target: a handle from a tree, or a locator resolved on the spot. */
  static Node Element(Win w, string handle) {
    Node n;
    if (!MapFor(w.H).ByHandle.TryGetValue(handle, out n)) throw new DexDeskError("stale_ref", "Unknown element " + handle + ".", "Call window_tree or window_find again.", null);
    return n;
  }
  static Node Target(Win w, Dictionary<string, object> a) {
    object t; a.TryGetValue("target", out t);
    if (t is string) return Element(w, (string)t);
    var loc = t as Dictionary<string, object>;
    if (loc == null) throw new DexDeskError("bad_target", "Give a target: an element handle like \"e17\", or {name, role?, automationId?}.");
    bool truncated;
    var nodes = Walk(w, Root(w), 12, 3000, false, out truncated);
    var hits = Match(nodes, Str(loc, "name"), Str(loc, "role"), Str(loc, "automationId"), "prefix");
    if (hits.Count == 0) throw new DexDeskError("not_found", "Nothing called that in this window.", "Call window_find or window_tree to see what's there.", null);
    if (hits.Count > 1) {
      var c = new List<object>(); foreach (var d in hits) if (c.Count < 8) c.Add(d);
      throw new DexDeskError("ambiguous_element", "More than one element matches.", "Pick one by its handle.", new Dictionary<string, object> { { "candidates", c } });
    }
    return Element(w, (string)hits[0]["h"]);
  }

  static T Pattern<T>(IUIAutomationElement el, int id) where T : class {
    try { return el.GetCurrentPattern(id) as T; } catch (COMException) { return null; }
  }
  static bool Live(IUIAutomationElement el, int prop) { try { var v = el.GetCurrentPropertyValue(prop); return v is bool && (bool)v; } catch { return false; } }

  static object Invoke(Dictionary<string, object> a) {
    var w = Resolve(a); var n = Target(w, a);
    if (!Live(n.El, P.UIA_IsEnabledPropertyId)) throw new DexDeskError("disabled", "That control is disabled right now.");
    var inv = Pattern<IUIAutomationInvokePattern>(n.El, Pat.UIA_InvokePatternId);
    if (inv != null) { inv.Invoke(); return new Dictionary<string, object> { { "method", "invoke" } }; }
    var sel = Pattern<IUIAutomationSelectionItemPattern>(n.El, Pat.UIA_SelectionItemPatternId);
    if (sel != null) { sel.Select(); return new Dictionary<string, object> { { "method", "select" }, { "verified", Live(n.El, P.UIA_SelectionItemIsSelectedPropertyId) } }; }
    var tog = Pattern<IUIAutomationTogglePattern>(n.El, Pat.UIA_TogglePatternId);
    if (tog != null) { tog.Toggle(); return new Dictionary<string, object> { { "method", "toggle" } }; }
    var exp = Pattern<IUIAutomationExpandCollapsePattern>(n.El, Pat.UIA_ExpandCollapsePatternId);
    if (exp != null) { exp.Expand(); return new Dictionary<string, object> { { "method", "expand" } }; }
    var leg = Pattern<IUIAutomationLegacyIAccessiblePattern>(n.El, Pat.UIA_LegacyIAccessiblePatternId);
    if (leg != null) {
      string action = null; try { action = leg.CurrentDefaultAction; } catch { }
      if (!string.IsNullOrEmpty(action)) { leg.DoDefaultAction(); return new Dictionary<string, object> { { "method", "legacy" }, { "action", action } }; }
    }
    throw new DexDeskError("needs_input", "That control can't be pressed without the mouse.", "Try another route (a menu, a keyboard shortcut via the app's menu items), or borrow input.", null);
  }

  static object SetText(Dictionary<string, object> a) {
    var w = Resolve(a); var n = Target(w, a);
    if (Live(n.El, P.UIA_IsPasswordPropertyId)) throw new DexDeskError("secret_field", "DEX doesn't type into password fields.", "Ask the user to type it.", null);
    string text = Str(a, "text") ?? "";
    var val = Pattern<IUIAutomationValuePattern>(n.El, Pat.UIA_ValuePatternId);
    if (val != null) {
      if (val.CurrentIsReadOnly != 0) throw new DexDeskError("read_only", "That field is read-only.");
      string next = Bool(a, "append", false) ? (val.CurrentValue ?? "") + text : text;
      val.SetValue(next);
      string back = val.CurrentValue ?? "";
      return new Dictionary<string, object> { { "method", "value" }, { "readBack", back.Length > 200 ? back.Substring(0, 200) + "…" : back }, { "verified", back == next } };
    }
    object hv = null; try { hv = n.El.GetCurrentPropertyValue(P.UIA_NativeWindowHandlePropertyId); } catch { }
    var native = new IntPtr(Convert.ToInt64(hv ?? 0));
    if (native != IntPtr.Zero) {
      var cls = new StringBuilder(256); GetClassName(native, cls, 256);
      if (cls.ToString().IndexOf("Edit", StringComparison.OrdinalIgnoreCase) >= 0) {
        SendMessage(native, WM_SETTEXT, IntPtr.Zero, text);
        var sb = new StringBuilder(4096); IntPtr r;
        SendMessageTimeout(native, WM_GETTEXT, new IntPtr(sb.Capacity), sb, 2, 2000, out r);
        return new Dictionary<string, object> { { "method", "wm_settext" }, { "readBack", sb.ToString() }, { "verified", sb.ToString() == text } };
      }
    }
    throw new DexDeskError("needs_input", "That field doesn't take text from automation.", "Look for an Edit field near it, or borrow input.", null);
  }

  static object Toggle(Dictionary<string, object> a) {
    var w = Resolve(a); var n = Target(w, a);
    var tog = Pattern<IUIAutomationTogglePattern>(n.El, Pat.UIA_TogglePatternId);
    if (tog == null) throw new DexDeskError("no_pattern", "That control isn't a switch or check box.");
    string want = Str(a, "state") ?? "on";
    Func<string> state = () => { var s = (int)tog.CurrentToggleState; return s == 1 ? "on" : s == 0 ? "off" : "mixed"; };
    string was = state();
    for (int i = 0; i < 3 && state() != want; i++) tog.Toggle();
    return new Dictionary<string, object> { { "was", was }, { "now", state() }, { "verified", state() == want } };
  }

  static object Select(Dictionary<string, object> a) {
    var w = Resolve(a); var n = Target(w, a);
    var sel = Pattern<IUIAutomationSelectionItemPattern>(n.El, Pat.UIA_SelectionItemPatternId);
    if (sel == null) throw new DexDeskError("no_pattern", "That isn't a selectable item.");
    sel.Select();
    return new Dictionary<string, object> { { "selected", sel.CurrentIsSelected != 0 } };
  }

  static object Expand(Dictionary<string, object> a) {
    var w = Resolve(a); var n = Target(w, a);
    var exp = Pattern<IUIAutomationExpandCollapsePattern>(n.El, Pat.UIA_ExpandCollapsePatternId);
    if (exp == null) throw new DexDeskError("no_pattern", "That can't expand or collapse.");
    if (Bool(a, "expanded", true)) exp.Expand(); else exp.Collapse();
    var s = (int)exp.CurrentExpandCollapseState;
    return new Dictionary<string, object> { { "state", s == 1 ? "expanded" : s == 0 ? "collapsed" : "partial" } };
  }

  static object Scroll(Dictionary<string, object> a) {
    var w = Resolve(a); var n = Target(w, a);
    if (Bool(a, "intoView", false)) {
      var item = Pattern<IUIAutomationScrollItemPattern>(n.El, Pat.UIA_ScrollItemPatternId);
      if (item == null) throw new DexDeskError("no_pattern", "That element can't be scrolled into view.");
      item.ScrollIntoView();
      return new Dictionary<string, object> { { "ok", true } };
    }
    // The element itself, or the nearest container that scrolls.
    var walker = uia.ControlViewWalker;
    IUIAutomationElement el = n.El; IUIAutomationScrollPattern sp = null;
    for (int i = 0; i < 8 && el != null && sp == null; i++) { sp = Pattern<IUIAutomationScrollPattern>(el, Pat.UIA_ScrollPatternId); if (sp == null) el = walker.GetParentElement(el); }
    if (sp == null) throw new DexDeskError("no_pattern", "Nothing scrolls there.");
    bool large = Str(a, "amount") == "large";
    var inc = large ? ScrollAmount.ScrollAmount_LargeIncrement : ScrollAmount.ScrollAmount_SmallIncrement;
    var dec = large ? ScrollAmount.ScrollAmount_LargeDecrement : ScrollAmount.ScrollAmount_SmallDecrement;
    var none = ScrollAmount.ScrollAmount_NoAmount;
    switch (Str(a, "direction") ?? "down") {
      case "up": sp.Scroll(none, dec); break;
      case "left": sp.Scroll(dec, none); break;
      case "right": sp.Scroll(inc, none); break;
      default: sp.Scroll(none, inc); break;
    }
    return new Dictionary<string, object> { { "vertical", sp.CurrentVerticalScrollPercent }, { "horizontal", sp.CurrentHorizontalScrollPercent } };
  }

  static object Wait(Dictionary<string, object> a) {
    var w = Resolve(a);
    bool gone = Bool(a, "gone", false);
    int timeout = Math.Max(250, Math.Min(30000, Int(a, "timeoutMs", 10000)));
    var sw = Stopwatch.StartNew();
    while (true) {
      bool truncated;
      var hits = Match(Walk(w, Root(w), 12, 3000, false, out truncated), Str(a, "name"), Str(a, "role"), Str(a, "automationId"), Str(a, "match") ?? "prefix");
      if (gone ? hits.Count == 0 : hits.Count > 0) {
        var r = new Dictionary<string, object> { { gone ? "disappeared" : "appeared", true }, { "ms", sw.ElapsedMilliseconds } };
        if (!gone) r["node"] = hits[0];
        return r;
      }
      if (sw.ElapsedMilliseconds > timeout) return new Dictionary<string, object> { { gone ? "disappeared" : "appeared", false }, { "ms", sw.ElapsedMilliseconds } };
      Thread.Sleep(250);
    }
  }

  // ── Capture ────────────────────────────────────────────────────────────
  static object Capture(Dictionary<string, object> a) {
    var w = Resolve(a);
    string path = Str(a, "path");
    if (string.IsNullOrEmpty(path)) throw new DexDeskError("bad_args", "capture needs a path.");
    int maxWidth = Math.Max(200, Math.Min(1600, Int(a, "maxWidth", 1280)));
    RECT r; GetWindowRect(w.H, out r);
    int width = r.Right - r.Left, height = r.Bottom - r.Top;
    if (width <= 0 || height <= 0 || w.Minimized) throw new DexDeskError("not_drawn", "That window is minimized, so there's nothing to see.", "app_launch parks windows off-screen instead of minimizing them.", null);
    int tries = 0;
    Bitmap bmp = null;
    for (; tries < 3; tries++) {
      if (bmp != null) bmp.Dispose();
      bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(bmp)) { IntPtr hdc = g.GetHdc(); PrintWindow(w.H, hdc, 2 /* PW_RENDERFULLCONTENT */); g.ReleaseHdc(hdc); }
      if (!Blank(bmp)) break;
      Thread.Sleep(200);
    }
    // The window rect includes the invisible resize border; tree boxes are relative to the visible frame.
    int ox = w.Bounds[0] - r.Left, oy = w.Bounds[1] - r.Top;
    if (Bool(a, "annotate", false)) Annotate(bmp, w, ox, oy);
    double scale = width > maxWidth ? (double)maxWidth / width : 1.0;
    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
    using (var outBmp = scale < 1 ? new Bitmap(bmp, (int)(width * scale), (int)(height * scale)) : new Bitmap(bmp)) {
      outBmp.Save(path, ImageFormat.Png);
      var res = new Dictionary<string, object> { { "path", path }, { "width", outBmp.Width }, { "height", outBmp.Height }, { "retries", tries }, { "blank", tries >= 3 } };
      bmp.Dispose();
      return res;
    }
  }

  static bool Blank(Bitmap b) {
    int corner = b.GetPixel(0, 0).ToArgb(), same = 0, total = 0;
    for (int y = 0; y < b.Height; y += 16) for (int x = 0; x < b.Width; x += 16) { total++; if (b.GetPixel(x, y).ToArgb() == corner) same++; }
    return total > 0 && same > total * 0.98;
  }

  static void Annotate(Bitmap bmp, Win w, int ox, int oy) {
    WinMap m; if (!maps.TryGetValue(w.H.ToInt64(), out m)) return;
    using (var g = Graphics.FromImage(bmp))
    using (var pen = new Pen(Color.FromArgb(220, 22, 131, 255), 2))
    using (var font = new Font("Segoe UI", 9, FontStyle.Bold))
    using (var bg = new SolidBrush(Color.FromArgb(230, 22, 131, 255))) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      foreach (var h in m.LastTree) {
        Node n; if (!m.ByHandle.TryGetValue(h, out n)) continue;
        if (n.Box[2] <= 0 || n.Box[3] <= 0) continue;
        var rect = new Rectangle(n.Box[0] + ox, n.Box[1] + oy, n.Box[2], n.Box[3]);
        g.DrawRectangle(pen, rect);
        var size = g.MeasureString(n.H, font);
        g.FillRectangle(bg, rect.X, rect.Y, size.Width, size.Height);
        g.DrawString(n.H, font, Brushes.White, rect.X, rect.Y);
      }
    }
  }

  // ── Launch and park ────────────────────────────────────────────────────
  /** Just right of every monitor: on no screen, but not minimized (minimized apps freeze). */
  static RECT ParkRect(int w, int h) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78);
    w = w > 200 ? w : 1280; h = h > 150 ? h : 800;
    return new RECT { Left = vx + vw + 200, Top = vy, Right = vx + vw + 200 + w, Bottom = vy + h };
  }

  static void Park(IntPtr h) {
    var wp = new WINDOWPLACEMENT { length = Marshal.SizeOf(typeof(WINDOWPLACEMENT)) };
    GetWindowPlacement(h, ref wp);
    int w = wp.rcNormalPosition.Right - wp.rcNormalPosition.Left, ht = wp.rcNormalPosition.Bottom - wp.rcNormalPosition.Top;
    // A window that took the foreground hands it back as it minimizes: Windows
    // activates the next window in z-order — the one the user was in.
    if (GetForegroundWindow() == h) ShowWindow(h, SW_SHOWMINNOACTIVE);
    wp.showCmd = SW_SHOWNOACTIVATE;
    wp.flags = 0;
    wp.rcNormalPosition = ParkRect(w, ht);
    SetWindowPlacement(h, ref wp);
  }

  static List<long> Hwnds() { var l = new List<long>(); foreach (var w in TopWindows(true)) l.Add(w.H.ToInt64()); return l; }

  static object Launch(Dictionary<string, object> a) {
    string app = Str(a, "app"), uri = Str(a, "uri");
    bool show = Bool(a, "show", false);
    var before = new HashSet<long>(Hwnds());
    var fgBefore = GetForegroundWindow();
    int pid = 0;
    bool viaShell = false;
    if (app != null && File.Exists(app)) {
      var si = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), dwFlags = 1 /* STARTF_USESHOWWINDOW */, wShowWindow = (short)(show ? 1 : SW_SHOWMINNOACTIVE) };
      PROCESS_INFORMATION pi;
      var cmd = new StringBuilder("\"" + app + "\"" + (Str(a, "args") != null ? " " + Str(a, "args") : ""));
      if (!CreateProcess(app, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, System.IO.Path.GetDirectoryName(app), ref si, out pi))
        throw new DexDeskError("launch_failed", "Windows wouldn't start " + app + " (error " + Marshal.GetLastWin32Error() + ").");
      pid = pi.dwProcessId; CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    } else {
      string file = uri ?? (app != null ? "shell:AppsFolder\\" + app : null);
      if (file == null) throw new DexDeskError("bad_args", "app_launch needs an app (exe path or app id) or a uri.");
      var info = new SHELLEXECUTEINFO { cbSize = Marshal.SizeOf(typeof(SHELLEXECUTEINFO)), fMask = 0x00000040 /* NOCLOSEPROCESS */, lpVerb = "open", lpFile = file, nShow = show ? 1 : SW_SHOWNOACTIVATE };
      if (!ShellExecuteEx(ref info)) throw new DexDeskError("launch_failed", "Windows couldn't open " + file + " (error " + Marshal.GetLastWin32Error() + ").");
      if (info.hProcess != IntPtr.Zero) CloseHandle(info.hProcess);
      viaShell = true;
    }
    // The new top-level window: one that wasn't there before (from this
    // process, its children, or a broker that started it for us).
    IntPtr found = IntPtr.Zero;
    var sw = Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < 15000 && found == IntPtr.Zero) {
      Thread.Sleep(200);
      foreach (var w in TopWindows(true)) {
        if (before.Contains(w.H.ToInt64()) || IsDex(w)) continue;
        if (pid != 0 && w.Pid != pid && sw.ElapsedMilliseconds < 4000) continue;   // prefer our own process's first
        found = w.H; break;
      }
    }
    var res = new Dictionary<string, object> { { "pid", pid } };
    if (found == IntPtr.Zero) {
      res["hwnd"] = null; res["parked"] = false;
      res["note"] = "Started, but no new window appeared in 15 s. It may have reused a window that was already open: call windows_list.";
      return res;
    }
    string id = "L" + (nextLaunch++);
    launches[id] = found.ToInt64();
    if (!show) { Park(found); parked[found.ToInt64()] = id; }
    res["launchId"] = id; res["hwnd"] = found.ToInt64(); res["parked"] = !show;
    res["mayHaveTakenFocus"] = viaShell || GetForegroundWindow() != fgBefore;
    return res;
  }

  static object WindowAction(Dictionary<string, object> a) {
    var w = Resolve(a);
    long key = w.H.ToInt64();
    string action = Str(a, "action") ?? "";
    switch (action) {
      case "park":
        if (!parked.ContainsKey(key) && !launches.ContainsValue(key)) throw new DexDeskError("not_yours", "DEX only parks windows it opened.");
        takenOver.Remove(key); Park(w.H); parked[key] = parked.ContainsKey(key) ? parked[key] : "L?";
        return new Dictionary<string, object> { { "parked", true } };
      case "unpark": {
        if (!parked.ContainsKey(key)) throw new DexDeskError("not_yours", "That window isn't parked by DEX.");
        parked.Remove(key);
        var wp = new WINDOWPLACEMENT { length = Marshal.SizeOf(typeof(WINDOWPLACEMENT)) };
        GetWindowPlacement(w.H, ref wp);
        int ww = wp.rcNormalPosition.Right - wp.rcNormalPosition.Left, hh = wp.rcNormalPosition.Bottom - wp.rcNormalPosition.Top;
        int sx = GetSystemMetrics(0), sy = GetSystemMetrics(1);
        wp.rcNormalPosition = new RECT { Left = Math.Max(0, (sx - ww) / 2), Top = Math.Max(0, (sy - hh) / 2), Right = Math.Max(0, (sx - ww) / 2) + ww, Bottom = Math.Max(0, (sy - hh) / 2) + hh };
        wp.showCmd = SW_SHOWNOACTIVATE;
        SetWindowPlacement(w.H, ref wp);
        return new Dictionary<string, object> { { "onScreen", true } };
      }
      case "minimize":
        ShowWindow(w.H, SW_SHOWMINNOACTIVE);
        return new Dictionary<string, object> { { "minimized", true } };
      case "close":
        PostMessage(w.H, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        parked.Remove(key);
        return new Dictionary<string, object> { { "closing", true } };
      default:
        throw new DexDeskError("bad_args", "action is park, unpark, minimize or close.");
    }
  }

  /**
   * Every 2 s: a parked window a display change moved back on screen goes
   * back; one the user brought to the front themselves (real input, and now
   * the foreground) is theirs — DEX says so and stops touching it.
   */
  static void Watch(object _) {
    SetThreadDpiAwarenessContext(PerMonitorAwareV2);
    if (!Monitor.TryEnter(stateLock)) return;   // an op is running; next tick
    try {
      var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
      GetLastInputInfo(ref li);
      bool userActed = li.dwTime != watchedInput;
      watchedInput = li.dwTime;
      var fg = GetForegroundWindow().ToInt64();
      foreach (var key in new List<long>(parked.Keys)) {
        var h = new IntPtr(key);
        if (!IsWindow(h)) { parked.Remove(key); continue; }
        if (key == fg && userActed) {
          parked.Remove(key);
          takenOver.Add(key);
          var wp = new WINDOWPLACEMENT { length = Marshal.SizeOf(typeof(WINDOWPLACEMENT)) };
          GetWindowPlacement(h, ref wp);
          int ww = wp.rcNormalPosition.Right - wp.rcNormalPosition.Left, hh = wp.rcNormalPosition.Bottom - wp.rcNormalPosition.Top;
          int sx = GetSystemMetrics(0), sy = GetSystemMetrics(1);
          wp.rcNormalPosition = new RECT { Left = Math.Max(0, (sx - ww) / 2), Top = Math.Max(0, (sy - hh) / 2), Right = Math.Max(0, (sx - ww) / 2) + ww, Bottom = Math.Max(0, (sy - hh) / 2) + hh };
          wp.showCmd = SW_SHOWNOACTIVATE;
          SetWindowPlacement(h, ref wp);
          var d = Describe(h);
          Emit(Json.Serialize(new Dictionary<string, object> { { "event", "taken-over" }, { "window", d } }));
          continue;
        }
        RECT r; GetWindowRect(h, out r);
        int vx = GetSystemMetrics(76), vw = GetSystemMetrics(78);
        if (r.Left < vx + vw && !IsIconic(h)) Park(h);
      }
    } catch { /* never let the watcher take the host down */ }
    finally { Monitor.Exit(stateLock); }
  }

  /** Is the user's hand on this window now? (A window they took.) */
  public static bool IsTakenOver(long hwnd) { return takenOver.Contains(hwnd); }

  // ── System ─────────────────────────────────────────────────────────────
  static object Hello() {
    return new Dictionary<string, object> {
      { "version", Version }, { "os", Environment.OSVersion.VersionString }, { "elevated", selfElevated },
      { "autoSetFocus", uia2.AutoSetFocus }, { "pid", Process.GetCurrentProcess().Id },
    };
  }

  /**
   * SPI_SETTOUCHPADPARAMETERS: change one touchpad setting, keeping the rest.
   * Returns the value it had, for the undo journal.
   */
  public static string SetTouchpad(string field, string value) {
    var p = new TOUCHPAD_PARAMETERS { versionNumber = 1 };
    uint size = (uint)Marshal.SizeOf(typeof(TOUCHPAD_PARAMETERS));
    if (!SystemParametersInfo(0x00AE, size, ref p, 0)) throw new DexDeskError("unsupported", "This Windows doesn't let DEX change touchpad settings (needs Windows 11).");
    Func<uint, int, bool, uint> setBit = (v, i, set) => set ? (v | (1u << i)) : (v & ~(1u << i));
    bool on = value == "true" || value == "1";
    string before;
    switch (field) {
      case "touchpadEnabled": before = (((p.flags1 >> 3) & 1) != 0).ToString().ToLower(); p.flags1 = setBit(p.flags1, 3, on); break;
      case "allowActiveWhenMousePresent": before = (((p.flags2 >> 0) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 0, on); break;
      case "tapEnabled": before = (((p.flags2 >> 2) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 2, on); break;
      case "tapAndDragEnabled": before = (((p.flags2 >> 3) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 3, on); break;
      case "twoFingerTapEnabled": before = (((p.flags2 >> 4) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 4, on); break;
      case "rightClickZoneEnabled": before = (((p.flags2 >> 5) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 5, on); break;
      case "panEnabled": before = (((p.flags2 >> 7) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 7, on); break;
      case "zoomEnabled": before = (((p.flags2 >> 8) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 8, on); break;
      case "scrollDirectionReversed": before = (((p.flags2 >> 9) & 1) != 0).ToString().ToLower(); p.flags2 = setBit(p.flags2, 9, on); break;
      case "cursorSpeed": before = p.cursorSpeed.ToString(); p.cursorSpeed = uint.Parse(value); break;
      case "sensitivity": before = p.sensitivityLevel.ToString(); p.sensitivityLevel = int.Parse(value); break;
      default: throw new DexDeskError("bad_args", "Unknown touchpad setting: " + field);
    }
    // SPIF_UPDATEINIFILE | SPIF_SENDCHANGE: saved, and every app hears about it.
    if (!SystemParametersInfo(0x00AF, size, ref p, 0x01 | 0x02)) throw new DexDeskError("change_failed", "Windows didn't accept the touchpad change.");
    return before;
  }

  /** SPI_GETTOUCHPADPARAMETERS (Windows 11): what the touchpad is set to, in words. */
  static object Touchpad() {
    var p = new TOUCHPAD_PARAMETERS { versionNumber = 1 };
    if (!SystemParametersInfo(0x00AE, (uint)Marshal.SizeOf(typeof(TOUCHPAD_PARAMETERS)), ref p, 0))
      return new Dictionary<string, object> { { "available", false }, { "note", "This Windows doesn't report touchpad settings (needs Windows 11)." } };
    Func<uint, int, bool> bit = (v, i) => ((v >> i) & 1) != 0;
    string[] sens = { "most", "high", "medium", "low", "least" };
    return new Dictionary<string, object> {
      { "available", true }, { "maxContacts", p.maxSupportedContacts },
      { "touchpadPresent", bit(p.flags1, 0) }, { "legacyTouchpadPresent", bit(p.flags1, 1) }, { "externalMousePresent", bit(p.flags1, 2) },
      { "touchpadEnabled", bit(p.flags1, 3) }, { "touchpadActive", bit(p.flags1, 4) },
      { "allowActiveWhenMousePresent", bit(p.flags2, 0) }, { "tapEnabled", bit(p.flags2, 2) }, { "tapAndDragEnabled", bit(p.flags2, 3) },
      { "twoFingerTapEnabled", bit(p.flags2, 4) }, { "rightClickZoneEnabled", bit(p.flags2, 5) }, { "panEnabled", bit(p.flags2, 7) },
      { "zoomEnabled", bit(p.flags2, 8) }, { "scrollDirectionReversed", bit(p.flags2, 9) },
      { "sensitivity", p.sensitivityLevel >= 0 && p.sensitivityLevel < sens.Length ? sens[p.sensitivityLevel] : p.sensitivityLevel.ToString() },
      { "cursorSpeed", p.cursorSpeed },
    };
  }
}
