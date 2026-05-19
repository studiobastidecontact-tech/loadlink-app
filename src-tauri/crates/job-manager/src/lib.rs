//! # loadlink-job-manager
//!
//! Job queue management with SQLite persistence.
//!
//! This crate is the **new foundation** introduced in Phase 1.
//! It allows LoadLink to:
//! - Track operations (downloads, conversions, etc.) as Job entities
//! - Persist jobs across app restarts (SQLite)
//! - Query history (recent jobs, by status, etc.)
//!
//! Future use cases:
//! - Resume interrupted jobs after crash (Phase 1.5)
//! - Parallel job execution with priorities (Phase 2)
//! - Job pipelines (transcribe → subtitle → export) (Phase 2)

use chrono::{DateTime, Utc};
use loadlink_core::{LoadlinkError, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

// ============================================
// Types
// ============================================

/// Job state in the queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum JobState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobState {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobState::Queued => "queued",
            JobState::Running => "running",
            JobState::Completed => "completed",
            JobState::Failed => "failed",
            JobState::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "queued" => Some(JobState::Queued),
            "running" => Some(JobState::Running),
            "completed" => Some(JobState::Completed),
            "failed" => Some(JobState::Failed),
            "cancelled" => Some(JobState::Cancelled),
            _ => None,
        }
    }
}

/// Kind of operation performed by a job.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum JobKind {
    Download,
    CompressZip,
    Reencode,
    /// Reserved for Phase 2
    Transcribe,
    /// Reserved for Phase 2
    Separate,
    AudioProcess,
}

impl JobKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobKind::Download => "download",
            JobKind::CompressZip => "compress_zip",
            JobKind::Reencode => "reencode",
            JobKind::Transcribe => "transcribe",
            JobKind::Separate => "separate",
            JobKind::AudioProcess => "audio_process",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "download" => Some(JobKind::Download),
            "compress_zip" => Some(JobKind::CompressZip),
            "reencode" => Some(JobKind::Reencode),
            "transcribe" => Some(JobKind::Transcribe),
            "separate" => Some(JobKind::Separate),
            "audio_process" => Some(JobKind::AudioProcess),
            _ => None,
        }
    }
}

/// A single Job tracked by the manager.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: Uuid,
    pub kind: JobKind,
    pub state: JobState,
    pub progress: f32,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub title: String,
    pub input_path: Option<String>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    /// Free-form JSON payload (options used for the job)
    pub metadata: serde_json::Value,
}

impl Job {
    pub fn new(kind: JobKind, title: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            kind,
            state: JobState::Queued,
            progress: 0.0,
            created_at: Utc::now(),
            started_at: None,
            finished_at: None,
            title,
            input_path: None,
            output_path: None,
            error: None,
            metadata: serde_json::Value::Null,
        }
    }
}

// ============================================
// JobManager
// ============================================

/// The job manager — wraps a SQLite connection for persistence.
///
/// Designed to be wrapped in `Arc<JobManager>` and stored in Tauri state.
pub struct JobManager {
    conn: Mutex<Connection>,
}

