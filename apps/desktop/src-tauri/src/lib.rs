mod boot;
mod overlay_position;
mod vram_guard;

use boot::{
    boot_voice, check_health, pause_all, resume_agent, wait_boot_sequence, AGENT_URL, VOICE_URL,
};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use overlay_position::{dock_bottom_right, is_position_locked, set_position_locked};
use vram_guard::{run_guard_loop, verify_vram_freed, GuardState, SharedGuard, VramGuard};

struct AppState {
    guard: SharedGuard,
    tray_label: Mutex<String>,
}

fn data_config_path() -> PathBuf {
    dirs_home().join(".composer-assistant").join("config.json")
}

fn games_config_path() -> PathBuf {
    // Bundled games.json relative to repo when dev
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("..")
        .join("config")
        .join("games.json");
    if dev.exists() {
        return dev;
    }
    dirs_home()
        .join(".composer-assistant")
        .join("games.json")
}

fn dirs_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn emit_state(app: &AppHandle, state: &str, label: &str) {
    let _ = app.emit(
        "assistant-state",
        serde_json::json!({ "state": state, "label": label }),
    );
}

fn set_tray_tooltip(app: &AppHandle, label: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(label));
    }
}

async fn sse_bridge(app: AppHandle) {
    let client = reqwest::Client::new();
    loop {
        match client
            .get(format!("{AGENT_URL}/events"))
            .send()
            .await
        {
            Ok(resp) => {
                use futures_util::StreamExt;
                let mut stream = resp.bytes_stream();
                let mut buf = String::new();
                while let Some(chunk) = stream.next().await {
                    if let Ok(bytes) = chunk {
                        buf.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(pos) = buf.find("\n\n") {
                            let frame = buf.drain(..=pos).collect::<String>();
                            for line in frame.lines() {
                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Ok(val) =
                                        serde_json::from_str::<serde_json::Value>(data)
                                    {
                                        let _ = app.emit("sse-event", val);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(_) => {}
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

async fn handle_game_start(app: AppHandle, guard: SharedGuard) {
    emit_state(&app, "booting", "Freeing GPU...");
    set_tray_tooltip(&app, "Freeing GPU...");
    let _ = pause_all().await;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let _ = verify_vram_freed().await;
    *guard.state.lock() = GuardState::Dormant;
    emit_state(&app, "booting", "Paused — game running");
    set_tray_tooltip(&app, "Paused — game running");
}

async fn handle_game_end(app: AppHandle, guard: SharedGuard) {
    emit_state(&app, "booting", "Resuming...");
    set_tray_tooltip(&app, "Resuming...");
    let mut retries = 0;
    let max = guard.config.reboot_max_retries;
    loop {
        if boot::boot_voice().await.is_ok() && resume_agent().await.is_ok() {
            if wait_boot_sequence(120).await {
                *guard.state.lock() = GuardState::Active;
                emit_state(&app, "idle", "Ready");
                set_tray_tooltip(&app, "Ready");
                return;
            }
        }
        retries += 1;
        if retries >= max {
            *guard.state.lock() = GuardState::Dormant;
            emit_state(&app, "error", "Resume failed — click to retry");
            set_tray_tooltip(&app, "Resume failed — click to retry");
            return;
        }
        let delay = 2u64.pow(retries);
        tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
    }
}

#[tauri::command]
async fn start_services(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    emit_state(&app, "booting", "Booting...");
    set_tray_tooltip(&app, "Starting...");

    let _ = boot_voice().await;
    let _ = resume_agent().await;

    let deadline =
        tokio::time::Instant::now() + std::time::Duration::from_secs(90);
    while tokio::time::Instant::now() < deadline {
        let (agent, voice) = tokio::join!(
            check_health(AGENT_URL),
            check_health(VOICE_URL),
        );
        if agent && voice {
            *state.guard.state.lock() = GuardState::Active;
            emit_state(&app, "idle", "Ready");
            set_tray_tooltip(&app, "Ready");
            return Ok(());
        }
        if !agent {
            emit_state(&app, "booting", "Agent bekleniyor…");
            set_tray_tooltip(&app, "Waiting for agent");
        } else if !voice {
            emit_state(&app, "booting", "Ses servisi başlatılıyor…");
            set_tray_tooltip(&app, "Starting voice");
            let _ = boot_voice().await;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    emit_state(
        &app,
        "error",
        "Servisler hazır değil — scripts/dev.ps1",
    );
    set_tray_tooltip(&app, "Boot failed");
    Err("services not ready".into())
}

#[tauri::command]
fn get_position_locked() -> bool {
    is_position_locked()
}

#[tauri::command]
fn toggle_position_lock() -> bool {
    let next = !is_position_locked();
    set_position_locked(next);
    next
}

#[derive(serde::Serialize)]
struct PttToggleState {
    listening: bool,
}

#[tauri::command]
async fn toggle_ptt() -> Result<PttToggleState, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{VOICE_URL}/ptt/toggle"))
        .send()
        .await
        .map_err(|_| "Voice service unavailable".to_string())?;
    if resp.status().as_u16() == 409 {
        return Err("Ashley is still processing the last request".into());
    }
    let body: serde_json::Value = resp
        .error_for_status()
        .map_err(|e| format!("Voice service error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Voice service error: {e}"))?;
    Ok(PttToggleState {
        listening: body
            .get("listening")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

#[tauri::command]
async fn retry_resume(app: AppHandle) -> Result<(), String> {
    let guard = app.state::<AppState>().guard.clone();
    *guard.state.lock() = GuardState::Resuming;
    handle_game_end(app, guard).await;
    Ok(())
}

#[tauri::command]
async fn quit_app(app: AppHandle) -> Result<(), String> {
    *app.state::<AppState>().guard.state.lock() = GuardState::Exiting;
    let _ = boot::post_empty(VOICE_URL, "/pause").await;
    let _ = boot::post_empty(AGENT_URL, "/shutdown").await;
    boot::kill_orpheus_processes();
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let guard = Arc::new(VramGuard::load(
                &data_config_path(),
                &games_config_path(),
            ));

            app.manage(AppState {
                guard: guard.clone(),
                tray_label: Mutex::new("Booting...".into()),
            });

            let show_i = MenuItem::with_id(app, "show", "Show overlay", true, None::<&str>)?;
            let retry_i =
                MenuItem::with_id(app, "retry", "Retry resume", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &retry_i, &quit_i])?;

            if let Some(main) = app.get_webview_window("main") {
                dock_bottom_right(&main);
                let dock_win = main.clone();
                main.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. }) {
                        dock_bottom_right(&dock_win);
                    }
                });
            }

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Ashley Assistant")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            dock_bottom_right(&w);
                            let _ = w.show();
                        }
                    }
                    "retry" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = retry_resume(app).await;
                        });
                    }
                    "quit" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = quit_app(app).await;
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            dock_bottom_right(&w);
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            let app_sse = app.handle().clone();
            tauri::async_runtime::spawn(sse_bridge(app_sse));

            let app_start = app.handle().clone();
            let app_end = app.handle().clone();
            let guard_start = guard.clone();
            let guard_end = guard.clone();
            tauri::async_runtime::spawn(async move {
                run_guard_loop(
                    guard_start.clone(),
                    move || {
                        let a = app_start.clone();
                        let g = guard_start.clone();
                        tauri::async_runtime::spawn(async move {
                            handle_game_start(a, g).await;
                        });
                    },
                    move || {
                        let a = app_end.clone();
                        let g = guard_end.clone();
                        tauri::async_runtime::spawn(async move {
                            handle_game_end(a, g).await;
                        });
                    },
                )
                .await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_services,
            toggle_ptt,
            retry_resume,
            quit_app,
            get_position_locked,
            toggle_position_lock
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri");
}
