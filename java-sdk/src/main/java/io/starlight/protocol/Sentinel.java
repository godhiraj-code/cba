package io.starlight.protocol;

import jakarta.websocket.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * Base class for building Starlight Protocol Sentinels in Java.
 * 
 * <p>Example usage:</p>
 * <pre>{@code
 * Sentinel sentinel = new Sentinel("MySentinel", 5)
 *     .withSelectors(List.of(".popup", ".modal"))
 *     .withCapabilities(List.of("detection", "healing"))
 *     .onPreCheck((params, ctx) -> {
 *         if (!params.getBlocking().isEmpty()) {
 *             ctx.hijack("Clearing obstacles");
 *         } else {
 *             ctx.clear();
 *         }
 *     });
 * 
 * sentinel.start("ws://localhost:8080");
 * }</pre>
 */
@ClientEndpoint
public class Sentinel {
    
    private static final Logger log = LoggerFactory.getLogger(Sentinel.class);
    
    private final String name;
    private final int priority;
    private List<String> capabilities = List.of("detection");
    private List<String> selectors = List.of();
    private String authToken;
    
    private Duration heartbeatInterval = Duration.ofSeconds(2);
    private Duration reconnectDelay = Duration.ofSeconds(3);
    
    private BiConsumer<PreCheckParams, ResponseContext> onPreCheck;
    private Consumer<EntropyStreamParams> onEntropyStream;
    
    private Session session;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean connected = new AtomicBoolean(false);
    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> heartbeatTask;
    private String hubUrl;
    
    /**
     * Create a new Sentinel with the given name and priority.
     * 
     * @param name Unique identifier for this sentinel
     * @param priority Priority level (1-10, lower = higher priority)
     */
    public Sentinel(String name, int priority) {
        this.name = name;
        this.priority = priority;
    }
    
    /**
     * Set the CSS selectors this sentinel monitors.
     */
    public Sentinel withSelectors(List<String> selectors) {
        this.selectors = selectors;
        return this;
    }
    
    /**
     * Set the capabilities of this sentinel.
     */
    public Sentinel withCapabilities(List<String> capabilities) {
        this.capabilities = capabilities;
        return this;
    }
    
    /**
     * Set the authentication token.
     */
    public Sentinel withAuthToken(String token) {
        this.authToken = token;
        return this;
    }
    
    /**
     * Generate and set a JWT token from a shared secret.
     */
    public Sentinel withAuthSecret(String secret) {
        this.authToken = JwtHelper.generateToken(secret, name, 3600);
        return this;
    }
    
    /**
     * Set the heartbeat interval.
     */
    public Sentinel withHeartbeatInterval(Duration interval) {
        this.heartbeatInterval = interval;
        return this;
    }
    
    /**
     * Set the reconnect delay.
     */
    public Sentinel withReconnectDelay(Duration delay) {
        this.reconnectDelay = delay;
        return this;
    }
    
    /**
     * Set the pre-check handler.
     */
    public Sentinel onPreCheck(BiConsumer<PreCheckParams, ResponseContext> handler) {
        this.onPreCheck = handler;
        return this;
    }
    
    /**
     * Set the entropy stream handler.
     */
    public Sentinel onEntropyStream(Consumer<EntropyStreamParams> handler) {
        this.onEntropyStream = handler;
        return this;
    }
    
    /**
     * Start the sentinel and connect to the Hub.
     * This method blocks until stop() is called.
     */
    public void start(String hubUrl) throws Exception {
        this.hubUrl = hubUrl;
        this.running.set(true);
        this.scheduler = Executors.newScheduledThreadPool(2);
        
        log.info("[{}] Starting sentinel, connecting to {}", name, hubUrl);
        
        while (running.get()) {
            try {
                connect();
                
                // Wait for disconnection
                while (connected.get() && running.get()) {
                    Thread.sleep(100);
                }
                
            } catch (Exception e) {
                log.warn("[{}] Connection error: {}", name, e.getMessage());
            }
            
            if (running.get()) {
                log.info("[{}] Reconnecting in {}s...", name, reconnectDelay.toSeconds());
                Thread.sleep(reconnectDelay.toMillis());
            }
        }
        
        scheduler.shutdown();
        log.info("[{}] Sentinel stopped", name);
    }
    
