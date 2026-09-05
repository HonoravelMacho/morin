use std::path::PathBuf;

pub fn get_app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("morim")
}

pub fn get_assets_dir() -> PathBuf {
    get_app_data_dir().join("assets")
}

pub fn get_avatars_dir() -> PathBuf {
    get_assets_dir().join("avatars")
}

pub fn get_podiums_dir() -> PathBuf {
    get_assets_dir().join("podiums")
}

pub fn get_quizzes_dir() -> PathBuf {
    get_app_data_dir().join("quizzes")
}

pub fn ensure_dirs_exist() -> std::io::Result<()> {
    std::fs::create_dir_all(get_avatars_dir())?;
    std::fs::create_dir_all(get_podiums_dir())?;
    std::fs::create_dir_all(get_quizzes_dir())?;
    Ok(())
}

pub fn format_duration(ms: u64) -> String {
    let secs = ms / 1000;
    let mins = secs / 60;
    let hours = mins / 60;
    
    if hours > 0 {
        format!("{}h {}m", hours, mins % 60)
    } else if mins > 0 {
        format!("{}m {}s", mins, secs % 60)
    } else {
        format!("{}s", secs)
    }
}

pub fn generate_random_color() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("#{:02x}{:02x}{:02x}", rng.gen_range(0..256), rng.gen_range(0..256), rng.gen_range(0..256))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_duration() {
        assert_eq!(format_duration(500), "0s");
        assert_eq!(format_duration(1500), "1s");
        assert_eq!(format_duration(65000), "1m 5s");
        assert_eq!(format_duration(3665000), "1h 1m");
    }
}