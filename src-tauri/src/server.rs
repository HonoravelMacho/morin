use crate::models::{Avatar, GameSession, LeaderboardEntry, PodiumAsset, PodiumAssetType, Player, Question, QuestionResult, Quiz, WsMessage};
use anyhow::{Context, Result};
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State, Multipart,
    },
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post, delete},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use local_ip_address::local_ip;
use parking_lot::RwLock;
use qrcode::QrCode;
use qrcode::render::svg;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::Manager;
use tokio::sync::broadcast;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub quizzes: Arc<RwLock<HashMap<Uuid, Quiz>>>,
    pub sessions: Arc<RwLock<HashMap<String, GameSession>>>,
    pub server_url: Arc<RwLock<String>>,
    pub local_ip: Arc<RwLock<String>>,
    pub tx: broadcast::Sender<WsMessage>,
    pub assets_dir: PathBuf,
    pub quizzes_dir: PathBuf,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);
        let assets_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("morim")
            .join("assets");
        let quizzes_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("morim")
            .join("quizzes");

        std::fs::create_dir_all(&assets_dir.join("avatars")).ok();
        std::fs::create_dir_all(&assets_dir.join("podiums")).ok();
        std::fs::create_dir_all(&quizzes_dir).ok();

        Self {
            quizzes: Arc::new(RwLock::new(HashMap::new())),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            server_url: Arc::new(RwLock::new(String::new())),
            local_ip: Arc::new(RwLock::new(String::new())),
            tx,
            assets_dir,
            quizzes_dir,
        }
    }

    pub async fn load_quizzes(&self) -> Result<()> {
        let mut quizzes = self.quizzes.write();
        if self.quizzes_dir.exists() {
            for entry in std::fs::read_dir(&self.quizzes_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "json" || ext == "yaml" || ext == "yml") {
                    let content = std::fs::read_to_string(&path)?;
                    let quiz: Quiz = if path.extension().map_or(false, |ext| ext == "json") {
                        serde_json::from_str(&content)?
                    } else {
                        serde_yaml::from_str(&content)?
                    };
                    quizzes.insert(quiz.id, quiz);
                }
            }
        }
        info!("Loaded {} quizzes", quizzes.len());
        Ok(())
    }

    pub fn save_quiz(&self, quiz: &Quiz) -> Result<()> {
        let path = self.quizzes_dir.join(format!("{}.json", quiz.id));
        let content = serde_json::to_string_pretty(quiz)?;
        std::fs::write(path, content)?;
        self.quizzes.write().insert(quiz.id, quiz.clone());
        Ok(())
    }

    pub fn delete_quiz(&self, quiz_id: Uuid) -> Result<()> {
        let path = self.quizzes_dir.join(format!("{}.json", quiz_id));
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        self.quizzes.write().remove(&quiz_id);
        Ok(())
    }

    pub fn get_quiz(&self, quiz_id: Uuid) -> Option<Quiz> {
        self.quizzes.read().get(&quiz_id).cloned()
    }

    pub fn list_quizzes(&self) -> Vec<crate::models::QuizSummary> {
        self.quizzes.read().values().map(|q| q.into()).collect()
    }

    pub fn create_session(&self, quiz_id: Uuid, host_id: Uuid) -> GameSession {
        let session = GameSession::new(quiz_id, host_id);
        let pin = session.pin.clone();
        self.sessions.write().insert(pin.clone(), session.clone());
        session
    }

    pub fn get_session(&self, pin: &str) -> Option<GameSession> {
        self.sessions.read().get(pin).cloned()
    }

    pub fn update_session(&self, session: GameSession) {
        self.sessions.write().insert(session.pin.clone(), session);
    }

    pub fn remove_session(&self, pin: &str) {
        self.sessions.write().remove(pin);
    }

    pub fn broadcast(&self, msg: WsMessage) {
        if let Err(e) = self.tx.send(msg) {
            debug!("Broadcast error (no receivers): {}", e);
        }
    }

    pub fn broadcast_to_session(&self, pin: &str, msg: WsMessage) {
        if let Some(session) = self.sessions.read().get(pin) {
            for player_id in session.players.keys() {
                let mut msg_clone = msg.clone();
                if let WsMessage::Error { .. } = &msg_clone {
                } else {
                    self.broadcast(msg_clone);
                }
            }
        }
    }
}

