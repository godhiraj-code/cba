//! WebSocket client for connecting to the Starlight Hub.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{
    stream::{SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, RwLock};
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};

use crate::error::{Error, Result};
use crate::messages::RawMessage;

/// Type alias for the WebSocket stream.
pub type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsSink = SplitSink<WsStream, Message>;
type WsReceiver = SplitStream<WsStream>;

/// WebSocket client configuration.
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// Hub URL (e.g., "ws://localhost:8080")
    pub url: String,

    /// Enable auto-reconnection
    pub auto_reconnect: bool,

    /// Initial reconnect delay in milliseconds
    pub reconnect_delay_ms: u64,

    /// Maximum reconnect delay in milliseconds
    pub max_reconnect_delay_ms: u64,

    /// Maximum reconnection attempts (0 = unlimited)
    pub max_reconnect_attempts: u32,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            url: "ws://localhost:8080".to_string(),
            auto_reconnect: true,
            reconnect_delay_ms: 1000,
            max_reconnect_delay_ms: 30000,
            max_reconnect_attempts: 0, // Unlimited
        }
    }
}

impl ClientConfig {
    /// Create a new client config with the given URL.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            ..Default::default()
        }
    }
}

/// WebSocket client for Starlight Hub communication.
pub struct WebSocketClient {
    config: ClientConfig,
    sender: Arc<Mutex<Option<WsSink>>>,
    receiver: Arc<Mutex<Option<WsReceiver>>>,
    connected: Arc<RwLock<bool>>,
    reconnect_count: Arc<RwLock<u32>>,
}

impl WebSocketClient {
    /// Create a new WebSocket client.
    pub fn new(config: ClientConfig) -> Self {
        Self {
            config,
            sender: Arc::new(Mutex::new(None)),
            receiver: Arc::new(Mutex::new(None)),
            connected: Arc::new(RwLock::new(false)),
            reconnect_count: Arc::new(RwLock::new(0)),
        }
    }

    /// Connect to the Hub.
    pub async fn connect(&self) -> Result<()> {
        info!("Connecting to Hub at {}", self.config.url);

        let (ws_stream, _) = connect_async(&self.config.url).await?;

        info!("Connected to Hub");

        let (sender, receiver) = ws_stream.split();
        *self.sender.lock().await = Some(sender);
        *self.receiver.lock().await = Some(receiver);
        *self.connected.write().await = true;
        *self.reconnect_count.write().await = 0;

        Ok(())
    }

    /// Check if connected to Hub.
    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }

    /// Send a message to the Hub.
    pub async fn send(&self, message: &str) -> Result<()> {
        let mut sender_guard = self.sender.lock().await;

        if let Some(ref mut sender) = *sender_guard {
            sender.send(Message::Text(message.to_string())).await?;
            debug!("Sent: {}", message);
            Ok(())
        } else {
            Err(Error::NotConnected)
        }
    }

    /// Send a typed message (serializes to JSON).
    pub async fn send_json<T: serde::Serialize>(&self, message: &T) -> Result<()> {
        let json = serde_json::to_string(message)?;
        self.send(&json).await
    }

    /// Receive a message from the Hub.
    pub async fn receive(&self) -> Result<Option<RawMessage>> {
        let message = {
            let mut receiver_guard = self.receiver.lock().await;
            let receiver = receiver_guard.as_mut().ok_or(Error::NotConnected)?;
            receiver.next().await
        };

        match message {
            Some(Ok(Message::Text(text))) => {
                debug!("Received: {}", text);
                let msg: RawMessage = serde_json::from_str(&text)?;
                Ok(Some(msg))
            }
            Some(Ok(Message::Close(_))) => {
                warn!("Connection closed by Hub");
                *self.connected.write().await = false;
                Err(Error::ConnectionClosed("Closed by Hub".to_string()))
            }
            Some(Ok(Message::Ping(data))) => {
                let mut sender_guard = self.sender.lock().await;
                let sender = sender_guard.as_mut().ok_or(Error::NotConnected)?;
                sender.send(Message::Pong(data)).await?;
                Ok(None)
            }
            Some(Ok(_)) => Ok(None), // Ignore other message types
            Some(Err(e)) => {
                error!("WebSocket error: {}", e);
                *self.connected.write().await = false;
                Err(Error::Connection(e))
            }
            None => {
                *self.connected.write().await = false;
                Err(Error::ConnectionClosed("Stream ended".to_string()))
            }
        }
    }

    /// Attempt to reconnect with exponential backoff.
    pub async fn reconnect(&self) -> Result<()> {
        let mut delay = self.config.reconnect_delay_ms;
        let mut attempts = 0;

        loop {
            attempts += 1;
            *self.reconnect_count.write().await = attempts;

            if self.config.max_reconnect_attempts > 0
                && attempts > self.config.max_reconnect_attempts
            {
                error!(
                    "Max reconnection attempts ({}) exceeded",
                    self.config.max_reconnect_attempts
                );
                return Err(Error::ConnectionClosed(
                    "Max reconnection attempts exceeded".to_string(),
                ));
            }

            info!("Reconnection attempt {} (delay: {}ms)", attempts, delay);
            sleep(Duration::from_millis(delay)).await;

            match self.connect().await {
                Ok(()) => {
                    info!("Reconnected successfully after {} attempts", attempts);
                    return Ok(());
                }
                Err(e) => {
                    warn!("Reconnection failed: {}", e);
                    delay = (delay * 2).min(self.config.max_reconnect_delay_ms);
                }
            }
        }
    }

    /// Close the connection.
    pub async fn close(&self) -> Result<()> {
        let mut sender_guard = self.sender.lock().await;

        if let Some(ref mut sender) = *sender_guard {
            sender.close().await?;
        }

        *sender_guard = None;
        *self.receiver.lock().await = None;
        *self.connected.write().await = false;

        info!("Connection closed");
        Ok(())
    }

    /// Get the current reconnection count.
    pub async fn reconnect_count(&self) -> u32 {
        *self.reconnect_count.read().await
    }
}

impl Clone for WebSocketClient {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            sender: Arc::clone(&self.sender),
            receiver: Arc::clone(&self.receiver),
            connected: Arc::clone(&self.connected),
            reconnect_count: Arc::clone(&self.reconnect_count),
        }
    }
}
