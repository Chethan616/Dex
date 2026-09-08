//! Starting the Dex stack and keeping it alive for exactly as long as the app.
//!
//! Ported from `app/lib/core/supervisor/supervisor.dart`. Six steps, in order,
//! each probed rather than assumed: a spawn that returns is a claim, and the
//! only proof a process is up is that something answers.
//!
//! Children go into a Windows **job object** so they die with this process.
//! Without it, a crashed or force-quit app leaves a daemon, three agents and a
//! core running, and the next launch finds its ports taken.

use std::collections::HashMap;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::job::Job;
use crate::paths;

const DESKTOP_AGENT_PORT: u16 = 8765;
const BROWSER_AGENT_PORT: u16 = 8766;
const APP_AGENT_PORT: u16 = 8767;

/// The pipe the privileged daemon claims. Whether something answers on it is
/// the only honest answer to "is the daemon running".
const DAEMON_PIPE: &str = r"\\.\pipe\dex_privileged_daemon";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    Pending,
    Running,
    Done,
    Failed,
}

/// What the splash draws. Labels live in the UI, so only ids and states cross.
#[derive(Debug, Clone, Serialize)]
pub struct StepReport {
    pub id: &'static str,
    pub status: StepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Each step, in start order. `optional` steps may fail without blocking.
const STEPS: &[(&str, bool)] = &[
    ("preflight", false),
    ("daemon", false),
    ("app", false),
    ("desktop", true),
    ("browser", true),
    ("core", false),
];

pub struct Supervisor {
    state: Mutex<HashMap<&'static str, StepReport>>,
    children: Mutex<Vec<Child>>,
    job: Job,
    root: Mutex<Option<PathBuf>>,
}

impl Supervisor {
    #[must_use]
    pub fn new() -> Arc<Self> {
        let mut state = HashMap::new();
        for (id, _) in STEPS {
            state.insert(
                *id,
                StepReport {
                    id,
                    status: StepStatus::Pending,
                    detail: None,
                },
            );
        }
        Arc::new(Self {
            state: Mutex::new(state),
            children: Mutex::new(Vec::new()),
            job: Job::new(),
            root: Mutex::new(None),
        })
    }

    /// Progress, in start order, for the splash.
    #[must_use]
    pub fn report(&self) -> Vec<StepReport> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        STEPS
            .iter()
            .filter_map(|(id, _)| state.get(id).cloned())
            .collect()
    }

    fn set(&self, id: &'static str, status: StepStatus, detail: Option<String>) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.insert(id, StepReport { id, status, detail });
    }