pub async fn start_server(state: Arc<AppState>, app_handle: tauri::AppHandle) -> Result<()> {
    state.load_quizzes().await?;

    let ip = local_ip().context("Failed to get local IP")?;
    let addr = SocketAddr::new(ip, 8080);
    *state.local_ip.write() = ip.to_string();
    *state.server_url.write() = format!("http://{}:8080", ip);

    let qr_code = generate_qr_code(&state.server_url.read())?;
    let qr_path = state.assets_dir.join("qr_code.svg");
    std::fs::write(&qr_path, qr_code)?;
    info!("QR Code saved to: {:?}", qr_path);

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit("server-started", serde_json::json!({
            "url": *state.server_url.read(),
            "ip": *state.local_ip.read(),
            "qr_code": qr_path.to_string_lossy()
        }));
    }

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mobile_dir = std::path::PathBuf::from("/home/tiagorabelo/morim/src/mobile");
    
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/quizzes", get(list_quizzes_handler).post(create_quiz_handler))
        .route("/api/quizzes/:id", get(get_quiz_handler).delete(delete_quiz_handler))
        .route("/api/avatars", get(list_avatars_handler))
        .route("/api/podiums", get(list_podiums_handler))
        .route("/api/qr", get(qr_code_handler))
        .route("/api/health", get(health_handler))
        .route("/api/stats", get(stats_handler))
        .route("/api/sessions", post(create_session_handler))
        .route("/api/upload", post(upload_handler))
        .route("/api/assets/:type/:id", delete(delete_asset_handler))
        .nest_service("/assets/avatars", ServeDir::new(state.assets_dir.join("avatars")))
        .nest_service("/assets/podiums", ServeDir::new(state.assets_dir.join("podiums")))
        .nest_service("/quizzes", ServeDir::new(state.quizzes_dir.clone()))
        .nest_service("/mobile", ServeDir::new(mobile_dir.clone()).append_index_html_on_directories(true))
        .fallback_service(ServeDir::new(mobile_dir).append_index_html_on_directories(true))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    info!("Starting HTTP/WebSocket server on http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.tx.subscribe();
    let mut player_id: Option<Uuid> = None;
    let mut current_pin: Option<String> = None;

    let (mut sender, mut receiver) = socket.split();

    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                    match ws_msg {
                        WsMessage::JoinGame { pin, name, avatar } => {
                            if let Some(session) = state.get_session(&pin) {
                                let player = Player::new(name, avatar);
                                player_id = Some(player.id);
                                current_pin = Some(pin.clone());
                                
                                let mut session_mut = session.clone();
                                session_mut.add_player(player.clone());
                                state.update_session(session_mut.clone());
                                
                                let quiz = state.get_quiz(session_mut.quiz_id).unwrap_or_else(|| Quiz::new("Unknown".to_string(), "".to_string()));
                                
                                let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::GameJoined {
                                    session: session_mut,
                                    player_id: player.id,
                                }).unwrap())).await;
                                
                                state.broadcast(WsMessage::PlayerJoined { player });
                            } else {
                                let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::Error {
                                    message: "Invalid game PIN".to_string(),
                                }).unwrap())).await;
                            }
                        }
                        WsMessage::SubmitAnswer { question_id, answer } => {
                            if let (Some(pid), Some(pin)) = (player_id, &current_pin) {
                                if let Some(mut session) = state.get_session(pin) {
                                    if let Some(quiz) = state.get_quiz(session.quiz_id) {
                                        if let Some(question) = quiz.questions.get(session.current_question_index) {
                                            if question.id == question_id {
                                                let is_correct = answer == question.correct_answer;
                                                let points = if is_correct { question.points } else { 0 };
                                                
                                                let result = QuestionResult {
                                                    question_id,
                                                    player_id: pid,
                                                    answer: answer.clone(),
                                                    is_correct,
                                                    response_time_ms: 0,
                                                    points_earned: points,
                                                };
                                                
                                                if let Some(player) = session.players.get_mut(&pid) {
                                                    player.score += points;
                                                    if is_correct {
                                                        player.correct_answers += 1;
                                                    }
                                                    player.last_activity = chrono::Utc::now();
                                                }
                                                
                                                state.update_session(session.clone());
                                                state.broadcast_to_session(pin, WsMessage::QuestionEnded {
                                                    results: vec![result],
                                                    correct_answers: question.correct_answer.clone(),
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        WsMessage::RequestQuizList => {
                            let quizzes = state.list_quizzes();
                            let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::QuizList { quizzes }).unwrap())).await;
                        }
                        WsMessage::CreateQuiz { title, description } => {
                            let mut quiz = Quiz::new(title, description);
                            if let Err(e) = state.save_quiz(&quiz) {
                                let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::Error {
                                    message: format!("Failed to create quiz: {}", e),
                                }).unwrap())).await;
                            } else {
                                let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::QuizCreated { quiz: quiz.clone() }).unwrap())).await;
                            }
                        }
                        WsMessage::DeleteQuiz { quiz_id } => {
                            if let Err(e) = state.delete_quiz(quiz_id) {
                                let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::Error {
                                    message: format!("Failed to delete quiz: {}", e),
                                }).unwrap())).await;
                            } else {
                                let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::QuizDeleted { quiz_id }).unwrap())).await;
                            }
                        }
                        WsMessage::Ping => {
                            let _ = sender.send(Message::Text(serde_json::to_string(&WsMessage::Pong).unwrap())).await;
                        }
                        _ => {}
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    if let (Some(pid), Some(pin)) = (player_id, current_pin) {
        if let Some(mut session) = state.get_session(&pin) {
            session.remove_player(&pid);
            state.update_session(session.clone());
            state.broadcast_to_session(&pin, WsMessage::PlayerLeft { player_id: pid });
        }
    }

    send_task.abort();
}

