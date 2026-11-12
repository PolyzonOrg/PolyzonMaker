//! The icon beside the clock on Windows and in the menu bar on a Mac: closing the window leaves the
//! queue running there, and quitting is its menu's job (owner, 2026-11-10). Linux keeps its close
//! button: a tray there needs a system library not every desktop has, and a hidden window with no
//! icon to bring it back would look like a crash.
use crate::{
    jobs::Jobs,
    packs::Packs,
    store::{Settings, Store},
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tauri_plugin_notification::NotificationExt;

const ID: &str = "main";
/// Width and height of icons/tray-template.rgba, in pixels
const TEMPLATE: (u32, u32) = (34, 36);

/// The window back where it was, in front.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Whether the close button hides the window: only where the icon is there to bring it back.
pub fn holds(app: &AppHandle) -> bool {
    app.tray_by_id(ID).is_some()
}

/// Its two lines, in Russian or in English.
fn menu(app: &AppHandle, ru: bool) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, "open", if ru { "Открыть Polyzon Maker" } else { "Open Polyzon Maker" }, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", if ru { "Выйти" } else { "Quit" }, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])
}

/// The page's language, which the menu and the notices speak
static RU: AtomicBool = AtomicBool::new(false);

/// The menu in the language the page shows: it says so at its start and at every change, «as the system» included.
pub fn relabel(app: &AppHandle, ru: bool) -> tauri::Result<()> {
    RU.store(ru, Ordering::Relaxed);
    match app.tray_by_id(ID) {
        Some(tray) => tray.set_menu(Some(menu(app, ru)?)),
        None => Ok(()),
    }
}

/// The icon and its menu, in the language the settings name until the page says which it shows.
pub fn attach(app: &AppHandle) -> tauri::Result<()> {
    let ru = app.state::<Arc<Store>>().settings().language == "ru";
    RU.store(ru, Ordering::Relaxed);
    if cfg!(target_os = "linux") {
        return Ok(());
    }
    let menu = menu(app, ru)?;
    let mut tray = TrayIconBuilder::with_id(ID)
        .tooltip("Polyzon Maker")
        .menu(&menu)
        // a Mac opens a menu bar icon's menu on a click; Windows opens the window and keeps the menu for the right button
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show(app),
            "quit" => leave(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if !cfg!(target_os = "macos") {
                    show(tray.app_handle());
                }
            }
        });
    if cfg!(target_os = "macos") {
        // the menu bar wants a template: a black shape the system colours for a light or a dark bar. The boat
        // of public/boat.svg at the bar's 18 pt, 2×, as raw RGBA, so no image decoder is built in for it
        let rgba = include_bytes!("../icons/tray-template.rgba").to_vec();
        tray = tray.icon(Image::new_owned(rgba, TEMPLATE.0, TEMPLATE.1)).icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// What the queue did since it last ran out. It is told once, when nothing more waits: a night's queue
/// should not ring after every model.
#[derive(Default)]
pub struct Tally {
    done: usize,
    failed: usize,
}

impl Tally {
    /// Counts a job that just ended. When nothing more waits, gives (done, failed) if there is any, and starts again.
    pub fn after(&mut self, state: &str, waiting: bool) -> Option<(usize, usize)> {
        match state {
            "succeeded" => self.done += 1,
            "failed" => self.failed += 1,
            _ => {} // cancelled by the person: not news to them
        }
        if waiting {
            return None;
        }
        let told = (self.done, self.failed);
        *self = Self::default();
        (told != (0, 0)).then_some(told)
    }
}

/// The notice's title and line.
pub fn news(done: usize, failed: usize, ru: bool) -> Option<(&'static str, String)> {
    let say = |ru_text: &'static str, en: &'static str| if ru { ru_text } else { en };
    Some(match (done, failed) {
        (0, 0) => return None,
        (1, 0) => (say("Генерация готова", "Generation ready"), say("Результат ждёт в Polyzon Maker", "The result is waiting in Polyzon Maker").into()),
        (n, 0) => (say("Очередь готова", "Queue done"), if ru { format!("Готово генераций: {n}") } else { format!("{n} generations ready") }),
        (0, 1) => (say("Генерация не получилась", "A generation failed"), say("Почему — сказано в Polyzon Maker", "Polyzon Maker says why").into()),
        (0, n) => (say("Генерации не получились", "Generations failed"), if ru { format!("Не получилось: {n}. Почему — сказано в Polyzon Maker") } else { format!("{n} failed. Polyzon Maker says why") }),
        (d, f) => (say("Очередь закончилась", "Queue finished"), if ru { format!("Готово: {d}, не получилось: {f}") } else { format!("{d} ready, {f} failed") }),
    })
}

/// A system notice of how the queue went, unless the person is looking at the window anyway.
pub fn tell(app: &AppHandle, done: usize, failed: usize) {
    let looking = app.get_webview_window("main").is_some_and(|w| {
        w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false)
    });
    if let (false, Some((title, line))) = (looking, news(done, failed, RU.load(Ordering::Relaxed))) {
        let _ = app.notification().builder().title(title).body(line).show();
    }
}

/// Beside the data: an update that went in from the tray brings the window back to it. Fresh for a while only,
/// in case the install never got to start the program again.
const MARK: &str = "start-in-tray";
const MARK_FRESH: Duration = Duration::from_secs(15 * 60);

/// A downloaded update goes in when the program waits in the tray with nothing to do, as it went in when the window
/// closed before the tray: a person who never quits would otherwise keep the old version for good.
pub fn update_now(hidden: bool, busy: bool, settings: &Settings, downloaded: bool) -> bool {
    hidden && !busy && downloaded && !settings.updates_off && !settings.updates_manual
}

