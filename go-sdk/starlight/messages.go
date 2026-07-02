package starlight

import (
	"encoding/json"
	"fmt"
	"time"
)

// Message represents a JSON-RPC 2.0 message used in the Starlight Protocol.
type Message struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      string          `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError represents a JSON-RPC 2.0 error.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// RegistrationParams contains parameters for sentinel registration.
type RegistrationParams struct {
	Layer        string   `json:"layer"`
	Role         string   `json:"role"`
	Priority     int      `json:"priority"`
	Capabilities []string `json:"capabilities,omitempty"`
	Selectors    []string `json:"selectors,omitempty"`
	Version      string   `json:"version"`
	AuthToken    string   `json:"authToken,omitempty"`
}

// PreCheckParams contains parameters sent by Hub during pre-check.
type PreCheckParams struct {
	Command    CommandInfo      `json:"command"`
	Blocking   []BlockingElement `json:"blocking,omitempty"`
	Screenshot string           `json:"screenshot,omitempty"`
	URL        string           `json:"url,omitempty"`
}

// CommandInfo describes the pending command.
type CommandInfo struct {
	Cmd           string `json:"cmd,omitempty"`
	Goal          string `json:"goal,omitempty"`
	Selector      string `json:"selector,omitempty"`
	Value         string `json:"value,omitempty"`
	StabilityHint int    `json:"stabilityHint,omitempty"`
}

// BlockingElement describes an element that might block execution.
type BlockingElement struct {
	Selector string `json:"selector"`
	Tag      string `json:"tag,omitempty"`
	Classes  string `json:"classes,omitempty"`
	Text     string `json:"text,omitempty"`
}

// EntropyStreamParams contains entropy data from the Hub.
type EntropyStreamParams struct {
	Entropy        bool `json:"entropy"`
	MutationCount  int  `json:"mutationCount,omitempty"`
	NetworkPending int  `json:"networkPending,omitempty"`
}

// ActionParams contains parameters for sentinel actions during hijack.
type ActionParams struct {
	Cmd      string `json:"cmd"`
	Selector string `json:"selector,omitempty"`
	Text     string `json:"text,omitempty"`
	Value    string `json:"value,omitempty"`
	Key      string `json:"key,omitempty"`
	Files    any    `json:"files,omitempty"`
}

// ContextUpdateParams contains sovereign context data.
type ContextUpdateParams struct {
	Context map[string]any `json:"context"`
}

// WaitParams contains parameters for the wait response.
type WaitParams struct {
	RetryAfterMs int `json:"retryAfterMs,omitempty"`
	Severity     string `json:"severity,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

// HijackParams contains parameters for hijack requests.
type HijackParams struct {
	Reason string `json:"reason"`
}

// ResumeParams contains parameters for resume after hijack.
type ResumeParams struct {
	ReCheck bool `json:"re_check"`
}

// NewMessage creates a new JSON-RPC 2.0 message.
func NewMessage(method string, params any) (*Message, error) {
	var rawParams json.RawMessage
	if params != nil {
		data, err := json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal params: %w", err)
		}
		rawParams = data
	}

	return &Message{
		JSONRPC: "2.0",
		Method:  method,
		Params:  rawParams,
		ID:      fmt.Sprintf("%d", time.Now().UnixNano()),
	}, nil
}

// NewResponse creates a response message with the same ID.
func NewResponse(id string, method string, params any) (*Message, error) {
	msg, err := NewMessage(method, params)
	if err != nil {
		return nil, err
	}
	msg.ID = id
	return msg, nil
}

// ParseParams unmarshals the params into the provided struct.
func (m *Message) ParseParams(v any) error {
	if m.Params == nil {
		return nil
	}
	return json.Unmarshal(m.Params, v)
}

// Marshal serializes the message to JSON bytes.
func (m *Message) Marshal() ([]byte, error) {
	return json.Marshal(m)
}

// ParseMessage deserializes JSON bytes into a Message.
func ParseMessage(data []byte) (*Message, error) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("failed to parse message: %w", err)
	}
	return &msg, nil
}
