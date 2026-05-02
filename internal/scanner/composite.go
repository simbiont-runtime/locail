package scanner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// CompositeScanner combines multiple language scanners.
type CompositeScanner struct {
	*BaseScanner
	scanners []Scanner
}

// NewCompositeScanner creates a new composite scanner with all language scanners.
func NewCompositeScanner() *CompositeScanner {
	cs := &CompositeScanner{
		BaseScanner: NewBaseScanner(),
		scanners:    make([]Scanner, 0),
	}

	// Register all language scanners
	cs.scanners = append(cs.scanners,
		NewVueScanner(),
		NewSvelteScanner(),
		NewReactScanner(),
		NewMarkdownScanner(),
	)

	return cs
}

// RegisterScanners allows additional scanners to be registered.
func (cs *CompositeScanner) RegisterScanners(scanners ...Scanner) {
	cs.scanners = append(cs.scanners, scanners...)
}

// ScanProject implements Scanner interface.
func (cs *CompositeScanner) ScanProject(ctx context.Context, projectPath string) (*ScanResult, error) {
	start := time.Now()
	result := &ScanResult{
		ExtractedStrings: make([]ExtractedString, 0),
		Errors:           make([]ScanError, 0),
	}

	err := filepath.Walk(projectPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			result.Errors = append(result.Errors, ScanError{
				FilePath: path,
				Message:  err.Error(),
			})
			return nil
		}

		if info.IsDir() {
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") || base == "node_modules" || base == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}

		result.TotalFiles++

		if !cs.IsSupported(path) {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		strings, err := cs.ScanFile(ctx, path)
		if err != nil {
			result.Errors = append(result.Errors, ScanError{
				FilePath: path,
				Message:  err.Error(),
			})
			return nil
		}

		result.ScannedFiles++
		result.ExtractedStrings = append(result.ExtractedStrings, strings...)
		return nil
	})

	if err != nil {
		return nil, err
	}

	result.Duration = time.Since(start)
	return result, nil
}

// ScanFile implements Scanner interface.
func (cs *CompositeScanner) ScanFile(ctx context.Context, filePath string) ([]ExtractedString, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	return cs.ExtractStrings(string(content), filePath)
}

// ExtractStrings implements Scanner interface.
func (cs *CompositeScanner) ExtractStrings(content, filePath string) ([]ExtractedString, error) {
	for _, s := range cs.scanners {
		if s.IsSupported(filePath) {
			return s.ExtractStrings(content, filePath)
		}
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	return nil, fmt.Errorf("no scanner for extension %s", ext)
}

// GetSupportedExtensions implements Scanner interface.
func (cs *CompositeScanner) GetSupportedExtensions() []string {
	extensions := make(map[string]bool)
	for _, s := range cs.scanners {
		for _, ext := range s.GetSupportedExtensions() {
			extensions[ext] = true
		}
	}

	result := make([]string, 0, len(extensions))
	for ext := range extensions {
		result = append(result, ext)
	}
	return result
}
