<#
.SYNOPSIS
A disposable window for testing the UI Automation tier.

.DESCRIPTION
Slice 4.5's end-to-end test needs a real application with real controls, and
the obvious candidates are all bad choices:

  * Notepad on Windows 11 uses tabs, so launching it joins whatever window is
    already open. During development that was the owner's own document with
    unsaved work in it, and set_text would have replaced their text.
  * Calculator is UWP/WinUI, where UIA invocation is unreliable in ways that
    have nothing to do with Dex: digits registered while operators were
    silently dropped, and "5 + 3 =" came out as 53 with an empty expression.

So the test brings its own target. WinForms exposes a textbook accessibility
tree, this window owns no data anybody cares about, and it can be closed
without a save prompt.

The controls are named through AccessibleName, which is exactly what the UIA
tree exposes as Name — the same property `click_element` and `set_text` resolve
against.

.PARAMETER Title
Window title. Deliberately a single token with no spaces: Start-Process splits
an -ArgumentList entry on whitespace, so 'DEX UIA Fixture' arrives as just 'DEX'.
#>
param(
    [string]$Title = 'DEX_UIA_Fixture'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form                 = New-Object System.Windows.Forms.Form
$form.Text            = $Title
$form.Size            = New-Object System.Drawing.Size(460, 260)
$form.StartPosition   = 'CenterScreen'
$form.TopMost         = $true

$inputBox                = New-Object System.Windows.Forms.TextBox
$inputBox.AccessibleName = 'Input Field'
$inputBox.Location       = New-Object System.Drawing.Point(20, 30)
$inputBox.Size           = New-Object System.Drawing.Size(400, 28)

$result               = New-Object System.Windows.Forms.TextBox
$result.AccessibleName = 'Result Field'
$result.Location      = New-Object System.Drawing.Point(20, 80)
$result.Size          = New-Object System.Drawing.Size(400, 28)
$result.ReadOnly      = $true

$apply                = New-Object System.Windows.Forms.Button
$apply.AccessibleName = 'Apply Button'
$apply.Text           = 'Apply'
$apply.Location       = New-Object System.Drawing.Point(20, 130)
$apply.Size           = New-Object System.Drawing.Size(120, 36)

# NOTE: the textbox must not be called $input — that is a reserved PowerShell
# automatic variable (the pipeline enumerator), so $input.Text silently yields
# nothing and the handler appears not to run at all.
# Uppercasing proves the click was actually processed by the application, not
# merely delivered: a copied value could be explained by the textbox itself,
# a transformed one could not.
$apply.Add_Click({ $result.Text = $inputBox.Text.ToUpper() })

$check                = New-Object System.Windows.Forms.CheckBox
$check.AccessibleName = 'Enable Option'
$check.Text           = 'Option'
$check.Location       = New-Object System.Drawing.Point(170, 136)
$check.Size           = New-Object System.Drawing.Size(120, 24)

$secret               = New-Object System.Windows.Forms.TextBox
$secret.AccessibleName = 'Password Field'
$secret.UseSystemPasswordChar = $true
$secret.Location      = New-Object System.Drawing.Point(20, 180)
$secret.Size          = New-Object System.Drawing.Size(400, 28)

$form.Controls.AddRange(@($inputBox, $result, $apply, $check, $secret))
[void]$form.ShowDialog()
