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

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Config {
    pub bark_key: String,
    pub feishu_webhook: String,
    pub dingtalk_webhook: String,
    pub wechat_webhook: String,
    pub push_on_running: bool,
    pub push_on_waiting: bool,
    pub push_on_completed: bool,
    pub port: u16, // 本地监听端口，保留支持
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

// 应用程序全局状态，使用 Mutex 保证线程安全
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
        push_on_running: false,
        push_on_waiting: true,
        push_on_completed: true,
        port: 8000,
    }
}

// 检索最新的 transcript.jsonl 文件
fn find_latest_transcript() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
        
    let brain_dir = Path::new(&home)
        .join(".gemini")
        .join("antigravity")
        .join("brain");
        
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
                            match latest_file {
                                Some((_, ref prev_mtime)) => {
                                    if mtime > *prev_mtime {
                                        latest_file = Some((log_file, mtime));
                                    }
                                }
                                None => {
                                    latest_file = Some((log_file, mtime));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    latest_file.map(|(path, _)| path)
}

// 解析最新的一行日志，判断AI状态
fn process_line(line_str: &str) -> Option<(String, String, String)> {
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
                        if name == "run_command" || name == "ask_permission" || name == "ask_question" {
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

// 格式化当前时间为 H:M:S
fn get_time_string() -> String {
    // 简单获取时间
    if let Ok(duration) = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        let total_secs = duration.as_secs() + 8 * 3600; // 东八区时区加8小时
        let secs = total_secs % 60;
        let mins = (total_secs / 60) % 60;
        let hours = (total_secs / 3600) % 24;
        format!("{:02}:{:02}:{:02}", hours, mins, secs)
    } else {
        "--:--:--".to_string()
    }
}

// 后台监控日志线程逻辑
fn start_monitoring(app: AppHandle) {
    thread::spawn(move || {
        let mut last_file: Option<PathBuf> = None;
        let mut last_size = 0;
        
        loop {
            thread::sleep(Duration::from_millis(500));
            
            let current_file = match find_latest_transcript() {
                Some(path) => path,
                None => continue,
            };
            
            // 提炼会话 ID
            let convo_id = current_file.parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.file_name().unwrap_or_default().to_string_lossy().to_string())
                .unwrap_or_default();
                
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
                // 读取新内容
                if let Ok(content) = fs::read_to_string(&current_file) {
                    let lines: Vec<&str> = content.lines().collect();
                    if !lines.is_empty() {
                        let last_line = lines.last().unwrap_or(&"");
                        if let Some((status, last_tool, detail)) = process_line(last_line) {
                            
                            // 更新全局状态并广播
                            let state_handle = app.state::<AppState>();
                            let mut state = state_handle.state.lock().unwrap();
                            
                            let prev_status = state.status.clone();
                            state.status = status.clone();
                            state.last_tool = last_tool.clone();
                            state.conversation_id = convo_id.clone();
                            state.log_file = current_file.to_string_lossy().to_string();
                            state.last_update = get_time_string();
                            
                            if prev_status != status {
                                let event = EventItem {
                                    time: state.last_update.clone(),
                                    from: prev_status,
                                    to: status.clone(),
                                    detail: detail.clone(),
                                };
                                state.events.insert(0, event);
                                if state.events.len() > 15 {
                                    state.events.truncate(15);
                                }
                                
                                // 广播事件到前端
                                let payload = state.clone();
                                let _ = app.emit("status-changed", payload);
                            }
                        }
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
    // 写入全局状态
    {
        let mut current = config_state.config.lock().unwrap();
        *current = new_config.clone();
    }
    
    // 保存至本地文件
    if let Some(dir) = app.path().app_config_dir().ok() {
        let _ = fs::create_dir_all(&dir);
        let config_path = dir.join("config.json");
        if let Ok(json_str) = serde_json::to_string_pretty(&new_config) {
            let _ = fs::write(config_path, json_str);
        }
    }
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化默认配置
    let mut config = get_default_config();
    
    // 尝试从磁盘加载配置
    // 我们必须手动实现 AppContext 初始化之前的加载，或者在 setup 中加载
    // 为了简单，我们使用 tauri 2.0 的 API 在运行时处理。下面在 builder 中获取路径：
    
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
            // 在初始化时读取本地配置文件
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
            
            // 启动后台日志监听线程
            start_monitoring(app.handle().clone());
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_status, get_config, save_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
