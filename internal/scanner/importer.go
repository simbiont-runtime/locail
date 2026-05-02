package scanner

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
)

// TranslationImporter handles importing translated strings back into source files.
type TranslationImporter struct{}

// NewTranslationImporter creates a new translation importer.
func NewTranslationImporter() *TranslationImporter {
	return &TranslationImporter{}
}

// ImportResult represents the result of an import operation.
type ImportResult struct {
	FilesProcessed int
	StringsUpdated int
	Errors         []string
}

// ImportToParaglideJSON imports translations to a paraglide JSON file.
func (ti *TranslationImporter) ImportToParaglideJSON(ctx context.Context, projectPath, locale, outputPath string, translations map[string]string) error {
	// Create .locallocales directory structure
	locailDir := filepath.Join(projectPath, ".locallocales")
	if err := os.MkdirAll(locailDir, 0755); err != nil {
		return err
	}

	// Prepare output path
	if outputPath == "" {
		outputPath = filepath.Join(locailDir, locale+".json")
	}

	// Read existing translations if file exists
	existing := make(map[string]string)
	if data, err := os.ReadFile(outputPath); err == nil {
		_ = json.Unmarshal(data, &existing)
	}

	// Merge translations
	for k, v := range translations {
		existing[k] = v
	}

	// Write JSON file
	data, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(outputPath, data, 0644)
}

// ImportToSourceFiles imports translations back into source files.
// This is the "translation without translation" feature - it writes the translations
// to a separate JSON file that can be used by the application.
func (ti *TranslationImporter) ImportToSourceFiles(ctx context.Context, projectPath, targetLang string, strings []ExtractedString) (*ImportResult, error) {
	result := &ImportResult{
		FilesProcessed: 0,
		StringsUpdated: 0,
		Errors:         make([]string, 0),
	}

	// Create .locallocales directory
	locailDir := filepath.Join(projectPath, ".locallocales")
	if err := os.MkdirAll(locailDir, 0755); err != nil {
		return result, err
	}

	// Create translation file for the target language
	transFile := filepath.Join(locailDir, targetLang+".json")

	// Build translations map
	transMap := make(map[string]string)
	for _, s := range strings {
		if s.Status == "translated" {
			transMap[s.Key] = s.Text
			result.StringsUpdated++
		}
	}

	// Write translations file
	data, err := json.MarshalIndent(transMap, "", "  ")
	if err != nil {
		return result, err
	}

	if err := os.WriteFile(transFile, data, 0644); err != nil {
		return result, err
	}

	result.FilesProcessed = 1
	return result, nil
}

// GenerateLangFile generates a language file in the project's locale directory.
func (ti *TranslationImporter) GenerateLangFile(ctx context.Context, projectPath, locale, format string, translations map[string]string) error {
	// Determine output directory based on format
	var outDir string
	switch format {
	case "paraglidejson":
		outDir = filepath.Join(projectPath, "locales")
	default:
		outDir = filepath.Join(projectPath, ".locallocales")
	}

	if err := os.MkdirAll(outDir, 0755); err != nil {
		return err
	}

	outFile := filepath.Join(outDir, locale+".json")

	// Write JSON file
	data, err := json.MarshalIndent(translations, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(outFile, data, 0644)
}

// GetTranslationFilePath returns the path to the translation file for a locale.
func (ti *TranslationImporter) GetTranslationFilePath(projectPath, locale string) string {
	return filepath.Join(projectPath, ".locallocales", locale+".json")
}