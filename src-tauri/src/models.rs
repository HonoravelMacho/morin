use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quiz {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub questions: Vec<Question>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub id: Uuid,
    pub text: String,
    pub question_type: QuestionType,
    pub options: Vec<Option>,
    pub correct_answer: Vec<usize>,
    pub time_limit: u32,
    pub points: u32,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QuestionType {
    SingleChoice,
    MultipleChoice,
    TrueFalse,
    TypeAnswer,
    Puzzle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Option {
    pub id: Uuid,
    pub text: String,
    pub is_correct: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: Uuid,
    pub name: String,
    pub avatar: String,
    pub score: u32,
    pub correct_answers: u32,
    pub connected_at: chrono::DateTime<chrono::Utc>,
    pub last_activity: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSession {
    pub id: Uuid,
    pub quiz_id: Uuid,
    pub pin: String,
    pub host_id: Uuid,
    pub players: HashMap<Uuid, Player>,
    pub current_question_index: usize,
    pub state: GameState,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GameState {
    Waiting,
    InProgress,
    QuestionActive,
    QuestionEnded,
    Finished,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionResult {
    pub question_id: Uuid,
    pub player_id: Uuid,
    pub answer: Vec<usize>,
    pub is_correct: bool,
    pub response_time_ms: u64,
    pub points_earned: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub player_id: Uuid,
    pub name: String,
    pub avatar: String,
    pub score: u32,
    pub correct_answers: u32,
    pub rank: usize,
}

impl Quiz {
    pub fn new(title: String, description: String) -> Self {
        let now = chrono::Utc::now();
        Self {
            id: Uuid::new_v4(),
            title,
            description,
            questions: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn add_question(&mut self, question: Question) {
        self.questions.push(question);
        self.updated_at = chrono::Utc::now();
    }
}

impl Question {
    pub fn new(text: String, question_type: QuestionType, time_limit: u32, points: u32) -> Self {
        Self {
            id: Uuid::new_v4(),
            text,
            question_type,
            options: Vec::new(),
            correct_answer: Vec::new(),
            time_limit,
            points,
            image_url: None,
        }
    }
}

impl Player {
    pub fn new(name: String, avatar: String) -> Self {
        let now = chrono::Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            avatar,
            score: 0,
            correct_answers: 0,
            connected_at: now,
            last_activity: now,
        }
    }
}

impl GameSession {
    pub fn new(quiz_id: Uuid, host_id: Uuid) -> Self {
        let pin = generate_pin();
        Self {
            id: Uuid::new_v4(),
            quiz_id,
            pin,
            host_id,
            players: HashMap::new(),
            current_question_index: 0,
            state: GameState::Waiting,
            created_at: chrono::Utc::now(),
            started_at: None,
            ended_at: None,
        }
    }

    pub fn add_player(&mut self, player: Player) {
        self.players.insert(player.id, player);
    }

    pub fn remove_player(&mut self, player_id: &Uuid) {
        self.players.remove(player_id);
    }
}

fn generate_pin() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..6).map(|_| rng.gen_range(0..10).to_string()).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsMessage {
    // Client -> Server
    JoinGame { pin: String, name: String, avatar: String },
    SubmitAnswer { question_id: Uuid, answer: Vec<usize> },
    RequestQuizList,
    CreateQuiz { title: String, description: String },
    DeleteQuiz { quiz_id: Uuid },
    
    // Server -> Client
    GameJoined { session: GameSession, player_id: Uuid },
    PlayerJoined { player: Player },
    PlayerLeft { player_id: Uuid },
    GameStarted { quiz: Quiz },
    QuestionStarted { question: Question, index: usize, total: usize },
    QuestionEnded { results: Vec<QuestionResult>, correct_answers: Vec<usize> },
    LeaderboardUpdate { leaderboard: Vec<LeaderboardEntry> },
    GameEnded { final_leaderboard: Vec<LeaderboardEntry> },
    QuizList { quizzes: Vec<QuizSummary> },
    QuizCreated { quiz: Quiz },
    QuizDeleted { quiz_id: Uuid },
    Error { message: String },
    Ping,
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizSummary {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub question_count: usize,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<&Quiz> for QuizSummary {
    fn from(quiz: &Quiz) -> Self {
        Self {
            id: quiz.id,
            title: quiz.title.clone(),
            description: quiz.description.clone(),
            question_count: quiz.questions.len(),
            created_at: quiz.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Avatar {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub file_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodiumAsset {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub file_type: String,
    pub asset_type: PodiumAssetType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PodiumAssetType {
    Audio,
    Theme,
    Animation,
}