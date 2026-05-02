package scanner

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// BaseScanner provides common functionality for language-specific scanners.
type BaseScanner struct {
	extensions    map[string]bool
	languageRules map[string]Scanner
	mu            sync.RWMutex
}

// NewBaseScanner creates a new base scanner.
func NewBaseScanner() *BaseScanner {
	return &BaseScanner{
		extensions:    make(map[string]bool),
		languageRules: make(map[string]Scanner),
	}
}

// RegisterExtension registers a file extension for a language.
func (s *BaseScanner) RegisterExtension(ext string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.extensions[strings.ToLower(ext)] = true
}

// RegisterLanguageScanner registers a language-specific scanner.
func (s *BaseScanner) RegisterLanguageScanner(language string, scanner Scanner) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.languageRules[strings.ToLower(language)] = scanner
}

// IsSupported checks if the file extension is supported.
func (s *BaseScanner) IsSupported(filePath string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ext := strings.ToLower(filepath.Ext(filePath))
	return s.extensions[ext]
}

// GetSupportedExtensions returns list of supported file extensions.
func (s *BaseScanner) GetSupportedExtensions() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	extensions := make([]string, 0, len(s.extensions))
	for ext := range s.extensions {
		extensions = append(extensions, ext)
	}
	return extensions
}

// GetLanguageScanner returns the scanner for a specific language.
func (s *BaseScanner) GetLanguageScanner(language string) Scanner {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.languageRules[strings.ToLower(language)]
}

// SimpleScanner is a basic implementation that uses regex patterns.
type SimpleScanner struct {
	BaseScanner
	patterns []Pattern
}

// Pattern defines a pattern for extracting strings.
type Pattern struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Priority: higher = more important
	Priority int `json:"priority"`
}

// NewSimpleScanner creates a new simple scanner.
func NewSimpleScanner() *SimpleScanner {
	return &SimpleScanner{
		BaseScanner: *NewBaseScanner(),
		patterns:    make([]Pattern, 0),
	}
}

// ScanProject implements Scanner interface.
func (s *SimpleScanner) ScanProject(ctx context.Context, projectPath string) (*ScanResult, error) {
	start := time.Now()
	result := &ScanResult{
		ExtractedStrings: make([]ExtractedString, 0),
		Errors:           make([]ScanError, 0),
	}

	// Walk the project directory
	err := filepath.Walk(projectPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			result.Errors = append(result.Errors, ScanError{FilePath: path, Message: err.Error()})
			return nil
		}

		// Skip directories
		if info.IsDir() {
			// Skip hidden and ignored directories
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") || base == "node_modules" || base == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}

		result.TotalFiles++

		if !s.IsSupported(path) {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		extracted, err := s.ScanFile(ctx, path)
		if err != nil {
			result.Errors = append(result.Errors, ScanError{FilePath: path, Message: err.Error()})
			return nil
		}

		result.ScannedFiles++
		result.ExtractedStrings = append(result.ExtractedStrings, extracted...)
		return nil
	})

	if err != nil {
		return nil, err
	}

	result.Duration = time.Since(start)
	return result, nil
}

// ScanFile implements Scanner interface.
func (s *SimpleScanner) ScanFile(ctx context.Context, filePath string) ([]ExtractedString, error) {
	// This is a stub - language-specific scanners will override
	return nil, nil
}

// ExtractStrings implements Scanner interface.
func (s *SimpleScanner) ExtractStrings(content, filePath string) ([]ExtractedString, error) {
	// This is a stub - language-specific scanners will override
	return nil, nil
}

// DefaultIgnorePatterns returns default patterns to ignore.
func DefaultIgnorePatterns() []string {
	return []string{
		"node_modules",
		"vendor",
		".git",
		"dist",
		"build",
		".next",
		".nuxt",
		"coverage",
		"*.min.js",
		"*.min.css",
	}
}
