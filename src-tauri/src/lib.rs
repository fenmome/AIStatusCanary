// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{AppHandle, Manager, State, Emitter};
use std::path::{Path, PathBuf};
use std::fs;
use std::sync::Mutex;
use std::time::{SystemTime, Duration};
use std::thread;

// 串口数据结构定义
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ToolCall {
    name: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct LogLine {
    source: Option<String>,
    #[serde(rename = "type")]
    line_type: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
}

// 辅助函数：提供 Serde 反序列化默认值
fn default_true() -> bool { true }

fn generate_random_token() -> String {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "UNKNOWN_HOST".to_string());
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "UNKNOWN_USER".to_string());
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "UNKNOWN_HOME".to_string());
    
    let combined = format!("{}-{}-{}", hostname, username, home);
    
    // 使用 DJB2 算法计算确定性的 Hash 值作为 seed
    let mut val: u128 = 5381;
    for byte in combined.bytes() {
        val = val.wrapping_mul(33).wrapping_add(byte as u128);
    }
    
    let chars: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut token = String::new();
    for _ in 0..6 {
        let idx = (val % (chars.len() as u128)) as usize;
        token.push(chars[idx] as char);
        val = val / 31 + 17;
    }
    token
}

fn default_token() -> String {
    generate_random_token()
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Config {
    pub bark_key: String,
    pub feishu_webhook: String,
    pub dingtalk_webhook: String,
    pub wechat_webhook: String,
    pub custom_push_url: String,
    pub push_on_running: bool,
    pub push_on_waiting: bool,
    pub push_on_completed: bool,
    pub port: u16,
    
    #[serde(default = "default_token")]
    pub token: String,
    
    // 多工具监测开关，默认启用
    #[serde(default = "default_true")]
    pub enable_antigravity: bool,
    #[serde(default = "default_true")]
    pub enable_roocode: bool,
    #[serde(default = "default_true")]
    pub enable_claudecode: bool,
    #[serde(default = "default_true")]
    pub enable_opencode: bool,
    #[serde(default = "default_true")]
    pub enable_codex: bool,

    // 各工具专属细颗粒度推送选项
    pub anti_push_running: Option<bool>,
    pub anti_push_waiting: Option<bool>,
    pub anti_push_completed: Option<bool>,

    pub roo_push_running: Option<bool>,
    pub roo_push_waiting: Option<bool>,
    pub roo_push_completed: Option<bool>,

    pub claude_push_running: Option<bool>,
    pub claude_push_waiting: Option<bool>,
    pub claude_push_completed: Option<bool>,

    pub open_push_running: Option<bool>,
    pub open_push_waiting: Option<bool>,
    pub open_push_completed: Option<bool>,

    pub codex_push_running: Option<bool>,
    pub codex_push_waiting: Option<bool>,
    pub codex_push_completed: Option<bool>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct EventItem {
    pub time: String,
    pub from: String,
    pub to: String,
    pub detail: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct StatusState {
    pub status: String,
    pub last_tool: String,
    pub last_update: String,
    pub conversation_id: String,
    pub log_file: String,
    pub events: Vec<EventItem>,
}

#[derive(serde::Serialize, Clone)]
pub struct ToolStatus {
    pub name: String,
    pub installed: bool,
    pub path: String,
}

// 应用程序全局状态
pub struct AppState {
    pub state: Mutex<StatusState>,
}

pub struct AppConfig {
    pub config: Mutex<Config>,
}

// 获取默认配置
fn get_default_config() -> Config {
    Config {
        bark_key: String::new(),
        feishu_webhook: String::new(),
        dingtalk_webhook: String::new(),
        wechat_webhook: String::new(),
        custom_push_url: String::new(),
        push_on_running: false,
        push_on_waiting: true,
        push_on_completed: true,
        port: 8000,
        token: generate_random_token(),
        enable_antigravity: true,
        enable_roocode: true,
        enable_claudecode: true,
        enable_opencode: true,
        enable_codex: true,
        
        anti_push_running: Some(false),
        anti_push_waiting: Some(true),
        anti_push_completed: Some(true),

        roo_push_running: Some(false),
        roo_push_waiting: Some(true),
        roo_push_completed: Some(true),

        claude_push_running: Some(false),
        claude_push_waiting: Some(true),
        claude_push_completed: Some(true),

        open_push_running: Some(false),
        open_push_waiting: Some(true),
        open_push_completed: Some(true),

        codex_push_running: Some(false),
        codex_push_waiting: Some(true),
        codex_push_completed: Some(true),
    }
}

// 辅助函数：安全获取用户目录
fn get_user_home() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
}

// 在指定文件夹下检索最新扩展名的文件
fn find_latest_file_in_dir(dir: &Path, extension: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let mut latest: Option<(PathBuf, SystemTime)> = None;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map(|e| e == extension).unwrap_or(false) {
                if let Ok(meta) = fs::metadata(&path) {
                    if let Ok(mtime) = meta.modified() {
                        let is_newer = match latest {
                            Some((_, prev_mtime)) => mtime > prev_mtime,
                            None => true,
                        };
                        if is_newer {
                            latest = Some((path, mtime));
                        }
                    }
                }
            }
        }
    }
    latest.map(|(p, _)| p)
}

