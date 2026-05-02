package scanner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ReactScanner extracts translatable strings from React/JSX files.
type ReactScanner struct {
	*BaseScanner
}

// NewReactScanner creates a new React scanner.
func NewReactScanner() *ReactScanner {
	s := &ReactScanner{
		BaseScanner: NewBaseScanner(),
	}
	s.RegisterExtension(".jsx")
	s.RegisterExtension(".tsx")
	s.RegisterExtension(".js")
	s.RegisterExtension(".ts")
	return s
}

// ScanProject implements Scanner interface.
func (s *ReactScanner) ScanProject(ctx context.Context, projectPath string) (*ScanResult, error) {
	start := time.Now()
	result := &ScanResult{
		ExtractedStrings: make([]ExtractedString, 0),
		Errors:           make([]ScanError, 0),
	}

	err := filepath.Walk(projectPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			result.Errors = append(result.Errors, ScanError{FilePath: path, Message: err.Error()})
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
func (s *ReactScanner) ScanFile(ctx context.Context, filePath string) ([]ExtractedString, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	return s.ExtractStrings(string(content), filePath)
}

// ExtractStrings implements Scanner interface.
func (s *ReactScanner) ExtractStrings(content, filePath string) ([]ExtractedString, error) {
	extracted := make([]ExtractedString, 0)
	lines := strings.Split(content, "\n")
	hash := computeHash(content)

	// Patterns for React/JSX string extraction
	patterns := []struct {
		name    string
		pattern *regexp.Regexp
		context string
	}{
		// {"string"} - JSX text content
		{"jsx-text", regexp.MustCompile(`>["']([^"']+)["']<`), "text"},
		// title={"string"}
		{"jsx-attr", regexp.MustCompile(`([a-z-]+)=\{\s*["']([^"']+)["']\s*\}`), "attribute"},
		// title="string"
		{"attr", regexp.MustCompile(`([a-z-]+)="([^"]*)"`), "attribute"},
		// aria-label="string"
		{"aria", regexp.MustCompile(`aria-[a-z-]="([^"]*)"`), "accessibility"},
	}

	for i, line := range lines {
		lineNum := i + 1

		for _, p := range patterns {
			matches := p.pattern.FindAllStringSubmatchIndex(line, -1)
			for _, match := range matches {
				if len(match) >= 4 {
					start := match[2]
					end := match[3]
					text := line[start:end]
					text = strings.TrimSpace(text)

					if len(text) < 2 {
						continue
					}

					context := determineReactContext(line, text)

					extracted = append(extracted, ExtractedString{
						FilePath:  filePath,
						Line:      lineNum,
						Column:    start + 1,
						Key:       fmt.Sprintf("%s:%d:%d", filePath, lineNum, start+1),
						Text:      text,
						Context:   context,
						Language:  "en",
						Status:    "new",
						Hash:      hash,
						CreatedAt: time.Now(),
						UpdatedAt: time.Now(),
					})
				}
			}
		}
	}

	return extracted, nil
}

// determineReactContext determines the UI context for a string.
func determineReactContext(line, text string) string {
	lineLower := strings.ToLower(line)

	contexts := []struct {
		pattern string
		context string
	}{
		{`aria-`, "accessibility"},
		{`title=`, "tooltip"},
		{`placeholder=`, "placeholder"},
		{`label=`, "label"},
		{`alt=`, "image-alt"},
		{`button`, "button"},
		{`<h1`, "heading"},
		{`<h2`, "heading"},
		{`<h3`, "heading"},
		{`error`, "error-message"},
	}

	for _, c := range contexts {
		if strings.Contains(lineLower, c.pattern) {
			return c.context
		}
	}

	return "text"
}
