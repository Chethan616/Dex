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
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
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
    /** How much the last window_capture shrank the window: its picture's pixels → the window's. */
    public double CaptureScale = 1;
  }
  static readonly Dictionary<long, WinMap> maps = new Dictionary<long, WinMap>();
  /** Windows DEX opened, and parked off-screen: hwnd → launch id. */
  static readonly Dictionary<long, string> parked = new Dictionary<long, string>();
  static readonly Dictionary<string, long> launches = new Dictionary<string, long>();
  /** Windows the user took (brought to the front themselves). DEX leaves them alone. */
  static readonly HashSet<long> takenOver = new HashSet<long>();
  static Timer watcher;
  static uint watchedInput;
  /** This task (DEX_SESSION_ID, as the server names its files): the Desk tab's files are per task. */
  static string session = "shared";

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
    session = Regex.Replace(Environment.GetEnvironmentVariable("DEX_SESSION_ID") ?? "", "[^A-Za-z0-9_-]", "_");
    if (session.Length == 0) session = "shared";
    AdoptNewWindows();                        // what's open now is the user's: only windows from here on are new
    StartForegroundWatch();
    watcher = new Timer(Watch, null, 2000, 2000);
    frameTimer = new Timer(FrameTick, null, 500, 500);
  }

  /** One line of JSON to stdout, from the request loop or the watcher alike. */
  public static void Emit(string line) {
    lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
  }

  // ── Request entry ──────────────────────────────────────────────────────
  static readonly HashSet<string> Mutating = new HashSet<string> { "invoke", "set_text", "toggle", "select", "expand", "scroll", "launch", "window" };

  static readonly HashSet<string> Ops = new HashSet<string> {
    "hello", "windows", "tree", "find", "invoke", "set_text", "toggle", "select", "expand", "scroll", "wait", "capture", "launch", "window", "touchpad", "resolve", "borrow",
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
    opElement = null;
    opWin = null;
    opActs = before != null;
    try {
      res["ok"] = true;
      var result = Dispatch(op, args);
      var dict = result as Dictionary<string, object>;
      if (dict != null && opElement != null && !dict.ContainsKey("element") && !string.IsNullOrEmpty((string)opElement["name"])) dict["element"] = opElement;
      res["result"] = result;
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
      object handedBack = null;
      try {
        // The app DEX just acted in came forward (or opened a window in front
        // of the user): back off-screen, and the front back to the user.
        if (op != "launch") handedBack = Contain(before);
        if (opWin != null) actedAt[opWin.Pid] = Environment.TickCount;
        AdoptNewWindows();
      } catch { /* never fail an op over this */ }
      var incident = Incident(before, Snap());
      if (incident != null || handedBack != null) {
        var focus = new Dictionary<string, object>();
        if (incident != null) focus["incident"] = incident;
        if (handedBack != null) focus["handedBack"] = handedBack;
        res["focus"] = focus;
      }
    }
    opActs = false;
    parkedCount = parked.Count;
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
      case "borrow": return Borrow(a);
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
    SyncTaken();
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
    NoteWorking(info.H);
    if (opActs) { opWin = info; actedAt[info.Pid] = Environment.TickCount; }
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
    var n = FindTarget(w, a);
    NoteFocus(w, n);
    return n;
  }
  static Node FindTarget(Win w, Dictionary<string, object> a) {
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
    int width, height;
    double ratio = DpiRatio(w.H, r, out width, out height);
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
    if (Bool(a, "annotate", false)) Annotate(bmp, w, ox, oy, ratio);
    double scale = width > maxWidth ? (double)maxWidth / width : 1.0;
    MapFor(w.H).CaptureScale = scale * ratio;     // picture px per screen px, for input_act's {x, y}
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

  /**
   * PrintWindow draws a window at the size the window itself thinks it is: a
   * DPI-unaware app on a 125% screen hands back a picture 80% the size of its
   * real rect, and a picture that big leaves the rest black. Gives that size,
   * and the picture's pixels per screen pixel.
   */
  static double DpiRatio(IntPtr h, RECT phys, out int width, out int height) {
    width = phys.Right - phys.Left; height = phys.Bottom - phys.Top;
    try {
      IntPtr old = SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(h));
      RECT own; bool ok = GetWindowRect(h, out own);
      SetThreadDpiAwarenessContext(old);
      if (ok && own.Right - own.Left > 0 && own.Bottom - own.Top > 0) { width = own.Right - own.Left; height = own.Bottom - own.Top; }
    } catch (EntryPointNotFoundException) { /* before Windows 10 1607: no virtualization to undo */ }
    return (double)width / Math.Max(1, phys.Right - phys.Left);
  }

  static void Annotate(Bitmap bmp, Win w, int ox, int oy, double ratio) {
    WinMap m; if (!maps.TryGetValue(w.H.ToInt64(), out m)) return;
    using (var g = Graphics.FromImage(bmp))
    using (var pen = new Pen(Color.FromArgb(220, 22, 131, 255), 2))
    using (var font = new Font("Segoe UI", 9, FontStyle.Bold))
    using (var bg = new SolidBrush(Color.FromArgb(230, 22, 131, 255))) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      foreach (var h in m.LastTree) {
        Node n; if (!m.ByHandle.TryGetValue(h, out n)) continue;
        if (n.Box[2] <= 0 || n.Box[3] <= 0) continue;
        var rect = new Rectangle((int)((n.Box[0] + ox) * ratio), (int)((n.Box[1] + oy) * ratio), (int)(n.Box[2] * ratio), (int)(n.Box[3] * ratio));
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

  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
  const int DWMWA_TRANSITIONS_FORCEDISABLED = 3;

  /**
   * Off every screen, not minimized (minimized apps stop drawing and their
   * accessibility goes stale), and not in front.
   *
   * SetWindowPos, never SetWindowPlacement: Windows pulls a placement that is
   * wholly off-screen back onto the screen's edge (documented, and measured:
   * a "parked" window sat at the right edge, in full view).
   */
  static void Park(IntPtr h) { Park(h, IntPtr.Zero); }

  /** `back`: the window the user was in, to hand the front back to if this one took it. */
  static void Park(IntPtr h, IntPtr back) {
    int noAnim = 1;
    DwmSetWindowAttribute(h, DWMWA_TRANSITIONS_FORCEDISABLED, ref noAnim, 4);   // no flying to and from the taskbar
    // Minimized (an app launched that way): restored where it was, then straight off-screen.
    if (IsIconic(h)) ShowWindow(h, SW_SHOWNOACTIVATE);
    RECT r; GetWindowRect(h, out r);
    var park = ParkRect(r.Right - r.Left, r.Bottom - r.Top);
    SetWindowPos(h, IntPtr.Zero, park.Left, park.Top, 0, 0, 0x0001 | 0x0004 | 0x0010 /* NOSIZE | NOZORDER | NOACTIVATE */);
    if (GetForegroundWindow() == h) {
      // It took the front: straight back to the window the user was in.
      if (!UsersWindow(back, h)) back = LastUserWindow(h);
      if (back != IntPtr.Zero) {
        Activate(back);
        for (int i = 0; i < 10 && GetForegroundWindow() == h; i++) Thread.Sleep(20);   // activation lands a moment later
      }
    }
    if (GetForegroundWindow() == h) {
      // Still in front (nothing of the user's to hand it to). Minimizing hands
      // it to the next window; restoring puts it where it is now — off-screen —
      // without activating.
      ShowWindow(h, SW_MINIMIZE);
      for (int i = 0; i < 15 && GetForegroundWindow() == h; i++) Thread.Sleep(20);
      Thread.Sleep(120);   // restored any sooner, some apps (WinForms) take the front straight back
      ShowWindow(h, SW_SHOWNOACTIVATE);
    }
    noAnim = 0;
    DwmSetWindowAttribute(h, DWMWA_TRANSITIONS_FORCEDISABLED, ref noAnim, 4);
  }

  static bool OnScreen(RECT r) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    return r.Right > vx && r.Left < vx + vw && r.Bottom > vy && r.Top < vy + vh;
  }

  static bool IsCloaked(IntPtr h) { int c; return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out c, 4) == 0 && c != 0; }

  static List<long> Hwnds() { var l = new List<long>(); foreach (var w in TopWindows(true)) l.Add(w.H.ToInt64()); return l; }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint SearchPath(string path, string file, string ext, int size, StringBuilder buffer, out IntPtr filePart);

  /**
   * An app given as a program, not an app id: a full path, a name on the PATH
   * ("notepad.exe", "mspaint"), or one registered in Windows' App Paths
   * ("chrome.exe"). Started as a program, it can start without activating.
   */
  static string ExePath(string app) {
    if (app.IndexOf('\\') >= 0 || app.IndexOf('/') >= 0) return File.Exists(app) ? app : null;
    if (app.IndexOf('!') >= 0 || app.IndexOf(' ') >= 0) return null;   // an app id, or a display name
    string name = app.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? app : app + ".exe";
    var sb = new StringBuilder(1024); IntPtr part;
    if (SearchPath(null, name, null, sb.Capacity, sb, out part) > 0 && File.Exists(sb.ToString())) return sb.ToString();
    foreach (var root in new[] { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine }) {
      using (var k = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\" + name)) {
        var v = k != null ? k.GetValue(null) as string : null;
        if (v == null) continue;
        v = Environment.ExpandEnvironmentVariables(v.Trim().Trim('"'));
        if (File.Exists(v)) return v;
      }
    }
    return null;
  }

  static object Launch(Dictionary<string, object> a) {
    string app = Str(a, "app"), uri = Str(a, "uri");
    bool show = Bool(a, "show", false);
    var before = new HashSet<long>(Hwnds());
    var fgBefore = GetForegroundWindow();
    uint inputBefore = LastInput();
    int pid = 0;
    bool viaShell = false;
    string exe = app != null && uri == null ? ExePath(app) : null;
    if (exe != null) {
      var si = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), dwFlags = 1 /* STARTF_USESHOWWINDOW */, wShowWindow = (short)(show ? 1 : SW_SHOWMINNOACTIVE) };
      PROCESS_INFORMATION pi;
      var cmd = new StringBuilder("\"" + exe + "\"" + (Str(a, "args") != null ? " " + Str(a, "args") : ""));
      if (!CreateProcess(exe, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, System.IO.Path.GetDirectoryName(exe), ref si, out pi))
        throw new DexDeskError("launch_failed", "Windows wouldn't start " + exe + " (error " + Marshal.GetLastWin32Error() + ").");
      pid = pi.dwProcessId; CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    } else {
      string file = uri ?? (app != null ? "shell:AppsFolder\\" + app : null);
      if (file == null) throw new DexDeskError("bad_args", "app_launch needs an app (exe path or app id) or a uri.");
      // NO_UI: a name Windows can't open fails here, rather than as an error
      // box on the user's screen that holds this helper until someone closes it.
      var info = new SHELLEXECUTEINFO { cbSize = Marshal.SizeOf(typeof(SHELLEXECUTEINFO)), fMask = 0x00000040 | 0x00000400 /* NOCLOSEPROCESS | FLAG_NO_UI */, lpVerb = "open", lpFile = file, nShow = show ? 1 : SW_SHOWNOACTIVATE };
      if (!ShellExecuteEx(ref info)) {
        int err = Marshal.GetLastWin32Error();
        if (uri == null) throw new DexDeskError("not_found", "There's no app called \"" + app + "\" to open (error " + err + ").", "Give an exe path, or the app id from system_info {topic:\"apps\"} (its startMenu list), e.g. Microsoft.WindowsCalculator_8wekyb3d8bbwe!App.", null);
        throw new DexDeskError("launch_failed", "Windows couldn't open " + file + " (error " + err + ").");
      }
      if (info.hProcess != IntPtr.Zero) CloseHandle(info.hProcess);
      viaShell = true;
    }
    // The new top-level window: one that wasn't there before (from this
    // process, its children, or a broker that started it for us).
    IntPtr found = IntPtr.Zero;
    var sw = Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < 15000 && found == IntPtr.Zero) {
      Thread.Sleep(200);
      var fgNow = GetForegroundWindow();
      foreach (var w in TopWindows(true)) {
        if (before.Contains(w.H.ToInt64()) || IsDex(w)) continue;
        // Prefer our own process's first — unless a new window just came to the
        // front with no input from the user: an app started for us by another
        // process (calc.exe starts the Store Calculator), on the user's screen.
        bool pushedIn = w.H == fgNow && LastInput() == inputBefore;
        if (pid != 0 && w.Pid != pid && sw.ElapsedMilliseconds < 4000 && !pushedIn) continue;
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
    bool tookFront = false;
    if (!show) { parked[found.ToInt64()] = id; tookFront = Settle(found, fgBefore); }
    uint foundPid; GetWindowThreadProcessId(found, out foundPid);
    actedAt[foundPid] = Environment.TickCount;
    res["launchId"] = id; res["hwnd"] = found.ToInt64(); res["parked"] = !show;
    res["mayHaveTakenFocus"] = show ? (viaShell || GetForegroundWindow() != fgBefore) : tookFront;
    if (tookFront) res["note"] = "It came to the front for a moment as Windows started it; DEX put it back behind the user's window.";
    return res;
  }

  /**
   * Keep a new window parked until it settles. Store (packaged) apps are
   * started by the shell, which brings them to the front at their last place
   * — on the user's screen — a moment after their window appears, often after
   * it was first parked. So: park it, then watch it until it stays off-screen
   * and behind for a while once drawn, parking it again (and handing the front
   * back) each time it pops up. Returns whether it ever took the front.
   */
  static bool Settle(IntPtr h, IntPtr back) {
    bool tookFront = false;
    var sw = Stopwatch.StartNew();
    long calm = 0;
    for (bool first = true; sw.ElapsedMilliseconds < 8000; first = false) {
      if (!IsWindow(h)) break;
      bool front = GetForegroundWindow() == h;
      RECT r; GetWindowRect(h, out r);
      bool shown = OnScreen(r) && !IsIconic(h);
      if (first || front || shown) {
        tookFront |= front;
        Park(h, back);
        calm = sw.ElapsedMilliseconds;
      }
      long quiet = sw.ElapsedMilliseconds - calm;
      // Drawn and quiet: done. Still cloaked (a splash that never ends): give up waiting a little later.
      if (quiet >= 1200 && (!IsCloaked(h) || sw.ElapsedMilliseconds > 4000)) break;
      Thread.Sleep(40);
    }
    return tookFront;
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
   * Every 2 s, and at once when a window comes to the front or appears: a
   * parked window that came on screen goes back; one in front goes back too,
   * and the front back to the user's window — unless the user brought it
   * forward themselves (TakenByUser), in which case it's theirs: DEX says so
   * and stops touching it. New windows of a parked app (its dialogs) are
   * parked with it.
   */
  static void Watch(object _) {
    SetThreadDpiAwarenessContext(PerMonitorAwareV2);
    if (!Monitor.TryEnter(stateLock)) return;   // an op is running; it tidies up after itself, and the next tick looks again
    try {
      SyncTaken();
      var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
      GetLastInputInfo(ref li);
      bool userActed = li.dwTime != watchedInput;
      watchedInput = li.dwTime;
      var fg = GetForegroundWindow().ToInt64();
      foreach (var key in new List<long>(parked.Keys)) {
        var h = new IntPtr(key);
        if (!IsWindow(h)) { parked.Remove(key); continue; }
        if (key == fg && !TakenByUser(h, userActed)) {
          // It came forward by itself, or because DEX acted in it: not the user's doing.
          Park(h);
          continue;
        }
        if (key == fg) {
          takenLaunch[key] = parked[key];
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
      AdoptNewWindows();
    } catch { /* never let the watcher take the host down */ }
    finally { parkedCount = parked.Count; Monitor.Exit(stateLock); }
  }

  // ── Who brought a window forward ───────────────────────────────────────
  // A parked window is off every screen, so the user can bring it forward only
  // through the shell (its taskbar button, Alt+Tab, Start), or with "Show me"
  // in DEX. Apps also bring themselves forward: every Store app as it starts,
  // and some when a button is pressed. Telling the two apart by "the user did
  // something lately" alone took a self-activating app for the user's — and
  // moved it onto their screen, in front of their film. So every foreground
  // change is recorded as it happens (an out-of-context WinEvent hook: no
  // effect on anyone's input), with the window it came from and the user's
  // last input at that moment.

  /** An app that comes forward this soon after DEX acted in it does so because of DEX. */
  const int DexCauseMs = 1500;
  /** A click or key press this soon before a window came forward brought it forward. */
  const int UserLeadMs = 1000;

  class FgChange { public long Hwnd; public uint At; public uint InputAt; public bool Shell; }
  static readonly object fgLock = new object();
  static readonly List<FgChange> fgHistory = new List<FgChange>();
  /** When DEX last acted in each process (Environment.TickCount, the clock input times use). */
  static readonly Dictionary<uint, int> actedAt = new Dictionary<uint, int>();
  /** The window the op in progress acts on (Resolve sets it), and whether the op acts at all. */
  static Win opWin;
  static bool opActs;
  /** Top-level windows the last sweep saw: one not in it is new. */
  static HashSet<long> knownTop;
  /** parked.Count, for the hook thread (which doesn't take stateLock). */
  static volatile int parkedCount;

  delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc fn, uint pid, uint tid, uint flags);
  static WinEventProc winEventProc;   // kept alive while hooked

  /** The taskbar, Alt+Tab, Task view and the tray: how a person reaches a window that's on no screen. */
  static readonly HashSet<string> ShellClasses = new HashSet<string>(StringComparer.Ordinal) {
    "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "XamlExplorerHostIslandWindow", "MultitaskingViewFrame", "TaskSwitcherWnd",
    "TaskSwitcherOverlayWnd", "ForegroundStaging", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland",
  };
  /** Start and Search are CoreWindows; these processes say it's them. */
  static readonly HashSet<string> ShellProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
    "StartMenuExperienceHost.exe", "SearchHost.exe", "SearchApp.exe", "ShellExperienceHost.exe",
  };

  static uint LastInput() {
    var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
    GetLastInputInfo(ref li);
    return li.dwTime;
  }

  static bool IsShellSurface(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    var cls = new StringBuilder(128); GetClassName(h, cls, 128);
    if (ShellClasses.Contains(cls.ToString())) return true;
    if (cls.ToString() != "Windows.UI.Core.CoreWindow") return false;
    uint pid; GetWindowThreadProcessId(h, out pid);
    string path = ImagePath(pid);
    return path != null && ShellProcesses.Contains(System.IO.Path.GetFileName(path));
  }

  static void StartForegroundWatch() {
    var t = new Thread(() => {
      lock (fgLock) fgHistory.Add(new FgChange { Hwnd = GetForegroundWindow().ToInt64(), At = (uint)Environment.TickCount, InputAt = LastInput() });
      winEventProc = OnWinEvent;
      // WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS: delivered to this thread's queue.
      SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, winEventProc, 0, 0, 0x0002);   // EVENT_SYSTEM_FOREGROUND
      SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, winEventProc, 0, 0, 0x0002);   // EVENT_OBJECT_SHOW
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
    });
    t.IsBackground = true;
    t.Start();
  }

  static void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time) {
    try {
      if (ev == 0x0003) {
        var c = new FgChange { Hwnd = hwnd.ToInt64(), At = time, InputAt = LastInput(), Shell = IsShellSurface(hwnd) };
        lock (fgLock) { fgHistory.Add(c); if (fgHistory.Count > 24) fgHistory.RemoveAt(0); }
        if (parkedCount > 0) Kick();
      } else if (obj == 0 && child == 0 && parkedCount > 0 && GetAncestor(hwnd, 2 /* GA_ROOT */) == hwnd) {
        Kick();   // a new window: perhaps a dialog of a parked app, on the user's screen
      }
    } catch { /* never throw into the hook */ }
  }

  /** Run the watcher now (it drops this if an op holds the state; the op tidies up after itself). */
  static void Kick() {
    var w = watcher;
    if (w == null) return;
    try { w.Change(60, 2000); } catch (ObjectDisposedException) { }
  }

  /**
   * Did the user bring this (parked, now foreground) window forward? Through
   * the shell: yes. Just after DEX acted in its app: no — DEX did. Otherwise:
   * only if they clicked or typed just before it came forward.
   */
  static bool TakenByUser(IntPtr h, bool userActed) {
    FgChange c = null, prev = null;
    lock (fgLock) {
      for (int i = fgHistory.Count - 1; i >= 0; i--) {
        if (fgHistory[i].Hwnd != h.ToInt64()) continue;
        c = fgHistory[i]; prev = i > 0 ? fgHistory[i - 1] : null;
        break;
      }
    }
    if (c == null) return userActed;            // no record of how it came forward: the old rule
    if (prev != null && prev.Shell) return true;
    uint pid; GetWindowThreadProcessId(h, out pid);
    int acted;
    if (actedAt.TryGetValue(pid, out acted)) {
      int since = unchecked((int)(c.At - (uint)acted));
      if (since > -10000 && since < DexCauseMs) return false;
    }
    int lead = unchecked((int)(c.At - c.InputAt));
    return lead > -250 && lead < UserLeadMs;
  }

  /** A window of the user's to hand the front back to: on screen, and nothing DEX parked. */
  static bool UsersWindow(IntPtr w, IntPtr not) {
    return w != IntPtr.Zero && w != not && IsWindow(w) && IsWindowVisible(w) && !IsIconic(w) && ParkedRootOf(w) == 0 && !IsShellSurface(w);
  }

  /** The last window the user had in front, other than `not`. */
  static IntPtr LastUserWindow(IntPtr not) {
    var list = new List<long>();
    lock (fgLock) foreach (var c in fgHistory) list.Add(c.Hwnd);
    for (int i = list.Count - 1; i >= 0; i--) {
      var w = new IntPtr(list[i]);
      if (UsersWindow(w, not)) return w;
    }
    return IntPtr.Zero;
  }

  /** The parked window `h` is, or belongs to (an owned window: its dialog); 0 for none. */
  static long ParkedRootOf(IntPtr h) {
    for (int i = 0; i < 8 && h != IntPtr.Zero; i++, h = GetWindow(h, GW_OWNER))
      if (parked.ContainsKey(h.ToInt64())) return h.ToInt64();
    return 0;
  }

  /**
   * After an op: if the app it acted in came to the front — or opened a
   * window there — park that window and give the front back to the window the
   * user was in. Returns what was handed back, or null.
   */
  static object Contain(Snapshot before) {
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero || fg == before.Fg) return null;
    long root = ParkedRootOf(fg);
    if (root == 0 || takenOver.Contains(root) || TakenByUser(fg, false)) return null;
    if (!parked.ContainsKey(fg.ToInt64())) parked[fg.ToInt64()] = parked[root];
    Park(fg, before.Fg);
    var d = Describe(fg);
    if (d != null) d["back"] = GetForegroundWindow() == before.Fg;
    return d;
  }

  /** Processes that host many apps' windows: every Store app's frame, File Explorer's windows. */
  static bool SharedHost(uint pid) {
    string path = ImagePath(pid);
    string name = path != null ? System.IO.Path.GetFileName(path) : "";
    return string.Equals(name, "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase) || string.Equals(name, "explorer.exe", StringComparison.OrdinalIgnoreCase);
  }

  static bool Adoptable(IntPtr h) {
    if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return false;
    var cls = new StringBuilder(64); GetClassName(h, cls, 64);
    // Dialogs and windows with a title bar. Not menus, drop-downs or tooltips:
    // those close when they lose their place, and Windows keeps them on a screen.
    return cls.ToString() == "#32770" || (GetWindowLong(h, -16 /* GWL_STYLE */) & 0x00C00000 /* WS_CAPTION */) == 0x00C00000;
  }

  /**
   * New windows of an app DEX has parked go off-screen with it: a window it
   * owns (Save as, a confirmation), or a new window of a process all of whose
   * windows are DEX's, just after DEX acted in it. Never a window of the
   * user's: windows already open, or of a process they also have open.
   */
  static void AdoptNewWindows() {
    var seen = new HashSet<long>();
    var fresh = new List<IntPtr>();
    var dexPids = new Dictionary<uint, long>();
    var theirPids = new HashSet<uint>();
    bool first = knownTop == null;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      long k = h.ToInt64();
      seen.Add(k);
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (parked.ContainsKey(k)) { dexPids[pid] = k; return true; }
      if (first || knownTop.Contains(k)) { theirPids.Add(pid); return true; }
      if (!takenOver.Contains(k)) fresh.Add(h);
      return true;
    }, IntPtr.Zero);
    knownTop = seen;
    int now = Environment.TickCount;
    // A window the user just opened themselves is theirs, whatever process it's in.
    bool userJustActed = unchecked(now - (int)LastInput()) < 1000;
    foreach (var h in fresh) {
      if (!Adoptable(h)) continue;
      long root = ParkedRootOf(GetWindow(h, GW_OWNER));
      if (root == 0 && !userJustActed) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        int acted; long r;
        if (!theirPids.Contains(pid) && dexPids.TryGetValue(pid, out r) && actedAt.TryGetValue(pid, out acted) && unchecked(now - acted) < 5000 && !SharedHost(pid)) root = r;
      }
      if (root == 0 || !parked.ContainsKey(root)) continue;
      parked[h.ToInt64()] = parked[root];
      RECT rect; GetWindowRect(h, out rect);
      if (OnScreen(rect) || GetForegroundWindow() == h) Park(h);
    }
    parkedCount = parked.Count;
  }

  /** Is the user's hand on this window now? (A window they took.) */
  public static bool IsTakenOver(long hwnd) { return takenOver.Contains(hwnd); }

  // ── The Desk tab: live pictures of the window DEX works in ────────────
  // (docs/desktop-control/PLAN.md §Phase 3.) While an op has touched a window
  // in the last few seconds, and while the Desk tab is on screen in DEX (main
  // keeps live/<session>.want fresh), two pictures a second of that window go
  // to live/<session>-0.jpg and -1.jpg in turn, and live/<session>.json says
  // which is newest and where the element being acted on is. Two slots: main
  // reads one while the next is written to the other. Nothing is captured
  // while nobody looks, and nothing is drawn on the real window.
  const int FrameMaxWidth = 960;
  const int FrameWorkingMs = 8000;
  const int FocusShownMs = 5000;
  static readonly Stopwatch clock = Stopwatch.StartNew();
  static Timer frameTimer;
  static long frameHwnd;
  static long frameUntil;
  static int frameBusy;
  static int frameSeq;
  static readonly object focusLock = new object();
  static long focusHwnd;
  static int[] focusBox;
  static string focusName, focusRole;
  static long focusAt;
  static ImageCodecInfo jpegCodec;

  static string LiveDir() { return System.IO.Path.Combine(home, "live"); }

  static void NoteWorking(IntPtr h) {
    Interlocked.Exchange(ref frameHwnd, h.ToInt64());
    Interlocked.Exchange(ref frameUntil, clock.ElapsedMilliseconds + FrameWorkingMs);
  }

  /** The element an op acts on: the box the Desk tab draws round it. */
  static void NoteFocus(Win w, Node n) {
    int[] box = n.Box;
    try {
      // Where it is now, not where the last tree saw it.
      var r = n.El.GetCurrentPropertyValue(P.UIA_BoundingRectanglePropertyId) as double[];
      if (r != null && r.Length == 4 && r[2] > 0 && r[3] > 0) box = new[] { (int)r[0] - w.Bounds[0], (int)r[1] - w.Bounds[1], (int)r[2], (int)r[3] };
    } catch { /* keep the tree's box */ }
    lock (focusLock) {
      focusHwnd = w.H.ToInt64(); focusBox = box; focusName = n.Name; focusRole = n.Role; focusAt = clock.ElapsedMilliseconds;
    }
    opElement = new Dictionary<string, object> { { "name", n.Name }, { "role", n.Role } };
  }
  /** The element the op in progress acted on, said back in its result (and in DEX's chat). */
  static Dictionary<string, object> opElement;

  /** Main says the Desk tab is showing by touching this file every couple of seconds. */
  static bool Watched() {
    try {
      var t = File.GetLastWriteTimeUtc(System.IO.Path.Combine(LiveDir(), session + ".want"));
      return (DateTime.UtcNow - t).TotalSeconds < 6;
    } catch { return false; }
  }

  static void FrameTick(object _) {
    if (Interlocked.Exchange(ref frameBusy, 1) == 1) return;   // the last one is still drawing
    try {
      long h = Interlocked.Read(ref frameHwnd);
      if (h == 0 || clock.ElapsedMilliseconds > Interlocked.Read(ref frameUntil) || !Watched()) return;
      SetThreadDpiAwarenessContext(PerMonitorAwareV2);
      WriteFrame(new IntPtr(h));
    } catch { /* never let a picture take the host down */ }
    finally { Interlocked.Exchange(ref frameBusy, 0); }
  }

  static void WriteFrame(IntPtr h) {
    if (!IsWindow(h) || IsIconic(h)) return;
    RECT r; GetWindowRect(h, out r);
    int width, height;
    double ratio = DpiRatio(h, r, out width, out height);   // the picture's px per screen px
    if (width <= 0 || height <= 0 || width > 10000 || height > 10000) return;
    // The visible frame, without the invisible resize borders (DWM gives screen px).
    RECT v;
    if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out v, Marshal.SizeOf(typeof(RECT))) != 0) v = r;
    int ox = Math.Max(0, (int)Math.Round((v.Left - r.Left) * ratio)), oy = Math.Max(0, (int)Math.Round((v.Top - r.Top) * ratio));
    int vw = Math.Min(width - ox, (int)Math.Round((v.Right - v.Left) * ratio)), vh = Math.Min(height - oy, (int)Math.Round((v.Bottom - v.Top) * ratio));
    if (vw <= 0 || vh <= 0) return;
    double scale = vw > FrameMaxWidth ? (double)FrameMaxWidth / vw : 1.0;
    int fw = Math.Max(1, (int)Math.Round(vw * scale)), fh = Math.Max(1, (int)Math.Round(vh * scale));
    string dir = LiveDir();
    Directory.CreateDirectory(dir);
    int seq = frameSeq + 1;
    string file = session + "-" + (seq % 2) + ".jpg";
    using (var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) { IntPtr hdc = g.GetHdc(); try { PrintWindow(h, hdc, 2 /* PW_RENDERFULLCONTENT */); } finally { g.ReleaseHdc(hdc); } }
      if (Blank(bmp)) return;                  // keep the last good picture
      using (var outBmp = new Bitmap(fw, fh, PixelFormat.Format24bppRgb)) {
        using (var g = Graphics.FromImage(outBmp)) {
          g.InterpolationMode = InterpolationMode.HighQualityBilinear;
          g.PixelOffsetMode = PixelOffsetMode.HighQuality;
          g.DrawImage(bmp, new Rectangle(0, 0, fw, fh), new Rectangle(ox, oy, vw, vh), GraphicsUnit.Pixel);
        }
        if (jpegCodec == null) foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpegCodec = c;
        using (var ps = new EncoderParameters(1)) {
          ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
          outBmp.Save(System.IO.Path.Combine(dir, file), jpegCodec, ps);
        }
      }
    }
    frameSeq = seq;
    // Element boxes are in screen px: to the picture's px, then the frame's.
    double boxScale = scale * ratio;
    var meta = new Dictionary<string, object> {
      { "seq", seq }, { "file", file }, { "at", (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds },
      { "width", fw }, { "height", fh }, { "scale", boxScale }, { "window", Describe(h) },
    };
    lock (focusLock) {
      if (focusHwnd == h.ToInt64() && focusBox != null && clock.ElapsedMilliseconds - focusAt < FocusShownMs && focusBox[2] > 0 && focusBox[3] > 0) {
        meta["focus"] = new Dictionary<string, object> {
          { "box", new[] { (int)Math.Round(focusBox[0] * boxScale), (int)Math.Round(focusBox[1] * boxScale), (int)Math.Max(1, Math.Round(focusBox[2] * boxScale)), (int)Math.Max(1, Math.Round(focusBox[3] * boxScale)) } },
          { "name", focusName }, { "role", focusRole },
        };
      }
    }
    string metaPath = System.IO.Path.Combine(dir, session + ".json"), tmp = metaPath + ".tmp";
    File.WriteAllText(tmp, Json.Serialize(meta));
    try { if (File.Exists(metaPath)) File.Replace(tmp, metaPath, null); else File.Move(tmp, metaPath); }
    catch (IOException) { /* main was reading it: the next picture says it */ }
  }

  // ── "Show me" and "Hand back", from the Desk tab ──────────────────────
  // Main lists the windows the user has taken in live/<session>.taken.json.
  // A window there is the user's: DEX leaves it alone (and no longer parks
  // it). Gone from the list again (Hand back), it's DEX's to use — and parked
  // again if DEX opened it.
  static DateTime takenStamp = DateTime.MinValue;
  static HashSet<long> listedTaken = new HashSet<long>();
  /** Launch ids of parked windows the user took, so Hand back can park them again. */
  static readonly Dictionary<long, string> takenLaunch = new Dictionary<long, string>();

  static void SyncTaken() {
    string f = System.IO.Path.Combine(LiveDir(), session + ".taken.json");
    DateTime stamp;
    try { stamp = File.Exists(f) ? File.GetLastWriteTimeUtc(f) : DateTime.MinValue; } catch { return; }
    if (stamp == takenStamp) return;
    var now = new HashSet<long>();
    if (stamp != DateTime.MinValue) {
      try {
        var d = Json.DeserializeObject(File.ReadAllText(f)) as Dictionary<string, object>;
        var list = d != null && d.ContainsKey("hwnds") ? d["hwnds"] as object[] : null;
        if (list != null) foreach (var x in list) now.Add(Convert.ToInt64(x));
      } catch { return; }                      // half-written: read it next time
    }
    takenStamp = stamp;
    foreach (var h in now) {
      if (listedTaken.Contains(h)) continue;
      string id;
      if (parked.TryGetValue(h, out id)) { takenLaunch[h] = id; parked.Remove(h); }
      takenOver.Add(h);
    }
    foreach (var h in listedTaken) {
      if (now.Contains(h)) continue;
      takenOver.Remove(h);
      string id;
      if (takenLaunch.TryGetValue(h, out id)) { parked[h] = id; takenLaunch.Remove(h); }
    }
    listedTaken = now;
  }

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

  // ── Borrowed input (docs/desktop-control/PLAN.md, Phase 4) ─────────────
  // For a control nothing but the real mouse can press. The owner's choice:
  // take it at once — no card in Full access — but give it back the instant
  // the user moves or types, and put their window and cursor back after.

  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  delegate IntPtr LowLevelProc(int code, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, LowLevelProc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);

  /** Marks DEX's own injected input, so the hooks can tell it from the user's. */
  static readonly IntPtr DexMark = new IntPtr(0x44455821);
  static volatile bool userTookOver;
  static int hooksInstalled;   // 1 mouse | 2 keyboard
  static LowLevelProc mouseProc, keyProc;   // kept alive while hooked

  static IntPtr OnMouse(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      var m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(MSLLHOOKSTRUCT));
      if (m.dwExtraInfo != DexMark) userTookOver = true;
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }
  static IntPtr OnKey(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      var k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(KBDLLHOOKSTRUCT));
      if (k.dwExtraInfo != DexMark) userTookOver = true;
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  /** Low-level hooks on a thread of their own (they need its message loop); returns its id, to stop it. */
  static uint StartWatching() {
    uint threadId = 0;
    var ready = new ManualResetEvent(false);
    var t = new Thread(() => {
      threadId = GetCurrentThreadId();
      mouseProc = OnMouse; keyProc = OnKey;
      IntPtr mod = GetModuleHandle(null);
      IntPtr hm = SetWindowsHookEx(14 /* WH_MOUSE_LL */, mouseProc, mod, 0);
      IntPtr hk = SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, keyProc, mod, 0);
      hooksInstalled = (hm != IntPtr.Zero ? 1 : 0) + (hk != IntPtr.Zero ? 2 : 0);
      ready.Set();
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
      UnhookWindowsHookEx(hm); UnhookWindowsHookEx(hk);
    });
    t.IsBackground = true;
    t.Start();
    ready.WaitOne(2000);
    Thread.Sleep(30);   // into GetMessage, so a WM_QUIT finds its queue
    return threadId;
  }

  static void Send(INPUT i) { SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static INPUT Mouse(uint flags, uint data, int dx, int dy) {
    return new INPUT { type = 0, u = new INPUTUNION { mi = new MOUSEINPUT { dx = dx, dy = dy, dwFlags = flags, mouseData = data, dwExtraInfo = DexMark } } };
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    return new INPUT { type = 1, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags, dwExtraInfo = DexMark } } };
  }

  /** The pointer to a screen point, as marked input (SetCursorPos would look like the user's hand). */
  static void MoveTo(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = Math.Max(2, GetSystemMetrics(78)), vh = Math.Max(2, GetSystemMetrics(79));
    int nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1)), ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    Send(Mouse(0x0001 | 0x8000 | 0x4000 /* MOVE | ABSOLUTE | VIRTUALDESK */, 0, nx, ny));
  }

  static readonly Dictionary<string, ushort> KeyNames = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase) {
    {"enter",0x0D},{"tab",0x09},{"escape",0x1B},{"esc",0x1B},{"backspace",0x08},{"delete",0x2E},{"space",0x20},
    {"up",0x26},{"down",0x28},{"left",0x25},{"right",0x27},{"home",0x24},{"end",0x23},{"pageup",0x21},{"pagedown",0x22},
    {"f1",0x70},{"f2",0x71},{"f3",0x72},{"f4",0x73},{"f5",0x74},{"f6",0x75},{"f7",0x76},{"f8",0x77},{"f9",0x78},{"f10",0x79},{"f11",0x7A},{"f12",0x7B},
    {"ctrl",0x11},{"control",0x11},{"alt",0x12},{"shift",0x10},
  };

  static ushort Vk(string name) {
    ushort vk;
    if (KeyNames.TryGetValue(name, out vk)) return vk;
    if (name.Length == 1) { char c = char.ToUpperInvariant(name[0]); if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c; }
    throw new DexDeskError("bad_args", "Unknown key: " + name + ".", "Keys: Enter, Tab, Escape, Backspace, Delete, Space, arrows, Home, End, PageUp, PageDown, F1–F12, a letter or digit, with Ctrl+/Alt+/Shift+.", null);
  }

  /** Bring a window to the front from a background process (Windows only lets the input queue's owner do that). */
  static void Activate(IntPtr h) {
    uint pid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint mine = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != mine && AttachThreadInput(mine, fgThread, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(mine, fgThread, false);
  }

  /** The glow round the screen while DEX has the mouse: click-through, never activated. */
  class Glow : System.Windows.Forms.Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override System.Windows.Forms.CreateParams CreateParams {
      // layered | transparent | toolwindow | noactivate | topmost
      get { var cp = base.CreateParams; cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x08000000 | 0x8; return cp; }
    }
    public Glow() {
      FormBorderStyle = System.Windows.Forms.FormBorderStyle.None;
      ShowInTaskbar = false; TopMost = true; StartPosition = System.Windows.Forms.FormStartPosition.Manual;
      // Physical pixels (the thread is per-monitor aware), so it reaches every edge.
      Bounds = new Rectangle(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
      BackColor = Color.Magenta; TransparencyKey = Color.Magenta;
    }
    protected override void OnPaint(System.Windows.Forms.PaintEventArgs e) {
      var r = ClientRectangle;
      for (int i = 0; i < 6; i++)
        using (var pen = new Pen(Color.FromArgb(53, 184 - i * 12, 255), 2)) e.Graphics.DrawRectangle(pen, i * 2, i * 2, r.Width - 1 - i * 4, r.Height - 1 - i * 4);
      using (var f = new Font("Segoe UI", 11, FontStyle.Bold))
      using (var bg = new SolidBrush(Color.FromArgb(22, 131, 255))) {
        string text = "DEX is using your mouse \u2014 move it to take over";
        var size = e.Graphics.MeasureString(text, f);
        var box = new RectangleF((r.Width - size.Width) / 2 - 18, 18, size.Width + 36, size.Height + 12);
        // A pill. No anti-aliasing on its edge: blended pixels would fringe with the transparency key.
        using (var pill = new GraphicsPath()) {
          float d = box.Height;
          pill.AddArc(box.X, box.Y, d, d, 90, 180);
          pill.AddArc(box.Right - d, box.Y, d, d, 270, 180);
          pill.CloseFigure();
          e.Graphics.FillPath(bg, pill);
        }
        e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        e.Graphics.DrawString(text, f, Brushes.White, box.X + 18, box.Y + 6);
      }
    }
  }

  static System.Windows.Forms.Form ShowGlow() {
    System.Windows.Forms.Form glow = null;
    var ready = new ManualResetEvent(false);
    var t = new Thread(() => {
      try {
        SetThreadDpiAwarenessContext(PerMonitorAwareV2);
        glow = new Glow();
        glow.Shown += (s, e) => ready.Set();
        System.Windows.Forms.Application.Run(glow);
      } catch { ready.Set(); }
    });
    t.SetApartmentState(ApartmentState.STA); t.IsBackground = true; t.Start();
    ready.WaitOne(2000);
    return glow;
  }

  static void CloseGlow(System.Windows.Forms.Form glow) {
    if (glow == null) return;
    try { glow.Invoke(new Action(() => glow.Close())); } catch { }
  }

  /**
   * Is the user watching or playing something full-screen (a film, a game, a
   * slideshow)? Then borrowing would pull a window over it. Windows' own
   * answer first (the state that holds back toasts), then the shape of the
   * window in front: one that covers its whole monitor, taskbar included.
   */
  static string FullScreenInFront(Win target) {
    try {
      int state;
      if (SHQueryUserNotificationState(out state) == 0 && (state == 2 || state == 3 || state == 4))
        return state == 4 ? "presentation" : "fullscreen";
    } catch { }
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero || fg == target.H) return null;
    uint pid; GetWindowThreadProcessId(fg, out pid);
    if (pid == target.Pid) return null;
    var cls = new StringBuilder(64);
    GetClassName(fg, cls, 64);
    string c = cls.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return null;
    RECT r; if (!GetWindowRect(fg, out r)) return null;
    var mi = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
    if (!GetMonitorInfo(MonitorFromWindow(fg, 2 /* MONITOR_DEFAULTTONEAREST */), ref mi)) return null;
    bool covers = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
    return covers ? "fullscreen" : null;
  }

  static uint IdleMs() {
    var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
    GetLastInputInfo(ref li);
    return (uint)Environment.TickCount - li.dwTime;
  }

  /** Where a click step lands, on screen: an element's centre, or a point in the window's last capture. */
  static POINT ClickPoint(Win w, Dictionary<string, object> c) {
    object t; c.TryGetValue("target", out t);
    if (t is string) {
      var n = Element(w, (string)t);
      var rect = n.El.GetCurrentPropertyValue(P.UIA_BoundingRectanglePropertyId) as double[];
      if (rect == null || rect.Length < 4 || rect[2] <= 0 || rect[3] <= 0) throw new DexDeskError("not_drawn", "That element has no place on screen to click.", "Pick another, or click a point from window_capture.", null);
      return new POINT { X = (int)(rect[0] + rect[2] / 2), Y = (int)(rect[1] + rect[3] / 2) };
    }
    if (!c.ContainsKey("x") || !c.ContainsKey("y")) throw new DexDeskError("bad_args", "A click needs a target handle, or x and y in the window's last window_capture picture.");
    RECT r; GetWindowRect(w.H, out r);
    double scale = MapFor(w.H).CaptureScale;
    return new POINT { X = r.Left + (int)Math.Round(Convert.ToDouble(c["x"]) / scale), Y = r.Top + (int)Math.Round(Convert.ToDouble(c["y"]) / scale) };
  }

  /** Would input at this point reach the app — its window or its own menus — and not whatever covers it (DEX's cards included)? */
  static bool Reaches(Win w, IntPtr at) {
    if (at == IntPtr.Zero) return false;
    IntPtr root = GetAncestor(at, 2 /* GA_ROOT */);
    if (root == w.H) return true;
    uint pid; GetWindowThreadProcessId(root, out pid);
    return pid == w.Pid;
  }

  static bool FocusedIsSecret() {
    try { var el = uia.GetFocusedElement(); return el != null && Live(el, P.UIA_IsPasswordPropertyId); } catch { return false; }
  }

  static object Borrow(Dictionary<string, object> a) {
    var w = Resolve(a);
    var steps = a.ContainsKey("steps") ? a["steps"] as object[] : null;
    if (steps == null || steps.Length == 0 || steps.Length > 40) throw new DexDeskError("bad_args", "steps: 1 to 40 of {click}, {type}, {key}, {scroll} or {wait}.");
    if (w.Minimized) throw new DexDeskError("not_drawn", "That window is minimized.", "window_manage restore it first (or app_launch parks windows instead).", null);
    foreach (var raw in steps) {
      var step = raw as Dictionary<string, object>;
      if (step == null) throw new DexDeskError("bad_args", "Each step is an object.");
      if (step.ContainsKey("key")) foreach (var part in Convert.ToString(step["key"]).Split('+')) Vk(part.Trim());
      if (step.ContainsKey("click") && Str((Dictionary<string, object>)step["click"], "target") != null) Element(w, Str((Dictionary<string, object>)step["click"], "target"));
    }

    // Never over a film, a game or a slideshow: a still mouse there means watching, not away.
    string busy = FullScreenInFront(w);
    if (busy != null)
      return new Dictionary<string, object> { { "borrowed", false }, { "reason", "user_fullscreen" }, { "hint", busy == "presentation"
        ? "The user is presenting. Don't borrow input now: do what you can the background way, and tell them what's left for later."
        : "The user is watching or playing something full-screen. Don't borrow input now: do what you can the background way (ui_invoke, menu items, keyboard shortcuts through the app's menus), and tell them what's left for when they're done." } };

    // Only in a pause in the user's own input.
    var waited = Stopwatch.StartNew();
    while (IdleMs() < 1500) {
      if (waited.ElapsedMilliseconds > Math.Min(30000, Int(a, "maxWaitMs", 20000)))
        return new Dictionary<string, object> { { "borrowed", false }, { "reason", "user_busy" }, { "hint", "The user is using the PC right now. Try again in a little while." } };
      Thread.Sleep(200);
    }

    IntPtr prevFg = GetForegroundWindow();
    POINT prevCursor; GetCursorPos(out prevCursor);
    long key = w.H.ToInt64();
    bool wasParked = parked.ContainsKey(key);
    var original = new WINDOWPLACEMENT { length = Marshal.SizeOf(typeof(WINDOWPLACEMENT)) };
    GetWindowPlacement(w.H, ref original);
    RECT before; GetWindowRect(w.H, out before);
    int cx = (before.Left + before.Right) / 2, cy = (before.Top + before.Bottom) / 2;
    int vx0 = GetSystemMetrics(76), vy0 = GetSystemMetrics(77);
    bool offScreen = cx < vx0 || cy < vy0 || cx >= vx0 + GetSystemMetrics(78) || cy >= vy0 + GetSystemMetrics(79);
    bool moved = wasParked || offScreen;
    if (moved) {
      // On screen for the moment, in the middle, so it can take clicks.
      var wp = original;
      int ww = wp.rcNormalPosition.Right - wp.rcNormalPosition.Left, hh = wp.rcNormalPosition.Bottom - wp.rcNormalPosition.Top;
      int sx = GetSystemMetrics(0), sy = GetSystemMetrics(1);
      int left = Math.Max(0, (sx - ww) / 2), top = Math.Max(0, (sy - hh) / 2);
      wp.rcNormalPosition = new RECT { Left = left, Top = top, Right = left + ww, Bottom = top + hh };
      wp.showCmd = SW_SHOWNOACTIVATE;
      wp.flags = 0;
      SetWindowPlacement(w.H, ref wp);
    }

    userTookOver = false; hooksInstalled = 0;
    var glow = ShowGlow();
    uint watcher = StartWatching();
    int done = 0;
    string stopped = null;
    var held = new List<ushort>();
    try {
      // No watching, no borrowing: DEX must be able to let go.
      if (hooksInstalled != 3) throw new DexDeskError("cant_watch", "DEX couldn't watch for the user's mouse and keyboard, so it won't borrow them.", "Tell the user what you needed to press.", null);
      Activate(w.H);
      Thread.Sleep(150);
      foreach (var raw in steps) {
        if (userTookOver) break;
        var step = (Dictionary<string, object>)raw;
        if (step.ContainsKey("click")) {
          var c = (Dictionary<string, object>)step["click"];
          var pt = ClickPoint(w, c);
          if (!Reaches(w, WindowFromPoint(pt))) { stopped = "covered"; break; }
          MoveTo(pt.X, pt.Y);
          Thread.Sleep(50);
          bool right = Str(c, "button") == "right";
          int times = Bool(c, "double", false) ? 2 : 1;
          for (int i = 0; i < times && !userTookOver; i++) {
            Send(Mouse(right ? 0x0008u : 0x0002u, 0, 0, 0));
            Send(Mouse(right ? 0x0010u : 0x0004u, 0, 0, 0));
            Thread.Sleep(60);
          }
        } else if (step.ContainsKey("type")) {
          Thread.Sleep(60);
          if (!Reaches(w, GetForegroundWindow())) { stopped = "lost_focus"; break; }
          if (FocusedIsSecret()) { stopped = "secret_field"; break; }
          foreach (char ch in Convert.ToString(step["type"])) {
            if (userTookOver) break;
            Send(Key(0, ch, 0x0004 /* UNICODE */));
            Send(Key(0, ch, 0x0004 | 0x0002 /* KEYUP */));
            Thread.Sleep(6);
          }
        } else if (step.ContainsKey("key")) {
          if (!Reaches(w, GetForegroundWindow())) { stopped = "lost_focus"; break; }
          var vks = new List<ushort>();
          foreach (var part in Convert.ToString(step["key"]).Split('+')) vks.Add(Vk(part.Trim()));
          foreach (var vk in vks) { Send(Key(vk, 0, 0)); held.Add(vk); }
          for (int i = vks.Count - 1; i >= 0; i--) { Send(Key(vks[i], 0, 0x0002)); held.Remove(vks[i]); }
        } else if (step.ContainsKey("scroll")) {
          var c = (Dictionary<string, object>)step["scroll"];
          var pt = ClickPoint(w, c);
          if (!Reaches(w, WindowFromPoint(pt))) { stopped = "covered"; break; }
          MoveTo(pt.X, pt.Y);
          Thread.Sleep(30);
          Send(Mouse(0x0800 /* WHEEL */, unchecked((uint)(-Int(c, "dy", 1) * 120)), 0, 0));
        } else if (step.ContainsKey("wait")) {
          int ms = Math.Min(5000, Math.Max(0, Convert.ToInt32(step["wait"])));
          for (int t = 0; t < ms && !userTookOver; t += 50) Thread.Sleep(50);
        }
        if (userTookOver) break;
        done++;
        Thread.Sleep(80);
      }
    } finally {
      foreach (var vk in held) Send(Key(vk, 0, 0x0002));   // never leave a key down
      PostThreadMessage(watcher, 0x0012 /* WM_QUIT */, IntPtr.Zero, IntPtr.Zero);
      CloseGlow(glow);
      // Put things back: DEX's window parked again, the user's window in
      // front (unless they've since picked another), and — if they didn't
      // take the mouse — the pointer where it was.
      if (wasParked && IsWindow(w.H)) Park(w.H);
      IntPtr fgNow = GetForegroundWindow();
      if (prevFg != IntPtr.Zero && prevFg != w.H && IsWindow(prevFg) && IsWindowVisible(prevFg) && (fgNow == w.H || fgNow == IntPtr.Zero || !userTookOver)) Activate(prevFg);
      // Back where it was. A plain move, once it's out of front: restoring
      // the placement of the active window pulls it onto a screen.
      if (moved && !wasParked && IsWindow(w.H)) {
        if (GetForegroundWindow() == w.H) {
          // Nothing of the user's to hand the front back to: minimizing hands it to the next window, as Park does.
          ShowWindow(w.H, SW_SHOWMINNOACTIVE);
          original.showCmd = SW_SHOWNOACTIVATE; original.flags = 0;
          SetWindowPlacement(w.H, ref original);
        } else {
          SetWindowPos(w.H, IntPtr.Zero, before.Left, before.Top, 0, 0, 0x0001 | 0x0004 | 0x0010 /* NOSIZE | NOZORDER | NOACTIVATE */);
        }
      }
      if (!userTookOver) SetCursorPos(prevCursor.X, prevCursor.Y);
      // DEX's own input isn't the user's hand on a parked window.
      var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
      GetLastInputInfo(ref li);
      if (!userTookOver) watchedInput = li.dwTime;
    }
    if (userTookOver) stopped = "user_took_over";
    var res = new Dictionary<string, object> { { "borrowed", true }, { "stepsDone", done }, { "steps", steps.Length }, { "movedOnScreen", moved } };
    if (stopped == "user_took_over") { res["stopped"] = stopped; res["hint"] = "The user moved the mouse or typed, so DEX let go. Don't fight them: wait until they pause, or ask."; }
    if (stopped == "covered") { res["stopped"] = stopped; res["hint"] = "Another window covers that point, so DEX didn't click. Capture the window again and aim at what's visible, or tell the user."; }
    if (stopped == "lost_focus") { res["stopped"] = stopped; res["hint"] = "The app lost the front before DEX could type, so it stopped. Try again, or tell the user."; }
    if (stopped == "secret_field") { res["stopped"] = stopped; res["hint"] = "The focused field is a password box. DEX doesn't type there; ask the user to."; }
    return res;
  }
}
