use parking_lot::Mutex;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardState {
    Active,
    Pausing,
    Dormant,
    Resuming,
    Exiting,
}

#[derive(Debug, Deserialize, Clone)]
pub struct VramGuardConfig {
    pub enabled: bool,
    #[serde(default = "default_poll")]
    pub poll_interval_ms: u64,
    #[serde(default = "default_start")]
    pub game_start_confirm_polls: u32,
    #[serde(default = "default_end")]
    pub game_end_confirm_polls: u32,
    /// When true, fullscreen only counts if the foreground exe is a known game/heavy-GPU process.
    #[serde(default)]
    pub fullscreen_detection: bool,
    #[serde(default = "default_true")]
    pub process_detection: bool,
    #[serde(default = "default_true")]
    pub auto_reboot: bool,
    #[serde(default = "default_retries")]
    pub reboot_max_retries: u32,
    #[serde(default)]
    pub custom_game_processes: Vec<String>,
    #[serde(default)]
    pub ignored_processes: Vec<String>,
}

fn default_poll() -> u64 {
    2000
}
fn default_start() -> u32 {
    2
}
fn default_end() -> u32 {
    3
}
fn default_true() -> bool {
    true
}
fn default_retries() -> u32 {
    3
}

impl Default for VramGuardConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            poll_interval_ms: 2000,
            game_start_confirm_polls: 2,
            game_end_confirm_polls: 3,
            fullscreen_detection: false,
            process_detection: true,
            auto_reboot: true,
            reboot_max_retries: 3,
            custom_game_processes: vec![],
            ignored_processes: vec![
                "vlc.exe".into(),
                "explorer.exe".into(),
                "chrome.exe".into(),
                "msedge.exe".into(),
                "firefox.exe".into(),
                "ApplicationFrameHost.exe".into(),
                "Video.UI.exe".into(),
                "SearchHost.exe".into(),
            ],
        }
    }
}

pub struct VramGuard {
    pub state: Mutex<GuardState>,
    pub config: VramGuardConfig,
    game_processes: Vec<String>,
    heavy_gpu_processes: Vec<String>,
}

impl VramGuard {
    pub fn load(config_path: &PathBuf, games_path: &PathBuf) -> Self {
        let mut config = VramGuardConfig::default();
        if let Ok(data) = std::fs::read_to_string(config_path) {
            if let Ok(file) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(vg) = file.get("vram_guard") {
                    if let Ok(c) = serde_json::from_value::<VramGuardConfig>(vg.clone()) {
                        config = c;
                    }
                }
            }
        }

