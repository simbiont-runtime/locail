package watcher

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"locail/internal/scanner"
)

// ChangeOp represents the type of file change.
type ChangeOp string

const (
	ChangeOpCreate ChangeOp = "create"
	ChangeOpModify ChangeOp = "modify"
	ChangeOpDelete ChangeOp = "delete"
)

// FileWatcher watches for file changes and triggers incremental scanning.
type FileWatcher struct {
	watcher   *fsnotify.Watcher
	scanner   scanner.Scanner
	cache     Cache
	debounce  time.Duration
	mu        sync.Mutex
	callbacks []func(filePath string, op ChangeOp)
	running   bool
}

// Cache is an interface for the cache operations needed by the watcher.
type Cache interface {
	GetFileHash(path string) (string, error)
	SetFileHash(path, hash string) error
	DeleteStringsForFile(path string) error
	AddString(s *scanner.ExtractedString) error
}

// NewFileWatcher creates a new file watcher.
func NewFileWatcher(scanner scanner.Scanner, cache Cache) (*FileWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	return &FileWatcher{
		watcher:   w,
		scanner:   scanner,
		cache:     cache,
		debounce:  500 * time.Millisecond,
		callbacks: make([]func(filePath string, op ChangeOp), 0),
	}, nil
}

// OnChange registers a callback for file changes.
func (fw *FileWatcher) OnChange(callback func(filePath string, op ChangeOp)) {
	fw.mu.Lock()
	defer fw.mu.Unlock()
	fw.callbacks = append(fw.callbacks, callback)
}

// Watch starts watching the project directory.
func (fw *FileWatcher) Watch(ctx context.Context, projectPath string) error {
	// Watch the project directory recursively
	return filepath.Walk(projectPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") || base == "node_modules" || base == "vendor" || base == ".git" {
				return filepath.SkipDir
			}
			return fw.watcher.Add(path)
		}
		return nil
	})
}

// Run starts the event loop for the watcher.
func (fw *FileWatcher) Run(ctx context.Context) error {
	fw.mu.Lock()
	fw.running = true
	fw.mu.Unlock()

	debounceMap := make(map[string]*time.Timer)
	mu := sync.Mutex{}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case event, ok := <-fw.watcher.Events:
			if !ok {
				return nil
			}

			if event.Op&fsnotify.Write == 0 {
				continue
			}

			// Check if file extension is supported
			ext := strings.ToLower(filepath.Ext(event.Name))
			if ext == "" || !fw.scanner.IsSupported(event.Name) {
				continue
			}

			mu.Lock()
			// Cancel previous timer for this file
			if timer, exists := debounceMap[event.Name]; exists {
				timer.Stop()
			}

			// Create new debounced timer
			timer := time.AfterFunc(fw.debounce, func() {
				fw.handleFileChange(ctx, event.Name)
			})
			debounceMap[event.Name] = timer
			mu.Unlock()

		case err, ok := <-fw.watcher.Errors:
			if !ok {
				return nil
			}
			// Log error but continue
			_ = err
		}
	}
}

// handleFileChange processes a file change event.
func (fw *FileWatcher) handleFileChange(ctx context.Context, filePath string) {
	// Check if file has changed (by hash)
	content, err := os.ReadFile(filePath)
	if err != nil {
		return
	}

	// Compute hash
	hash := computeHash(string(content))

	// Check if hash changed
	oldHash, _ := fw.cache.GetFileHash(filePath)
	if oldHash == hash {
		return // No changes
	}

	// Update hash
	_ = fw.cache.SetFileHash(filePath, hash)

	// Remove old strings
	_ = fw.cache.DeleteStringsForFile(filePath)

	// Re-scan file
	strings, err := fw.scanner.ScanFile(ctx, filePath)
	if err != nil {
		return
	}

	// Add new strings to cache
	for i := range strings {
		_ = fw.cache.AddString(&strings[i])
	}

	// Notify callbacks about new strings
	for _, cb := range fw.callbacks {
		for range strings {
			cb(filePath, ChangeOpModify)
		}
	}
}

// Stop stops the watcher.
func (fw *FileWatcher) Stop() error {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	if !fw.running {
		return nil
	}

	fw.running = false
	return fw.watcher.Close()
}

// computeHash computes a simple hash of content.
func computeHash(content string) string {
	h := fnv32a(content)
	return strings.ToUpper(strings.Replace(fmt.Sprintf("%08x", h), " ", "0", -1))
}

// fnv32a is a simple FNV-1a hash.
func fnv32a(s string) uint32 {
	const prime32 = uint32(16777619)
	hash := uint32(2166136261)
	for _, c := range s {
		hash ^= uint32(c)
		hash *= prime32
	}
	return hash
}
