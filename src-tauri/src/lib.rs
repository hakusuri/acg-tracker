use serde::Serialize;
use std::time::Duration;
use tauri::Manager;

const UA_BANGUMI: &str = "acg-tracker/0.3.0 (personal anime tracker)";
const UA_VNDB: &str = "acg-tracker/0.3.0 (personal galgame tracker)";
const DEFAULT_BANGUMI: &str = "https://api.bgm.tv";
const DEFAULT_VNDB: &str = "https://api.vndb.org";

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BangumiItem {
    pub id: i64,
    pub name: String,
    pub name_cn: String,
    pub summary: String,
    pub date: Option<String>,
    pub image: Option<String>,
    pub score: Option<f64>,
    pub eps: Option<i64>,
    pub volumes: Option<i64>,
    pub total_episodes: Option<i64>,
    pub tags: Vec<String>,
    pub btype: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VndbItem {
    pub id: String,
    pub title: String,
    pub released: Option<String>,
    pub image: Option<String>,
    pub rating: Option<f64>,
    pub description: Option<String>,
    pub tags: Vec<String>,
}

fn base_url(api_base: &str, default: &str) -> String {
    let trimmed = api_base.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        default.to_string()
    } else {
        trimmed.to_string()
    }
}

/// 默认数据目录：程序所在目录下的 data/（安装/便携版数据跟随程序目录）。
fn default_data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| app.path().app_config_dir().unwrap_or_default())
        .join("data")
}

/// 数据目录：自定义目录优先，空值回退到默认目录（程序目录/data）。
fn resolve_data_dir(app: &tauri::AppHandle, custom: &str) -> std::path::PathBuf {
    let trimmed = custom.trim();
    if trimmed.is_empty() {
        default_data_dir(app)
    } else {
        std::path::PathBuf::from(trimmed)
    }
}

/// 解析语义化版本号 x.y.z（忽略前缀 v）。
fn parse_version(v: &str) -> (u64, u64, u64) {
    let s = v.trim().trim_start_matches('v');
    let parts: Vec<&str> = s.split('.').collect();
    let get = |i: usize| parts.get(i).and_then(|p| p.parse::<u64>().ok()).unwrap_or(0);
    (get(0), get(1), get(2))
}

fn bootstrap_data_dir_from(cfg_dir: &std::path::Path) -> String {
    let file = cfg_dir.join("data_dir.json");
    if let Ok(text) = std::fs::read_to_string(&file) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(s) = v.get("dataDir").and_then(|x| x.as_str()) {
                return s.to_string();
            }
        }
    }
    String::new()
}

/// 当前实际使用的数据库文件路径（引导文件指向自定义目录时优先）。
fn current_db_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let cfg = app.path().app_config_dir().unwrap_or_default();
    let custom = bootstrap_data_dir_from(&cfg);
    if !custom.is_empty() {
        let p = std::path::PathBuf::from(&custom).join("acg.db");
        if p.exists() {
            return p;
        }
    }
    cfg.join("acg.db")
}

fn current_covers_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let cfg = app.path().app_config_dir().unwrap_or_default();
    let custom = bootstrap_data_dir_from(&cfg);
    let base = if custom.is_empty() {
        app.path().app_data_dir().unwrap_or(cfg)
    } else {
        std::path::PathBuf::from(&custom)
    };
    base.join("covers")
}

/// 根据代理模式创建客户端：
/// - auto：使用系统代理（Clash 等）
/// - custom：使用自定义代理地址
/// - direct：直连
/// 无论哪种模式，都会附带一个直连客户端作为失败回退。
fn make_clients(
    proxy_mode: &str,
    proxy_url: &str,
) -> Result<(Option<reqwest::Client>, reqwest::Client), String> {
    let timeout = Duration::from_secs(20);
    let direct = reqwest::Client::builder()
        .no_proxy()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建客户端失败: {e}"))?;

    let primary = match proxy_mode {
        "direct" => None,
        "custom" => {
            let url = proxy_url.trim();
            if url.is_empty() {
                None
            } else {
                let proxy =
                    reqwest::Proxy::all(url).map_err(|e| format!("代理地址无效: {e}"))?;
                Some(
                    reqwest::Client::builder()
                        .proxy(proxy)
                        .timeout(timeout)
                        .build()
                        .map_err(|e| format!("创建客户端失败: {e}"))?,
                )
            }
        }
        _ => Some(
            reqwest::Client::builder()
                .timeout(timeout)
                .build()
                .map_err(|e| format!("创建客户端失败: {e}"))?,
        ),
    };
    Ok((primary, direct))
}

