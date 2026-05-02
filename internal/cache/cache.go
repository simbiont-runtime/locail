package cache

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"locail/internal/scanner"
)

// Cache manages the .locallocales directory and SQLite storage.
type Cache struct {
	db      *sql.DB
	rootDir string
}

// New creates a new cache instance in the specified project root.
func New(projectRoot string) (*Cache, error) {
	cacheDir := filepath.Join(projectRoot, ".locallocales")
	
	// Create directory if it doesn't exist
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, fmt.Errorf("creating cache directory: %w", err)
	}

	dbPath := filepath.Join(cacheDir, "cache.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening cache database: %w", err)
	}

	c := &Cache{
		db:      db,
		rootDir: cacheDir,
	}

	if err := c.initSchema(); err != nil {
		return nil, err
	}

	return c, nil
}

// initSchema creates the necessary tables.
func (c *Cache) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS extracted_strings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		file_path TEXT NOT NULL,
		line INTEGER NOT NULL,
		column INTEGER NOT NULL,
		key TEXT NOT NULL UNIQUE,
		text TEXT NOT NULL,
		context TEXT,
		language TEXT NOT NULL DEFAULT 'en',
		status TEXT NOT NULL DEFAULT 'new',
		hash TEXT NOT NULL,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_extracted_strings_file_path ON extracted_strings(file_path);
	CREATE INDEX IF NOT EXISTS idx_extracted_strings_status ON extracted_strings(status);
	CREATE INDEX IF NOT EXISTS idx_extracted_strings_key ON extracted_strings(key);

	CREATE TABLE IF NOT EXISTS file_hashes (
		path TEXT PRIMARY KEY,
		hash TEXT NOT NULL,
		updated_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS scan_config (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS scan_cache (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME NOT NULL
	);
	`

	_, err := c.db.Exec(schema)
	return err
}

// Close closes the database connection.
func (c *Cache) Close() error {
	return c.db.Close()
}

// GetFileHash returns the stored hash for a file.
func (c *Cache) GetFileHash(path string) (string, error) {
	var hash string
	err := c.db.QueryRow("SELECT hash FROM file_hashes WHERE path = ?", path).Scan(&hash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return hash, nil
}

// SetFileHash stores the hash for a file.
func (c *Cache) SetFileHash(path, hash string) error {
	_, err := c.db.Exec(`
		INSERT INTO file_hashes (path, hash, updated_at) 
		VALUES (?, ?, ?) 
		ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at
	`, path, hash, time.Now())
	return err
}

// AddString adds an extracted string to the cache.
func (c *Cache) AddString(s *scanner.ExtractedString) error {
	_, err := c.db.Exec(`
		INSERT INTO extracted_strings (file_path, line, column, key, text, context, language, status, hash, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET 
			text = excluded.text,
			status = CASE WHEN excluded.hash != extracted_strings.hash THEN 'new' ELSE extracted_strings.status END,
			hash = excluded.hash,
			updated_at = excluded.updated_at
	`,
		s.FilePath, s.Line, s.Column, s.Key, s.Text, s.Context, s.Language, s.Status, s.Hash,
		time.Now(), time.Now(),
	)
	return err
}

// GetStringsForFile returns all strings for a specific file.
func (c *Cache) GetStringsForFile(filePath string) ([]scanner.ExtractedString, error) {
	rows, err := c.db.Query(`
		SELECT id, file_path, line, column, key, text, context, language, status, hash, created_at, updated_at 
		FROM extracted_strings 
		WHERE file_path = ? 
		ORDER BY line, column
	`, filePath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var strings []scanner.ExtractedString
	for rows.Next() {
		var s scanner.ExtractedString
		var createdAt, updatedAt string
		err := rows.Scan(&s.ID, &s.FilePath, &s.Line, &s.Column, &s.Key, &s.Text, &s.Context, &s.Language, &s.Status, &s.Hash, &createdAt, &updatedAt)
		if err != nil {
			return nil, err
		}
		strings = append(strings, s)
	}
	return strings, nil
}

// GetNewStrings returns all strings with status "new".
func (c *Cache) GetNewStrings() ([]scanner.ExtractedString, error) {
	rows, err := c.db.Query(`
		SELECT id, file_path, line, column, key, text, context, language, status, hash, created_at, updated_at 
		FROM extracted_strings 
		WHERE status = 'new' 
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var strings []scanner.ExtractedString
	for rows.Next() {
		var s scanner.ExtractedString
		var createdAt, updatedAt string
		err := rows.Scan(&s.ID, &s.FilePath, &s.Line, &s.Column, &s.Key, &s.Text, &s.Context, &s.Language, &s.Status, &s.Hash, &createdAt, &updatedAt)
		if err != nil {
			return nil, err
		}
		strings = append(strings, s)
	}
	return strings, nil
}

// UpdateStringStatus updates the status of a string by key.
func (c *Cache) UpdateStringStatus(key, status string) error {
	_, err := c.db.Exec("UPDATE extracted_strings SET status = ?, updated_at = ? WHERE key = ?", status, time.Now(), key)
	return err
}

// DeleteStringsForFile removes all strings for a file.
func (c *Cache) DeleteStringsForFile(filePath string) error {
	_, err := c.db.Exec("DELETE FROM extracted_strings WHERE file_path = ?", filePath)
	return err
}

// DeleteStringByKey removes a string by key.
func (c *Cache) DeleteStringByKey(key string) error {
	_, err := c.db.Exec("DELETE FROM extracted_strings WHERE key = ?", key)
	return err
}

// GetAllStrings returns all extracted strings.
func (c *Cache) GetAllStrings() ([]scanner.ExtractedString, error) {
	rows, err := c.db.Query(`
		SELECT id, file_path, line, column, key, text, context, language, status, hash, created_at, updated_at 
		FROM extracted_strings 
		ORDER BY file_path, line, column
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var strings []scanner.ExtractedString
	for rows.Next() {
		var s scanner.ExtractedString
		var createdAt, updatedAt string
		err := rows.Scan(&s.ID, &s.FilePath, &s.Line, &s.Column, &s.Key, &s.Text, &s.Context, &s.Language, &s.Status, &s.Hash, &createdAt, &updatedAt)
		if err != nil {
			return nil, err
		}
		strings = append(strings, s)
	}
	return strings, nil
}

// SetConfig stores configuration.
func (c *Cache) SetConfig(key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = c.db.Exec(`
		INSERT INTO scan_config (key, value) 
		VALUES (?, ?) 
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, string(data))
	return err
}

// GetConfig retrieves configuration.
func (c *Cache) GetConfig(key string, dest interface{}) error {
	var value string
	err := c.db.QueryRow("SELECT value FROM scan_config WHERE key = ?", key).Scan(&value)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(value), dest)
}

// ClearCache removes all cached data.
func (c *Cache) ClearCache() error {
	_, err := c.db.Exec("DELETE FROM extracted_strings")
	if err != nil {
		return err
	}
	_, err = c.db.Exec("DELETE FROM file_hashes")
	return err
}

// GetOrCreateConfig returns the scan configuration, creating default if needed.
func (c *Cache) GetOrCreateConfig() (*scanner.ScanConfig, error) {
	var config scanner.ScanConfig
	err := c.GetConfig("config", &config)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			config = scanner.ScanConfig{
				SourceLanguage: "en",
				Extensions:     []string{".vue", ".svelte", ".jsx", ".tsx", ".js", ".ts", ".md", ".mdx"},
				IgnorePatterns: scanner.DefaultIgnorePatterns(),
				ExtractUIOnly:  true,
				AutoTranslate:  false,
			}
			if err := c.SetConfig("config", config); err != nil {
				return nil, err
			}
			return &config, nil
		}
		return nil, err
	}
	return &config, nil
}

// SaveConfig saves the scan configuration.
func (c *Cache) SaveConfig(config *scanner.ScanConfig) error {
	return c.SetConfig("config", config)
}