        let mut game_processes = Vec::new();
        let mut heavy_gpu_processes = Vec::new();
        if let Ok(data) = std::fs::read_to_string(games_path) {
            if let Ok(file) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(arr) = file.get("processes").and_then(|v| v.as_array()) {
                    for p in arr {
                        if let Some(s) = p.as_str() {
                            game_processes.push(s.to_lowercase());
                        }
                    }
                }
                if let Some(arr) = file.get("heavy_gpu_processes").and_then(|v| v.as_array()) {
                    for p in arr {
                        if let Some(s) = p.as_str() {
                            heavy_gpu_processes.push(s.to_lowercase());
                        }
                    }
                }
            }
        }
        for p in &config.custom_game_processes {
            game_processes.push(p.to_lowercase());
        }

        Self {
            state: Mutex::new(GuardState::Active),
            config,
            game_processes,
            heavy_gpu_processes,
        }
    }

    pub fn is_game_detected(&self) -> bool {
        if !self.config.enabled {
            return false;
        }
        if self.config.process_detection && self.detect_target_process() {
            return true;
        }
        if self.config.fullscreen_detection && self.detect_fullscreen_target() {
            return true;
        }
        false
    }

    fn tasklist_lower(&self) -> Option<String> {
        let output = std::process::Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&output.stdout).to_lowercase())
    }

    fn list_contains_process(text: &str, name: &str) -> bool {
        text.contains(name)
    }

    fn detect_target_process(&self) -> bool {
        let Some(text) = self.tasklist_lower() else {
            return false;
        };
        for game in &self.game_processes {
            if Self::list_contains_process(&text, game) {
                return true;
            }
        }
        for heavy in &self.heavy_gpu_processes {
            if Self::list_contains_process(&text, heavy) {
                return true;
            }
        }
        false
    }

    #[cfg(windows)]
    fn foreground_exe_lower() -> Option<String> {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };

        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 || pid == std::process::id() {
                return None;
            }
            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
                .output()
                .ok()?;
            let line = String::from_utf8_lossy(&output.stdout);
            let first = line.lines().next()?.trim();
            let name = first.split(',').next()?.trim_matches('"').to_lowercase();
            if name.is_empty() {
                None
            } else {
                Some(name)
            }
        }
    }

    fn is_target_exe(&self, exe: &str) -> bool {
        if self.config.ignored_processes.iter().any(|i| i.eq_ignore_ascii_case(exe)) {
            return false;
        }
        self.game_processes.iter().any(|g| g == exe)
            || self.heavy_gpu_processes.iter().any(|h| h == exe)
    }

    fn detect_fullscreen_target(&self) -> bool {
        #[cfg(windows)]
        {
            let Some(exe) = Self::foreground_exe_lower() else {
                return false;
            };
            if !self.is_target_exe(&exe) {
                return false;
            }
            return self.detect_fullscreen_foreground();
        }
        #[cfg(not(windows))]
        false
    }

    fn detect_fullscreen_foreground(&self) -> bool {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::RECT;
            use windows::Win32::UI::WindowsAndMessaging::{
                GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic,
            };

            unsafe {
                let hwnd = GetForegroundWindow();
                if hwnd.0.is_null() || IsIconic(hwnd).as_bool() {
                    return false;
                }
                let mut rect = RECT::default();
                if GetWindowRect(hwnd, &mut rect).is_err() {
                    return false;
                }
                let w = rect.right - rect.left;
                let h = rect.bottom - rect.top;
                let screen_w = windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                    windows::Win32::UI::WindowsAndMessaging::SM_CXSCREEN,
                );
                let screen_h = windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                    windows::Win32::UI::WindowsAndMessaging::SM_CYSCREEN,
                );
                let fullscreen = w >= screen_w - 8 && h >= screen_h - 8;
                if !fullscreen {
                    return false;
                }
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid == 0 || pid == std::process::id() {
                    return false;
                }
                return true;
            }
        }
        #[cfg(not(windows))]
        false
    }
}

pub async fn verify_vram_freed() -> bool {
    let output = tokio::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=memory.used",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await;
    match output {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Ok(mb) = s.trim().parse::<u32>() {
                return mb < 500;
            }
            true
        }
        _ => true,
    }
}

pub type SharedGuard = Arc<VramGuard>;

pub async fn run_guard_loop(
    guard: SharedGuard,
    on_game_start: impl Fn() + Send + Sync + 'static,
    on_game_end: impl Fn() + Send + Sync + 'static,
) {
    let mut game_start_count = 0u32;
    let mut game_end_count = 0u32;

    loop {
        let interval = guard.config.poll_interval_ms;
        tokio::time::sleep(Duration::from_millis(interval)).await;

        if !guard.config.enabled {
            continue;
        }

        let state = *guard.state.lock();
        let detected = guard.is_game_detected();

        match state {
            GuardState::Active => {
                if detected {
                    game_start_count += 1;
                    if game_start_count >= guard.config.game_start_confirm_polls {
                        game_start_count = 0;
                        *guard.state.lock() = GuardState::Pausing;
                        on_game_start();
                    }
                } else {
                    game_start_count = 0;
                }
            }
            GuardState::Dormant => {
                if !detected {
                    game_end_count += 1;
                    if game_end_count >= guard.config.game_end_confirm_polls {
                        game_end_count = 0;
                        if guard.config.auto_reboot {
                            *guard.state.lock() = GuardState::Resuming;
                            on_game_end();
                        }
                    }
                } else {
                    game_end_count = 0;
                }
            }
            _ => {
                game_start_count = 0;
                game_end_count = 0;
            }
        }
    }
}
