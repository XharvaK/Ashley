use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{PhysicalPosition, WebviewWindow};

/// Gap from the work-area edge (above taskbar / beside tray clock).
const MARGIN_RIGHT: i32 = 6;
const MARGIN_BOTTOM: i32 = 2;

static POSITION_LOCKED: AtomicBool = AtomicBool::new(false);

pub fn is_position_locked() -> bool {
    POSITION_LOCKED.load(Ordering::Relaxed)
}

pub fn set_position_locked(locked: bool) {
    POSITION_LOCKED.store(locked, Ordering::Relaxed);
}

pub fn dock_bottom_right(window: &WebviewWindow) {
    if is_position_locked() {
        return;
    }

    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let work = monitor.work_area();
    let size = window.outer_size().unwrap_or_default();

    let x = work.position.x + work.size.width as i32 - size.width as i32 - MARGIN_RIGHT;
    let y = work.position.y + work.size.height as i32 - size.height as i32 - MARGIN_BOTTOM;

    let _ = window.set_position(PhysicalPosition::new(x, y));
}