// 递归查找指定扩展名最新的文件
fn find_latest_file_in_dir_recursive(dir: &Path, extension: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let mut latest: Option<(PathBuf, SystemTime)> = None;
    let _ = visit_dirs(dir, extension, &mut latest);
    latest.map(|(p, _)| p)
}

fn visit_dirs(dir: &Path, extension: &str, latest: &mut Option<(PathBuf, SystemTime)>) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let _ = visit_dirs(&path, extension, latest);
            } else if path.is_file() && path.extension().map(|e| e == extension).unwrap_or(false) {
                if let Ok(meta) = fs::metadata(&path) {
                    if let Ok(mtime) = meta.modified() {
                        let is_newer = match latest {
                            Some((_, prev_mtime)) => mtime > *prev_mtime,
                            None => true,
                        };
                        if is_newer {
                            *latest = Some((path, mtime));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

// 检索最新的 Antigravity 日志文件
fn find_latest_antigravity_transcript() -> Option<PathBuf> {
    let home = get_user_home()?;
    let brain_dir = Path::new(&home).join(".gemini").join("antigravity").join("brain");
    if !brain_dir.exists() {
        return None;
    }
    let mut latest_file: Option<(PathBuf, SystemTime)> = None;
    
    if let Ok(entries) = fs::read_dir(brain_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let log_file = entry.path()
                    .join(".system_generated")
                    .join("logs")
                    .join("transcript.jsonl");
                    
                if log_file.exists() {
                    if let Ok(meta) = fs::metadata(&log_file) {
                        if let Ok(mtime) = meta.modified() {
                            let is_newer = match latest_file {
                                Some((_, prev_mtime)) => mtime > prev_mtime,
                                None => true,
                            };
                            if is_newer {
                                latest_file = Some((log_file, mtime));
                            }
                        }
                    }
                }
            }
        }
    }
    
    latest_file.map(|(path, _)| path)
}

fn find_latest_codex_rollout() -> Option<PathBuf> {
    let home = get_user_home()?;
    let sessions_dir = Path::new(&home).join(".codex").join("sessions");
    if !sessions_dir.exists() {
        return None;
    }
    let mut latest_file: Option<(PathBuf, SystemTime)> = None;
    let _ = visit_dirs(&sessions_dir, "jsonl", &mut latest_file);
    latest_file.map(|(path, _)| path)
}

fn find_latest_opencode_log() -> Option<PathBuf> {
    let home = get_user_home()?;
    let paths_to_check = vec![
        Path::new(&home).join(".local").join("share").join("opencode"),
        Path::new(&home).join(".config").join("opencode"),
    ];
    let mut latest_file: Option<(PathBuf, SystemTime)> = None;
    for dir in paths_to_check {
        if dir.exists() {
            let _ = visit_dirs(&dir, "log", &mut latest_file);
            let _ = visit_dirs(&dir, "jsonl", &mut latest_file);
            let _ = visit_dirs(&dir, "json", &mut latest_file);
        }
    }
    latest_file.map(|(path, _)| path)
}

// 全局检索所有启用的 AI 工具，并获取其中最新修改的文件和工具名
fn find_absolute_latest_log(config: &Config) -> Option<(PathBuf, String)> {
    let home = get_user_home()?;
    let mut files_to_compare = Vec::new();
    
    // 1. Antigravity
    if config.enable_antigravity {
        if let Some(path) = find_latest_antigravity_transcript() {
            if let Ok(meta) = fs::metadata(&path) {
                if let Ok(mtime) = meta.modified() {
                    files_to_compare.push((path, "Antigravity".to_string(), mtime));
                }
            }
        }
    }
    
    // 2. Roo Code
    if config.enable_roocode {
        let roo_dir = if cfg!(target_os = "windows") {
            Path::new(&home).join("AppData").join("Roaming").join("Code").join("User")
                .join("globalStorage").join("saoudrizwan.claude-dev").join("logs")
        } else {
            Path::new(&home).join("Library").join("Application Support").join("Code").join("User")
                .join("globalStorage").join("saoudrizwan.claude-dev").join("logs")
        };
        
        if let Some(path) = find_latest_file_in_dir(&roo_dir, "json") {
            if let Ok(meta) = fs::metadata(&path) {
                if let Ok(mtime) = meta.modified() {
                    files_to_compare.push((path, "Roo Code".to_string(), mtime));
                }
            }
        }
    }
    
    // 3. Claude Code
    if config.enable_claudecode {
        let claude_projects_dir = Path::new(&home).join(".claude").join("projects");
        if let Some(path) = find_latest_file_in_dir_recursive(&claude_projects_dir, "jsonl") {
            if let Ok(meta) = fs::metadata(&path) {
                if let Ok(mtime) = meta.modified() {
                    files_to_compare.push((path, "Claude Code".to_string(), mtime));
                }
            }
        }
    }
    
    // 4. OpenCode
    if config.enable_opencode {
        if let Some(path) = find_latest_opencode_log() {
            if let Ok(meta) = fs::metadata(&path) {
                if let Ok(mtime) = meta.modified() {
                    files_to_compare.push((path, "OpenCode".to_string(), mtime));
                }
            }
        }
    }

    // 5. Codex
    if config.enable_codex {
        if let Some(path) = find_latest_codex_rollout() {
            if let Ok(meta) = fs::metadata(&path) {
                if let Ok(mtime) = meta.modified() {
                    files_to_compare.push((path, "Codex".to_string(), mtime));
                }
            }
        }
    }
    
    if files_to_compare.is_empty() {
        return None;
    }
    
    // 按修改时间降序排序（最新修改的排前面）
    files_to_compare.sort_by(|a, b| b.2.cmp(&a.2));
    let (path, tool_name, _) = files_to_compare.remove(0);
    Some((path, tool_name))
}

// 解析 Antigravity (JSONL) 的一行
fn parse_antigravity_line(line_str: &str) -> Option<(String, String, String)> {
    let line: LogLine = serde_json::from_str(line_str).ok()?;
    let source = line.source.unwrap_or_default();
    let line_type = line.line_type.unwrap_or_default();
    
    let mut status = "RUNNING".to_string();
    let mut last_tool = "".to_string();
    let mut detail = "".to_string();
    
    if source == "USER_EXPLICIT" && line_type == "USER_INPUT" {
        status = "RUNNING".to_string();
        detail = "用户发送了新问题，AI开始思考".to_string();
    } else if source == "MODEL" {
        if line_type == "PLANNER_RESPONSE" {
            if let Some(calls) = line.tool_calls {
                if !calls.is_empty() {
                    let names: Vec<String> = calls.iter()
                        .filter_map(|c| c.name.clone())
                        .collect();
                    last_tool = names.join(", ");
                    
                    let mut has_interactive = false;
                    for name in &names {
                        if name == "run_command" || name == "ask_permission" || name == "ask_question"
                           || name.contains("run_command") || name.contains("ask_permission") || name.contains("ask_question") {
                            has_interactive = true;
                            break;
                        }
                    }
                    if has_interactive {
                        status = "WAITING".to_string();
                        detail = format!("请求执行敏感指令: {}，等待用户确认", last_tool);
                    } else {
                        status = "RUNNING".to_string();
                        detail = format!("正在自动执行工具: {}", last_tool);
                    }
                } else {
                    status = "COMPLETED".to_string();
                    detail = "AI 任务执行完毕，已给出最终答复".to_string();
                }
            } else {
                status = "COMPLETED".to_string();
                detail = "AI 任务执行完毕，已给出最终答复".to_string();
            }
        } else {
            status = "RUNNING".to_string();
            detail = format!("已完成工具执行: {}", line_type);
        }
    } else {
        return None;
    }
    
    Some((status, last_tool, detail))
}

fn parse_codex_line(line_str: &str) -> Option<(String, String, String)> {
    let val: serde_json::Value = serde_json::from_str(line_str).ok()?;
    let mut status = "RUNNING".to_string();
    let mut last_tool = "".to_string();
    let mut detail = "Codex 正在运行中...".to_string();

    let event_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if event_type == "event_msg" {
        if let Some(payload) = val.get("payload") {
            let payload_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if payload_type == "task_complete" {
                status = "COMPLETED".to_string();
                detail = "AI 任务执行完毕，已给出最终答复".to_string();
            } else if payload_type == "task_started" {
                status = "RUNNING".to_string();
                detail = "任务启动，AI 开始工作".to_string();
            }
        }
    } else if event_type == "response_item" {
        if line_str.contains("run_command") || line_str.contains("ask_permission") || line_str.contains("ask_question") {
            status = "WAITING".to_string();
            detail = "请求执行敏感操作，等待您的授权确认".to_string();
            last_tool = "CLI Command / Permission".to_string();
        } else {
            status = "RUNNING".to_string();
            detail = "AI 正在执行子任务".to_string();
        }
    }

    Some((status, last_tool, detail))
}

fn parse_opencode_line(line_str: &str) -> Option<(String, String, String)> {
    let mut status = "RUNNING".to_string();
    let mut last_tool = "".to_string();
    let mut detail = "OpenCode 正在执行中...".to_string();

    let lower = line_str.to_lowercase();
    if lower.contains("task_complete") || lower.contains("completed") || lower.contains("finished") {
        status = "COMPLETED".to_string();
        detail = "AI 任务执行完毕，已给出最终答复".to_string();
    } else if lower.contains("ask_permission") || lower.contains("ask_question") || lower.contains("run_command") || lower.contains("waiting for approval") || lower.contains("require_escalated") {
        status = "WAITING".to_string();
        detail = "请求执行敏感指令，等待您的授权确认".to_string();
        last_tool = "Command / Interactive Tool".to_string();
    } else {
        status = "RUNNING".to_string();
        detail = "AI 正在分析或执行自动工具".to_string();
    }

    Some((status, last_tool, detail))
}

// 解析通用日志状态的主入口
fn process_any_log(path: &Path, tool_name: &str) -> Option<(String, String, String)> {
    if tool_name == "Antigravity" {
        let content = fs::read_to_string(path).ok()?;
        let lines: Vec<&str> = content.lines().collect();
        let last_line = lines.last()?;
        parse_antigravity_line(last_line)
    } else if tool_name == "Roo Code" {
        // Roo Code 属于 JSON 数组
        let content = fs::read_to_string(path).ok()?;
        let arr: serde_json::Value = serde_json::from_str(&content).ok()?;
        if let Some(list) = arr.as_array() {
            if let Some(last_val) = list.last() {
                let say = last_val.get("say").and_then(|v| v.as_str()).unwrap_or("");
                let ask = last_val.get("ask").and_then(|v| v.as_str()).unwrap_or("");
                
                let mut status = "RUNNING".to_string();
                let mut detail = "AI 正在执行任务...".to_string();
                let last_tool = if !ask.is_empty() { ask.to_string() } else { say.to_string() };
                
                if !ask.is_empty() {
                    status = "WAITING".to_string();
                    detail = match ask {
                        "command" => "请求执行终端命令，等待您的确认".to_string(),
                        "tool" => "请求使用开发工具，等待您的确认".to_string(),
                        _ => format!("等待确认操作: {}", ask),
                    };
                } else if say == "completion" || say == "task" {
                    status = "COMPLETED".to_string();
                    detail = "AI 任务执行完毕，已给出最终答复".to_string();
                } else {
                    status = "RUNNING".to_string();
                    detail = format!("正在自动处理: {}", say);
                }
                
                return Some((status, last_tool, detail));
            }
        }
        None
    } else if tool_name == "Claude Code" {
        // Claude Code 属于 JSONL 会话记录
        let content = fs::read_to_string(path).ok()?;
        let lines: Vec<&str> = content.lines().collect();
        let last_line = lines.last()?;
        
        let val: serde_json::Value = serde_json::from_str(last_line).ok()?;
        let role = val.get("role").and_then(|v| v.as_str()).unwrap_or("");
        
        let mut status = "RUNNING".to_string();
        let mut last_tool = "".to_string();
        let mut detail = "Claude Code 正在执行中...".to_string();
        
        if role == "user" {
            status = "RUNNING".to_string();
            detail = "用户发送了新问题，Claude Code开始思考".to_string();
        } else if role == "assistant" {
            let content_blocks = val.get("content").and_then(|c| c.as_array());
            let mut has_tool_use = false;
            let mut tool_names = Vec::new();
            if let Some(blocks) = content_blocks {
                for block in blocks {
                    let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if block_type == "tool_use" {
                        has_tool_use = true;
                        if let Some(name) = block.get("name").and_then(|n| n.as_str()) {
                            tool_names.push(name.to_string());
                        }
                    }
                }
            }
            
            if has_tool_use {
                last_tool = tool_names.join(", ");
                let mut requires_approval = false;
                for name in &tool_names {
                    if name.contains("bash") || name.contains("execute") || name.contains("write") {
                        requires_approval = true;
                        break;
                    }
                }
                if requires_approval {
                    status = "WAITING".to_string();
                    detail = format!("请求执行命令/修改文件: {}，等待您的授权", last_tool);
                } else {
                    status = "RUNNING".to_string();
                    detail = format!("正在自动调用工具: {}", last_tool);
                }
            } else {
                status = "COMPLETED".to_string();
                detail = "Claude Code 执行结束，已给出最终结果".to_string();
            }
        }
        Some((status, last_tool, detail))
    } else if tool_name == "OpenCode" {
        let content = fs::read_to_string(path).ok()?;
        let lines: Vec<&str> = content.lines().collect();
        let last_line = lines.last()?;
        parse_opencode_line(last_line)
    } else if tool_name == "Codex" {
        let content = fs::read_to_string(path).ok()?;
        let lines: Vec<&str> = content.lines().collect();
        let last_line = lines.last()?;
        parse_codex_line(last_line)
    } else {
        None
    }
}

// 格式化当前时间为 H:M:S
fn get_time_string() -> String {
    if let Ok(duration) = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        let total_secs = duration.as_secs() + 8 * 3600; // 东八区
        let secs = total_secs % 60;
        let mins = (total_secs / 60) % 60;
        let hours = (total_secs / 3600) % 24;
        format!("{:02}:{:02}:{:02}", hours, mins, secs)
    } else {
        "--:--:--".to_string()
    }
}

// 后台多日志并行与自适应监控主循环
fn start_monitoring(app: AppHandle) {
    thread::spawn(move || {
        let mut last_file: Option<PathBuf> = None;
        let mut last_size = 0;
        
        loop {
            thread::sleep(Duration::from_millis(500));
            
            // 获取当前最新启用的配置
            let config = {
                let config_state = app.state::<AppConfig>();
                let current = config_state.config.lock().unwrap();
                current.clone()
            };
            
            // 扫描定位当前最新修改的工具日志
            let (current_file, tool_name) = match find_absolute_latest_log(&config) {
                Some((path, name)) => (path, name),
                None => continue,
            };
            
            let mut reset = false;
            if Some(&current_file) != last_file.as_ref() {
                last_file = Some(current_file.clone());
                last_size = 0;
                reset = true;
            }
            
            let file_size = fs::metadata(&current_file).map(|m| m.len()).unwrap_or(0);
            if file_size == 0 {
                continue;
            }
            
            if file_size < last_size {
                last_size = 0;
            }
            
            if file_size > last_size || reset {
                if let Some((status, last_tool, detail)) = process_any_log(&current_file, &tool_name) {
                    
                    let state_handle = app.state::<AppState>();
                    let mut state = state_handle.state.lock().unwrap();
                    
                    let prev_status = state.status.clone();
                    state.status = status.clone();
                    state.last_tool = last_tool.clone();
                    // 显示具体的工具来源，例如 "Antigravity" 或 "Claude Code"
                    state.conversation_id = format!("{} (活跃监控中)", tool_name);
                    state.log_file = current_file.to_string_lossy().to_string();
                    state.last_update = get_time_string();
                    
                    if prev_status != status {
                        let event = EventItem {
                            time: state.last_update.clone(),
                            from: prev_status,
                            to: status.clone(),
                            detail: format!("[{}] {}", tool_name, detail),
                        };
                        state.events.insert(0, event);
                        if state.events.len() > 15 {
                            state.events.truncate(15);
                        }
                        
                        let payload = state.clone();
                        let _ = app.emit("status-changed", payload);
                    }
                }
                last_size = file_size;
            }
        }
    });
}

// --- 前端调用的 Tauri Commands ---

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> StatusState {
    let current = state.state.lock().unwrap();
    current.clone()
}

#[tauri::command]
fn get_config(config_state: State<'_, AppConfig>) -> Config {
    let current = config_state.config.lock().unwrap();
    current.clone()
}

#[tauri::command]
fn save_config(app: AppHandle, config_state: State<'_, AppConfig>, new_config: Config) -> Result<(), String> {
    {
        let mut current = config_state.config.lock().unwrap();
        *current = new_config.clone();
    }
    
    if let Some(dir) = app.path().app_config_dir().ok() {
        let _ = fs::create_dir_all(&dir);
        let config_path = dir.join("config.json");
        if let Ok(json_str) = serde_json::to_string_pretty(&new_config) {
            let _ = fs::write(config_path, json_str);
        }
    }
    
    Ok(())
}

// 自动探测当前电脑上安装了哪些 AI 编程工具
#[tauri::command]
fn detect_tools() -> Vec<ToolStatus> {
    let home = match get_user_home() {
        Some(h) => h,
        None => return Vec::new(),
    };
    
    let mut results = Vec::new();
    
    // 1. Antigravity
    let anti_path = Path::new(&home).join(".gemini").join("antigravity");
    results.push(ToolStatus {
        name: "Antigravity".to_string(),
        installed: anti_path.exists(),
        path: anti_path.to_string_lossy().to_string(),
    });
    
    // 2. Roo Code / Cline
    let roo_path = if cfg!(target_os = "windows") {
        Path::new(&home).join("AppData").join("Roaming").join("Code").join("User")
            .join("globalStorage").join("saoudrizwan.claude-dev")
    } else {
        Path::new(&home).join("Library").join("Application Support").join("Code").join("User")
            .join("globalStorage").join("saoudrizwan.claude-dev")
    };
    results.push(ToolStatus {
        name: "Roo Code / Cline".to_string(),
        installed: roo_path.exists(),
        path: roo_path.to_string_lossy().to_string(),
    });
    
    // 3. Claude Code
    let claude_path = Path::new(&home).join(".claude");
    results.push(ToolStatus {
        name: "Claude Code".to_string(),
        installed: claude_path.exists(),
        path: claude_path.to_string_lossy().to_string(),
    });
    
    // 4. OpenCode
    let opencode_path1 = Path::new(&home).join(".config").join("opencode");
    let opencode_path2 = Path::new(&home).join(".local").join("share").join("opencode");
    let opencode_installed = opencode_path1.exists() || opencode_path2.exists();
    results.push(ToolStatus {
        name: "OpenCode".to_string(),
        installed: opencode_installed,
        path: if opencode_path1.exists() { opencode_path1.to_string_lossy().to_string() } else { opencode_path2.to_string_lossy().to_string() },
    });

    // 5. Codex
    let codex_path = Path::new(&home).join(".codex");
    results.push(ToolStatus {
        name: "Codex".to_string(),
        installed: codex_path.exists(),
        path: codex_path.to_string_lossy().to_string(),
    });

    results
}

#[tauri::command]
fn get_app_version() -> String {
    "1.0.9".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut config = get_default_config();
    
    let state = AppState {
        state: Mutex::new(StatusState {
            status: "COMPLETED".to_string(),
            last_tool: String::new(),
            last_update: "--:--:--".to_string(),
            conversation_id: String::new(),
            log_file: String::new(),
            events: Vec::new(),
        }),
    };
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(|app| {
            if let Some(dir) = app.path().app_config_dir().ok() {
                let config_path = dir.join("config.json");
                if config_path.exists() {
                    if let Ok(content) = fs::read_to_string(config_path) {
                        if let Ok(loaded_config) = serde_json::from_str::<Config>(&content) {
                            config = loaded_config;
                        }
                    }
                }
            }
            
            app.manage(AppConfig {
                config: Mutex::new(config),
            });
            
            start_monitoring(app.handle().clone());
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_status, get_config, save_config, detect_tools, get_app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
