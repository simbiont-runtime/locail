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

// VueScanner extracts translatable strings from Vue3 files.
type VueScanner struct {
	*BaseScanner
}

// NewVueScanner creates a new Vue scanner.
func NewVueScanner() *VueScanner {
	s := &VueScanner{
		BaseScanner: NewBaseScanner(),
	}
	s.RegisterExtension(".vue")
	return s
}

// ScanProject implements Scanner interface.
func (s *VueScanner) ScanProject(ctx context.Context, projectPath string) (*ScanResult, error) {
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
func (s *VueScanner) ScanFile(ctx context.Context, filePath string) ([]ExtractedString, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	return s.ExtractStrings(string(content), filePath)
}

// ExtractStrings implements Scanner interface.
func (s *VueScanner) ExtractStrings(content, filePath string) ([]ExtractedString, error) {
	extracted := make([]ExtractedString, 0)
	lines := strings.Split(content, "\n")
	hash := computeHash(content)

	// Patterns for Vue3 string extraction
	patterns := []struct {
		name    string
		pattern *regexp.Regexp
		context string
	}{
		// {{ interpolation }}
		{"mustache", regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`), "mustache"},
		// :title="text" or :aria-label="text"
		{"binding", regexp.MustCompile(`(?i):([a-z-]+)="([^"]*)"`), "attribute"},
		// title="text"
		{"attribute", regexp.MustCompile(`([a-z-]+)="([^"]*)"`), "attribute"},
		// v-text="'literal'" or v-text="'text'"
		{"v-text", regexp.MustCompile(`v-text="[\'']([^\'"]+)[\'"]"`), "directive"},
		// v-html="'literal'"
		{"v-html", regexp.MustCompile(`v-html="[\'']([^\'"]+)[\'"]"`), "directive"},
		// :placeholder="'text'"
		{"placeholder", regexp.MustCompile(`:placeholder="[\'']([^\'"]+)[\'"]"`), "attribute"},
	}

	for i, line := range lines {
		lineNum := i + 1

		for _, p := range patterns {
			matches := p.pattern.FindAllStringSubmatchIndex(line, -1)
			for _, match := range matches {
				if len(match) >= 4 {
					// Extract the captured group
					start := match[2]
					end := match[3]
					text := line[start:end]
					text = strings.TrimSpace(text)

					// Skip empty or very short strings
					if len(text) < 2 {
						continue
					}

					// Skip variable/interpolation patterns like {{ variable }}
					if p.context == "mustache" && isVariablePattern(text) {
						continue
					}

					// Determine context
					context := determineVueContext(line, text)

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

// isVariablePattern checks if text is a variable reference (not translatable).
func isVariablePattern(text string) bool {
	text = strings.TrimSpace(text)
	// Single word, no spaces - likely a variable
	if strings.Contains(text, ".") || strings.Contains(text, "(") || strings.Contains(text, "[") {
		return true
	}
	// Check if it's a simple identifier
	if matched, _ := regexp.MatchString(`^[a-zA-Z_][a-zA-Z0-9_]*$`, text); matched {
		return true
	}
	return false
}

// determineVueContext determines the UI context for a string.
func determineVueContext(line, text string) string {
	lineLower := strings.ToLower(line)

	// Common UI attribute contexts
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
		{`<p>`, "paragraph"},
		{`error`, "error-message"},
		{`success`, "success-message"},
		{`warning`, "warning-message"},
	}

	for _, c := range contexts {
		if strings.Contains(lineLower, c.pattern) {
			return c.context
		}
	}

	return "text"
}

// readFileContent reads file content.
func readFileContent(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(content), nil
}