pub fn going(data: &Path) {
    let _ = std::fs::write(data.join(MARK), "");
}

/// Whether this start is the update's, so the window stays in the tray as it was; the mark is used once.
pub fn came_back(data: &Path) -> bool {
    let mark = data.join(MARK);
    let fresh = std::fs::metadata(&mark).and_then(|m| m.modified()).is_ok_and(|t| SystemTime::now().duration_since(t).is_ok_and(|age| age < MARK_FRESH));
    let _ = std::fs::remove_file(mark);
    fresh
}

/// Called now and then: installs what was downloaded when update_now says so. On Windows the installer takes
/// over and starts the new version, which finds the mark and stays in the tray.
pub fn update_if_away(app: &AppHandle) {
    if !holds(app) {
        return;
    }
    let hidden = app.get_webview_window("main").and_then(|w| w.is_visible().ok()).is_some_and(|shown| !shown);
    let busy = app.state::<Arc<Jobs>>().busy() || app.state::<Packs>().busy();
    let store = app.state::<Arc<Store>>();
    let fetched = app.state::<crate::Fetched>();
    let downloaded = fetched.0.lock().unwrap().is_some();
    if !update_now(hidden, busy, &store.settings(), downloaded) {
        return;
    }
    let Some((update, bytes)) = fetched.0.lock().unwrap().take() else { return };
    going(store.data());
    app.state::<Arc<crate::assistant::Assistant>>().stop();
    match update.install(bytes) {
        Ok(()) => app.restart(), // where the install does not end the program itself
        Err(_) => {
            let _ = came_back(store.data()); // the mark goes: nothing is coming back
        }
    }
}

/// Quitting from the menu: with work on its way the window comes back and asks first, as the close button did.
fn leave(app: &AppHandle) {
    let busy = app.state::<Arc<Jobs>>().busy() || app.state::<Packs>().busy();
    if busy {
        show(app);
        crate::news(app, "close-requested", ());
    } else {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Settings;

    #[test]
    fn a_downloaded_update_goes_in_only_while_the_program_waits_in_the_tray_with_nothing_to_do() {
        let auto = Settings::default();
        assert!(update_now(true, false, &auto, true));
        assert!(!update_now(false, false, &auto, true), "the window is open: the person may be working");
        assert!(!update_now(true, true, &auto, true), "a generation or a download is on its way");
        assert!(!update_now(true, false, &auto, false), "nothing downloaded");
        assert!(!update_now(true, false, &Settings { updates_manual: true, ..Settings::default() }, true), "the person installs by hand");
        assert!(!update_now(true, false, &Settings { updates_off: true, ..Settings::default() }, true));
    }

    #[test]
    fn back_from_such_an_update_it_stays_in_the_tray_but_only_right_after_it() {
        let dir = std::env::temp_dir().join(format!("maker-tray-{}", crate::store::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!came_back(&dir), "no mark: an ordinary start shows the window");
        going(&dir);
        assert!(came_back(&dir));
        assert!(!came_back(&dir), "the mark is used once");
        // a mark left by an update that never finished is old by the next start
        going(&dir);
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        std::fs::File::options().write(true).open(dir.join(MARK)).unwrap().set_modified(old).unwrap();
        assert!(!came_back(&dir));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_queue_says_once_what_it_did_when_it_runs_out() {
        let mut tally = Tally::default();
        assert_eq!(tally.after("succeeded", true), None, "more waits: no notice in the middle of the night");
        assert_eq!(tally.after("cancelled", true), None);
        assert_eq!(tally.after("failed", true), None);
        assert_eq!(tally.after("succeeded", false), Some((2, 1)), "the person cancelled one: it is not news");
        assert_eq!(tally.after("succeeded", false), Some((1, 0)), "and the count starts again");
        assert_eq!(tally.after("cancelled", false), None, "only a cancel: nothing to say");
        // a paused queue still holds what waits: the notice comes when that has run too
        assert_eq!(tally.after("succeeded", true), None);
        assert_eq!(tally.after("succeeded", false), Some((2, 0)));
    }

    #[test]
    fn the_notice_says_how_it_went_in_the_pages_language() {
        assert_eq!(news(1, 0, true), Some(("Генерация готова", "Результат ждёт в Polyzon Maker".into())));
        assert_eq!(news(3, 0, false), Some(("Queue done", "3 generations ready".into())));
        assert_eq!(news(0, 1, true).unwrap().0, "Генерация не получилась");
        assert_eq!(news(0, 2, false), Some(("Generations failed", "2 failed. Polyzon Maker says why".into())));
        assert_eq!(news(2, 1, true), Some(("Очередь закончилась", "Готово: 2, не получилось: 1".into())));
        assert_eq!(news(0, 0, true), None);
    }

    #[test]
    fn the_menu_bar_icon_is_a_black_shape_of_its_stated_size() {
        let rgba = include_bytes!("../icons/tray-template.rgba");
        assert_eq!(rgba.len() as u32, TEMPLATE.0 * TEMPLATE.1 * 4);
        let pixels: Vec<&[u8]> = rgba.chunks(4).collect();
        // a template is read by its alpha alone: anything coloured would show as a smudge
        assert!(pixels.iter().all(|p| p[3] == 0 || p[..3] == [0, 0, 0]));
        let shown = pixels.iter().filter(|p| p[3] > 128).count();
        assert!(shown > pixels.len() / 5 && shown < pixels.len() * 4 / 5, "{shown} of {}", pixels.len());
    }
}
