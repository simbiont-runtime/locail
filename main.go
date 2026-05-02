package main

import (
	"embed"
	"fmt"
	dbsqlite "locail/internal/adapters/db/sqlite"
	expcsv "locail/internal/adapters/exporter/csv"
	expjson "locail/internal/adapters/exporter/paraglidejson"
	exportreg "locail/internal/adapters/exporter/registry"
	expvdf "locail/internal/adapters/exporter/valvevdf"
	llmfactory "locail/internal/adapters/llm/factory"
	csvparser "locail/internal/adapters/parser/csv"
	paraglidejson "locail/internal/adapters/parser/paraglidejson"
	parreg "locail/internal/adapters/parser/registry"
	valvevdf "locail/internal/adapters/parser/valvevdf"
	promptRenderer "locail/internal/adapters/prompt"
	apiapp "locail/internal/api/app"
	"locail/internal/domain"
	"locail/internal/ports"
	exporterusecase "locail/internal/usecase/exporter"
	"locail/internal/usecase/importer"
	jobsusecase "locail/internal/usecase/jobs"
	scannersvc "locail/internal/usecase/scanner"
	translatorusecase "locail/internal/usecase/translator"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Initialize database and repositories
	db, dberr := dbsqlite.Init("data/locail.db")
	if dberr != nil {
		println("DB Error:", dberr.Error())
	}
	projectRepo := dbsqlite.NewProjectRepo(db)
	fileRepo := dbsqlite.NewFileRepo(db)
	unitRepo := dbsqlite.NewUnitRepo(db)
	providerRepo := dbsqlite.NewProviderRepo(db)
	templatesRepo := dbsqlite.NewTemplateRepo(db)
	cacheRepo := dbsqlite.NewCacheRepo(db)
	translationRepo := dbsqlite.NewTranslationRepo(db)
	jobRepo := dbsqlite.NewJobRepo(db)
	fileAPI := apiapp.NewFileAPI(fileRepo)
	unitAPI := apiapp.NewUnitAPI(unitRepo)

	// Parser registry and importer service
	parserRegistry := parreg.New()
	// Register parsers directly to keep wiring explicit
	parserRegistry.Register(paraglidejson.New())
	parserRegistry.Register(valvevdf.New())
	parserRegistry.Register(csvparser.New())
	importSvc := importer.New(fileRepo, unitRepo, parserRegistry)

	// Prompt renderer and translator service
	pr := promptRenderer.New(templatesRepo)
	transSvc := translatorusecase.New(translatorusecase.Deps{
		Providers:    providerRepo,
		Templates:    templatesRepo,
		Cache:        cacheRepo,
		Translations: translationRepo,
		Prompt:       pr,
		BuildProvider: func(p *domain.Provider) (ports.Provider, error) {
			prov, ok := llmfactory.FromProvider(p)
			if !ok {
				return nil, fmt.Errorf("unsupported provider: %s", p.Type)
			}
			return prov, nil
		},
	})

	// Job runner
	runner := jobsusecase.NewRunner(jobsusecase.Deps{Jobs: jobRepo, Files: fileRepo, Units: unitRepo, Providers: providerRepo, Translations: translationRepo, Prompt: pr, Cache: cacheRepo}, transSvc)
	app.SetRunner(runner)

	// Exporters and service
	expReg := exportreg.New()
	expReg.Register(expjson.New())
	expReg.Register(expvdf.New())
	expReg.Register(expcsv.New())
	expSvc := exporterusecase.New(fileRepo, unitRepo, translationRepo, expReg)

	// API bindings
	projectAPI := apiapp.NewProjectAPI(projectRepo)
	importAPI := apiapp.NewImportAPI(importSvc)
	providerAPI := apiapp.NewProviderAPI(providerRepo)
	jobsAPI := apiapp.NewJobsAPI(runner, jobRepo)
	exportAPI := apiapp.NewExportAPI(expSvc)
	translationsAPI := apiapp.NewTranslationsAPIWithUnits(translationRepo, unitRepo)

	// Scanner service and API
	scannerSvc, err := scannersvc.NewService(".")
	if err != nil {
		println("Scanner service error:", err.Error())
	} else {
		scannerSvc.SetTranslator(transSvc)
	}
	scannerAPI := apiapp.NewScannerAPI(scannerSvc)
	_ = scannerAPI // May be nil if scannerSvc is nil

	// Create application with options
	wails.Run(&options.App{
		Title:     "LLM Translator",
		Width:     1700,
		Height:    1000,
		MinWidth:  1700,
		MinHeight: 1000,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
			projectAPI,
			importAPI,
			providerAPI,
			fileAPI,
			unitAPI,
			jobsAPI,
			exportAPI,
			translationsAPI,
			scannerAPI,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
