use std::path::PathBuf;
use tauri::command;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct KubeconfigContext {
    pub name: String,
    pub cluster: String,
    pub user: String,
    pub namespace: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KubeconfigInfo {
    pub path: String,
    pub current_context: Option<String>,
    pub contexts: Vec<KubeconfigContext>,
}

// C4.1: Never include path or content in error messages (no secrets in logs).
fn kubeconfig_read_error() -> String {
    "Failed to read kubeconfig at configured path".to_string()
}
fn kubeconfig_parse_error() -> String {
    "Failed to parse kubeconfig".to_string()
}
fn kubeconfig_write_error() -> String {
    "Failed to write kubeconfig".to_string()
}

#[command]
pub async fn read_kubeconfig(path: Option<String>) -> Result<String, String> {
    let kubeconfig_path = get_kubeconfig_path(path)?;

    std::fs::read_to_string(kubeconfig_path).map_err(|_| kubeconfig_read_error())
}

#[command]
pub async fn get_kubeconfig_info(path: Option<String>) -> Result<KubeconfigInfo, String> {
    let kubeconfig_path = get_kubeconfig_path(path.clone())?;
    let content = std::fs::read_to_string(&kubeconfig_path).map_err(|_| kubeconfig_read_error())?;
    
    let config: Value = serde_yaml::from_str(&content).map_err(|_| kubeconfig_parse_error())?;
    
    let current_context = config.get("current-context")
        .and_then(|v| v.as_str())
        .map(String::from);
    
    let contexts = parse_contexts(&config)?;
    
    Ok(KubeconfigInfo {
        path: kubeconfig_path.to_string_lossy().to_string(),
        current_context,
        contexts,
    })
}

#[command]
pub async fn switch_context(context_name: String) -> Result<(), String> {
    let kubeconfig_path = get_kubeconfig_path(None)?;
    let content = std::fs::read_to_string(&kubeconfig_path).map_err(|_| kubeconfig_read_error())?;
    
    let mut config: Value = serde_yaml::from_str(&content).map_err(|_| kubeconfig_parse_error())?;
    
    // Validate context exists
    let contexts = parse_contexts(&config)?;
    if !contexts.iter().any(|c| c.name == context_name) {
        return Err(format!("Context '{}' not found", context_name));
    }
    
    // Update current-context
    if let Some(obj) = config.as_object_mut() {
        obj.insert("current-context".to_string(), Value::String(context_name));
    }
    
    // Write back
    let yaml = serde_yaml::to_string(&config).map_err(|_| kubeconfig_parse_error())?;
    
    std::fs::write(&kubeconfig_path, yaml).map_err(|_| kubeconfig_write_error())?;
    
    Ok(())
}

#[command]
pub async fn validate_kubeconfig(path: Option<String>) -> Result<bool, String> {
    let kubeconfig_path = get_kubeconfig_path(path)?;
    
    if !kubeconfig_path.exists() {
        return Ok(false);
    }
    
    let content = match std::fs::read_to_string(&kubeconfig_path) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };
    
    match serde_yaml::from_str::<Value>(&content) {
        Ok(config) => {
            // Check required fields
            let has_clusters = config.get("clusters").is_some();
            let has_contexts = config.get("contexts").is_some();
            let has_users = config.get("users").is_some();
            
            Ok(has_clusters && has_contexts && has_users)
        }
        Err(_) => Ok(false),
    }
}

#[command]
pub async fn auto_detect_kubeconfig() -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    
    // Check default location
    if let Some(home) = dirs::home_dir() {
        let default_path = home.join(".kube").join("config");
        if default_path.exists() {
            paths.push(default_path.to_string_lossy().to_string());
        }
    }
    
    // Check KUBECONFIG env var
    if let Ok(kubeconfig_env) = std::env::var("KUBECONFIG") {
        for path in kubeconfig_env.split(':') {
            let p = PathBuf::from(path);
            if p.exists() && !paths.contains(&p.to_string_lossy().to_string()) {
                paths.push(p.to_string_lossy().to_string());
            }
        }
    }
    
    Ok(paths)
}

#[command]
pub async fn browse_for_kubeconfig() -> Result<Option<String>, String> {
    // Will be handled by frontend dialog plugin
    // This is a placeholder for backend validation
    Ok(None)
}

#[command]
pub async fn save_topology_export(
    data: Vec<u8>,
    filename: String,
    _format: String,
) -> Result<String, String> {
    let app_data_dir = get_app_data_dir().await?;
    let exports_dir = PathBuf::from(app_data_dir).join("exports");
    
    if !exports_dir.exists() {
        std::fs::create_dir_all(&exports_dir)
            .map_err(|e| format!("Failed to create exports directory: {}", e))?;
    }
    
    let file_path = exports_dir.join(filename);
    std::fs::write(&file_path, data)
        .map_err(|e| format!("Failed to write export file: {}", e))?;
    
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub async fn open_in_system_editor(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    Ok(())
}

#[command]
pub async fn reveal_in_file_manager(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(&["/select,", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(&["-R", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to reveal file: {}", e))?;
        }
    }
    
    Ok(())
}

#[command]
pub async fn get_app_data_dir() -> Result<String, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or("Could not find data directory")?;
    
    let kubilitics_dir = data_dir.join("kubilitics");
    
    if !kubilitics_dir.exists() {
        std::fs::create_dir_all(&kubilitics_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }
    
    Ok(kubilitics_dir.to_string_lossy().to_string())
}

#[command]
pub async fn get_recent_exports() -> Result<Vec<String>, String> {
    let app_data_dir = get_app_data_dir().await?;
    let exports_dir = PathBuf::from(app_data_dir).join("exports");
    
    if !exports_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut exports = Vec::new();
    
    for entry in std::fs::read_dir(exports_dir)
        .map_err(|e| format!("Failed to read exports directory: {}", e))? {
        if let Ok(entry) = entry {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    exports.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }
    
    // Sort by modification time (most recent first)
    exports.sort_by(|a, b| {
        let a_time = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let b_time = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });
    
    Ok(exports.into_iter().take(10).collect())
}

#[command]
pub async fn select_kubeconfig_file() -> Result<Option<String>, String> {
    // This will be called from frontend using dialog plugin
    Ok(None)
}

// Helper functions

fn get_kubeconfig_path(path: Option<String>) -> Result<PathBuf, String> {
    match path {
        Some(p) => Ok(PathBuf::from(p)),
        None => {
            let home = dirs::home_dir()
                .ok_or("Could not find home directory")?;
            Ok(home.join(".kube").join("config"))
        }
    }
}

fn parse_contexts(config: &Value) -> Result<Vec<KubeconfigContext>, String> {
    let contexts = config.get("contexts")
        .and_then(|v| v.as_array())
        .ok_or("No contexts found in kubeconfig")?;
    
    let mut result = Vec::new();
    
    for ctx in contexts {
        let name = ctx.get("name")
            .and_then(|v: &Value| v.as_str())
            .ok_or("Context missing name")?
            .to_string();
        
        let context = ctx.get("context")
            .ok_or("Context missing context field")?;
        
        let cluster = context.get("cluster")
            .and_then(|v: &Value| v.as_str())
            .ok_or("Context missing cluster")?
            .to_string();
        
        let user = context.get("user")
            .and_then(|v: &Value| v.as_str())
            .ok_or("Context missing user")?
            .to_string();
        
        let namespace = context.get("namespace")
            .and_then(|v: &Value| v.as_str())
            .map(String::from);
        
        result.push(KubeconfigContext {
            name,
            cluster,
            user,
            namespace,
        });
    }
    
    Ok(result)
}
