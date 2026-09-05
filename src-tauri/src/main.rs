#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use morim::server::{start_server, AppState};
use morim::commands::{get_local_ip, get_server_url, list_quizzes, create_quiz, delete_quiz, open_data_directory};
use std::sync::Arc;
use tauri::Manager;

mod commands;
mod server;
mod models;
mod utils;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = app_state.clone();
            
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_server(state, handle).await {
                    tracing::error!("Failed to start server: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_ip,
            get_server_url,
            list_quizzes,
            create_quiz,
            delete_quiz,
            open_data_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}