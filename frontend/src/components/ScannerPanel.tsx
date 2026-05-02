import React, { useState, useCallback } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Select } from './ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { FolderOpen, RefreshCw, Play } from 'lucide-react'

// Types matching backend
type ScanConfig = {
  project_path: string
  source_language: string
  extensions: string[]
  ignore_patterns: string[]
  extract_ui_only: boolean
  auto_translate: boolean
}

type ExtractedString = {
  id?: number
  file_path: string
  line: number
  column: number
  key: string
  text: string
  context: string
  language: string
  status: string
  hash: string
}

type ScanResult = {
  total_files: number
  scanned_files: number
  extracted_strings: ExtractedString[]
  errors: { file_path: string; message: string }[]
}

type ScannerPanelProps = {
  onStringsFound?: (strings: ExtractedString[]) => void
}

// Scanner API will be available after wails dev/build
declare const ScannerAPI: {
  ScanProject: (projectPath: string) => Promise<ScanResult>
  GetNewStrings: (projectPath: string) => Promise<ExtractedString[]>
  AutoTranslateNewStrings: (projectPath: string, sourceLang: string, targetLang: string) => Promise<ExtractedString[]>
}

// Wails runtime is available globally
declare const window: any

export function ScannerPanel({ onStringsFound }: ScannerPanelProps) {
  const [config, setConfig] = useState<ScanConfig>({
    project_path: '',
    source_language: 'en',
    extensions: ['.vue', '.svelte', '.jsx', '.tsx', '.js', '.ts', '.md', '.mdx'],
    ignore_patterns: ['node_modules', '.git', 'dist', 'build'],
    extract_ui_only: true,
    auto_translate: false,
  })
  const [scanning, setScanning] = useState(false)
  const [newStrings, setNewStrings] = useState<ExtractedString[]>([])
  const [status, setStatus] = useState('')

  const handleScan = useCallback(async () => {
    if (!config.project_path) {
      setStatus('Please specify a project path')
      return
    }

    setScanning(true)
    setStatus('Scanning...')

    try {
      const result = await ScannerAPI.ScanProject(config.project_path)
      
      setNewStrings(result.extracted_strings)
      onStringsFound?.(result.extracted_strings)
      setStatus(`Scanned ${result.scanned_files} files, found ${result.extracted_strings.length} strings`)
    } catch (error) {
      setStatus(`Error: ${error}`)
    } finally {
      setScanning(false)
    }
  }, [config, onStringsFound])

  const handleAutoTranslate = useCallback(async () => {
    if (!config.project_path) return
    
    setStatus('Translating...')
    try {
      await ScannerAPI.AutoTranslateNewStrings(config.project_path, config.source_language, 'ru')
      setStatus('Translation completed')
      // Refresh strings
      const strings = await ScannerAPI.GetNewStrings(config.project_path)
      setNewStrings(strings)
    } catch (error) {
      setStatus(`Translation error: ${error}`)
    }
  }, [config])

  const handleProjectPathSelect = useCallback(async () => {
    try {
      const result = await window.runtime.OpenDirectoryDialog({
        title: 'Select Project Folder',
      })
      if (result) {
        setConfig({ ...config, project_path: result })
      }
    } catch (error) {
      setStatus(`Dialog error: ${error}`)
    }
  }, [config])

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Code Scanner</CardTitle>
          <CardDescription>
            Scan source code for translatable strings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="projectPath">Project Path</Label>
            <div className="flex gap-2">
              <Input
                id="projectPath"
                value={config.project_path}
                onChange={(e) => setConfig({ ...config, project_path: e.target.value })}
                placeholder="/path/to/project"
                readOnly
              />
              <Button variant="outline" size="icon" onClick={handleProjectPathSelect}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sourceLanguage">Source Language</Label>
            <select
              id="sourceLanguage"
              className="h-9 border rounded-md px-2 bg-transparent w-full"
              value={config.source_language}
              onChange={(e) => setConfig({ ...config, source_language: e.target.value })}
            >
              <option value="en">English</option>
              <option value="ru">Russian</option>
              <option value="de">German</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="extractUIOnly">Extract UI strings only</Label>
            <Switch
              checked={config.extract_ui_only}
              onCheckedChange={(checked) => setConfig({ ...config, extract_ui_only: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="autoTranslate">Auto-translate new strings</Label>
            <Switch
              checked={config.auto_translate}
              onCheckedChange={(checked) => setConfig({ ...config, auto_translate: checked })}
            />
          </div>

          <Button 
            className="w-full" 
            onClick={handleScan} 
            disabled={scanning || !config.project_path}
          >
            {scanning ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Scan
              </>
            )}
          </Button>

          {status && (
            <p className="text-sm text-muted-foreground">{status}</p>
          )}
        </CardContent>
      </Card>

      {newStrings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>New Strings ({newStrings.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {newStrings.map((s, i) => (
                <div key={i} className="p-2 border rounded text-sm">
                  <div className="font-mono text-xs text-muted-foreground">
                    {s.file_path}:{s.line}
                  </div>
                  <div className="font-medium">{s.text}</div>
                  <div className="text-xs text-muted-foreground">{s.context}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {newStrings.length > 0 && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setNewStrings([])}>
            Clear List
          </Button>
          <Button onClick={handleAutoTranslate}>
            Auto-translate All
          </Button>
        </div>
      )}
    </div>
  )
}