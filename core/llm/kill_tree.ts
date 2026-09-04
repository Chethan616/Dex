/**
 * Stopping a child process and everything it started.
 *
 * `child.kill()` signals one process. On Windows that is not the process doing
 * the work: npm installs its global "binaries" as shims, so `claude` is
 * `claude.cmd`, and spawning a `.cmd` means Node runs
 *
 *     cmd.exe /d /c claude.cmd …
 *
 * which starts `claude.exe` as a *grandchild*. `kill()` terminates `cmd.exe`
 * and leaves `claude.exe` running — still generating, still spending the
 * owner's subscription, with nothing left that will ever read the answer.
 *
 * That is what "I pressed Stop and it kept going" was. The Stop button did
 * reach the provider, the provider did call `kill()`, and the model carried on
 * to the end of a reply nobody would see.
 *
 * `taskkill /T` walks the tree. `/F` because a CLI mid-generation does not
 * stop for a polite request, and Stop means stop.
 */
import { spawn } from 'child_process';

/**
 * Kill a process and its descendants.
 *
 * Never throws and never waits: the caller has already given up on this
 * process, and a failure to kill something that may have exited on its own is
 * not worth an error path. On anything other than Windows the ordinary signal
 * already reaches the group.
 */
export function killTree(pid: number | undefined, fallback?: () => void): void {
  if (pid === undefined) {
    fallback?.();
    return;
  }

  if (process.platform !== 'win32') {
    try {
      // Negative pid is the process group, which is the POSIX equivalent of
      // what /T does. Falls back to the plain kill if the child was not made
      // a group leader.
      process.kill(-pid, 'SIGKILL');
    } catch {
      fallback?.();
    }
    return;
  }

  try {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    });
    // Unref'd so a core shutting down is not held open by the thing it used to
    // clean up after itself.
    killer.unref();
    killer.on('error', () => fallback?.());
  } catch {
    fallback?.();
  }
}
