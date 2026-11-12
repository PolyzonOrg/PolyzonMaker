//! Windows 11 shows its snap layouts only for a window whose maximize button answers the system's
//! hit test, and a page inside WebView2 never gets that question. So a small native window that
//! paints nothing lies over the page's button and answers for it. It takes the mouse there, so
//! hover and click are passed back. On Windows 10 the same window simply maximizes.

use std::{
    mem::{size_of, zeroed},
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicIsize, Ordering},
        OnceLock,
    },
};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows_sys::{
    core::w,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::{GetStockObject, NULL_BRUSH},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT},
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, GetClientRect, RegisterClassW, SetWindowPos, HTMAXBUTTON, HWND_TOP,
                SWP_NOACTIVATE, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE,
                WM_NCMOUSEMOVE, WNDCLASSW, WS_CHILD, WS_CLIPSIBLINGS, WS_VISIBLE,
            },
        },
    },
};

/// The same numbers as in TitleBar.svelte, in pixels at 100% scale
const BUTTON_WIDTH: i32 = 46;
const BAR_HEIGHT: i32 = 38;

static APP: OnceLock<AppHandle> = OnceLock::new();
static PARENT: AtomicIsize = AtomicIsize::new(0);
static OVER_BUTTON: AtomicIsize = AtomicIsize::new(0);

fn tell_page(over: bool) {
    if let Some(app) = APP.get() {
        crate::news(app, "snap", over);
    }
}

fn toggle() {
    if let Some(window) = APP.get().and_then(|app| app.get_webview_window("main")) {
        let _ = if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() };
    }
}

unsafe extern "system" fn procedure(hwnd: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match message {
        WM_NCHITTEST => HTMAXBUTTON as LRESULT,
        WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => 0,
        WM_NCLBUTTONUP => {
            toggle();
            0
        }
        WM_NCMOUSELEAVE => {
            tell_page(false);
            0
        }
        WM_NCMOUSEMOVE => {
            let mut track = TRACKMOUSEEVENT {
                cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_LEAVE | TME_NONCLIENT,
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            TrackMouseEvent(&mut track);
            tell_page(true);
            DefWindowProcW(hwnd, message, w, l)
        }
        _ => DefWindowProcW(hwnd, message, w, l),
    }
}

/// Over the page's maximize button, whatever the window's size and the screen's scale.
pub fn place() {
    let (parent, over) = (PARENT.load(Ordering::Relaxed), OVER_BUTTON.load(Ordering::Relaxed));
    if over == 0 {
        return;
    }
    // SAFETY: both are windows this module holds for as long as the app runs
    unsafe {
        let parent = parent as HWND;
        let dpi = GetDpiForWindow(parent) as i32;
        let scaled = |value: i32| value * dpi / 96;
        let mut client = zeroed();
        GetClientRect(parent, &mut client);
        let (x, width, height) = (client.right - scaled(BUTTON_WIDTH * 2), scaled(BUTTON_WIDTH), scaled(BAR_HEIGHT));
        SetWindowPos(over as HWND, HWND_TOP, x, 0, width, height, SWP_NOACTIVATE);
    }
}

/// Called when the page is up: WebView2's own window exists by then and ours goes on top of it.
pub fn attach(window: &WebviewWindow) {
    if OVER_BUTTON.load(Ordering::Relaxed) != 0 {
        return place();
    }
    let Ok(parent) = window.hwnd() else { return };
    let _ = APP.set(window.app_handle().clone());
    // SAFETY: a window class and a child window, built from values that outlive the calls
    unsafe {
        let instance = GetModuleHandleW(null());
        let class = w!("PolyzonMakerMaximize");
        let mut description: WNDCLASSW = zeroed();
        description.lpfnWndProc = Some(procedure);
        description.hInstance = instance;
        description.lpszClassName = class;
        description.hbrBackground = GetStockObject(NULL_BRUSH);
        RegisterClassW(&description);
        let style = WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS;
        let over = CreateWindowExW(0, class, null(), style, 0, 0, 0, 0, parent.0 as HWND, null_mut(), instance, null());
        PARENT.store(parent.0 as isize, Ordering::Relaxed);
        OVER_BUTTON.store(over as isize, Ordering::Relaxed);
    }
    place();
}
