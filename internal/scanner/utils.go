package scanner

import (
	"crypto/sha256"
	"encoding/hex"
)

// computeHash computes SHA256 hash of content and returns first 16 characters.
func computeHash(content string) string {
	h := sha256.New()
	h.Write([]byte(content))
	return hex.EncodeToString(h.Sum(nil))[:16]
}