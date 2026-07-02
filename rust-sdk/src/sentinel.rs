//! Sentinel implementation for the Starlight Protocol.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::auth::JwtHandler;
use crate::client::{ClientConfig, WebSocketClient};
use crate::error::{Error, Result};
use crate::messages::{
    methods, ActionCommand, ActionParams, ContextUpdateParams, EntropyParams, HijackParams,
    JsonRpcRequest, PreCheckParams, PreCheckResponse, RawMessage,
    RegistrationParams, ResumeParams,
};

/// Sentinel configuration.
#[derive(Debug, Clone)]
pub struct SentinelConfig {
    /// Sentinel layer name
    pub name: String,

    /// Priority (1-10, lower = higher priority)
    pub priority: u8,

    /// Capabilities
    pub capabilities: Vec<String>,

    /// CSS selectors to monitor
    pub selectors: Vec<String>,

    /// JWT secret for authentication (optional)
    pub jwt_secret: Option<String>,

    /// Auto-reconnect on disconnect
    pub auto_reconnect: bool,
}

impl SentinelConfig {
    /// Create a new Sentinel configuration.
    ///
    /// # Arguments
    /// * `name` - Sentinel layer name (e.g., "JanitorSentinel")
    /// * `priority` - Priority 1-10, lower = higher priority
    ///
    /// # Example
    /// ```
    /// use starlight::SentinelConfig;
    ///
    /// let config = SentinelConfig::new("MySentinel", 5)
    ///     .with_selectors(vec![".popup", ".modal"]);
    /// ```
    pub fn new(name: impl Into<String>, priority: u8) -> Self {
        Self {
            name: name.into(),
            priority: priority.clamp(1, 10),
            capabilities: Vec::new(),
            selectors: Vec::new(),
            jwt_secret: None,
            auto_reconnect: true,
        }
    }

    /// Add capabilities.
    pub fn with_capabilities(mut self, caps: Vec<impl Into<String>>) -> Self {
        self.capabilities = caps.into_iter().map(Into::into).collect();
        self
    }

    /// Add CSS selectors to monitor.
    pub fn with_selectors(mut self, sels: Vec<impl Into<String>>) -> Self {
        self.selectors = sels.into_iter().map(Into::into).collect();
        self
    }

    /// Set JWT secret for authentication.
    pub fn with_jwt_secret(mut self, secret: impl Into<String>) -> Self {
        self.jwt_secret = Some(secret.into());
        self
    }

    /// Disable auto-reconnect.
    pub fn without_auto_reconnect(mut self) -> Self {
        self.auto_reconnect = false;
        self
    }
}

/// Trait for handling Sentinel events.
///
/// Implement this trait to define custom behavior for your Sentinel.
///
/// # Example
/// ```rust,no_run
/// use starlight::{SentinelHandler, PreCheckParams, PreCheckResponse};
/// use async_trait::async_trait;
///
/// struct MyHandler;
///
/// #[async_trait]
/// impl SentinelHandler for MyHandler {
///     async fn on_pre_check(&self, params: PreCheckParams) -> PreCheckResponse {
///         if params.blocking.is_empty() {
///             PreCheckResponse::Clear
///         } else {
///             PreCheckResponse::Hijack {
///                 reason: "Detected obstacles".to_string()
///             }
///         }
///     }
/// }
/// ```
#[async_trait::async_trait]
pub trait SentinelHandler: Send + Sync {
    /// Called when Hub requests a pre-check before executing a command.
    ///
    /// This is the main decision point for your Sentinel.
    async fn on_pre_check(&self, params: PreCheckParams) -> PreCheckResponse {
        // Default: always clear
        let _ = params;
        PreCheckResponse::Clear
    }

    /// Called when Hub sends entropy (page state) updates.
    async fn on_entropy(&self, params: EntropyParams) {
        debug!("Entropy update: {:?}", params);
    }

    /// Called when Hub sends context updates.
    async fn on_context_update(&self, context: HashMap<String, serde_json::Value>) {
        debug!("Context update: {:?}", context);
    }

    /// Called when the Sentinel connects to the Hub.
    async fn on_connect(&self) {
        info!("Connected to Hub");
    }