async fn list_quizzes_handler(State(state): State<Arc<AppState>>) -> Json<Vec<crate::models::QuizSummary>> {
    Json(state.list_quizzes())
}

async fn get_quiz_handler(State(state): State<Arc<AppState>>, axum::extract::Path(id): axum::extract::Path<Uuid>) -> Result<Json<Quiz>, (axum::http::StatusCode, String)> {
    state.get_quiz(id)
        .map(Json)
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Quiz not found".to_string()))
}

#[derive(Deserialize)]
struct CreateQuizRequest {
    title: String,
    description: String,
}

async fn create_quiz_handler(State(state): State<Arc<AppState>>, Json(req): Json<CreateQuizRequest>) -> Result<Json<Quiz>, (axum::http::StatusCode, String)> {
    let mut quiz = Quiz::new(req.title, req.description);
    state.save_quiz(&quiz).map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(quiz))
}

async fn delete_quiz_handler(State(state): State<Arc<AppState>>, axum::extract::Path(id): axum::extract::Path<Uuid>) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    state.delete_quiz(id).map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn list_avatars_handler(State(state): State<Arc<AppState>>) -> Json<Vec<Avatar>> {
    let mut avatars = Vec::new();
    let avatars_dir = state.assets_dir.join("avatars");
    if avatars_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(avatars_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if matches!(ext_str.as_str(), "png" | "jpg" | "jpeg" | "gif" | "svg") {
                        avatars.push(Avatar {
                            id: path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                            name: path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                            file_path: format!("/assets/avatars/{}", path.file_name().unwrap().to_string_lossy()),
                            file_type: ext_str,
                        });
                    }
                }
            }
        }
    }
    Json(avatars)
}

async fn list_podiums_handler(State(state): State<Arc<AppState>>) -> Json<Vec<PodiumAsset>> {
    let mut podiums = Vec::new();
    let podiums_dir = state.assets_dir.join("podiums");
    if podiums_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(podiums_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    let asset_type = if matches!(ext_str.as_str(), "mp3" | "wav" | "ogg" | "m4a") {
                        PodiumAssetType::Audio
                    } else if matches!(ext_str.as_str(), "json" | "css" | "js") {
                        PodiumAssetType::Theme
                    } else {
                        PodiumAssetType::Animation
                    };
                    podiums.push(PodiumAsset {
                        id: path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                        name: path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                        file_path: format!("/assets/podiums/{}", path.file_name().unwrap().to_string_lossy()),
                        file_type: ext_str,
                        asset_type,
                    });
                }
            }
        }
    }
    Json(podiums)
}

async fn qr_code_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let url = state.server_url.read().clone();
    let qr = generate_qr_code(&url).unwrap_or_default();
    Html(qr)
}

