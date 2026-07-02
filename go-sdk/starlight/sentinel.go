package starlight

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Sentinel represents a Starlight Protocol sentinel agent.
type Sentinel struct {
	// Name is the unique identifier for this sentinel.
	Name string

	// Priority determines the order of response processing (1-10, lower = higher priority).
	Priority int

	// Capabilities lists what this sentinel can do (e.g., "detection", "healing", "vision").
	Capabilities []string

	// Selectors are CSS selectors this sentinel monitors for blocking elements.
	Selectors []string

	// AuthToken is the JWT token for authentication (optional if Hub doesn't require auth).
	AuthToken string

	// OnPreCheck is called when the Hub sends a pre-check request.
	// Return Clear(), Wait(ms), or Hijack(reason) response.
	OnPreCheck func(params PreCheckParams, msgID string) error

	// OnEntropyStream is called when the Hub broadcasts entropy data.
	OnEntropyStream func(params EntropyStreamParams)

	// Logger for sentinel operations. Defaults to standard log.
	Logger *log.Logger

	// HeartbeatInterval is the time between pulse messages. Default: 2 seconds.
	HeartbeatInterval time.Duration

	// ReconnectDelay is the time to wait before reconnecting. Default: 3 seconds.
	ReconnectDelay time.Duration

	// conn is the WebSocket connection to the Hub.
	conn *websocket.Conn

	// mu protects concurrent access to the connection.
	mu sync.Mutex

	// done signals shutdown.
	done chan struct{}

	stopOnce sync.Once

	// isConnected tracks connection state.
	isConnected bool
}

// NewSentinel creates a new Sentinel with the given name and priority.
func NewSentinel(name string, priority int) *Sentinel {
	return &Sentinel{
		Name:              name,
		Priority:          priority,
		Capabilities:      []string{"detection"},
		Selectors:         []string{},
		HeartbeatInterval: 2 * time.Second,
		ReconnectDelay:    3 * time.Second,
		Logger:            log.Default(),
		done:              make(chan struct{}),
	}
}

// Start connects to the Hub and begins the sentinel lifecycle.
// This method blocks until the context is cancelled or an unrecoverable error occurs.
func (s *Sentinel) Start(ctx context.Context, hubURL string) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.done:
			return nil
		default:
		}

		if err := s.connect(ctx, hubURL); err != nil {
			s.Logger.Printf("[%s] Connection failed: %v, retrying in %v", s.Name, err, s.ReconnectDelay)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-s.done:
				return nil
			case <-time.After(s.ReconnectDelay):
				continue
			}
		}

		// Run message loop
		if err := s.messageLoop(ctx); err != nil {
			s.Logger.Printf("[%s] Message loop error: %v", s.Name, err)
		}

		s.disconnect()

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.done:
			return nil
		case <-time.After(s.ReconnectDelay):
			s.Logger.Printf("[%s] Reconnecting...", s.Name)
		}
	}
}

// Stop gracefully shuts down the sentinel.
func (s *Sentinel) Stop() {
	s.stopOnce.Do(func() { close(s.done) })
	s.disconnect()
}

// connect establishes WebSocket connection and registers with Hub.
func (s *Sentinel) connect(ctx context.Context, hubURL string) error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, hubURL, nil)
	if err != nil {
		return fmt.Errorf("dial failed: %w", err)
	}

	s.mu.Lock()
	s.conn = conn
	s.isConnected = true
	s.mu.Unlock()

	// Send registration
	regParams := RegistrationParams{
		Layer:        s.Name,
		Role:         "sentinel",
		Priority:     s.Priority,
		Capabilities: s.Capabilities,
		Selectors:    s.Selectors,
		Version:      "1.0.0",
		AuthToken:    s.AuthToken,
	}

	if err := s.sendMessage("starlight.registration", regParams); err != nil {
		s.disconnect()
		return fmt.Errorf("registration failed: %w", err)
	}

	s.Logger.Printf("[%s] Connected and registered with Hub (priority=%d)", s.Name, s.Priority)
	return nil
}

// disconnect closes the WebSocket connection.
func (s *Sentinel) disconnect() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.conn != nil {
		s.conn.Close()
		s.conn = nil
		s.isConnected = false
	}
}