impl JobManager {
    /// Creates a new JobManager with database at `<AppData>/jobs.db`.
    pub fn new(app: &AppHandle) -> Result<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| LoadlinkError::Other(format!("AppData not found: {}", e)))?;
        std::fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("jobs.db");
        Self::with_path(db_path)
    }

    /// Creates a new JobManager at a specific path (useful for tests).
    pub fn with_path(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&path)
            .map_err(|e| LoadlinkError::Other(format!("SQLite open failed: {}", e)))?;

        let manager = Self {
            conn: Mutex::new(conn),
        };
        manager.init_schema()?;
        Ok(manager)
    }

    /// Creates the `jobs` table if it doesn't exist.
    fn init_schema(&self) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| LoadlinkError::Other(format!("Lock poisoned: {}", e)))?;
        conn.execute_batch(include_str!("schema.sql"))
            .map_err(|e| LoadlinkError::Other(format!("Schema init failed: {}", e)))?;
        Ok(())
    }

    /// Inserts a new Job into the database.
    pub fn insert(&self, job: &Job) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| LoadlinkError::Other(format!("Lock poisoned: {}", e)))?;

        conn.execute(
            "INSERT INTO jobs (
                id, kind, state, progress,
                created_at, started_at, finished_at,
                title, input_path, output_path, error, metadata
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                job.id.to_string(),
                job.kind.as_str(),
                job.state.as_str(),
                job.progress,
                job.created_at.to_rfc3339(),
                job.started_at.map(|t| t.to_rfc3339()),
                job.finished_at.map(|t| t.to_rfc3339()),
                job.title,
                job.input_path,
                job.output_path,
                job.error,
                job.metadata.to_string(),
            ],
        )
        .map_err(|e| LoadlinkError::Other(format!("Insert failed: {}", e)))?;

        Ok(())
    }

    /// Updates the state and progress of an existing job.
    pub fn update_state(
        &self,
        id: Uuid,
        state: JobState,
        progress: f32,
        error: Option<String>,
        output_path: Option<String>,
    ) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| LoadlinkError::Other(format!("Lock poisoned: {}", e)))?;

        let now = Utc::now().to_rfc3339();
        let started_at = if state == JobState::Running {
            Some(now.clone())
        } else {
            None
        };
        let finished_at = if matches!(
            state,
            JobState::Completed | JobState::Failed | JobState::Cancelled
        ) {
            Some(now.clone())
        } else {
            None
        };

        conn.execute(
            "UPDATE jobs
             SET state = ?1, progress = ?2, error = COALESCE(?3, error),
                 output_path = COALESCE(?4, output_path),
                 started_at = COALESCE(?5, started_at),
                 finished_at = COALESCE(?6, finished_at)
             WHERE id = ?7",
            params![
                state.as_str(),
                progress,
                error,
                output_path,
                started_at,
                finished_at,
                id.to_string(),
            ],
        )
        .map_err(|e| LoadlinkError::Other(format!("Update failed: {}", e)))?;

        Ok(())
    }

    /// Returns the most recent N jobs, ordered by creation date (newest first).
    pub fn recent(&self, limit: u32) -> Result<Vec<Job>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| LoadlinkError::Other(format!("Lock poisoned: {}", e)))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, kind, state, progress,
                        created_at, started_at, finished_at,
                        title, input_path, output_path, error, metadata
                 FROM jobs
                 ORDER BY created_at DESC
                 LIMIT ?1",
            )
            .map_err(|e| LoadlinkError::Other(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map(params![limit], row_to_job)
            .map_err(|e| LoadlinkError::Other(format!("Query failed: {}", e)))?;

        let mut jobs = Vec::new();
        for row in rows {
            jobs.push(row.map_err(|e| LoadlinkError::Other(format!("Row read: {}", e)))?);
        }
        Ok(jobs)
    }

    /// Deletes a job by ID.
    pub fn delete(&self, id: Uuid) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| LoadlinkError::Other(format!("Lock poisoned: {}", e)))?;

        conn.execute("DELETE FROM jobs WHERE id = ?1", params![id.to_string()])
            .map_err(|e| LoadlinkError::Other(format!("Delete failed: {}", e)))?;
        Ok(())
    }

    /// Clears all completed and failed jobs older than a given number of days.
    pub fn cleanup_old(&self, days: i64) -> Result<usize> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| LoadlinkError::Other(format!("Lock poisoned: {}", e)))?;

        let cutoff = (Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let count = conn
            .execute(
                "DELETE FROM jobs
                 WHERE state IN ('completed', 'failed', 'cancelled')
                 AND finished_at < ?1",
                params![cutoff],
            )
            .map_err(|e| LoadlinkError::Other(format!("Cleanup failed: {}", e)))?;
        Ok(count)
    }
}

// ============================================
// Helpers
// ============================================

fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<Job> {
    let id_str: String = row.get(0)?;
    let kind_str: String = row.get(1)?;
    let state_str: String = row.get(2)?;
    let progress: f32 = row.get(3)?;
    let created_at_str: String = row.get(4)?;
    let started_at_str: Option<String> = row.get(5)?;
    let finished_at_str: Option<String> = row.get(6)?;
    let title: String = row.get(7)?;
    let input_path: Option<String> = row.get(8)?;
    let output_path: Option<String> = row.get(9)?;
    let error: Option<String> = row.get(10)?;
    let metadata_str: String = row.get(11)?;

    Ok(Job {
        id: Uuid::parse_str(&id_str).unwrap_or_else(|_| Uuid::new_v4()),
        kind: JobKind::from_str(&kind_str).unwrap_or(JobKind::Download),
        state: JobState::from_str(&state_str).unwrap_or(JobState::Queued),
        progress,
        created_at: DateTime::parse_from_rfc3339(&created_at_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        started_at: started_at_str
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
        finished_at: finished_at_str
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
        title,
        input_path,
        output_path,
        error,
        metadata: serde_json::from_str(&metadata_str).unwrap_or(serde_json::Value::Null),
    })
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_db() -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("loadlink_test_{}.db", Uuid::new_v4()));
        path
    }

    #[test]
    fn insert_and_recent() {
        let db = temp_db();
        let mgr = JobManager::with_path(db.clone()).unwrap();
        let job = Job::new(JobKind::Download, "Test Job".to_string());
        mgr.insert(&job).unwrap();
        let recent = mgr.recent(10).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].title, "Test Job");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn update_state_works() {
        let db = temp_db();
        let mgr = JobManager::with_path(db.clone()).unwrap();
        let job = Job::new(JobKind::Download, "Test".to_string());
        let id = job.id;
        mgr.insert(&job).unwrap();
        mgr.update_state(id, JobState::Running, 50.0, None, None)
            .unwrap();
        let recent = mgr.recent(10).unwrap();
        assert_eq!(recent[0].state, JobState::Running);
        assert!((recent[0].progress - 50.0).abs() < 0.01);
        let _ = std::fs::remove_file(&db);
    }
}