    /// Called when the Sentinel disconnects from the Hub.
    async fn on_disconnect(&self) {
        warn!("Disconnected from Hub");
    }
}

/// Default handler that always clears pre-checks.
pub struct DefaultHandler;

#[async_trait::async_trait]
impl SentinelHandler for DefaultHandler {}

/// A Starlight Protocol Sentinel.
///
/// This is the main entry point for building Sentinels in Rust.
///
/// # Example
/// ```rust,no_run
/// use starlight::{Sentinel, SentinelConfig, DefaultHandler};
///
/// #[tokio::main]
/// async fn main() -> Result<(), Box<dyn std::error::Error>> {
///     let config = SentinelConfig::new("MySentinel", 5);
///     let mut sentinel = Sentinel::new(config, DefaultHandler);
///     
///     sentinel.connect("ws://localhost:8080").await?;
///     sentinel.run().await?;
///     
///     Ok(())
/// }
/// ```
pub struct Sentinel<H: SentinelHandler> {
    config: SentinelConfig,
    handler: Arc<H>,
    client: Option<WebSocketClient>,
    running: Arc<RwLock<bool>>,
    jwt_handler: Option<JwtHandler>,
}

impl<H: SentinelHandler + 'static> Sentinel<H> {
    /// Create a new Sentinel.
    pub fn new(config: SentinelConfig, handler: H) -> Self {
        let jwt_handler = config.jwt_secret.as_ref().map(JwtHandler::new);

        Self {
            config,
            handler: Arc::new(handler),
            client: None,
            running: Arc::new(RwLock::new(false)),
            jwt_handler,
        }
    }

    /// Connect to the Starlight Hub.
    pub async fn connect(&mut self, url: &str) -> Result<()> {
        info!("Connecting {} to {}", self.config.name, url);

        let client_config = ClientConfig::new(url);
        let client = WebSocketClient::new(client_config);

        client.connect().await?;
        self.client = Some(client);

        // Send registration
        self.register().await?;

        // Notify handler
        self.handler.on_connect().await;

        Ok(())
    }

    /// Send registration message to Hub.
    async fn register(&self) -> Result<()> {
        let client = self.client.as_ref().ok_or(Error::NotConnected)?;

        let mut params = RegistrationParams::new(&self.config.name, self.config.priority)
            .with_capabilities(self.config.capabilities.clone())
            .with_selectors(self.config.selectors.clone());

        // Add JWT token if configured
        if let Some(ref jwt) = self.jwt_handler {
            let token = jwt.generate_token(&self.config.name)?;
            params = params.with_auth_token(token);
        }

        let request = JsonRpcRequest::new(
            methods::REGISTRATION,
            params,
            format!("reg-{}", Uuid::new_v4()),
        );

        client.send_json(&request).await?;
        info!("{} registered with Hub", self.config.name);

        Ok(())
    }

    /// Run the Sentinel message loop.
    ///
    /// This method blocks until the Sentinel is stopped or disconnected.
    pub async fn run(&self) -> Result<()> {
        let client = self.client.as_ref().ok_or(Error::NotConnected)?;

        *self.running.write().await = true;
        info!("{} running", self.config.name);

        loop {
            if !*self.running.read().await {
                break;
            }

            match client.receive().await {
                Ok(Some(msg)) => {
                    if let Err(e) = self.handle_message(msg).await {
                        error!("Error handling message: {}", e);
                    }
                }
                Ok(None) => continue, // Ping/pong or other non-text message
                Err(Error::ConnectionClosed(_)) if self.config.auto_reconnect => {
                    self.handler.on_disconnect().await;
                    warn!("Connection lost, attempting reconnect...");

                    if let Err(e) = client.reconnect().await {
                        error!("Reconnection failed: {}", e);
                        break;
                    }

                    // Re-register after reconnect
                    if let Err(e) = self.register().await {
                        error!("Re-registration failed: {}", e);
                        break;
                    }

                    self.handler.on_connect().await;
                }
                Err(e) => {
                    error!("Error: {}", e);
                    self.handler.on_disconnect().await;
                    break;
                }
            }
        }

        *self.running.write().await = false;
        Ok(())
    }

    /// Handle an incoming message from the Hub.
    async fn handle_message(&self, msg: RawMessage) -> Result<()> {
        let Some(method) = msg.method.as_deref() else {
            if let Some(error) = msg.error {
                error!("Hub request failed: {}", error.message);
            }
            return Ok(());
        };

        debug!("Handling: {}", method);

        match method {
            methods::PRE_CHECK => {
                let params: PreCheckParams = serde_json::from_value(msg.params)?;
                let response = self.handler.on_pre_check(params).await;

                if let Some(id) = msg.id {
                    self.send_pre_check_response(&id, response).await?;
                }
            }
            methods::ENTROPY_STREAM => {
                let params: EntropyParams = serde_json::from_value(msg.params)?;
                self.handler.on_entropy(params).await;
            }
            methods::CONTEXT_UPDATE => {
                let params: ContextUpdateParams = serde_json::from_value(msg.params)?;
                self.handler.on_context_update(params.context).await;
            }
            methods::PING => {
                let client = self.client.as_ref().ok_or(Error::NotConnected)?;
                let request = JsonRpcRequest::new(
                    methods::PONG,
                    serde_json::json!({ "timestamp": chrono::Utc::now().timestamp_millis() }),
                    format!("pong-{}", Uuid::new_v4()),
                );
                client.send_json(&request).await?;
            }
            _ => {
                debug!("Unhandled method: {}", method);
            }
        }

        Ok(())
    }

    /// Send pre-check response to Hub.
    async fn send_pre_check_response(&self, id: &str, response: PreCheckResponse) -> Result<()> {
        let client = self.client.as_ref().ok_or(Error::NotConnected)?;

        let (method, params) = match response {
            PreCheckResponse::Clear => (
                methods::CLEAR,
                serde_json::json!({ "confidence": 1.0 }),
            ),
            PreCheckResponse::Wait {
                retry_after_ms,
                reason,
            } => {
                let mut params = serde_json::json!({
                    "retryAfterMs": retry_after_ms,
                    "severity": "soft"
                });
                if let Some(reason) = reason {
                    params["reason"] = serde_json::Value::String(reason);
                }
                (methods::WAIT, params)
            }
            PreCheckResponse::Hijack { reason } => (
                methods::HIJACK,
                serde_json::json!({ "reason": reason }),
            ),
        };

        let request = JsonRpcRequest::new(method, params, id);
        client.send_json(&request).await
    }

    /// Send a hijack request (take control of browser).
    pub async fn hijack(&self, reason: impl Into<String>) -> Result<()> {
        let client = self.client.as_ref().ok_or(Error::NotConnected)?;

        let params = HijackParams {
            reason: reason.into(),
        };

        let request = JsonRpcRequest::new(
            methods::HIJACK,
            params,
            format!("hijack-{}", Uuid::new_v4()),
        );
        client.send_json(&request).await
    }

    /// Send an action during hijack.
    pub async fn action(
        &self,
        cmd: ActionCommand,
        selector: impl Into<String>,
        text: Option<String>,
    ) -> Result<()> {
        let client = self.client.as_ref().ok_or(Error::NotConnected)?;

        let params = ActionParams {
            cmd,
            selector: selector.into(),
            text,
        };

        let request = JsonRpcRequest::new(
            methods::ACTION,
            params,
            format!("action-{}", Uuid::new_v4()),
        );
        client.send_json(&request).await
    }

    /// Resume after hijack.
    pub async fn resume(&self, request_recheck: bool) -> Result<()> {
        let client = self.client.as_ref().ok_or(Error::NotConnected)?;

        let params = ResumeParams { request_recheck };
        let request = JsonRpcRequest::new(
            methods::RESUME,
            params,
            format!("resume-{}", Uuid::new_v4()),
        );
        client.send_json(&request).await
    }

    /// Stop the Sentinel.
    pub async fn stop(&self) {
        *self.running.write().await = false;

        if let Some(ref client) = self.client {
            let _ = client.close().await;
        }

        info!("{} stopped", self.config.name);
    }

    /// Check if the Sentinel is running.
    pub async fn is_running(&self) -> bool {
        *self.running.read().await
    }
}