// messageLoop handles incoming messages and sends heartbeats.
func (s *Sentinel) messageLoop(ctx context.Context) error {
	// Start heartbeat goroutine
	heartbeatDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(s.HeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := s.sendPulse(); err != nil {
					s.Logger.Printf("[%s] Heartbeat failed: %v", s.Name, err)
					return
				}
			case <-heartbeatDone:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
	defer close(heartbeatDone)

	// Message read loop
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.done:
			return nil
		default:
		}

		s.mu.Lock()
		conn := s.conn
		s.mu.Unlock()

		if conn == nil {
			return fmt.Errorf("connection lost")
		}

		// Set read deadline for responsiveness
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))

		_, data, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read error: %w", err)
		}

		msg, err := ParseMessage(data)
		if err != nil {
			s.Logger.Printf("[%s] Failed to parse message: %v", s.Name, err)
			continue
		}

		s.handleMessage(msg)
	}
}

// handleMessage routes incoming messages to appropriate handlers.
func (s *Sentinel) handleMessage(msg *Message) {
	switch msg.Method {
	case "starlight.pre_check":
		if s.OnPreCheck != nil {
			var params PreCheckParams
			if err := msg.ParseParams(&params); err != nil {
				s.Logger.Printf("[%s] Failed to parse pre_check params: %v", s.Name, err)
				s.SendClear(msg.ID)
				return
			}
			if err := s.OnPreCheck(params, msg.ID); err != nil {
				s.Logger.Printf("[%s] OnPreCheck error: %v", s.Name, err)
			}
		} else {
			// Default: clear if no handler
			s.SendClear(msg.ID)
		}

	case "starlight.entropy_stream":
		if s.OnEntropyStream != nil {
			var params EntropyStreamParams
			if err := msg.ParseParams(&params); err != nil {
				s.Logger.Printf("[%s] Failed to parse entropy params: %v", s.Name, err)
				return
			}
			s.OnEntropyStream(params)
		}

	case "starlight.ping":
		if err := s.sendMessage("starlight.pong", map[string]any{
			"timestamp": time.Now().UnixMilli(),
		}); err != nil {
			s.Logger.Printf("[%s] Failed to send pong: %v", s.Name, err)
		}

	default:
		// Log unknown methods for debugging
		if msg.Method != "" {
			s.Logger.Printf("[%s] Received unknown method: %s", s.Name, msg.Method)
		}
	}
}

// SendClear sends a clear response to approve action execution.
func (s *Sentinel) SendClear(msgID string) error {
	return s.sendResponse(msgID, "starlight.clear", nil)
}

// SendWait sends a wait response to veto action execution.
func (s *Sentinel) SendWait(msgID string, retryAfterMs int) error {
	return s.sendResponse(msgID, "starlight.wait", WaitParams{
		RetryAfterMs: retryAfterMs,
		Severity:     "soft",
	})
}

// SendHijack requests exclusive browser control.
func (s *Sentinel) SendHijack(msgID string, reason string) error {
	return s.sendResponse(msgID, "starlight.hijack", HijackParams{Reason: reason})
}

// SendResume releases browser control after hijack.
func (s *Sentinel) SendResume(reCheck bool) error {
	return s.sendMessage("starlight.resume", ResumeParams{ReCheck: reCheck})
}

// SendAction requests the Hub to perform a browser action during hijack.
func (s *Sentinel) SendAction(cmd, selector, text string) error {
	return s.sendMessage("starlight.action", ActionParams{
		Cmd:      cmd,
		Selector: selector,
		Text:     text,
	})
}

// SendContextUpdate injects data into sovereign state.
func (s *Sentinel) SendContextUpdate(ctx map[string]any) error {
	return s.sendMessage("starlight.context_update", ContextUpdateParams{Context: ctx})
}

// sendPulse sends a heartbeat message.
func (s *Sentinel) sendPulse() error {
	return s.sendMessage("starlight.pulse", map[string]string{"layer": s.Name})
}

// sendMessage sends a JSON-RPC message to the Hub.
func (s *Sentinel) sendMessage(method string, params any) error {
	msg, err := NewMessage(method, params)
	if err != nil {
		return err
	}
	return s.writeMessage(msg)
}

// sendResponse sends a JSON-RPC response with the given ID.
func (s *Sentinel) sendResponse(id, method string, params any) error {
	msg, err := NewResponse(id, method, params)
	if err != nil {
		return err
	}
	return s.writeMessage(msg)
}

// writeMessage sends a message over the WebSocket connection.
func (s *Sentinel) writeMessage(msg *Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.conn == nil {
		return fmt.Errorf("not connected")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	return s.conn.WriteMessage(websocket.TextMessage, data)
}

// IsConnected returns whether the sentinel is currently connected to the Hub.
func (s *Sentinel) IsConnected() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isConnected
}
