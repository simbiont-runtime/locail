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

// MarkdownScanner extracts translatable strings from Markdown and MDX files.
type MarkdownScanner struct {
	*BaseScanner
}

// NewMarkdownScanner creates a new Markdown/MDX scanner.
func NewMarkdownScanner() *MarkdownScanner {
	s := &MarkdownScanner{
		BaseScanner: NewBaseScanner(),
	}
	s.RegisterExtension(".md")
	s.RegisterExtension(".mdx")
	return s
}

// ScanProject implements Scanner interface.
func (s *MarkdownScanner) ScanProject(ctx context.Context, projectPath string) (*ScanResult, error) {
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
func (s *MarkdownScanner) ScanFile(ctx context.Context, filePath string) ([]ExtractedString, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	return s.ExtractStrings(string(content), filePath)
}

// ExtractStrings implements Scanner interface.
func (s *MarkdownScanner) ExtractStrings(content, filePath string) ([]ExtractedString, error) {
	extracted := make([]ExtractedString, 0)
	lines := strings.Split(content, "\n")
	hash := computeHash(content)

	// Patterns for Markdown/MDX string extraction
	patterns := []struct {
		name    string
		pattern *regexp.Regexp
		context string
	}{
		// Headings: # Heading Text
		{"heading", regexp.MustCompile(`^(#{1,6})\s+(.+)$`), "heading"},
		// Image alt: ![alt text](image.png)
		{"image-alt", regexp.MustCompile(`!\[([^\]]*)\](?:\\(.+\\)|\\[(.+)\\])`), "image-alt"},
		// Link text: [link text](url)
		{"link-text", regexp.MustCompile(`\[([^\]]+)\](?:\\s*\()|\\s*\[)`), "link"},
		// Bold: **text** or __text__
		{"bold", regexp.MustCompile(`\*\*([^*]+)\*\*|__([^_]+)__`), "emphasis"},
		// Italic: *text* or _text_
		{"italic", regexp.MustCompile(`\*([^*]+)\*|_([^_]+)_`), "emphasis"},
		// Code: `code` (inline)
		{"inline-code", regexp.MustCompile("`([^`]+)`"), "code"},
		// MDX components: <Component>text</Component> or <Component text="value" />
		{"mdx-attr", regexp.MustCompile(`:([a-z-]+)="([^"]*)"`), "attribute"},
	}

	inCodeBlock := false
	inFrontmatter := false

	for i, line := range lines {
		lineNum := i + 1

		// Track code blocks
		if strings.HasPrefix(line, "```") {
			inCodeBlock = !inCodeBlock
			continue
		}

		// Skip code blocks
		if inCodeBlock {
			continue
		}

		// Track frontmatter (YAML between ---)
		if strings.HasPrefix(line, "---") {
			inFrontmatter = !inFrontmatter
			continue
		}

		// Skip frontmatter
		if inFrontmatter {
			continue
		}

		for _, p := range patterns {
			matches := p.pattern.FindAllStringSubmatchIndex(line, -1)
			for _, match := range matches {
				if len(match) >= 4 {
					start := match[2]
					end := match[3]
					text := line[start:end]
					text = strings.TrimSpace(text)

					// Skip empty or very short strings
					if len(text) < 2 {
						continue
					}

					// Skip code content
					if p.name == "inline-code" {
						continue
					}

					context := p.context

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