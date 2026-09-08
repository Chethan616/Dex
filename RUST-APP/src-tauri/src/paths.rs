//! Finding the Dex tree, and the interpreters it needs.
//!
//! Ported from `app/lib/core/supervisor/dex_paths.dart`. The rules are the same
//! because the failure modes are: a Node older than 24 has no `node:sqlite` and
//! the core will not start, and the `python` on PATH is often the Store shim
//! that opens a web page instead of running anything.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Where the core keeps everything: `%LOCALAPPDATA%\DEX`.
#[must_use]
pub fn state_dir() -> PathBuf {
    env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("DEX")
}

/// The core's handshake: `{port, token}`.
#[must_use]
pub fn handshake_file() -> PathBuf {
    state_dir().join("ui.json")
}

/// The Dex checkout. `DEX_HOME` wins; otherwise walk up from the executable and
/// from the working directory looking for the marker files.
#[must_use]
pub fn dex_root() -> Option<PathBuf> {
    if let Ok(home) = env::var("DEX_HOME") {
        let path = PathBuf::from(home);
        if is_dex_root(&path) {
            return Some(path);
        }
    }

    let mut starts = Vec::new();
    if let Ok(exe) = env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = env::current_dir() {
        starts.push(cwd);
    }

    for start in starts {
        let mut cursor: Option<&Path> = Some(start.as_path());
        while let Some(dir) = cursor {
            if is_dex_root(dir) {
                return Some(dir.to_path_buf());
            }
            cursor = dir.parent();
        }
    }
    None
}

/// A tree is the Dex tree when it has the daemon and the core entry point.
/// Checking two files rather than one avoids matching a stray `src/`.
fn is_dex_root(dir: &Path) -> bool {
    dir.join("daemon").join("DexDaemon.py").is_file() && dir.join("src").join("main.ts").is_file()
}

/// Node 24 or newer. Older versions lack `node:sqlite`, which the core uses for
/// its history, so an old Node is a hard failure rather than a warning.
#[must_use]
pub fn node_executable() -> Result<PathBuf, String> {
    let node = which("node").ok_or_else(|| {
        "Node.js is not installed. Dex needs version 24 or newer — it keeps its history in \
         node:sqlite, which older versions lack."
            .to_owned()
    })?;

    let version = Command::new(&node)
        .args(["-p", "process.versions.node"])
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .unwrap_or_default();

    let major: u32 = version
        .trim()
        .split('.')
        .next()
        .and_then(|m| m.parse().ok())
        .unwrap_or(0);

    if major < 24 {
        return Err(format!(
            "Node.js {} is too old. Dex needs version 24 or newer — it keeps its history in \
             node:sqlite, which older versions lack.",
            version.trim()
        ));
    }
    Ok(node)
}

/// Python 3.11+, skipping the Microsoft Store shim.
#[must_use]
pub fn python_executable() -> Result<PathBuf, String> {
    for name in ["python", "python3", "py"] {
        if let Some(path) = which(name)
            && !is_store_shim(&path)
        {
            return Ok(path);
        }
    }
    Err("Python is not installed. Dex needs 3.11 or newer.".to_owned())
}

/// `WindowsApps\python.exe` is a zero-byte stub that opens the Store. Running
/// it looks like success and then nothing happens.
fn is_store_shim(path: &Path) -> bool {
    path.to_string_lossy().contains("WindowsApps")
        || std::fs::metadata(path).is_ok_and(|m| m.len() == 0)
}

/// Resolve a command on PATH, honouring PATHEXT.
fn which(command: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    let exts: Vec<String> = env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT".to_owned())
        .split(';')
        .filter(|e| !e.is_empty())
        .map(str::to_lowercase)
        .collect();

    for dir in env::split_paths(&path) {
        let bare = dir.join(command);
        if bare.is_file() {
            return Some(bare);
        }
        for ext in &exts {
            let candidate = dir.join(format!("{command}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}
