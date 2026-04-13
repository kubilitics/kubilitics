// Native app menu (R1.4): File, Edit, View, Help
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

pub fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<tauri::menu::Menu<R>, Box<dyn std::error::Error + Send + Sync>> {
    let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
    let close = PredefinedMenuItem::close_window(app, Some("Close"))?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&close)
        .item(&quit)
        .build()?;

    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .build()?;

    // Hard reload — bypasses HTTP cache so stale modules can't stick around.
    // Accelerator Cmd+Shift+R is used to force reload (Cmd+R does a soft reload).
    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let force_reload = MenuItemBuilder::with_id("force_reload", "Force Reload")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .text("refresh", "Refresh")
        .separator()
        .item(&reload)
        .item(&force_reload)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .text("docs", "Documentation")
        .text("about", "About Kubilitics")
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}
