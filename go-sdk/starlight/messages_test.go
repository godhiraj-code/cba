package starlight

import (
	"encoding/json"
	"testing"
)

func TestRegistrationUsesCanonicalFields(t *testing.T) {
	params := RegistrationParams{
		Layer:     "GoSentinel",
		Role:      "sentinel",
		Priority:  5,
		Version:   "1.0.0",
		AuthToken: "token",
	}

	data, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}

	if decoded["role"] != "sentinel" || decoded["version"] != "1.0.0" {
		t.Fatalf("missing canonical registration fields: %s", data)
	}
	if decoded["authToken"] != "token" {
		t.Fatalf("auth token must use camelCase: %s", data)
	}
}

func TestPreCheckResponsePreservesRequestID(t *testing.T) {
	message, err := NewResponse("precheck-123", "starlight.clear", map[string]float64{
		"confidence": 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if message.ID != "precheck-123" {
		t.Fatalf("expected correlated id, got %q", message.ID)
	}
}
