use std::path::Path;

#[tauri::command]
pub async fn v2_read_project_file(path: String) -> Result<String, String> {
    let path_ref = Path::new(&path);
    if path_ref.extension().and_then(|ext| ext.to_str()) != Some("loadlink") {
        return Err("Le fichier doit avoir l'extension .loadlink".to_string());
    }
    std::fs::read_to_string(path_ref).map_err(|err| format!("Lecture .loadlink impossible: {err}"))
}

#[tauri::command]
pub async fn v2_write_project_file(path: String, content: String) -> Result<(), String> {
    let path_ref = Path::new(&path);
    if path_ref.extension().and_then(|ext| ext.to_str()) != Some("loadlink") {
        return Err("Le fichier doit avoir l'extension .loadlink".to_string());
    }
    std::fs::write(path_ref, content)
        .map_err(|err| format!("Sauvegarde .loadlink impossible: {err}"))
}
