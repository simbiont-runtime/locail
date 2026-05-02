package app

import (
	"context"

	locailscanner "locail/internal/scanner"
	scannersvc "locail/internal/usecase/scanner"
)

// API provides scanner endpoints.
type API struct {
	service  *scannersvc.Service
	importer *locailscanner.TranslationImporter
}

// NewScannerAPI creates a new scanner API.
func NewScannerAPI(service *scannersvc.Service) *API {
	return &API{
		service:  service,
		importer: locailscanner.NewTranslationImporter(),
	}
}

// ScanProject scans a project and returns extracted strings.
func (api *API) ScanProject(ctx context.Context, projectPath string) (*locailscanner.ScanResult, error) {
	return api.service.ScanProject(ctx, projectPath)
}

// GetNewStrings returns all new strings from the cache.
func (api *API) GetNewStrings(ctx context.Context, projectPath string) ([]locailscanner.ExtractedString, error) {
	return api.service.GetNewStrings(ctx, projectPath)
}

// GetScanConfig returns the scan configuration.
func (api *API) GetScanConfig(ctx context.Context, projectPath string) (*locailscanner.ScanConfig, error) {
	return api.service.GetConfig(ctx, projectPath)
}

// SaveScanConfig saves the scan configuration.
func (api *API) SaveScanConfig(ctx context.Context, projectPath string, config *locailscanner.ScanConfig) error {
	return api.service.SaveConfig(ctx, projectPath, config)
}

// DeleteStringByKey removes a string from the cache.
func (api *API) DeleteStringByKey(ctx context.Context, projectPath, key string) error {
	return api.service.DeleteString(ctx, projectPath, key)
}

// UpdateStringStatus updates the status of a string.
func (api *API) UpdateStringStatus(ctx context.Context, projectPath, key, status string) error {
	return api.service.UpdateStringStatus(ctx, projectPath, key, status)
}

// AutoTranslateNewStrings автоматически переводит новые строки.
func (api *API) AutoTranslateNewStrings(ctx context.Context, projectPath, sourceLang, targetLang string) ([]locailscanner.ExtractedString, error) {
	return api.service.AutoTranslateNewStrings(ctx, sourceLang, targetLang)
}

// ImportTranslations imports translated strings back into the project.
func (api *API) ImportTranslations(ctx context.Context, projectPath, targetLang string) (*locailscanner.ImportResult, error) {
	strings, err := api.service.GetNewStrings(ctx, projectPath)
	if err != nil {
		return nil, err
	}

	return api.importer.ImportToSourceFiles(ctx, projectPath, targetLang, strings)
}

// GenerateLangFile generates a language file in the project's locale directory.
func (api *API) GenerateLangFile(ctx context.Context, projectPath, locale, format string, translations map[string]string) error {
	return api.importer.GenerateLangFile(ctx, projectPath, locale, format, translations)
}
