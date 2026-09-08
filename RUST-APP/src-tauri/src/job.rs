//! A Windows job object, so supervised processes die with this one.
//!
//! Without it, a crash or a force-quit leaves the daemon, three agents and the
//! core running, and the next launch finds its ports already taken. The Flutter
//! client solves this the same way in `win32_spawn.dart`.

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    pub struct Job(Option<HANDLE>);

    // SAFETY: a job-object HANDLE is a kernel handle with no thread affinity;
    // the Win32 calls used here are documented as thread-safe.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> Self {
            // SAFETY: passing null for both arguments creates an unnamed job
            // with default security, which is what the docs prescribe.
            let handle = unsafe { CreateJobObjectW(None, None) }.ok();

            if let Some(handle) = handle {
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                // The whole point: closing the job kills everything in it, and
                // the job closes when this process exits for any reason.
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                // SAFETY: `info` is a correctly-typed, fully-initialised struct
                // matching the information class, and its size is passed.
                let _ = unsafe {
                    SetInformationJobObject(
                        handle,
                        JobObjectExtendedLimitInformation,
                        std::ptr::from_ref(&info).cast(),
                        u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                            .unwrap_or(0),
                    )
                };
            }

            Self(handle)
        }

        /// Put a freshly spawned child into the job.
        pub fn adopt(&self, child: &Child) {
            let Some(job) = self.0 else { return };
            let handle = HANDLE(child.as_raw_handle());
            // SAFETY: both handles are live — the job is owned by self and the
            // child handle is owned by `child`, which outlives this call.
            let _ = unsafe { AssignProcessToJobObject(job, handle) };
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            if let Some(handle) = self.0.take() {
                // SAFETY: the handle came from CreateJobObjectW and is closed
                // exactly once, here.
                let _ = unsafe { CloseHandle(handle) };
            }
        }
    }
}

/// Everywhere else this is a no-op: the supervisor still kills its children on
/// shutdown, there is just no kernel guarantee behind it.
#[cfg(not(windows))]
mod imp {
    use std::process::Child;

    pub struct Job;

    impl Job {
        pub fn new() -> Self {
            Self
        }
        pub fn adopt(&self, _child: &Child) {}
    }
}

pub use imp::Job;
