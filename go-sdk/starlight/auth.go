package starlight

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// JWTClaims represents the payload of a Starlight JWT token.
type JWTClaims struct {
	IssuedAt   int64  `json:"iat"`
	Expiration int64  `json:"exp"`
	Subject    string `json:"sub"`
}

// GenerateToken creates a JWT token for authentication.
func GenerateToken(secret, subject string, expirySeconds int64) (string, error) {
	if secret == "" {
		return "", fmt.Errorf("secret cannot be empty")
	}

	now := time.Now().Unix()
	claims := JWTClaims{
		IssuedAt:   now,
		Expiration: now + expirySeconds,
		Subject:    subject,
	}

	// Header
	header := map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	}
	headerJSON, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)

	// Payload
	payloadJSON, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)

	// Signature
	message := headerB64 + "." + payloadB64
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(message))
	signature := base64.RawURLEncoding.EncodeToString(h.Sum(nil))

	return message + "." + signature, nil
}

// ValidateToken verifies a JWT token and returns the claims.
func ValidateToken(token, secret string) (*JWTClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("failed to decode header: %w", err)
	}

	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, fmt.Errorf("failed to parse header: %w", err)
	}
	if header.Algorithm != "HS256" || header.Type != "JWT" {
		return nil, fmt.Errorf("unsupported token header")
	}

	// Verify signature
	message := parts[0] + "." + parts[1]
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(message))
	expectedSig := base64.RawURLEncoding.EncodeToString(h.Sum(nil))

	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, fmt.Errorf("invalid signature")
	}

	// Decode payload
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("failed to decode payload: %w", err)
	}

	var claims JWTClaims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil, fmt.Errorf("failed to parse claims: %w", err)
	}

	// Check expiration
	if time.Now().Unix() > claims.Expiration {
		return nil, fmt.Errorf("token expired")
	}

	return &claims, nil
}

// WithAuth sets the authentication token on the sentinel.
// If secret is provided, generates a new token. Otherwise, uses the provided token directly.
func (s *Sentinel) WithAuth(tokenOrSecret string, isSecret bool) *Sentinel {
	if isSecret {
		token, err := GenerateToken(tokenOrSecret, s.Name, 3600)
		if err != nil {
			s.Logger.Printf("[%s] Failed to generate token: %v", s.Name, err)
			return s
		}
		s.AuthToken = token
	} else {
		s.AuthToken = tokenOrSecret
	}
	return s
}