    /// Start everything. Runs on its own thread; the UI polls `report()`.
    pub fn boot(self: &Arc<Self>) {
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            if !this.step_preflight() {
                return;
            }
            this.step("daemon", |s| s.start_daemon());
            this.step("app", |s| {
                s.start_python_agent("app", APP_AGENT_PORT, &["agents", "app", "server.py"])
            });
            this.step("desktop", |s| {
                s.start_python_agent(
                    "desktop",
                    DESKTOP_AGENT_PORT,
                    &["agents", "desktop", "server.py"],
                )
            });
            this.step("browser", |s| {
                s.start_python_agent(
                    "browser",
                    BROWSER_AGENT_PORT,
                    &["agents", "browser", "server.py"],
                )
            });
            this.step("core", |s| s.start_core());
        });
    }

    /// Re-run every failed step, leaving the ones that worked alone.
    pub fn retry(self: &Arc<Self>) {
        let failed: Vec<&'static str> = self
            .report()
            .iter()
            .filter(|r| r.status == StepStatus::Failed)
            .map(|r| r.id)
            .collect();
        if failed.is_empty() {
            return;
        }
        for id in &failed {
            self.set(id, StepStatus::Pending, None);
        }
        self.boot();
    }

    fn step(self: &Arc<Self>, id: &'static str, run: impl FnOnce(&Self) -> Result<(), String>) {
        self.set(id, StepStatus::Running, None);
        match run(self) {
            Ok(()) => self.set(id, StepStatus::Done, None),
            Err(why) => self.set(id, StepStatus::Failed, Some(why)),
        }
    }

    fn step_preflight(self: &Arc<Self>) -> bool {
        self.set("preflight", StepStatus::Running, None);

        let Some(root) = paths::dex_root() else {
            self.set(
                "preflight",
                StepStatus::Failed,
                Some(
                    "Could not find the Dex files. Set DEX_HOME to the folder containing \
                     daemon/DexDaemon.py."
                        .to_owned(),
                ),
            );
            return false;
        };

        if let Err(why) = paths::node_executable() {
            self.set("preflight", StepStatus::Failed, Some(why));
            return false;
        }
        if let Err(why) = paths::python_executable() {
            self.set("preflight", StepStatus::Failed, Some(why));
            return false;
        }

        *self.root.lock().unwrap_or_else(|e| e.into_inner()) = Some(root);
        self.set("preflight", StepStatus::Done, None);
        true
    }

    fn root(&self) -> Result<PathBuf, String> {
        self.root
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or_else(|| "the Dex tree was not located".to_owned())
    }

    fn start_daemon(&self) -> Result<(), String> {
        // Windows allows many pipe-server instances under one name, so the
        // daemon claims its pipe with FILE_FLAG_FIRST_PIPE_INSTANCE. If one
        // already answers, a second would silently take half the traffic.
        if pipe_answers() {
            return Ok(());
        }

        let root = self.root()?;
        let python = paths::python_executable()?;
        self.spawn(
            Command::new(python)
                .arg(root.join("daemon").join("DexDaemon.py"))
                .current_dir(&root),
        )?;

        wait_until(Duration::from_secs(20), pipe_answers)
            .then_some(())
            .ok_or_else(|| "the daemon started but never opened its pipe".to_owned())
    }

    fn start_python_agent(
        &self,
        name: &str,
        port: u16,
        script: &[&str],
    ) -> Result<(), String> {
        if port_answers(port) {
            return Ok(());
        }

        let root = self.root()?;
        let python = paths::python_executable()?;
        let mut path = root.clone();
        for part in script {
            path = path.join(part);
        }
        self.spawn(Command::new(python).arg(&path).current_dir(&root))?;

        wait_until(Duration::from_secs(45), || port_answers(port))
            .then_some(())
            .ok_or_else(|| {
                format!("the {name} agent started but never answered on port {port}")
            })
    }

    fn start_core(&self) -> Result<(), String> {
        if port_answers(dex_protocol::DEFAULT_PORT) {
            return Ok(());
        }

        // A stale handshake survives a killed core, and leaving it would let a
        // readiness check pass against a port nobody is listening on. Only
        // removed when nothing answers — a live core is not stale.
        let handshake = paths::handshake_file();
        if handshake.exists() {
            let _ = std::fs::remove_file(&handshake);
        }

        let root = self.root()?;
        let node = paths::node_executable()?;
        self.spawn(
            Command::new(node)
                .args(["-r", "ts-node/register", "src/main.ts"])
                .current_dir(&root)
                // Without this, main.ts starts a readline over a stdin that is
                // already closed and exits the moment it begins.
                .env("DEX_HEADLESS", "true"),
        )?;

        wait_until(Duration::from_secs(60), || {
            port_answers(dex_protocol::DEFAULT_PORT) && paths::handshake_file().exists()
        })
        .then_some(())
        .ok_or_else(|| "the core is starting but has not opened its socket yet".to_owned())
    }

    /// Spawn a child, put it in the job, and remember it.
    fn spawn(&self, command: &mut Command) -> Result<(), String> {
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start it: {e}"))?;

        self.job.adopt(&child);
        self.children
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(child);
        Ok(())
    }

    /// Stop everything this process started.
    ///
    /// The job object already guarantees it, but killing explicitly means a
    /// clean quit does not depend on process teardown ordering.
    pub fn shutdown(&self) {
        let mut children = self.children.lock().unwrap_or_else(|e| e.into_inner());
        for child in children.iter_mut() {
            let _ = child.kill();
        }
        children.clear();
    }
}

/// Poll until `check` passes or the deadline expires.
fn wait_until(timeout: Duration, check: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

/// Something is listening on loopback.
fn port_answers(port: u16) -> bool {
    TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        Duration::from_millis(400),
    )
    .is_ok()
}

/// Something answers on the daemon's named pipe.
fn pipe_answers() -> bool {
    // Opening the pipe is the probe; the daemon is the only thing that can
    // create it, so a successful open proves it is up.
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(DAEMON_PIPE)
        .is_ok()
}
