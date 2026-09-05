use crate::models::Quiz;
use crate::server::AppState;
use crate::utils::get_app_data_dir;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{command, State};
use uuid::Uuid;

#[derive(Serialize)]
pub struct ServerInfo {
    pub url: String,
    pub ip: String,
    pub port: u16,
}

#[command]
pub async fn get_local_ip(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    Ok(state.local_ip.read().clone())
}

#[command]
pub async fn get_server_url(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    Ok(state.server_url.read().clone())
}

#[command]
pub async fn list_quizzes(state: State<'_, Arc<AppState>>) -> Result<Vec<crate::models::QuizSummary>, String> {
    Ok(state.list_quizzes())
}

#[derive(Deserialize)]
pub struct CreateQuizRequest {
    pub title: String,
    pub description: String,
}

#[command]
pub async fn create_quiz(state: State<'_, Arc<AppState>>, request: CreateQuizRequest) -> Result<Quiz, String> {
    let mut quiz = Quiz::new(request.title, request.description);
    state.save_quiz(&quiz).map_err(|e| e.to_string())?;
    Ok(quiz)
}

#[command]
pub async fn delete_quiz(state: State<'_, Arc<AppState>>, quiz_id: Uuid) -> Result<bool, String> {
    state.delete_quiz(quiz_id).map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn open_data_directory() -> Result<bool, String> {
    let dir = get_app_data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(true)
}