async fn send_with_fallback(
    build: impl Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    proxy_mode: &str,
    proxy_url: &str,
) -> Result<reqwest::Response, String> {
    let (primary, direct) = make_clients(proxy_mode, proxy_url)?;
    if let Some(client) = &primary {
        match build(client).send().await {
            Ok(resp) => return Ok(resp),
            Err(_) => {}
        }
    }
    build(&direct)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))
}

async fn check_status(resp: reqwest::Response, service: &str) -> Result<reqwest::Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let text = resp.text().await.unwrap_or_default();
    let snippet: String = text.chars().take(200).collect();
    Err(format!("{service} 返回状态 {status}：{snippet}"))
}

/// Bangumi 搜索结果的 image 可能是字符串 URL，也可能是 { large, common, ... } 对象。
fn extract_bangumi_image(it: &serde_json::Value) -> Option<String> {
    for key in ["image", "images"] {
        if let Some(img) = it.get(key) {
            if let Some(s) = img.as_str() {
                return Some(s.to_string());
            }
            for size in ["large", "medium", "common", "small"] {
                if let Some(s) = img.get(size).and_then(|v| v.as_str()) {
                    return Some(s.to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
async fn search_bangumi(
    keyword: String,
    types: Vec<i64>,
    limit: u32,
    api_base: String,
    proxy_mode: String,
    proxy_url: String,
) -> Result<Vec<BangumiItem>, String> {
    let base = base_url(&api_base, DEFAULT_BANGUMI);
    let limit = limit.clamp(1, 50);
    let url = reqwest::Url::parse_with_params(
        &format!("{base}/v0/search/subjects"),
        &[("limit", limit.to_string())],
    )
    .map_err(|e| e.to_string())?;

    let mut payload = serde_json::json!({ "keyword": keyword, "sort": "match" });
    if !types.is_empty() {
        payload["filter"] = serde_json::json!({ "type": types });
    }

    let resp = send_with_fallback(
        |client| {
            client
                .post(url.clone())
                .header("User-Agent", UA_BANGUMI)
                .json(&payload)
        },
        &proxy_mode,
        &proxy_url,
    )
    .await?;
    let resp = check_status(resp, "Bangumi").await?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Bangumi 响应解析失败: {e}"))?;

    let data = body
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let mut items = Vec::new();
    for it in data {
        let mut tags = Vec::new();
        if let Some(arr) = it.get("meta_tags").and_then(|v| v.as_array()) {
            for v in arr {
                if let Some(s) = v.as_str() {
                    if !s.trim().is_empty() && !tags.contains(&s.to_string()) {
                        tags.push(s.to_string());
                    }
                }
            }
        }
        if let Some(arr) = it.get("tags").and_then(|v| v.as_array()) {
            for v in arr {
                if let Some(s) = v.get("name").and_then(|x| x.as_str()) {
                    let s = s.to_string();
                    if !tags.contains(&s) {
                        tags.push(s);
                    }
                }
            }
        }
        tags.truncate(10);

        let score = it
            .get("rating")
            .and_then(|r| r.get("score"))
            .and_then(|v| v.as_f64())
            .or_else(|| it.get("score").and_then(|v| v.as_f64()));

        items.push(BangumiItem {
            id: it.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            name: it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name_cn: it.get("name_cn").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            summary: it.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            date: it.get("date").and_then(|v| v.as_str()).map(|s| s.to_string()),
            image: extract_bangumi_image(&it),
            score,
            eps: it.get("eps").and_then(|v| v.as_i64()),
            volumes: it.get("volumes").and_then(|v| v.as_i64()),
            total_episodes: it.get("total_episodes").and_then(|v| v.as_i64()),
            tags,
            btype: it.get("type").and_then(|v| v.as_i64()).unwrap_or(2),
        });
    }
    Ok(items)
}

#[tauri::command]
async fn search_vndb(
    keyword: String,
    limit: u32,
    api_base: String,
    proxy_mode: String,
    proxy_url: String,
) -> Result<Vec<VndbItem>, String> {
    let base = base_url(&api_base, DEFAULT_VNDB);
    let limit = limit.clamp(1, 100);
    let payload = serde_json::json!({
        "filters": ["search", "=", keyword],
        "fields": "id,title,released,image.url,rating,description,tags{id,name,spoiler,rating}",
        "sort": "searchrank",
        "results": limit
    });

    let resp = send_with_fallback(
        |client| {
            client
                .post(format!("{base}/kana/vn"))
                .header("User-Agent", UA_VNDB)
                .json(&payload)
        },
        &proxy_mode,
        &proxy_url,
    )
    .await?;
    let resp = check_status(resp, "VNDB").await?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("VNDB 响应解析失败: {e}"))?;

    let results = body
        .get("results")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let mut items = Vec::new();
    for it in results {
        let mut tags: Vec<(f64, String)> = Vec::new();
        if let Some(arr) = it.get("tags").and_then(|v| v.as_array()) {
            for v in arr {
                let spoiler = v.get("spoiler").and_then(|x| x.as_i64()).unwrap_or(1);
                if spoiler != 0 {
                    continue;
                }
                if let Some(name) = v.get("name").and_then(|x| x.as_str()) {
                    let rating = v.get("rating").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    tags.push((rating, name.to_string()));
                }
            }
        }
        tags.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let tag_names: Vec<String> = tags.into_iter().take(8).map(|(_, n)| n).collect();

        items.push(VndbItem {
            id: it.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            title: it.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            released: it.get("released").and_then(|v| v.as_str()).map(|s| s.to_string()),
            image: it
                .get("image")
                .and_then(|v| v.get("url"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            rating: it.get("rating").and_then(|v| v.as_f64()),
            description: it.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
            tags: tag_names,
        });
    }
    Ok(items)
}

#[tauri::command]
async fn download_cover(
    app: tauri::AppHandle,
    url: String,
    proxy_mode: String,
    proxy_url: String,
    data_dir: String,
) -> Result<String, String> {
    let covers_dir = resolve_data_dir(&app, &data_dir).join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(|e| format!("无法创建封面目录: {e}"))?;

    let resp = send_with_fallback(
        |client| client.get(url.clone()).header("User-Agent", UA_BANGUMI),
        &proxy_mode,
        &proxy_url,
    )
    .await?;
    let resp = check_status(resp, "封面下载").await?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("下载封面失败: {e}"))?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("封面文件过大".to_string());
    }

    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let ext = parsed
        .path_segments()
        .and_then(|mut segs| segs.next_back())
        .and_then(|name| name.rfind('.').map(|i| &name[i + 1..]))
        .map(|e| e.to_lowercase())
        .filter(|e| matches!(e.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp"))
        .unwrap_or_else(|| "jpg".to_string());

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let file_name = format!("cover_{}.{}", nanos, ext);
    let dest = covers_dir.join(&file_name);

    std::fs::write(&dest, &bytes).map_err(|e| format!("保存封面失败: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_background(app: tauri::AppHandle, source_path: String, data_dir: String) -> Result<String, String> {
    let base = resolve_data_dir(&app, &data_dir);
    let bg_dir = base.join("backgrounds");
    std::fs::create_dir_all(&bg_dir).map_err(|e| format!("无法创建背景目录: {e}"))?;

    // 内容去重：如果所选图片与已保存的背景相同，直接复用已有文件
    if let Ok(src_bytes) = std::fs::read(&source_path) {
        if let Ok(entries) = std::fs::read_dir(&bg_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Ok(b) = std::fs::read(&p) {
                        if b.len() == src_bytes.len() && b == src_bytes {
                            return Ok(p.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
    }

    let ext = std::path::Path::new(&source_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let file_name = format!("bg_{}.{}", nanos, ext);
    let dest = bg_dir.join(&file_name);

    std::fs::copy(&source_path, &dest).map_err(|e| format!("复制背景图片失败: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: String,
}

#[tauri::command]
fn list_backups(app: tauri::AppHandle, data_dir: String) -> Result<Vec<BackupInfo>, String> {
    let base = resolve_data_dir(&app, &data_dir);
    let backups_dir = base.join("backups");
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&backups_dir).map_err(|e| e.to_string())? {
        let Ok(e) = entry else { continue };
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("db") {
            continue;
        }
        let is_backup = p
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with("acg_"))
            .unwrap_or(false);
        if !is_backup {
            continue;
        }
        let meta = e.metadata().map_err(|e| e.to_string())?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();
        out.push(BackupInfo {
            name: e.file_name().to_string_lossy().into_owned(),
            path: p.to_string_lossy().into_owned(),
            size: meta.len(),
            modified,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
fn restore_backup(app: tauri::AppHandle, backup_path: String, data_dir: String) -> Result<(), String> {
    let base = resolve_data_dir(&app, &data_dir);
    let backups_dir = base.join("backups");
    let target = std::path::PathBuf::from(&backup_path);
    if !target.exists() {
        return Err("备份文件不存在".to_string());
    }
    let b = backups_dir.canonicalize().map_err(|e| e.to_string())?;
    let t = target.canonicalize().map_err(|e| e.to_string())?;
    if !t.starts_with(&b) {
        return Err("只能恢复备份目录内的文件".to_string());
    }
    let db_path = base.join("acg.db");
    for suffix in ["", "-wal", "-shm"] {
        let p = std::path::PathBuf::from(format!("{}{}", db_path.to_string_lossy(), suffix));
        if p.exists() {
            let _ = std::fs::remove_file(&p);
        }
    }
    std::fs::copy(&target, &db_path).map_err(|e| format!("恢复数据库失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn delete_all_covers(app: tauri::AppHandle, data_dir: String) -> Result<u32, String> {
    let base = resolve_data_dir(&app, &data_dir);
    let covers_dir = base.join("covers");
    if !covers_dir.exists() {
        return Ok(0);
    }
    let mut count = 0;
    for entry in std::fs::read_dir(&covers_dir).map_err(|e| e.to_string())? {
        if let Ok(e) = entry {
            if e.path().is_file() {
                let _ = std::fs::remove_file(e.path());
                count += 1;
            }
        }
    }
    Ok(count)
}

#[tauri::command]
fn delete_cover_file(app: tauri::AppHandle, path: String, data_dir: String) -> Result<(), String> {
    let base = resolve_data_dir(&app, &data_dir);
    let covers_dir = base.join("covers");
    if !covers_dir.exists() {
        return Ok(());
    }
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Ok(());
    }
    let covers_canon = covers_dir
        .canonicalize()
        .map_err(|e| format!("解析封面目录失败: {e}"))?;
    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("解析封面文件失败: {e}"))?;
    if !target_canon.starts_with(&covers_canon) {
        return Err("只能删除封面目录内的文件".to_string());
    }
    std::fs::remove_file(&target_canon).map_err(|e| format!("删除封面文件失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn delete_background(app: tauri::AppHandle, path: String, data_dir: String) -> Result<(), String> {
    let base = resolve_data_dir(&app, &data_dir);
    let bg_dir = base.join("backgrounds");
    if !bg_dir.exists() {
        return Ok(());
    }
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Ok(());
    }
    let bg_canon = bg_dir
        .canonicalize()
        .map_err(|e| format!("解析背景目录失败: {e}"))?;
    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("解析背景文件失败: {e}"))?;
    if !target_canon.starts_with(&bg_canon) {
        return Err("只能删除背景目录内的文件".to_string());
    }
    std::fs::remove_file(&target_canon).map_err(|e| format!("删除背景图片失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn save_cover(app: tauri::AppHandle, source_path: String, data_dir: String) -> Result<String, String> {
    let covers_dir = resolve_data_dir(&app, &data_dir).join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(|e| format!("无法创建封面目录: {e}"))?;

    let ext = std::path::Path::new(&source_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let file_name = format!("cover_{}.{}", nanos, ext);
    let dest = covers_dir.join(&file_name);

    std::fs::copy(&source_path, &dest).map_err(|e| format!("复制封面失败: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(default_data_dir(&app).to_string_lossy().into_owned())
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle, data_dir: String) -> Result<(), String> {
    let dir = resolve_data_dir(&app, &data_dir);
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn backup_database(app: tauri::AppHandle, keep: u32, data_dir: String) -> Result<String, String> {
    let base = resolve_data_dir(&app, &data_dir);
    let db_path = base.join("acg.db");
    let backups_dir = base.join("backups");
    std::fs::create_dir_all(&backups_dir).map_err(|e| format!("无法创建备份目录: {e}"))?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dest = backups_dir.join(format!("acg_{}.db", nanos));
    let target = dest.to_string_lossy().replace('\\', "/");

    let opts = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(false);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("打开数据库失败: {e}"))?;
    sqlx::query(&format!("VACUUM INTO '{}'", target))
        .execute(&pool)
        .await
        .map_err(|e| format!("备份失败: {e}"))?;
    pool.close().await;

    let keep = keep.max(1);
    let mut files: Vec<_> = std::fs::read_dir(&backups_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().and_then(|x| x.to_str()) == Some("db")
                && p.file_name()
                    .and_then(|x| x.to_str())
                    .map(|n| n.starts_with("acg_"))
                    .unwrap_or(false)
        })
        .collect();
    files.sort_by_key(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_prefix("acg_"))
            .and_then(|s| s.strip_suffix(".db"))
            .and_then(|s| s.parse::<u128>().ok())
            .unwrap_or(0)
    });
    for old in files.iter().take(files.len().saturating_sub(keep as usize)) {
        let _ = std::fs::remove_file(old);
    }

    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_bootstrap_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取应用配置目录: {e}"))?;
    Ok(bootstrap_data_dir_from(&cfg))
}

#[tauri::command]
fn set_bootstrap_data_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let cfg = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取应用配置目录: {e}"))?;
    std::fs::create_dir_all(&cfg).map_err(|e| format!("创建目录失败: {e}"))?;
    let file = cfg.join("data_dir.json");
    let payload = serde_json::json!({ "dataDir": path });
    let text = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(&file, text).map_err(|e| format!("写入引导文件失败: {e}"))?;
    Ok(())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub latest_version: String,
    pub html_url: String,
    pub published_at: String,
    pub is_newer: bool,
}

/// 把旧默认目录（%APPDATA%/com.acg.tracker）中的数据迁移到新的默认目录（程序目录/data）。
#[tauri::command]
async fn migrate_legacy_data(app: tauri::AppHandle) -> Result<(), String> {
    let default_dir = default_data_dir(&app);
    // 无论是否迁移，都确保默认数据目录存在（全新安装场景）
    std::fs::create_dir_all(&default_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let old_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取旧数据目录: {e}"))?;
    let new_db = default_dir.join("acg.db");
    let old_db = old_dir.join("acg.db");
    if new_db.exists() || !old_db.exists() {
        return Ok(());
    }

    let dest = new_db.to_string_lossy().replace('\\', "/");
    let opts = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&old_db)
        .create_if_missing(false);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("打开旧数据库失败: {e}"))?;
    sqlx::query(&format!("VACUUM INTO '{}'", dest))
        .execute(&pool)
        .await
        .map_err(|e| format!("迁移数据库失败: {e}"))?;
    pool.close().await;

    for sub in ["covers", "backgrounds", "backups"] {
        let src = old_dir.join(sub);
        let dst = default_dir.join(sub);
        if src.exists() && !dst.exists() {
            std::fs::create_dir_all(&dst).map_err(|e| format!("创建目录失败: {e}"))?;
            for entry in std::fs::read_dir(&src).map_err(|e| e.to_string())? {
                if let Ok(e) = entry {
                    let from = e.path();
                    let to = dst.join(e.file_name());
                    if from.is_file() && !to.exists() {
                        let _ = std::fs::copy(&from, &to);
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn check_update(current_version: String, feed_url: String) -> Result<UpdateCheck, String> {
    let url = if feed_url.trim().is_empty() {
        "https://api.github.com/repos/hakusuri/acg-tracker/releases/latest".to_string()
    } else {
        feed_url.trim().to_string()
    };
    let resp = send_with_fallback(
        |client| client.get(url.clone()).header("User-Agent", UA_BANGUMI),
        "auto",
        "",
    )
    .await?;
    let resp = check_status(resp, "更新检查").await?;
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("更新响应解析失败: {e}"))?;

    let latest_version = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let html_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let published_at = body
        .get("published_at")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_newer = !latest_version.is_empty() && parse_version(&latest_version) > parse_version(&current_version);

    Ok(UpdateCheck {
        latest_version,
        html_url,
        published_at,
        is_newer,
    })
}

#[tauri::command]
fn allow_asset_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let d = resolve_data_dir(&app, &dir);
    app.asset_protocol_scope()
        .allow_directory(&d, true)
        .map_err(|e| format!("添加资源目录到白名单失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn ensure_data_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let d = resolve_data_dir(&app, &dir);
    std::fs::create_dir_all(&d).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn migrate_data_dir(app: tauri::AppHandle, new_dir: String) -> Result<String, String> {
    let target = std::path::PathBuf::from(new_dir.trim());
    if target.as_os_str().is_empty() {
        return Err("目录不能为空".to_string());
    }
    std::fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {e}"))?;

    let target_db = target.join("acg.db");
    if !target_db.exists() {
        let src = current_db_path(&app);
        if src.exists() {
            let dest = target_db.to_string_lossy().replace('\\', "/");
            let opts = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&src)
                .create_if_missing(false);
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(opts)
                .await
                .map_err(|e| format!("打开数据库失败: {e}"))?;
            sqlx::query(&format!("VACUUM INTO '{}'", dest))
                .execute(&pool)
                .await
                .map_err(|e| format!("迁移数据库失败: {e}"))?;
            pool.close().await;
        }
    }

    let src_covers = current_covers_dir(&app);
    let dst_covers = target.join("covers");
    if src_covers.exists() && !dst_covers.exists() {
        std::fs::create_dir_all(&dst_covers).map_err(|e| format!("创建封面目录失败: {e}"))?;
        for entry in std::fs::read_dir(&src_covers).map_err(|e| e.to_string())? {
            if let Ok(e) = entry {
                let from = e.path();
                let to = dst_covers.join(e.file_name());
                if from.is_file() && !to.exists() {
                    let _ = std::fs::copy(&from, &to);
                }
            }
        }
    }

    Ok(target.to_string_lossy().into_owned())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CalendarItem {
    pub id: i64,
    pub name: String,
    pub name_cn: String,
    pub date: Option<String>,
    pub image: Option<String>,
    pub score: Option<f64>,
    pub eps: Option<i64>,
    pub btype: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    pub weekday: i64,
    pub en: String,
    pub cn: String,
    pub ja: String,
    pub items: Vec<CalendarItem>,
}

#[tauri::command]
async fn fetch_bangumi_calendar(
    api_base: String,
    proxy_mode: String,
    proxy_url: String,
) -> Result<Vec<CalendarDay>, String> {
    let base = base_url(&api_base, DEFAULT_BANGUMI);
    let url = format!("{base}/calendar");
    let resp = send_with_fallback(
        |client| client.get(url.clone()).header("User-Agent", UA_BANGUMI),
        &proxy_mode,
        &proxy_url,
    )
    .await?;
    let resp = check_status(resp, "Bangumi").await?;
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Bangumi 响应解析失败: {e}"))?;
    let arr = body.as_array().cloned().unwrap_or_default();
    let mut days = Vec::new();
    for (i, day) in arr.into_iter().enumerate() {
        let weekday = day.get("weekday");
        let id = weekday
            .and_then(|w| w.get("id"))
            .and_then(|v| v.as_i64())
            .unwrap_or(i as i64 + 1);
        let en = weekday
            .and_then(|w| w.get("en"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let cn = weekday
            .and_then(|w| w.get("cn"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ja = weekday
            .and_then(|w| w.get("ja"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut items = Vec::new();
        if let Some(list) = day.get("items").and_then(|v| v.as_array()) {
            for it in list {
                let score = it
                    .get("rating")
                    .and_then(|r| r.get("score"))
                    .and_then(|v| v.as_f64());
                items.push(CalendarItem {
                    id: it.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
                    name: it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name_cn: it.get("name_cn").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    date: it
                        .get("date")
                        .or_else(|| it.get("air_date"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    image: extract_bangumi_image(it),
                    score,
                    eps: it
                        .get("eps")
                        .and_then(|v| v.as_i64())
                        .or_else(|| it.get("total_episodes").and_then(|v| v.as_i64())),
                    btype: it.get("type").and_then(|v| v.as_i64()).unwrap_or(2),
                });
            }
        }
        days.push(CalendarDay {
            weekday: id,
            en,
            cn,
            ja,
            items,
        });
    }
    days.sort_by_key(|d| d.weekday);
    Ok(days)
}

#[tauri::command]
async fn fetch_bangumi_subject(
    subject_id: i64,
    api_base: String,
    proxy_mode: String,
    proxy_url: String,
) -> Result<BangumiItem, String> {
    let base = base_url(&api_base, DEFAULT_BANGUMI);
    let url = format!("{base}/v0/subjects/{subject_id}");
    let resp = send_with_fallback(
        |client| client.get(url.clone()).header("User-Agent", UA_BANGUMI),
        &proxy_mode,
        &proxy_url,
    )
    .await?;
    let resp = check_status(resp, "Bangumi").await?;
    let it: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Bangumi 响应解析失败: {e}"))?;

    let mut tags = Vec::new();
    if let Some(arr) = it.get("meta_tags").and_then(|v| v.as_array()) {
        for v in arr {
            if let Some(s) = v.as_str() {
                if !s.trim().is_empty() && !tags.contains(&s.to_string()) {
                    tags.push(s.to_string());
                }
            }
        }
    }
    if let Some(arr) = it.get("tags").and_then(|v| v.as_array()) {
        for v in arr {
            if let Some(s) = v.get("name").and_then(|x| x.as_str()) {
                let s = s.to_string();
                if !tags.contains(&s) {
                    tags.push(s);
                }
            }
        }
    }
    tags.truncate(10);

    let score = it
        .get("rating")
        .and_then(|r| r.get("score"))
        .and_then(|v| v.as_f64());

    Ok(BangumiItem {
        id: it.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
        name: it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        name_cn: it.get("name_cn").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        summary: it.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        date: it.get("date").and_then(|v| v.as_str()).map(|s| s.to_string()),
        image: extract_bangumi_image(&it),
        score,
        eps: it.get("eps").and_then(|v| v.as_i64()),
        volumes: it.get("volumes").and_then(|v| v.as_i64()),
        total_episodes: it.get("total_episodes").and_then(|v| v.as_i64()),
        tags,
        btype: it.get("type").and_then(|v| v.as_i64()).unwrap_or(2),
    })
}

#[tauri::command]
fn launch_game(path: String) -> Result<(), String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("游戏路径为空".to_string());
    }
    if !std::path::Path::new(p).exists() {
        return Err("游戏文件不存在".to_string());
    }
    std::process::Command::new(p)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(())
}

fn calendar_cache_dir(app: &tauri::AppHandle, data_dir: &str) -> std::path::PathBuf {
    resolve_data_dir(app, data_dir).join("calendar_cache")
}

#[tauri::command]
fn read_calendar_cache(app: tauri::AppHandle, data_dir: String) -> Result<Option<String>, String> {
    let file = calendar_cache_dir(&app, &data_dir).join("calendar.json");
    if !file.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&file)
        .map(Some)
        .map_err(|e| format!("读取日历缓存失败: {e}"))
}

#[tauri::command]
fn write_calendar_cache(app: tauri::AppHandle, data_dir: String, json: String) -> Result<(), String> {
    let dir = calendar_cache_dir(&app, &data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建日历缓存目录: {e}"))?;
    std::fs::write(dir.join("calendar.json"), json).map_err(|e| format!("写入日历缓存失败: {e}"))
}

#[tauri::command]
fn delete_calendar_cache(app: tauri::AppHandle, data_dir: String) -> Result<(), String> {
    let dir = calendar_cache_dir(&app, &data_dir);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除日历缓存失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn download_calendar_cover(
    app: tauri::AppHandle,
    url: String,
    data_dir: String,
    proxy_mode: String,
    proxy_url: String,
) -> Result<String, String> {
    let covers_dir = calendar_cache_dir(&app, &data_dir).join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(|e| format!("无法创建日历封面目录: {e}"))?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hasher::write(&mut hasher, url.as_bytes());
    let hash = std::hash::Hasher::finish(&hasher);

    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let ext = parsed
        .path_segments()
        .and_then(|mut segs| segs.next_back())
        .and_then(|name| name.rfind('.').map(|i| &name[i + 1..]))
        .map(|e| e.to_lowercase())
        .filter(|e| matches!(e.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp"))
        .unwrap_or_else(|| "jpg".to_string());
    let dest = covers_dir.join(format!("cal_{hash:x}.{ext}"));
    if dest.exists() {
        return Ok(dest.to_string_lossy().into_owned());
    }

    let resp = send_with_fallback(
        |client| client.get(url.clone()).header("User-Agent", UA_BANGUMI),
        &proxy_mode,
        &proxy_url,
    )
    .await?;
    let resp = check_status(resp, "日历封面下载").await?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("下载日历封面失败: {e}"))?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("封面文件过大".to_string());
    }
    std::fs::write(&dest, &bytes).map_err(|e| format!("保存日历封面失败: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// 枚举当前系统中所有正在运行的进程可执行文件名（小写；同时记录完整名与前 15 字符前缀，
/// 兼容部分系统信息接口对镜像名的截断）。
fn running_process_names() -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    unsafe {
        let snapshot = windows_sys::Win32::System::Diagnostics::ToolHelp::CreateToolhelp32Snapshot(
            windows_sys::Win32::System::Diagnostics::ToolHelp::TH32CS_SNAPPROCESS,
            0,
        );
        if snapshot == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return set;
        }
        let mut entry: windows_sys::Win32::System::Diagnostics::ToolHelp::PROCESSENTRY32W =
            std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<
            windows_sys::Win32::System::Diagnostics::ToolHelp::PROCESSENTRY32W,
        >() as u32;
        if windows_sys::Win32::System::Diagnostics::ToolHelp::Process32FirstW(snapshot, &mut entry) != 0
        {
            loop {
                let raw: &[u16] = &entry.szExeFile;
                let end = raw.iter().position(|&ch| ch == 0).unwrap_or(raw.len());
                let name = String::from_utf16_lossy(&raw[..end]).to_lowercase();
                if !name.is_empty() {
                    set.insert(name.clone());
                    let prefix: String = name.chars().take(15).collect();
                    set.insert(prefix);
                }
                if windows_sys::Win32::System::Diagnostics::ToolHelp::Process32NextW(snapshot, &mut entry)
                    == 0
                {
                    break;
                }
            }
        }
        windows_sys::Win32::Foundation::CloseHandle(snapshot);
    }
    set
}

/// 检测指定 exe 是否正在运行（按可执行文件名匹配，原生枚举，毫秒级）。
#[cfg(test)]
fn is_process_running(path: &str) -> bool {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if name.is_empty() {
        return false;
    }
    let needle = name.to_lowercase();
    let running = running_process_names();
    running.contains(&needle) || running.contains(&needle.chars().take(15).collect::<String>())
}

#[tauri::command]
async fn games_running(paths: Vec<String>) -> Vec<bool> {
    // 原生枚举一次即可，避免每轮为每个游戏 spawn 子进程而阻塞 GUI 主线程
    let running = running_process_names();
    paths
        .iter()
        .map(|p| {
            let name = std::path::Path::new(p)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if name.is_empty() {
                return false;
            }
            let needle = name.to_lowercase();
            running.contains(&needle) || running.contains(&needle.chars().take(15).collect::<String>())
        })
        .collect()
}

/// 关闭行为是否为“最小化到托盘”（读取设置表中的 close_behavior）。
fn close_behavior_is_tray(app: &tauri::AppHandle) -> bool {
    // 使用与前端一致的实际数据目录（默认程序目录/data，或引导文件指定的自定义目录）
    let cfg = app.path().app_config_dir().unwrap_or_default();
    let custom = bootstrap_data_dir_from(&cfg);
    let db_path = resolve_data_dir(app, &custom).join("acg.db");
    if !db_path.exists() {
        return false;
    }
    let value = tauri::async_runtime::block_on(async {
        let opts = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(false)
            .read_only(true);
        let Ok(pool) = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
        else {
            return None;
        };
        let result = sqlx::query_scalar::<_, String>(
            "SELECT value FROM settings WHERE key = 'close_behavior'",
        )
        .fetch_optional(&pool)
        .await;
        let _ = pool.close().await;
        result.unwrap_or(None)
    });
    value.as_deref() == Some("tray")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {

            if let Some(icon) = app.default_window_icon().cloned() {
                let show_item = tauri::menu::MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = tauri::menu::Menu::with_items(app, &[&show_item, &quit_item])?;
                let tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    });
                tray.build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && close_behavior_is_tray(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            games_running,
            fetch_bangumi_calendar,
            fetch_bangumi_subject,
            launch_game,
            read_calendar_cache,
            write_calendar_cache,
            delete_calendar_cache,
            download_calendar_cover,
            search_bangumi,
            search_vndb,
            download_cover,
            save_cover,
            save_background,
            delete_background,
            delete_cover_file,
            get_data_dir,
            open_data_dir,
            backup_database,
            allow_asset_dir,
            migrate_legacy_data,
            list_backups,
            restore_backup,
            delete_all_covers,
            path_exists,
            check_update,
            get_bootstrap_data_dir,
            set_bootstrap_data_dir,
            ensure_data_dir,
            migrate_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod api_tests {
    use super::*;


    #[test]
    fn check_process_running() {
        let exe = std::env::current_exe().unwrap();
        let path = exe.to_string_lossy().to_string();
        assert!(is_process_running(&path), "当前测试进程应被检测为运行中");
        assert!(!is_process_running(r"C:\nonexistent\not_running_xyz_12345.exe"));
    }

    #[tokio::test]
    async fn check_calendar() {
        let (pm, pu) = ("auto".to_string(), String::new());
        match fetch_bangumi_calendar("https://api.bgm.tv".to_string(), pm, pu).await {
            Ok(v) => println!(
                "CALENDAR OK days={} items={} first={:?}",
                v.len(),
                v.iter().map(|d| d.items.len()).sum::<usize>(),
                v.first()
                    .and_then(|d| d.items.first())
                    .map(|x| (x.id, x.name_cn.clone(), x.eps, x.image.clone()))
            ),
            Err(e) => println!("CALENDAR ERR {e}"),
        }
    }

    #[tokio::test]
    async fn check_subject() {
        let (pm, pu) = ("auto".to_string(), String::new());
        match fetch_bangumi_subject(7, "https://api.bgm.tv".to_string(), pm, pu).await {
            Ok(x) => println!(
                "SUBJECT OK id={} name={:?} eps={:?} img={:?}",
                x.id, x.name_cn, x.total_episodes, x.image
            ),
            Err(e) => println!("SUBJECT ERR {e}"),
        }
    }

    #[tokio::test]
    async fn check_bangumi() {
        let (pm, pu) = ("auto".to_string(), String::new());
        match search_bangumi(
            "命运石之门".to_string(),
            vec![],
            30,
            "https://api.bgm.tv".to_string(),
            pm,
            pu,
        )
        .await
        {
            Ok(v) => println!(
                "BANGUMI OK count={} first={:?}",
                v.len(),
                v.first().map(|x| (x.id, x.name_cn.clone(), x.score, x.eps, x.volumes, x.total_episodes, x.tags.len(), x.image.clone()))
            ),
            Err(e) => println!("BANGUMI ERR {e}"),
        }
    }

    #[tokio::test]
    async fn check_bangumi_anime_filter() {
        let (pm, pu) = ("auto".to_string(), String::new());
        match search_bangumi(
            "命运石之门".to_string(),
            vec![2],
            30,
            "https://api.bgm.tv".to_string(),
            pm,
            pu,
        )
        .await
        {
            Ok(v) => println!(
                "BANGUMI ANIME OK count={} first={:?}",
                v.len(),
                v.first().map(|x| (x.id, x.name_cn.clone(), x.image.clone()))
            ),
            Err(e) => println!("BANGUMI ANIME ERR {e}"),
        }
    }

    #[tokio::test]
    async fn check_vndb() {
        let (pm, pu) = ("auto".to_string(), String::new());
        match search_vndb(
            "CLANNAD".to_string(),
            30,
            "https://api.vndb.org".to_string(),
            pm,
            pu,
        )
        .await
        {
            Ok(v) => println!(
                "VNDB OK count={} first={:?}",
                v.len(),
                v.first().map(|x| (x.id.clone(), x.title.clone(), x.rating, x.tags.len(), x.image.clone()))
            ),
            Err(e) => println!("VNDB ERR {e}"),
        }
    }
}