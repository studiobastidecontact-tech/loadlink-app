use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V2MediaProbe {
    pub file_path: String,
    pub name: String,
    pub extension: String,
}

#[tauri::command]
pub async fn v2_probe_media_file(path: String) -> Result<V2MediaProbe, String> {
    let path_ref = Path::new(&path);
    if !path_ref.is_file() {
        return Err("Fichier introuvable".to_string());
    }
    Ok(V2MediaProbe {
        file_path: path.clone(),
        name: path_ref
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("media")
            .to_string(),
        extension: path_ref
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_lowercase(),
    })
}