async fn health_handler() -> &'static str {
    "OK"
}

fn generate_qr_code(url: &str) -> Result<String> {
    let code = QrCode::new(url)?;
    let image = code.render::<svg::Color>().min_dimensions(200, 200).build();
    Ok(image)
}

#[derive(Serialize)]
struct ServerInfo {
    url: String,
    ip: String,
    port: u16,
}

pub async fn get_server_info(State(state): State<Arc<AppState>>) -> Json<ServerInfo> {
    Json(ServerInfo {
        url: state.server_url.read().clone(),
        ip: state.local_ip.read().clone(),
        port: 8080,
    })
}

#[derive(Serialize)]
struct StatsResponse {
    active_players: usize,
    active_games: usize,
    total_sessions: usize,
}

async fn stats_handler(State(state): State<Arc<AppState>>) -> Json<StatsResponse> {
    let sessions = state.sessions.read();
    let active_games = sessions.values().filter(|s| s.state != crate::models::GameState::Waiting && s.state != crate::models::GameState::Finished).count();
    let active_players: usize = sessions.values().map(|s| s.players.len()).sum();
    let total_sessions = sessions.len();
    
    Json(StatsResponse {
        active_players,
        active_games,
        total_sessions,
    })
}

#[derive(Deserialize)]
struct CreateSessionRequest {
    quiz_id: Uuid,
    host_id: String,
}

async fn create_session_handler(State(state): State<Arc<AppState>>, Json(req): Json<CreateSessionRequest>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let host_id = Uuid::parse_str(&req.host_id).unwrap_or_else(|_| Uuid::new_v4());
    let session = state.create_session(req.quiz_id, host_id);
    Ok(Json(serde_json::json!({ "pin": session.pin, "session_id": session.id })))
}

async fn upload_handler(State(state): State<Arc<AppState>>, mut multipart: Multipart) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut asset_type: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                file_name = field.file_name().map(|s| s.to_string());
                file_data = Some(field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?.to_vec());
            }
            "type" => {
                asset_type = Some(field.text().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?);
            }
            _ => {}
        }
    }

    let file_data = file_data.ok_or((StatusCode::BAD_REQUEST, "No file provided".to_string()))?;
    let file_name = file_name.ok_or((StatusCode::BAD_REQUEST, "No filename".to_string()))?;
    let asset_type = asset_type.unwrap_or_else(|| "avatars".to_string());

    let ext = Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let allowed_avatars = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
    let allowed_podiums = ["mp3", "wav", "ogg", "m4a", "json", "css", "js", "png", "jpg", "gif", "svg"];

    let (target_dir, allowed) = match asset_type.as_str() {
        "avatars" => (state.assets_dir.join("avatars"), allowed_avatars),
        "podiums" => (state.assets_dir.join("podiums"), allowed_podiums),
        _ => return Err((StatusCode::BAD_REQUEST, "Invalid asset type".to_string())),
    };

    if !allowed.contains(&ext.as_str()) {
        return Err((StatusCode::BAD_REQUEST, format!("File type .{} not allowed for {}", ext, asset_type)));
    }

    let new_name = format!("{}_{}.{}", Uuid::new_v4(), chrono::Utc::now().timestamp(), ext);
    let file_path = target_dir.join(&new_name);

    tokio::fs::write(&file_path, file_data).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "file_path": format!("/assets/{}/{}", asset_type, new_name),
        "file_name": new_name
    })))
}

async fn delete_asset_handler(
    State(state): State<Arc<AppState>>,
    axum::extract::Path((asset_type, id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let target_dir = match asset_type.as_str() {
        "avatars" => state.assets_dir.join("avatars"),
        "podiums" => state.assets_dir.join("podiums"),
        _ => return Err((StatusCode::BAD_REQUEST, "Invalid asset type".to_string())),
    };

    let mut found = false;
    if let Ok(entries) = std::fs::read_dir(&target_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_stem().and_then(|s| s.to_str()) == Some(&id) {
                tokio::fs::remove_file(&path).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                found = true;
                break;
            }
        }
    }

    if !found {
        return Err((StatusCode::NOT_FOUND, "Asset not found".to_string()));
    }

    Ok(Json(serde_json::json!({ "success": true })))
}