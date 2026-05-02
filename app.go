package main

import (
	"context"
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	jobsusecase "locail/internal/usecase/jobs"
)

// version is set at build time via -ldflags "-X main.version=..."
var version = "dev"

// App struct
type App struct {
	ctx context.Context
	// db handle and other services will be added as we build
	runner *jobsusecase.Runner
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.runner != nil {
		a.runner.SetEmitter(wailsEmitter{ctx: a.ctx})
	}
}

// SelectProjectFolder opens a directory selection dialog and returns the selected path.
func (a *App) SelectProjectFolder(title string) (string, error) {
	result, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
	})
	if err != nil {
		return "", err
	}
	return result, nil
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// SetRunner allows main() to provide the job runner so we can wire event emitter on startup
func (a *App) SetRunner(r *jobsusecase.Runner) {
	a.runner = r
}

// Version returns the application version embedded at build time.
func (a *App) Version() string { return version }

type wailsEmitter struct{ ctx context.Context }

func (w wailsEmitter) Emit(name string, payload any) {
	runtime.EventsEmit(w.ctx, name, payload)
}
