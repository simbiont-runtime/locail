package scanner

import (
	"context"
	"time"
)

// ExtractedString represents a string extracted from source code for translation.
type ExtractedString struct {
	ID        int64      `json:"id,omitempty"`
	FilePath  string     `json:"file_path"`
	Line      int        `json:"line"`
	Column    int        `json:"column"`
	Key       string     `json:"key"`       // Unique key: filePath:line:column or generated hash
	Text      string     `json:"text"`      // The extracted text
	Context   string     `json:"context"`   // Parent context (element name, attribute, etc.)
	Language  string     `json:"language"`  // Source language (e.g., "en")
	Status    string     `json:"status"`    // "new", "translated", "skipped", "ignored"
	Hash      string     `json:"hash"`      // Content hash for change detection
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// ScanConfig holds configuration for the scanner.
type ScanConfig struct {
	ProjectPath    string   `json:"project_path"`
	SourceLanguage string   `json:"source_language"`
	Extensions     []string `json:"extensions"`     // File extensions to scan
	IgnorePatterns []string `json:"ignore_patterns"`  // Glob patterns to ignore
	ExtractUIOnly  bool     `json:"extract_ui_only"`  // Extract only UI strings (not comments, etc.)
	AutoTranslate  bool     `json:"auto_translate"`   // Auto-translate new strings
}

// ScanResult contains the results of a scan operation.
type ScanResult struct {
	TotalFiles    int               `json:"total_files"`
	ScannedFiles  int               `json:"scanned_files"`
	ExtractedStrings []ExtractedString `json:"extracted_strings"`
	Errors        []ScanError       `json:"errors,omitempty"`
	Duration      time.Duration     `json:"duration"`
}

// ScanError represents an error during scanning.
type ScanError struct {
	FilePath string `json:"file_path"`
	Message  string `json:"message"`
}

// Scanner defines the interface for scanning source code.
type Scanner interface {
	// ScanFile scans a single file and returns extracted strings.
	ScanFile(ctx context.Context, filePath string) ([]ExtractedString, error)
	
	// ScanProject scans an entire project and returns all extracted strings.
	ScanProject(ctx context.Context, projectPath string) (*ScanResult, error)
	
	// ExtractStrings extracts translatable strings from source code content.
	ExtractStrings(content, filePath string) ([]ExtractedString, error)
	
	// IsSupported checks if the file extension is supported.
	IsSupported(filePath string) bool
	
	// GetSupportedExtensions returns list of supported file extensions.
	GetSupportedExtensions() []string
}

// Watcher defines the interface for watching file changes.
type Watcher interface {
	// Watch starts watching the project directory for changes.
	Watch(ctx context.Context, projectPath string) error
	
	// Stop stops the watcher.
	Stop() error
	
	// OnChange registers a callback for file changes.
	OnChange(callback func(filePath string, op ChangeOp))
}

// ChangeOp represents the type of file change.
type ChangeOp string

const (
	ChangeOpCreate ChangeOp = "create"
	ChangeOpModify ChangeOp = "modify"
	ChangeOpDelete ChangeOp = "delete"
)

// LanguageDetector detects the language of a file based on extension.
type LanguageDetector interface {
	Detect(filePath string) string
	IsMarkupLanguage(language string) bool
}