    /**
     * Start the sentinel asynchronously.
     * 
     * @return CompletableFuture that completes when the sentinel stops
     */
    public CompletableFuture<Void> startAsync(String hubUrl) {
        return CompletableFuture.runAsync(() -> {
            try {
                start(hubUrl);
            } catch (Exception e) {
                throw new CompletionException(e);
            }
        });
    }
    
    /**
     * Stop the sentinel.
     */
    public void stop() {
        running.set(false);
        disconnect();
    }
    
    /**
     * Check if the sentinel is connected.
     */
    public boolean isConnected() {
        return connected.get();
    }
    
    private void connect() throws Exception {
        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        session = container.connectToServer(this, URI.create(hubUrl));
    }
    
    private void disconnect() {
        if (session != null && session.isOpen()) {
            try {
                session.close();
            } catch (IOException e) {
                log.debug("[{}] Error closing session: {}", name, e.getMessage());
            }
        }
        connected.set(false);
    }
    
    @OnOpen
    public void onOpen(Session session) {
        this.session = session;
        this.connected.set(true);
        log.info("[{}] Connected to Hub", name);
        
        // Send registration
        try {
            RegistrationParams params = new RegistrationParams();
            params.setLayer(name);
            params.setRole("sentinel");
            params.setPriority(priority);
            params.setCapabilities(capabilities);
            params.setSelectors(selectors);
            params.setVersion("1.0.0");
            params.setAuthToken(authToken);
            
            sendMessage("starlight.registration", params);
            log.info("[{}] Registered with Hub (priority={})", name, priority);
            
            // Start heartbeat
            if (heartbeatTask != null) heartbeatTask.cancel(false);
            heartbeatTask = scheduler.scheduleAtFixedRate(
                this::sendPulse,
                heartbeatInterval.toMillis(),
                heartbeatInterval.toMillis(),
                TimeUnit.MILLISECONDS
            );
            
        } catch (Exception e) {
            log.error("[{}] Registration failed: {}", name, e.getMessage());
            disconnect();
        }
    }
    
    @OnMessage
    public void onMessage(String text) {
        try {
            Message msg = Message.parse(text);
            handleMessage(msg);
        } catch (Exception e) {
            log.warn("[{}] Failed to parse message: {}", name, e.getMessage());
        }
    }
    
    @OnClose
    public void onClose(Session session, CloseReason reason) {
        connected.set(false);
        if (heartbeatTask != null) heartbeatTask.cancel(false);
        log.info("[{}] Disconnected: {}", name, reason.getReasonPhrase());
    }
    
    @OnError
    public void onError(Session session, Throwable error) {
        log.error("[{}] WebSocket error: {}", name, error.getMessage());
    }
    
    private void handleMessage(Message msg) {
        if (msg.getMethod() == null) {
            if (msg.getError() != null) {
                log.error("[{}] Hub request failed: {}", name, msg.getError().getMessage());
            }
            return;
        }

        switch (msg.getMethod()) {
            case "starlight.pre_check":
                if (onPreCheck != null) {
                    PreCheckParams params = msg.getParamsAs(PreCheckParams.class);
                    ResponseContext ctx = new ResponseContext(this, msg.getId());
                    onPreCheck.accept(params, ctx);
                } else {
                    sendClear(msg.getId());
                }
                break;
                
            case "starlight.entropy_stream":
                if (onEntropyStream != null) {
                    EntropyStreamParams params = msg.getParamsAs(EntropyStreamParams.class);
                    onEntropyStream.accept(params);
                }
                break;

            case "starlight.ping":
                try {
                    sendMessage("starlight.pong", java.util.Map.of(
                        "timestamp", System.currentTimeMillis()
                    ));
                } catch (Exception e) {
                    log.warn("[{}] Failed to send pong: {}", name, e.getMessage());
                }
                break;
                
            default:
                if (msg.getMethod() != null && !msg.getMethod().isEmpty()) {
                    log.debug("[{}] Unknown method: {}", name, msg.getMethod());
                }
        }
    }
    
