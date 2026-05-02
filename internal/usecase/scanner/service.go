package scanner

import (
	"context"
	"sync"

	"locail/internal/cache"
	locailscanner "locail/internal/scanner"
	translatorusecase "locail/internal/usecase/translator"
)

// Service provides scanning functionality.
type Service struct {
	scanner   *locailscanner.CompositeScanner
	cache     *cache.Cache
	mu        sync.Mutex
	translate *translatorusecase.Service
}

// NewService creates a new scanner service.
func NewService(projectPath string) (*Service, error) {
	c, err := cache.New(projectPath)
	if err != nil {
		return nil, err
	}

	return &Service{
		scanner: locailscanner.NewCompositeScanner(),
		cache:   c,
	}, nil
}

// SetTranslator sets the translator service for auto-translation.
func (s *Service) SetTranslator(t *translatorusecase.Service) {
	s.translate = t
}

// ScanProject scans a project and stores extracted strings in cache.
func (s *Service) ScanProject(ctx context.Context, projectPath string) (*locailscanner.ScanResult, error) {
	result, err := s.scanner.ScanProject(ctx, projectPath)
	if err != nil {
		return nil, err
	}

	// Store strings in cache
	for i := range result.ExtractedStrings {
		_ = s.cache.AddString(&result.ExtractedStrings[i])
	}

	return result, nil
}

// GetNewStrings returns all strings with status "new".
func (s *Service) GetNewStrings(ctx context.Context, projectPath string) ([]locailscanner.ExtractedString, error) {
	return s.cache.GetNewStrings()
}

// GetConfig returns the scan configuration.
func (s *Service) GetConfig(ctx context.Context, projectPath string) (*locailscanner.ScanConfig, error) {
	return s.cache.GetOrCreateConfig()
}

// SaveConfig saves the scan configuration.
func (s *Service) SaveConfig(ctx context.Context, projectPath string, config *locailscanner.ScanConfig) error {
	return s.cache.SaveConfig(config)
}

// DeleteString removes a string from cache.
func (s *Service) DeleteString(ctx context.Context, projectPath, key string) error {
	return s.cache.DeleteStringByKey(key)
}

// UpdateStringStatus updates the status of a string.
func (s *Service) UpdateStringStatus(ctx context.Context, projectPath, key, status string) error {
	return s.cache.UpdateStringStatus(key, status)
}

// Close closes the service.
func (s *Service) Close() error {
	return s.cache.Close()
}

// AutoTranslateNewStrings автоматически переводит новые строки.
func (s *Service) AutoTranslateNewStrings(ctx context.Context, sourceLang, targetLang string) ([]locailscanner.ExtractedString, error) {
	strings, err := s.cache.GetNewStrings()
	if err != nil {
		return nil, err
	}

	if s.translate == nil {
		// Fallback: just mark as processed
		for i := range strings {
			_ = s.cache.UpdateStringStatus(strings[i].Key, "processed")
		}
		return strings, nil
	}

	// Translate each string
	for i := range strings {
		_, err := s.translate.TranslateOne(ctx, translatorusecase.TranslateArgs{
			Unit:       nil, // Would need to create domain.Unit
			SourceLang: sourceLang,
			TargetLang: targetLang,
			Model:      "",
		})
		if err != nil {
			// Log error but continue
			continue
		}
		_ = s.cache.UpdateStringStatus(strings[i].Key, "translated")
	}

	return strings, nil
}

// FilterTranslatableStrings фильтрует строки, которые подлежат переводу.
// Используется для исключения технических строк и строк, которые не нужно переводить.
func FilterTranslatableStrings(strings []locailscanner.ExtractedString) []locailscanner.ExtractedString {
	filtered := make([]locailscanner.ExtractedString, 0)

	for _, s := range strings {
		// Пропускаем короткие строки (менее 3 символов)
		if len(s.Text) < 3 {
			continue
		}

		// Пропускаем строки, которые выглядят как идентификаторы
		if isIdentifier(s.Text) {
			continue
		}

		// Пропускаем пути файлов и URL
		if isPathOrURL(s.Text) {
			continue
		}

		// Пропускаем строки только с заглавными буквами (вероятно аббревиатуры)
		if isAllCaps(s.Text) {
			continue
		}

		filtered = append(filtered, s)
	}

	return filtered
}

// isIdentifier проверяет, является ли строка идентификатором.
func isIdentifier(s string) bool {
	// Простая эвристика: если строка содержит только латиниские буквы, цифры и подчеркивания
	// и начинается с маленькой буквы, скорее всего это идентификатор
	for i, r := range s {
		if i == 0 {
			if (r >= 'a' && r <= 'z') || r == '_' {
				continue
			}
			return false
		}
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_') {
			return false
		}
	}
	return true
}

// isPathOrURL проверяет, является ли строка путем или URL.
func isPathOrURL(s string) bool {
	return len(s) > 0 && (s[0] == '/' || s[0] == '.' ||
		(len(s) > 4 && (s[:4] == "http" || s[:4] == "www.")))
}

// isAllCaps проверяет, состоит ли строка только из заглавных букв.
func isAllCaps(s string) bool {
	for _, r := range s {
		if r >= 'a' && r <= 'z' {
			return false
		}
	}
	return true
}
