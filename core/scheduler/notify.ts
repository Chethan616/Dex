/**
 * Telling the owner something, when nothing is watching the screen.
 *
 * A reminder that only appears inside the Dex window is a reminder you get if
 * you happened to be looking at Dex — which is the one situation where you did
 * not need reminding. So this raises a real Windows toast, from the core,
 * whether or not the app is open.
 *
 * **Windows' own notification API, through PowerShell.** The same route the
 * file indexer takes to `Windows.Media.Ocr`, and for the same reason: the
 * WinRT bindings for Node mean a native module to rebuild on every Node
 * upgrade, and `BurntToast` means asking the owner to install a PowerShell
 * module before a reminder works. `ToastNotificationManager` has shipped since
 * Windows 8 and is already on the machine.
 *
 * The text travels in environment variables rather than interpolated into the
 * script, so a reminder containing a quote, a dollar sign or a backtick is a
 * reminder rather than a syntax error — or worse, an injection into a shell
 * running as the owner.
 */
import { spawn } from 'child_process';

/**
 * The application the toast appears to come from.
 *
 * Windows requires a registered AppUserModelID to show a toast; PowerShell's
 * own is present on every machine and needs no install step. The cost is that
 * the notification says PowerShell in Action Center, which is a fair trade for
 * not asking the owner to register a shortcut before a reminder works.
 */
const APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

const SCRIPT = String.raw`
$title = $env:DEX_TOAST_TITLE
$body  = $env:DEX_TOAST_BODY
$appId = $env:DEX_TOAST_APPID

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
  [Windows.UI.Notifications.ToastTemplateType]::ToastText02
)
$texts = $template.GetElementsByTagName('text')
$texts.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
$texts.Item(1).AppendChild($template.CreateTextNode($body)) | Out-Null

$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

/** Long enough for a cold PowerShell start, short enough not to pile up. */
const TIMEOUT_MS = 20_000;

/**
 * Show a Windows notification.
 *
 * Fire and forget, and deliberately never throws: a reminder that could not be
 * shown is worth a log line, and is not worth taking down the scheduler that
 * still has other reminders to fire.
 */
export function notify(title: string, body: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            DEX_TOAST_TITLE: title.slice(0, 120),
            DEX_TOAST_BODY: body.slice(0, 400),
            DEX_TOAST_APPID: APP_ID,
          },
        },
      );
    } catch {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, TIMEOUT_MS);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
