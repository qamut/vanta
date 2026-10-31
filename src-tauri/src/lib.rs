//! VANTA — Dynamic Island para Windows, macOS e Linux.

mod alarms;
mod audio;
// Linux/macOS; os interpretadores são testados em qualquer sistema.
#[cfg_attr(windows, allow(dead_code))]
mod audio_unix;
pub mod bridge;
mod error;
mod files;
mod island;
mod lyrics;
mod media;
mod power;
mod store;
mod system;
mod tools;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent};

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Mostrar ou ocultar a cápsula", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Configurações…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair do VANTA", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("vanta")
        .tooltip("VANTA")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "toggle" => island::toggle_visible(app),
            "settings" => {
                let _ = system::open_settings_window(app, None);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                let _ = system::open_settings_window(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    // Iniciado por um navegador como host de Native Messaging: só retransmite e sai.
    let args: Vec<String> = std::env::args().collect();
    if let Some(family) = bridge::host::detect(&args) {
        std::process::exit(bridge::host::run(&family));
    }

    // Linux: no Wayland puro um app não escolhe a própria posição nem lê o cursor global;
    // pelo XWayland a ilha consegue ficar presa no topo da tela e saber onde está o mouse.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Segunda execução: abre as configurações da instância que já está rodando.
            let _ = system::open_settings_window(app, None);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Warn)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("vanta".into()) }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().app_name("VANTA").build())
        .setup(|app| {
            // macOS: app de barra de menus, sem ícone no Dock (o Info.plist também diz LSUIElement).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            let store = store::init(&handle)?;
            let alarms = alarms::start(&handle, &store);
            app.manage(store);
            app.manage(alarms);
            app.manage(island::init(&handle));
            app.manage(media::start(&handle));
            app.manage(audio::start(&handle));
            app.manage(bridge::start(&handle));
            app.manage(system::ShortcutHolder::default());
            app.manage(lyrics::Lyrics::default());
            let tools = tools::Tools::default();
            tools::start_clipboard_watch(&handle, &tools);
            tools::start_auto_install(&handle);
            app.manage(tools);
            power::start(&handle);
            build_tray(&handle)?;
            island::show_after_setup(&handle);
            log::info!(target: "app", "VANTA {} iniciado", handle.package_info().version);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store::store_get,
            store::store_set,
            store::store_clear,
            store::store_usage,
            alarms::alarm_set,
            alarms::alarm_cancel,
            alarms::alarm_list,
            alarms::notify_now,
            island::island_set_hit_rect,
            island::island_set_expanded,
            island::island_request_focus,
            island::island_release_focus,
            island::island_apply_prefs,
            island::list_monitors,
            island::island_drag_start,
            island::island_set_position,
            island::island_return_home,
            island::island_geometry,
            media::media_snapshot,
            media::media_artwork,
            media::media_command,
            media::media_refresh,
            power::power_state,
            audio::audio_state,
            audio::audio_set_volume,
            audio::audio_set_mute,
            bridge::bridge_status,
            bridge::bridge_tabs,
            bridge::bridge_register,
            bridge::bridge_unregister,
            bridge::bridge_command,
            bridge::bridge_ping,
            files::files_stat,
            files::files_open,
            files::files_reveal,
            tools::tools_probe,
            tools::convert_start,
            tools::convert_merge_pdf,
            tools::tools_thumb,
            tools::job_cancel,
            tools::downloader_status,
            tools::downloader_install,
            tools::download_start,
            tools::tools_set_watch,
            lyrics::lyrics_lookup,
            lyrics::lyrics_clear_cache,
            system::system_info,
            system::open_uri,
            system::open_app_folder,
            system::open_extension_folder,
            system::clear_logs,
            system::open_settings,
            system::set_global_shortcut,
        ])
        .build(tauri::generate_context!())
        .expect("falha ao iniciar o VANTA")
        .run(|_app, event| {
            // Fechar a janela de configurações não encerra o app: a cápsula continua.
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