    private void sendPulse() {
        try {
            sendMessage("starlight.pulse", java.util.Map.of("layer", name));
        } catch (Exception e) {
            log.warn("[{}] Heartbeat failed: {}", name, e.getMessage());
        }
    }
    
    void sendClear(String msgId) {
        try {
            sendResponse(msgId, "starlight.clear", null);
        } catch (Exception e) {
            log.error("[{}] Failed to send clear: {}", name, e.getMessage());
        }
    }
    
    void sendWait(String msgId, int retryAfterMs) {
        try {
            sendResponse(msgId, "starlight.wait", java.util.Map.of(
                "retryAfterMs", retryAfterMs,
                "severity", "soft"
            ));
        } catch (Exception e) {
            log.error("[{}] Failed to send wait: {}", name, e.getMessage());
        }
    }
    
    void sendHijack(String msgId, String reason) {
        try {
            sendResponse(msgId, "starlight.hijack", java.util.Map.of("reason", reason));
        } catch (Exception e) {
            log.error("[{}] Failed to send hijack: {}", name, e.getMessage());
        }
    }
    
    /**
     * Send a resume message after hijack.
     */
    public void sendResume(boolean reCheck) {
        try {
            sendMessage("starlight.resume", java.util.Map.of("re_check", reCheck));
        } catch (Exception e) {
            log.error("[{}] Failed to send resume: {}", name, e.getMessage());
        }
    }
    
    /**
     * Send an action during hijack.
     */
    public void sendAction(String cmd, String selector) {
        sendAction(cmd, selector, null);
    }
    
    /**
     * Send an action during hijack with text.
     */
    public void sendAction(String cmd, String selector, String text) {
        try {
            var params = new java.util.HashMap<String, Object>();
            params.put("cmd", cmd);
            params.put("selector", selector);
            if (text != null) params.put("text", text);
            sendMessage("starlight.action", params);
        } catch (Exception e) {
            log.error("[{}] Failed to send action: {}", name, e.getMessage());
        }
    }
    
    /**
     * Send a context update.
     */
    public void sendContextUpdate(java.util.Map<String, Object> context) {
        try {
            sendMessage("starlight.context_update", java.util.Map.of("context", context));
        } catch (Exception e) {
            log.error("[{}] Failed to send context update: {}", name, e.getMessage());
        }
    }
    
    private void sendMessage(String method, Object params) throws Exception {
        Message msg = new Message(method, params);
        sendRaw(msg.toJson());
    }
    
    private void sendResponse(String id, String method, Object params) throws Exception {
        Message msg = Message.withId(id, method, params);
        sendRaw(msg.toJson());
    }
    
    private synchronized void sendRaw(String json) throws IOException {
        if (session != null && session.isOpen()) {
            session.getBasicRemote().sendText(json);
        }
    }
    
    /**
     * Context for responding to pre-check requests.
     */
    public static class ResponseContext {
        private final Sentinel sentinel;
        private final String msgId;
        
        ResponseContext(Sentinel sentinel, String msgId) {
            this.sentinel = sentinel;
            this.msgId = msgId;
        }
        
        /**
         * Approve action execution.
         */
        public void clear() {
            sentinel.sendClear(msgId);
        }
        
        /**
         * Veto action, retry after delay.
         */
        public void wait(int retryAfterMs) {
            sentinel.sendWait(msgId, retryAfterMs);
        }
        
        /**
         * Request browser control.
         */
        public void hijack(String reason) {
            sentinel.sendHijack(msgId, reason);
        }
    }
}
