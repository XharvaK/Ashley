use reqwest::Client;
use std::time::Duration;

pub const AGENT_URL: &str = "http://127.0.0.1:3710";
pub const VOICE_URL: &str = "http://127.0.0.1:3711";
pub const ORPHEUS_URL: &str = "http://127.0.0.1:8881";

#[derive(serde::Deserialize)]
struct Health {
    ready: Option<bool>,
}

pub async fn check_health(url: &str) -> bool {
    let client = match Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let resp = match client.get(format!("{url}/health")).send().await {
        Ok(r) => r,
        Err(_) => return false,
    };
    if !resp.status().is_success() {
        return false;
    }
    let h = match resp.json::<Health>().await {
        Ok(h) => h,
        Err(_) => return false,
    };
    h.ready.unwrap_or(false)
}

pub async fn wait_for_health(url: &str, timeout_secs: u64) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
    while tokio::time::Instant::now() < deadline {
        if check_health(url).await {
            return true;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    false
}

pub async fn post_empty(url: &str, path: &str) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .post(format!("{url}{path}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn pause_all() -> Result<(), String> {
    let _ = post_empty(VOICE_URL, "/pause").await;
    let _ = post_empty(AGENT_URL, "/pause").await;
    kill_orpheus_processes();
    Ok(())
}

pub async fn boot_voice() -> Result<(), String> {
    post_empty(VOICE_URL, "/boot").await?;
    wait_for_health(VOICE_URL, 120).await;
    Ok(())
}

pub async fn resume_agent() -> Result<(), String> {
    post_empty(AGENT_URL, "/resume").await
}

pub fn kill_orpheus_processes() {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "llama-server.exe"])
            .output();
    }
}

pub async fn wait_boot_sequence(timeout_secs: u64) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
    while tokio::time::Instant::now() < deadline {
        let (agent, voice) = tokio::join!(
            check_health(AGENT_URL),
            check_health(VOICE_URL),
        );
        if agent && voice {
            return true;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    false
}
