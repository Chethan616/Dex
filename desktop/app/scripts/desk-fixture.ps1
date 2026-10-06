# A test window for DEX's Windows tools (docs/desktop-control/PLAN.md §4.1.10):
# shown without activation, off every screen, so it never takes the user's
# focus. Prints {"hwnd":…} once it's up, logs what happens to it to -Log,
# and closes when stdin closes or after -Seconds.
param([string]$Log = (Join-Path $env:TEMP 'dex-desk-fixture.log'), [int]$Seconds = 120)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.IO; using System.Windows.Forms;
public class DeskFixture : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  readonly string log;
  void Note(string s) { File.AppendAllText(log, DateTime.Now.ToString("HH:mm:ss.fff") + " " + s + Environment.NewLine); }
  public DeskFixture(string logPath) {
    log = logPath;
    Text = "DEX desk fixture"; StartPosition = FormStartPosition.Manual; ShowInTaskbar = false;
    Location = new Point(SystemInformation.VirtualScreen.Right + 300, SystemInformation.VirtualScreen.Top); Size = new Size(420, 320);
    var press = new Button { Name = "pressMe", Text = "Press me", Location = new Point(10, 10), Width = 120 };
    press.Click += (s, e) => Note("pressed");
    var box = new TextBox { Name = "box", Location = new Point(10, 45), Width = 260 };
    box.TextChanged += (s, e) => Note("text=" + box.Text);
    var secret = new TextBox { Name = "secret", Location = new Point(10, 75), Width = 260, UseSystemPasswordChar = true, Text = "hunter22" };
    var check = new CheckBox { Name = "check", Text = "Enable shuffle", Location = new Point(10, 105), Width = 200 };
    check.CheckedChanged += (s, e) => Note("checked=" + check.Checked);
    var list = new ListBox { Name = "list", Location = new Point(10, 135), Height = 70, Width = 200 };
    list.Items.AddRange(new object[] { "Discover Weekly", "Liked Songs", "Daily Mix 1" });
    list.SelectedIndexChanged += (s, e) => Note("selected=" + list.SelectedItem);
    var combo = new ComboBox { Name = "combo", Location = new Point(10, 215), Width = 200, DropDownStyle = ComboBoxStyle.DropDownList };
    combo.Items.AddRange(new object[] { "Off", "Track", "List" });
    Controls.AddRange(new Control[] { press, box, secret, check, list, combo });
    Activated += (s, e) => Note("ACTIVATED");
  }
}
'@
$form = New-Object DeskFixture $Log
$form.Add_Shown({ [Console]::Out.WriteLine('{"hwnd":' + $form.Handle.ToInt64() + '}'); [Console]::Out.Flush() })
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $Seconds * 1000
$timer.Add_Tick({ $form.Close() })
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
