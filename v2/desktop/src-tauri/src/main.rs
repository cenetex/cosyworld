#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod memory;
mod models;
mod services;
use services::Services;
use tauri::Manager;

fn main() {
    let app = tauri::Builder::default()
        .manage(Services::default())
        .invoke_handler(tauri::generate_handler![
            services::status,
            services::prepare_dialogue,
            services::prepare_voices,
            services::start_game
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("CosyWorld could not open its window");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            handle.state::<Services>().stop();
        }
    });
}
