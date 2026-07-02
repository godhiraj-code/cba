//! JSON-RPC 2.0 and Starlight Protocol message types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// JSON-RPC 2.0 version constant.
pub const JSONRPC_VERSION: &str = "2.0";

// =============================================================================
// Base JSON-RPC Types
// =============================================================================

/// A JSON-RPC 2.0 request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest<T> {
    pub jsonrpc: String,
    pub method: String,
    pub params: T,
    pub id: String,
}

impl<T> JsonRpcRequest<T> {
    /// Create a new JSON-RPC request.
    pub fn new(method: impl Into<String>, params: T, id: impl Into<String>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            method: method.into(),
            params,
            id: id.into(),
        }
    }
}

/// A JSON-RPC 2.0 response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse<T> {
    pub jsonrpc: String,
    pub result: Option<T>,
    pub error: Option<JsonRpcError>,
    pub id: String,
}

/// A JSON-RPC 2.0 error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// A JSON-RPC 2.0 notification (no id field).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification<T> {
    pub jsonrpc: String,
    pub method: String,
    pub params: T,
}

impl<T> JsonRpcNotification<T> {
    /// Create a new notification.
    pub fn new(method: impl Into<String>, params: T) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            method: method.into(),
            params,
        }
    }
}

// =============================================================================
// Starlight Protocol Message Types
// =============================================================================

/// Registration parameters for Sentinel → Hub.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationParams {
    /// Sentinel layer name (e.g., "JanitorSentinel")
    pub layer: String,

    /// Client role.
    pub role: String,

    /// Priority (1-10, lower = higher priority)
    pub priority: u8,

    /// Protocol version.
    pub version: String,

    /// Capabilities (e.g., ["detection", "healing"])
    #[serde(default)]
    pub capabilities: Vec<String>,

    /// CSS selectors this Sentinel monitors
    #[serde(default)]
    pub selectors: Vec<String>,

    /// Optional JWT authentication token
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "authToken")]
    pub auth_token: Option<String>,
}

impl RegistrationParams {
    /// Create new registration params.
    pub fn new(layer: impl Into<String>, priority: u8) -> Self {
        Self {
            layer: layer.into(),
            role: "sentinel".to_string(),
            priority,
            version: "1.0.0".to_string(),
            capabilities: Vec::new(),
            selectors: Vec::new(),
            auth_token: None,
        }
    }

    /// Add capabilities.
    pub fn with_capabilities(mut self, caps: Vec<impl Into<String>>) -> Self {
        self.capabilities = caps.into_iter().map(Into::into).collect();
        self
    }

    /// Add selectors.
    pub fn with_selectors(mut self, sels: Vec<impl Into<String>>) -> Self {
        self.selectors = sels.into_iter().map(Into::into).collect();
        self
    }

    /// Set auth token.
    pub fn with_auth_token(mut self, token: impl Into<String>) -> Self {
        self.auth_token = Some(token.into());
        self
    }
}

/// Pre-check parameters from Hub → Sentinel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreCheckParams {
    /// Upcoming command.
    pub command: CommandInfo,

    /// Detected blocking elements
    #[serde(default)]
    pub blocking: Vec<BlockingElement>,

    /// Page screenshot (base64)
    #[serde(default)]
    pub screenshot: Option<String>,

    /// Target element rectangle, when available.
    #[serde(default)]
    #[serde(rename = "targetRect")]
    pub target_rect: Option<serde_json::Value>,

    /// Page text supplied to PII-aware Sentinels.
    #[serde(default)]
    pub page_text: Option<String>,

    /// Accessibility snapshot supplied to accessibility Sentinels.
    #[serde(default)]
    pub a11y_snapshot: Option<serde_json::Value>,
}

/// Command information included in a pre-check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandInfo {
    #[serde(default)]
    pub cmd: Option<String>,
    #[serde(default)]
    pub goal: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

/// A blocking element detected by the Hub.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockingElement {
    pub selector: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub element_type: Option<String>,
}

/// Pre-check response types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "response")]
pub enum PreCheckResponse {
    /// All clear - proceed with command
    #[serde(rename = "clear")]
    Clear,

    /// Wait - retry after specified milliseconds
    #[serde(rename = "wait")]
    Wait {
        #[serde(rename = "retryAfterMs")]
        retry_after_ms: u64,
        #[serde(default)]
        reason: Option<String>,
    },

    /// Hijack - Sentinel takes browser control
    #[serde(rename = "hijack")]
    Hijack { reason: String },
}

/// Hijack parameters (Sentinel → Hub).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HijackParams {
    pub reason: String,
}

/// Action command during hijack (Sentinel → Hub).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionParams {
    pub cmd: ActionCommand,
    pub selector: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Available action commands during hijack.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionCommand {
    Click,
    Fill,
    Hide,
    Remove,
}

/// Resume parameters after hijack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeParams {
    /// Request re-check after resume
    #[serde(default = "default_true")]
    #[serde(rename = "re_check")]
    pub request_recheck: bool,
}

fn default_true() -> bool {
    true
}

/// Context update from Sentinel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextUpdateParams {
    pub context: HashMap<String, serde_json::Value>,
}

/// Entropy (page state) update from Hub.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntropyParams {
    #[serde(default)]
    pub entropy: bool,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub mutations: u32,
    #[serde(default)]
    pub network_pending: u32,
    #[serde(default)]
    pub context: HashMap<String, serde_json::Value>,
}

// =============================================================================
// Protocol Method Names
// =============================================================================

/// Starlight Protocol method names.
pub mod methods {
    pub const REGISTRATION: &str = "starlight.registration";
    pub const PRE_CHECK: &str = "starlight.pre_check";
    pub const CLEAR: &str = "starlight.clear";
    pub const WAIT: &str = "starlight.wait";
    pub const HIJACK: &str = "starlight.hijack";
    pub const ACTION: &str = "starlight.action";
    pub const RESUME: &str = "starlight.resume";
    pub const ENTROPY: &str = "starlight.entropy";
    pub const ENTROPY_STREAM: &str = "starlight.entropy_stream";
    pub const CONTEXT_UPDATE: &str = "starlight.context_update";
    pub const INTENT: &str = "starlight.intent";
    pub const PING: &str = "starlight.ping";
    pub const PONG: &str = "starlight.pong";
}

// =============================================================================
// Helper Types
// =============================================================================

/// Raw incoming message that can be either a request or notification.
#[derive(Debug, Clone, Deserialize)]
pub struct RawMessage {
    pub jsonrpc: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub params: serde_json::Value,
    pub id: Option<String>,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<JsonRpcError>,
}
