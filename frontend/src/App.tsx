import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import * as ProjectAPI from '../wailsjs/go/app/ProjectAPI'
import * as FileAPI from '../wailsjs/go/app/FileAPI'
import * as TranslationsAPI from '../wailsjs/go/app/TranslationsAPI'
import * as JobsAPI from '../wailsjs/go/app/JobsAPI'
import * as ProviderAPI from '../wailsjs/go/app/ProviderAPI'
import * as ExportAPI from '../wailsjs/go/app/ExportAPI'
import TranslationRow from './components/TranslationRow'
import NewProjectModal from './components/NewProjectModal'
import EditProjectModal from './components/EditProjectModal'
import ImportFileModal from './components/ImportFileModal'
import ExportModal from './components/ExportModal'
import UpdateFileModal from './components/UpdateFileModal'
import ProviderEditor from './components/ProviderEditor'
import ConfirmModal from './components/ConfirmModal'
import { Pencil, Trash2, RefreshCw, UploadCloud, Plus, FileDiff, Download, CircleX } from 'lucide-react'
import { Progress } from './components/ui/progress'
import ProviderDropdown from './components/ProviderDropdown'
import GeneralSettings from './components/GeneralSettings'
import { ScannerPanel } from './components/ScannerPanel'

type ProjectRecord = {
  id: number
  name: string
  sourceLang: string
  locales: string[]
}

type FileRecord = {
  id: number
  path: string
  format?: string
  locale?: string
}

type Entry = {
  unitId: number
  key: string
  source: string
  translation: string
  draft: string
  status: string
}

type ProviderInfo = {
  id: number
  type: string
  name: string
  base_url?: string
  model?: string
  api_key?: string
}

type ProviderSettings = {
  providerId: number | null
  providerType: string
  baseUrl: string
  model: string
  apiKeyMasked?: string
}


type JobProgress = {
  jobId: number | null
  done: number
  total: number
  status: string
  model?: string
}

type JobItemState = {
  key?: string
  locale?: string
  model?: string
}

type JobLastResult = {
  key?: string
  locale?: string
  text?: string
  error?: string
  model?: string
}

function formatNumber(n: number) {
  return new Intl.NumberFormat().format(n)
}

function download(filename: string, data: string, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadBase64(filename: string, base64: string, mime = 'application/octet-stream') {
  if (!base64) return
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}


function useTranslationMemory() {
  const memoryRef = useRef<Map<string, string>>(new Map())
  const set = useCallback((key: string, value: string) => {
    memoryRef.current.set(key, value)
  }, [])
  const get = useCallback((key: string) => memoryRef.current.get(key), [])
  const toJSON = useCallback(() => {
    const obj: Record<string, string> = {}
    memoryRef.current.forEach((value, key) => {
      obj[key] = value
    })
    return obj
  }, [])
  const api = useMemo(() => ({ set, get, toJSON }), [set, get, toJSON])
  return api
}

function useKeyboardShortcuts(onFocusSearch: () => void, onSave: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const active = document.activeElement
      const tag = active?.tagName
      if (event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        event.preventDefault()
        onFocusSearch()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSave()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onFocusSearch, onSave])
}

type FileStats = Record<number, { total: number; translated: number }>

function App() {
  const [wailsReady, setWailsReady] = useState<boolean>(() => !!(window as any)?.go?.app)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [files, setFiles] = useState<FileRecord[]>([])
  const [fileStats, setFileStats] = useState<FileStats>({})
  const [entries, setEntries] = useState<Entry[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null)
  const [targetLang, setTargetLang] = useState('')
  const [search, setSearch] = useState('')
  const [onlyUntranslated, setOnlyUntranslated] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('Ready.')
  const [activeTab, setActiveTab] = useState<'projects' | 'files' | 'scanner' | 'settings'>('projects')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [editProject, setEditProject] = useState<ProjectRecord | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [settingsProviderId, setSettingsProviderId] = useState<number | 'new' | 'general' | null>(null)
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; confirmText?: string; onConfirm?: () => Promise<void> | void }>({ open: false, title: '', message: '' })
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>({
    providerId: null,
    providerType: '',
    baseUrl: '',
    model: '',
    apiKeyMasked: '',
  })
  const [jobProgress, setJobProgress] = useState<JobProgress>({ jobId: null, done: 0, total: 0, status: 'idle' })
  const [currentItem, setCurrentItem] = useState<JobItemState>({})
  const [lastResult, setLastResult] = useState<JobLastResult>({})
  const [colWidths, setColWidths] = useState<{ key: number; source: number; saved: number; translation: number; actions: number }>({ key: 320, source: 420, saved: 360, translation: 520, actions: 220 })
  const [resizing, setResizing] = useState<{ col: 'key' | 'source' | 'saved' | 'translation' | 'actions' | null; startX: number; startWidth: number }>({ col: null, startX: 0, startWidth: 0 })
  const [settingsTab, setSettingsTab] = useState<'general' | 'providers'>('general')
  const [themePref, setThemePref] = useState<'system' | 'light' | 'dark'>(() => {
    const v = localStorage.getItem('theme') as any
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  })
  const handleCancelJob = useCallback(async () => {
    if (!(window as any)?.go?.app) { setStatus('Backend not available in web mode.'); return }
    const id = jobProgress.jobId
    if (!id) return
    try {
      await (JobsAPI as any).Cancel(id)
      setStatus(`Cancel requested for job #${id}.`)
    } catch (e) {
      console.error(e)
      setStatus('Failed to cancel job.')
    }
  }, [jobProgress.jobId])

  const importInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const memory = useTranslationMemory()

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  const srcLang = selectedProject?.sourceLang || 'en'
  const availableLanguages = useMemo(() => {
    if (!selectedProject) return []
    const set = new Set<string>()
    if (selectedProject.sourceLang) set.add(selectedProject.sourceLang)
    selectedProject.locales.forEach(loc => {
      if (loc) set.add(loc)
    })
    return Array.from(set)
  }, [selectedProject])
  const selectedFile = useMemo(
    () => files.find(f => f.id === selectedFileId) ?? null,
    [files, selectedFileId],
  )

  const loadProjects = useCallback(async () => {
    if (!(window as any)?.go?.app) {
      // Running without Wails backend (e.g., web dev) — skip and avoid errors
      setProjects([])
      setSelectedProjectId(null)
      return
    }
    setStatus('Loading projects…')
    try {
      const res = await (ProjectAPI as any).List()
      const list: ProjectRecord[] = []
      for (const p of res || []) {
        let locales: string[] = []
        try {
          const locs = await (ProjectAPI as any).ListLocales(p.id)
          locales = (locs || []).map((l: any) => l.locale).filter(Boolean)
        } catch (err) {
          console.error(err)
        }
        list.push({ id: p.id, name: p.name, sourceLang: p.source_lang || '', locales })
      }
      setProjects(list)
      if (list.length === 0) {
        setSelectedProjectId(null)
      } else {
        setSelectedProjectId(prev => (prev && list.some(p => p.id === prev) ? prev : list[0].id))
      }
      setStatus(`Loaded ${list.length} project${list.length === 1 ? '' : 's'}.`)
    } catch (error: any) {
      console.error(error)
      setStatus(`Failed to load projects: ${String(error?.message || error)}`)
    }
  }, [])

  const loadFiles = useCallback(async (projectId: number) => {
    if (!(window as any)?.go?.app) return
    setStatus('Loading files…')
    try {
      const res = await (FileAPI as any).ListByProject(projectId)
      const list: FileRecord[] = (res || []).map((f: any) => ({ id: f.id, path: f.path, format: f.format, locale: f.locale }))
      setFiles(list)
      setSelectedFileId(prev => (prev && list.some(f => f.id === prev) ? prev : list[0]?.id ?? null))
      setStatus(`Loaded ${list.length} file${list.length === 1 ? '' : 's'}.`)
    } catch (error: any) {
      console.error(error)
      setFiles([])
      setSelectedFileId(null)
      setStatus(`Failed to load files: ${String(error?.message || error)}`)
    }
  }, [])

  const loadEntries = useCallback(async (fileId: number | null, locale: string) => {
    if (!(window as any)?.go?.app) {
      setEntries([])
      setSelection(new Set())
      setDirty(false)
      return
    }
    if (!fileId || !locale) {
      setEntries([])
      setSelection(new Set())
      setDirty(false)
      return
    }
    setStatus('Loading units…')
    try {
      const res = await (TranslationsAPI as any).ListUnitTexts(fileId, locale)
      const list: Entry[] = (res || []).map((u: any) => ({
        unitId: u.unit_id,
        key: u.key,
        source: u.source,
        translation: u.translation || '',
        draft: u.translation || '',
        status: u.status || '',
      }))
      setEntries(list)
      setSelection(new Set())
      list.forEach(entry => {
        if (entry.translation.trim()) {
          memory.set(`${entry.source}|${locale}`, entry.translation)
        }
      })
      setFileStats(prev => ({
        ...prev,
        [fileId]: { total: list.length, translated: list.filter(entry => entry.translation.trim() !== '').length },
      }))
      setDirty(false)
      setStatus(`Loaded ${list.length} unit${list.length === 1 ? '' : 's'}.`)
    } catch (error: any) {
      console.error(error)
      setEntries([])
      setSelection(new Set())
      setStatus(`Failed to load units: ${String(error?.message || error)}`)
    }
  }, [memory])

  const loadProviders = useCallback(async () => {
    if (!(window as any)?.go?.app) {
      setProviders([])
      setProviderSettings({ providerId: null, providerType: '', baseUrl: '', model: '', apiKeyMasked: '' })
      return
    }
    try {
      const res = await (ProviderAPI as any).List()
      const list: ProviderInfo[] = res || []
      setProviders(list)
      if (list.length === 0) {
        setProviderSettings({ providerId: null, providerType: '', baseUrl: '', model: '', apiKeyMasked: '' })
        setSettingsProviderId('general')
      } else {
        setProviderSettings(prev => {
          const existing = prev.providerId ? list.find(p => p.id === prev.providerId) : undefined
          const provider = existing ?? list[0]
          return {
            providerId: provider.id,
            providerType: provider.type || '',
            baseUrl: provider.base_url || '',
            model: provider.model || '',
            apiKeyMasked: provider.api_key || '',
          }
        })
        setSettingsProviderId(prev => {
          if (prev === 'new' || prev == null) return list[0]?.id ?? 'general'
          if (prev === 'general') return 'general'
          return list.some(p => p.id === prev) ? prev : (list[0]?.id ?? 'general')
        })
      }
    } catch (error) {
      console.error(error)
    }
  }, [])

  useEffect(() => {
    if (!resizing.col) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - resizing.startX
      const min = 240
      const max = 1200
      if (resizing.col === 'key') {
        const w = Math.max(min, Math.min(max, resizing.startWidth + dx))
        setColWidths(prev => ({ ...prev, key: w }))
      } else if (resizing.col === 'source') {
        const w = Math.max(min, Math.min(max, resizing.startWidth + dx))
        setColWidths(prev => ({ ...prev, source: w }))
      } else if (resizing.col === 'saved') {
        const w = Math.max(min, Math.min(max, resizing.startWidth + dx))
        setColWidths(prev => ({ ...prev, saved: w }))
      } else if (resizing.col === 'translation') {
        const w = Math.max(min, Math.min(max, resizing.startWidth + dx))
        setColWidths(prev => ({ ...prev, translation: w }))
      } else if (resizing.col === 'actions') {
        const w = Math.max(160, Math.min(max, resizing.startWidth + dx))
        setColWidths(prev => ({ ...prev, actions: w }))
      }
    }
    const onUp = () => setResizing({ col: null, startX: 0, startWidth: 0 })
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [resizing])

  const beginResize = useCallback((col: 'key' | 'source' | 'saved' | 'translation' | 'actions', e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    let startWidth = 0
    if (col === 'key') startWidth = colWidths.key
    else if (col === 'source') startWidth = colWidths.source
    else if (col === 'saved') startWidth = colWidths.saved
    else if (col === 'translation') startWidth = colWidths.translation
    else if (col === 'actions') startWidth = colWidths.actions
    setResizing({ col, startX: e.clientX, startWidth })
  }, [colWidths])

  useEffect(() => {
    const root = document.documentElement
    const apply = (pref: 'system' | 'light' | 'dark') => {
      if (pref === 'system') {
        const m = window.matchMedia('(prefers-color-scheme: dark)')
        if (m.matches) root.classList.add('dark')
        else root.classList.remove('dark')
      } else if (pref === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
    apply(themePref)
    localStorage.setItem('theme', themePref)
    let mql: MediaQueryList | null = null
    const onChange = (e: MediaQueryListEvent) => { if (themePref === 'system') { if (e.matches) root.classList.add('dark'); else root.classList.remove('dark') } }
    if (themePref === 'system') { mql = window.matchMedia('(prefers-color-scheme: dark)'); try { mql.addEventListener('change', onChange) } catch { mql?.addListener(onChange) } }
    return () => { if (mql) { try { mql.removeEventListener('change', onChange) } catch { mql.removeListener(onChange) } } }
  }, [themePref])

  const handleChangeTheme = useCallback((value: 'system'|'light'|'dark') => {
    setThemePref(value)
    setStatus(`Theme set to ${value}.`)
  }, [])

  useEffect(() => {
    if (wailsReady) return
    const id = window.setInterval(() => {
      if ((window as any)?.go?.app) {
        setWailsReady(true)
        window.clearInterval(id)
      }
    }, 50)
    return () => window.clearInterval(id)
  }, [wailsReady])

  useEffect(() => {
    if (!wailsReady) return
    loadProjects()
    loadProviders()
  }, [wailsReady, loadProjects, loadProviders])

  useEffect(() => {
    if (selectedProjectId != null) {
      loadFiles(selectedProjectId)
    } else {
      setFiles([])
      setSelectedFileId(null)
      setEntries([])
    }
  }, [selectedProjectId, loadFiles])

  useEffect(() => {
    if (!selectedProject) {
      setTargetLang('')
      return
    }
    const targets = availableLanguages.filter(lang => lang !== srcLang)
    if (targets.length === 0) {
      setTargetLang(srcLang)
      return
    }
    if (!targetLang || (targetLang === srcLang && targets.length > 0) || !targets.includes(targetLang)) {
      setTargetLang(targets[0])
    }
  }, [selectedProject, availableLanguages, srcLang, targetLang])

  useEffect(() => {
    if (selectedFileId && targetLang) {
      loadEntries(selectedFileId, targetLang)
    } else {
      setEntries([])
      setSelection(new Set())
      setDirty(false)
    }
  }, [selectedFileId, targetLang, loadEntries])

  useEffect(() => {
    const rt = (window as any).runtime
    if (!wailsReady || !rt?.EventsOn) return
    const offStarted = rt.EventsOn('job.started', (payload: any) => {
      const jobId = payload?.job_id
      if (!jobId) return
      setJobProgress({ jobId, done: 0, total: payload?.total || 0, status: 'running', model: payload?.model })
      setStatus(`Job #${jobId} started (${payload?.total || 0} items).`)
    })
    const offProgress = rt.EventsOn('job.progress', (payload: any) => {
      const jobId = payload?.job_id
      if (!jobId) return
      setJobProgress(prev => ({
        jobId,
        done: payload?.done ?? prev.done,
        total: payload?.total ?? prev.total,
        status: payload?.status || prev.status,
        model: payload?.model || prev.model,
      }))
    })
    const norm = (loc?: string) => (loc || '').toLowerCase().replace(/_/g, '-').trim()
    const offItemStart = rt.EventsOn('job.item.start', (payload: any) => {
      setCurrentItem({ key: payload?.key, locale: payload?.locale, model: payload?.model })
      if (payload?.key) {
        setStatus(`Translating ${payload.key}${payload?.locale ? ` (${payload.locale})` : ''}…`)
      }
    })
    const offItemDone = rt.EventsOn('job.item.done', (payload: any) => {
      setLastResult({ key: payload?.key, locale: payload?.locale, text: payload?.text, error: payload?.error, model: payload?.model })
      const pLoc = norm(payload?.locale)
      const tLoc = norm(targetLang)
      if (!payload?.unit_id || (tLoc && pLoc && pLoc !== tLoc)) return
      setEntries(prev => {
        const next = prev.map(entry => {
          if (entry.unitId === payload.unit_id) {
            const text = payload?.text ?? entry.translation
            const updated: Entry = {
              ...entry,
              translation: text,
              draft: text,
              status: payload?.error ? entry.status : 'machine',
            }
            if (text?.trim()) {
              memory.set(`${updated.source}|${targetLang}`, text)
            }
            return updated
          }
          return entry
        })
        const translatedCount = next.filter(entry => entry.translation.trim() !== '').length
        if (selectedFileId) {
          setFileStats(fs => ({ ...fs, [selectedFileId]: { total: next.length, translated: translatedCount } }))
        }
        setDirty(next.some(entry => entry.draft !== entry.translation))
        if (payload?.error) {
          setStatus(`Translation failed for ${payload.key || payload.unit_id}: ${payload.error}`)
        } else if (payload?.text) {
          setStatus(`Translated ${payload.key || payload.unit_id}.`)
        }
        return next
      })
    })
    const offLog = rt.EventsOn('job.log', (payload: any) => {
      if (!payload?.message) return
      setStatus(`Job log: ${payload.message}`)
    })
    return () => {
      try { rt.EventsOff('job.started', 'job.progress', 'job.item.start', 'job.item.done', 'job.log') } catch (err) { console.error(err) }
      if (typeof offStarted === 'function') offStarted()
      if (typeof offProgress === 'function') offProgress()
      if (typeof offItemStart === 'function') offItemStart()
      if (typeof offItemDone === 'function') offItemDone()
      if (typeof offLog === 'function') offLog()
    }
  }, [wailsReady, targetLang, selectedFileId, memory])

  const entriesList = entries
  const filteredEntries = useMemo(() => {
    let list = entriesList
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(entry => {
        return (
          entry.key.toLowerCase().includes(q) ||
          entry.source.toLowerCase().includes(q) ||
          entry.draft.toLowerCase().includes(q) ||
          entry.translation.toLowerCase().includes(q)
        )
      })
    }
    if (onlyUntranslated) {
      list = list.filter(entry => {
        const current = (entry.draft || entry.translation || '').trim()
        return current === ''
      })
    }
    return list
  }, [entriesList, search, onlyUntranslated])


  const handleEntryChange = useCallback((entry: Entry, value: string) => {
    setEntries(prev => {
      const next = prev.map(item => (item.unitId === entry.unitId ? { ...item, draft: value } : item))
      setDirty(true)
      return next
    })
  }, [])


  const handleToggle = useCallback((entry: Entry, checked: boolean) => {
    setSelection(prev => {
      const next = new Set(prev)
      if (checked) next.add(entry.unitId)
      else next.delete(entry.unitId)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelection(new Set())
  }, [])

  const allFilteredSelected = useMemo(
    () => filteredEntries.length > 0 && filteredEntries.every(entry => selection.has(entry.unitId)),
    [filteredEntries, selection],
  )

  const handleToggleAll = useCallback(() => {
    setSelection(prev => {
      const next = new Set(prev)
      if (filteredEntries.length === 0) return next
      if (filteredEntries.every(entry => next.has(entry.unitId))) {
        filteredEntries.forEach(entry => next.delete(entry.unitId))
      } else {
        filteredEntries.forEach(entry => next.add(entry.unitId))
      }
      return next
    })
  }, [filteredEntries])

  const handleAiTranslate = useCallback(async () => {
    if (!(window as any)?.go?.app) {
      setStatus('Backend not available in web mode.')
      return
    }
    if (!selectedProjectId || !selectedFileId) {
      setStatus('Select a project and file before translating.')
      return
    }
    if (!providerSettings.providerId) {
      setStatus('Configure a provider in Settings first.')
      return
    }
    const locales = [targetLang].filter(Boolean)
    if (locales.length === 0) {
      setStatus('Select a target language first.')
      return
    }
    const selectedEntries = entries.filter(entry => selection.has(entry.unitId))
    const unitIds = selectedEntries.map(entry => entry.unitId)
    if (unitIds.length === 0) {
      setStatus('Select at least one row to translate.')
      return
    }
    try {
      // If user intentionally cleared drafts, clear stored translations first
      const toClear = entries.filter(e => selection.has(e.unitId) && (e.draft || '').trim() === '')
      for (const e of toClear) {
        try { await (TranslationsAPI as any).Upsert({ unit_id: e.unitId, locale: targetLang, text: '', status: 'draft' }) } catch {}
      }
      const res = await (JobsAPI as any).StartTranslateUnits({
        project_id: selectedProjectId,
        provider_id: providerSettings.providerId,
        unit_ids: unitIds,
        locales,
        model: providerSettings.model,
        force: true,
      })
      const jobId = res?.job_id ?? res?.JobID
      if (jobId) {
        setJobProgress({ jobId, done: 0, total: unitIds.length * locales.length, status: 'running', model: providerSettings.model })
        setStatus(`Queued re-translate for ${unitIds.length} item${unitIds.length === 1 ? '' : 's'} (force).`)
      } else {
        setStatus('No jobs started.')
      }
    } catch (error) {
      console.error(error)
      setStatus('Failed to start translation job.')
    }
  }, [entries, selection, selectedProjectId, selectedFileId, providerSettings, targetLang])

  const handleAiTranslateRow = useCallback(async (entry: Entry) => {
    if (!(window as any)?.go?.app) {
      setStatus('Backend not available in web mode.')
      return
    }
    if (!selectedProjectId || !selectedFileId) {
      setStatus('Select a project and file before translating.')
      return
    }
    if (!providerSettings.providerId) {
      setStatus('Configure a provider in Settings first.')
      return
    }
    const locales = [targetLang].filter(Boolean)
    if (locales.length === 0) {
      setStatus('Select a target language first.')
      return
    }
    try {
      if ((entry.draft || '').trim() === '') {
        try { await (TranslationsAPI as any).Upsert({ unit_id: entry.unitId, locale: targetLang, text: '', status: 'draft' }) } catch {}
      }
      setStatus(`Starting translation for ${entry.key}…`)
      const res = await (JobsAPI as any).StartTranslateUnit({
        project_id: selectedProjectId,
        provider_id: providerSettings.providerId,
        unit_id: entry.unitId,
        locales,
        model: providerSettings.model,
        force: true,
      })
      const jobId = res?.job_id ?? res?.JobID
      if (jobId) {
        setJobProgress({ jobId, done: 0, total: locales.length, status: 'running', model: providerSettings.model })
      }
      setStatus(`Queued translation for ${entry.key}.`)
    } catch (error) {
      console.error(error)
      setStatus('Failed to start translation job.')
    }
  }, [selectedProjectId, selectedFileId, providerSettings, targetLang])

  const handleSaveRow = useCallback(async (entry: Entry) => {
    if (!(window as any)?.go?.app) {
      setStatus('Backend not available in web mode.')
      return
    }
    if (!targetLang) {
      setStatus('Select a target language before saving.')
      return
    }
    try {
      await (TranslationsAPI as any).Upsert({ unit_id: entry.unitId, locale: targetLang, text: entry.draft, status: 'edited' })
      setEntries(prev => {
        const next = prev.map(it => (it.unitId === entry.unitId ? { ...it, translation: it.draft, status: 'edited' } : it))
        next.forEach(e => {
          if (e.translation.trim()) {
            memory.set(`${e.source}|${targetLang}`, e.translation)
          }
        })
        if (selectedFileId) {
          const translatedCount = next.filter(e => e.translation.trim() !== '').length
          setFileStats(fs => ({ ...fs, [selectedFileId]: { total: next.length, translated: translatedCount } }))
        }
        setDirty(next.some(e => e.draft !== e.translation))
        return next
      })
      setStatus(`Saved ${entry.key}.`)
    } catch (error) {
      console.error(error)
      setStatus('Failed to save entry.')
    }
  }, [memory, selectedFileId, targetLang])

  const handleSave = useCallback(async () => {
    if (!(window as any)?.go?.app) {
      setStatus('Backend not available in web mode.')
      return
    }
    if (!targetLang) {
      setStatus('Select a target language before saving.')
      return
    }
    const toSave = entries.filter(entry => entry.draft !== entry.translation)
    if (toSave.length === 0) {
      setStatus('Nothing to save.')
      return
    }
    try {
      for (const entry of toSave) {
        await (TranslationsAPI as any).Upsert({ unit_id: entry.unitId, locale: targetLang, text: entry.draft, status: 'edited' })
      }
      const nextEntries = entries.map(entry => (entry.draft !== entry.translation ? { ...entry, translation: entry.draft, status: 'edited' } : entry))
      nextEntries.forEach(entry => {
        if (entry.translation.trim()) {
          memory.set(`${entry.source}|${targetLang}`, entry.translation)
        }
      })
      setEntries(nextEntries)
      const translatedCount = nextEntries.filter(entry => entry.translation.trim() !== '').length
      if (selectedFileId) {
        setFileStats(prev => ({ ...prev, [selectedFileId]: { total: nextEntries.length, translated: translatedCount } }))
      }
      setDirty(nextEntries.some(entry => entry.draft !== entry.translation))
      setStatus(`Saved ${toSave.length} entr${toSave.length === 1 ? 'y' : 'ies'}.`)
    } catch (error: any) {
      console.error(error)
      setStatus(`Failed to save: ${String(error?.message || error)}`)
    }
  }, [entries, memory, selectedFileId, targetLang])

  const handleExportMemory = useCallback(() => {
    const json = JSON.stringify(memory.toJSON(), null, 2)
    download('translation-memory.json', json)
    setStatus('Exported translation memory JSON.')
  }, [memory])

  const handleImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text) as Record<string, string>
        setEntries(prev => {
          const next = prev.map(entry => (Object.prototype.hasOwnProperty.call(data, entry.key)
            ? { ...entry, draft: String(data[entry.key] ?? '') }
            : entry))
          setDirty(true)
          return next
        })
        setStatus('Imported translations into drafts. Review and click Save to persist.')
      } catch (error) {
        console.error(error)
        setStatus('Invalid JSON file.')
      } finally {
        event.target.value = ''
      }
    },
    [],
  )

  const totalEntries = entries.length
  const doneEntries = useMemo(
    () => entries.filter(entry => entry.translation.trim() !== '').length,
    [entries],
  )
  const shownEntries = filteredEntries.length

  const ROWS_STEP = 200
  const [visibleCount, setVisibleCount] = useState(ROWS_STEP)
  useEffect(() => {
    setVisibleCount(ROWS_STEP)
  }, [selectedFileId, targetLang, search, onlyUntranslated])
  const visibleEntries = useMemo(() => filteredEntries.slice(0, visibleCount), [filteredEntries, visibleCount])

  useKeyboardShortcuts(
    () => {
      if (searchInputRef.current) {
        searchInputRef.current.focus()
        searchInputRef.current.select()
      }
    },
    handleSave,
  )

  const handleSelectProject = useCallback((projectIdValue: string) => {
    const id = Number(projectIdValue)
    if (Number.isNaN(id)) return
    setSelectedProjectId(id)
    setSelection(new Set())
  }, [])

  const handleSelectFile = useCallback((fileIdValue: string) => {
    const id = Number(fileIdValue)
    if (Number.isNaN(id)) return
    setSelectedFileId(id)
    setSelection(new Set())
  }, [])

  const handleNewProject = useCallback(async ({ name, source, locales }: { name: string; source: string; locales: string[] }) => {
    if (!(window as any)?.go?.app) {
      setStatus('Backend not available in web mode.')
      return
    }
    try {
      const created = await (ProjectAPI as any).Create(name, source || 'en')
      const projectId = created?.id || created?.ID || null
      // Add target locales if provided
      if (projectId && Array.isArray(locales)) {
        const norm = (s: string) => (s || '').trim()
        const src = norm(source || 'en')
        const unique = Array.from(new Set(locales.map(norm).filter(l => l && l !== src)))
        for (const loc of unique) {
          try { await (ProjectAPI as any).AddLocale(projectId, loc) } catch (e) { console.error('AddLocale failed', loc, e) }
        }
      }
      setStatus('Project created.')
      await loadProjects()
      setNewProjectOpen(false)
    } catch (error: any) {
      console.error(error)
      setStatus(`Failed to create project: ${String(error?.message || error)}`)
    }
  }, [loadProjects])

  const selectProvider = useCallback((value: string) => {
    const id = Number(value)
    if (Number.isNaN(id)) {
      setProviderSettings({ providerId: null, providerType: '', baseUrl: '', model: '', apiKeyMasked: '' })
      return
    }
    const provider = providers.find(p => p.id === id)
    if (!provider) {
      setProviderSettings({ providerId: null, providerType: '', baseUrl: '', model: '', apiKeyMasked: '' })
      return
    }
    setProviderSettings({
      providerId: provider.id,
      providerType: provider.type || '',
      baseUrl: provider.base_url || '',
      model: provider.model || '',
      apiKeyMasked: provider.api_key || '',
    })
  }, [providers])

  const handleProviderModelChange = useCallback((value: string) => {
    setProviderSettings(prev => ({ ...prev, model: value }))
  }, [])


  const handleDownload = useCallback(async () => {
    if (!(window as any)?.go?.app) {
      setStatus('Backend not available in web mode.')
      return
    }
    if (!selectedFileId || !targetLang) {
      setStatus('Select a file and target language to export.')
      return
    }
    try {
      const res = await (ExportAPI as any).ExportFileBase64({
        file_id: selectedFileId,
        locale: targetLang,
        override_format: '',
        language_name: targetLang,
      })
      const filename = res?.filename || `${(selectedFile?.path?.split('/').pop() || 'translations')}.${targetLang}.json`
      downloadBase64(filename, res?.content_b64 || '', 'application/octet-stream')
      setStatus(`Downloaded ${filename}.`)
    } catch (error: any) {
      console.error(error)
      setStatus(`Export failed: ${String(error?.message || error)}`)
    }
  }, [selectedFileId, targetLang, selectedFile])

  const statusSection = (
    <div className="border-t border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between gap-3 flex-wrap dark:bg-slate-800">
      <div className="min-w-[40%]">
        Status: <span id="status">{status}</span>
        {jobProgress.jobId && (
          <span className="ml-2 text-muted-foreground">
            Job #{jobProgress.jobId}: {jobProgress.done}/{jobProgress.total} {jobProgress.status}
            {jobProgress.model ? ` · model ${jobProgress.model}` : ''}
          </span>
        )}
        {currentItem.key && (
          <span className="ml-2 text-muted-foreground">Current: {currentItem.key} [{currentItem.locale}]</span>
        )}
        {lastResult.key && (
          <span className="ml-2 text-muted-foreground">
            Last: {lastResult.key} [{lastResult.locale}] {lastResult.error ? '✖' : '✓'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-slate-500">Provider</label>
        <ProviderDropdown
          providers={providers as any}
          value={providerSettings.providerId}
          onChange={(id) => { selectProvider(String(id)); setSettingsProviderId(id) }}
          disabled={providers.length === 0}
        />
      </div>
    </div>
  )

  return (
    <div className="h-screen w-screen antialiased text-slate-900 bg-slate-50 dark:text-slate-100 dark:bg-slate-900 overflow-x-hidden">
      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onSubmit={handleNewProject}
      />
      <EditProjectModal
        open={!!editProject}
        project={editProject}
        onClose={() => setEditProject(null)}
        onSaved={async () => { await loadProjects() }}
      />
      <ImportFileModal
        open={importOpen}
        projectId={selectedProjectId}
        onClose={() => setImportOpen(false)}
        onImported={async (fileId: number) => {
          setStatus(`Imported file #${fileId}.`)
          await loadFiles(selectedProjectId!)
          setSelectedFileId(fileId)
          if (targetLang) {
            await loadEntries(fileId, targetLang)
          }
          setActiveTab('files')
        }}
      />
      <ExportModal
        open={exportOpen}
        fileId={selectedFileId}
        defaultLocale={targetLang}
        originalFormat={selectedFile?.format}
        originalPath={selectedFile?.path}
        onClose={() => setExportOpen(false)}
        onExported={(fname) => setStatus(`Exported ${fname}.`)}
      />
      <UpdateFileModal
        open={updateOpen}
        fileId={selectedFileId}
        filePath={selectedFile?.path}
        originalFormat={selectedFile?.format}
        onClose={() => setUpdateOpen(false)}
        onUpdated={async () => {
          setStatus('File updated.')
          if (selectedFileId && targetLang) await loadEntries(selectedFileId, targetLang)
        }}
      />
      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        onClose={() => setConfirmState(prev => ({ ...prev, open: false }))}
        onConfirm={async () => { if (confirmState.onConfirm) await confirmState.onConfirm() }}
      />
      <div id="app" className="h-full w-full flex">
        {sidebarCollapsed && (
          <button
            className="fixed top-2 left-2 z-50 p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow hover:bg-slate-50 dark:hover:bg-slate-700"
            title="Expand sidebar"
            aria-label="Expand sidebar"
            onClick={() => setSidebarCollapsed(false)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h11m0 0-4-4m4 4-4 4" />
            </svg>
          </button>
        )}
        <aside
          className={`w-80 max-w-xs bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col ${sidebarCollapsed ? 'hidden' : ''}`}
        >
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-indigo-600 text-white grid place-items-center font-bold">LT</div>
              <h1 className="text-sm font-semibold">LLM Translator</h1>
            </div>
            <button
              id="collapseSidebar"
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white/90 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              onClick={() => setSidebarCollapsed(prev => !prev)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H8m0 0 4 4m-4-4 4-4" />
              </svg>
            </button>
          </div>

          <div className="px-3 pt-3">
            <div role="tablist" aria-label="Sidebar tabs" className="grid grid-cols-4 gap-2">
              <button
                data-tab="projects"
                className={`tab-btn ${activeTab === 'projects' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('projects')}
              >
                Projects
              </button>
              <button
                data-tab="files"
                className={`tab-btn ${activeTab === 'files' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('files')}
              >
                Files
              </button>
              <button
                data-tab="scanner"
                className={`tab-btn ${activeTab === 'scanner' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('scanner')}
              >
                Scanner
              </button>
              <button
                data-tab="settings"
                className={`tab-btn ${activeTab === 'settings' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                Settings
              </button>
            </div>
          </div>

          <div className="p-3 grow overflow-auto">
            <section id="tab-projects" className={`tab-pane ${activeTab === 'projects' ? '' : 'hidden'}`}>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Projects</label>
                <button
                  id="newProjectBtn"
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-slate-200"
                  title="Create project"
                  aria-label="Create project"
                  onClick={() => setNewProjectOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <ul id="recentProjects" className="space-y-1 text-sm mt-2">
                {projects.map(p => (
                  <li key={p.id} className="relative group">
                    <button
                      className={`w-full text-left px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 pr-14 ${selectedProjectId === p.id ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                      onClick={() => handleSelectProject(String(p.id))}
                      title="Open project"
                    >
                      {p.name}
                    </button>
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="h-6 w-6 rounded-md bg-white/90 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center shadow-sm"
                        title="Edit project"
                        aria-label="Edit project"
                        onClick={(e) => { e.stopPropagation(); setEditProject(p) }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="h-6 w-6 rounded-md bg-white/90 dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-700 dark:text-red-400 flex items-center justify-center shadow-sm"
                        title="Delete project"
                        aria-label="Delete project"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmState({
                            open: true,
                            title: 'Delete Project',
                            message: `Delete project "${p.name}" and all related data?`,
                            confirmText: 'Delete',
                            onConfirm: async () => {
                              try {
                                await (ProjectAPI as any).Delete(p.id)
                                setStatus('Project deleted.')
                                if (selectedProjectId === p.id) { setSelectedProjectId(null); setFiles([]); setEntries([]) }
                                await loadProjects()
                              } catch (e) { console.error(e); setStatus('Failed to delete project.') }
                            },
                          })
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section id="tab-files" className={`tab-pane ${activeTab === 'files' ? '' : 'hidden'}`}>
              <div className="flex items-center gap-2">
                <button
                  id="refreshFiles"
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                  title="Refresh files"
                  aria-label="Refresh files"
                  onClick={() => { if (selectedProjectId != null) loadFiles(selectedProjectId) }}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                  title="Update file from new version"
                  aria-label="Update file"
                  onClick={() => setUpdateOpen(true)}
                  disabled={!selectedFileId}
                >
                  <FileDiff className="h-4 w-4" />
                </button>
                <button
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                  title="Import file"
                  aria-label="Import file"
                  onClick={() => setImportOpen(true)}
                >
                  <UploadCloud className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Files</label>
                <ul id="fileTree" className="text-sm space-y-1">
                  {files.map(file => {
                    const stats = fileStats[file.id]
                    const count = stats?.total ?? 0
                    const untranslated = stats ? stats.total - stats.translated : 0
                    const current = file.id === selectedFileId
                    return (
                      <li key={file.id} className="relative group">
                        <button
                          className={`w-full text-left px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 pr-12 ${current ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                          data-file={file.path}
                          onClick={() => handleSelectFile(String(file.id))}
                          title="Open file"
                        >
                          <span className="font-mono text-xs">{file.path}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {formatNumber(untranslated)}/{formatNumber(count)}
                          </span>
                        </button>
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="h-6 w-6 rounded-md bg-white/90 dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-700 dark:text-red-400 flex items-center justify-center shadow-sm"
                            title="Delete file"
                            aria-label="Delete file"
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmState({
                                open: true,
                                title: 'Delete File',
                                message: `Delete file "${file.path}" and its units?`,
                                confirmText: 'Delete',
                                onConfirm: async () => {
                                  try {
                                    const api: any = (FileAPI as any)
                                    if (typeof api.Delete !== 'function') { setStatus('Delete not available (rebuild required)'); return }
                                    await api.Delete(file.id)
                                    setStatus('File deleted.')
                                    await loadFiles(selectedProjectId!)
                                    if (selectedFileId === file.id) { setSelectedFileId(null); setEntries([]) }
                                  } catch (e) { console.error(e); setStatus('Failed to delete file.') }
                                },
                              })
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>

            <section id="tab-settings" className={`tab-pane ${activeTab === 'settings' ? '' : 'hidden'}`}>
              <div className="grid gap-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Settings</label>
                <ul className="space-y-1 text-sm">
                  <li>
                    <button
                      className={`w-full text-left px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 ${settingsProviderId === 'general' ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                      onClick={() => setSettingsProviderId('general')}
                      title="General settings"
                    >
                      General
                    </button>
                  </li>
                  <li className="mt-1 flex items-center justify-between">
                    <span className="block text-xs font-medium text-slate-600 dark:text-slate-300">Providers</span>
                    <button
                      className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs"
                      onClick={() => setSettingsProviderId('new')}
                      title="Add provider"
                    >
                      + Add
                    </button>
                  </li>
                  {providers.map(p => (
                    <li key={p.id}>
                      <button
                        className={`w-full text-left px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 ${settingsProviderId === p.id ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                        onClick={() => { setSettingsProviderId(p.id); selectProvider(String(p.id)) }}
                        title={`${p.name} (${p.type})`}
                      >
                        {p.name}
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{p.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          {statusSection}
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          {activeTab !== 'settings' && (
          <header className={`bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-3 ${sidebarCollapsed ? 'pl-12' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600 dark:text-slate-300">Source</label>
                <select id="srcLang" className="rounded-xl border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 text-sm" value={srcLang} onChange={() => {}}>
                  <option value={srcLang}>{srcLang}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600 dark:text-slate-300">Target</label>
                <select
                  id="tgtLang"
                  className="rounded-xl border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 text-sm"
                  value={targetLang}
                  onChange={event => {
                    setTargetLang(event.target.value)
                    clearSelection()
                  }}
                >
                  {availableLanguages
                    .filter(lang => lang !== srcLang)
                    .map(lang => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grow min-w-[200px] flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    id="search"
                    ref={searchInputRef}
                    placeholder="Search keys or text  ( / )"
                    className="w-full rounded-xl border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 pl-9 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                  />
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    id="onlyUntranslated"
                    type="checkbox"
                    className="rounded"
                    checked={onlyUntranslated}
                    onChange={event => setOnlyUntranslated(event.target.checked)}
                  />
                  Untranslated only
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="selectAll"
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm"
                  title="Select all rows"
                  onClick={handleToggleAll}
                >
                  {allFilteredSelected ? 'Unselect all' : 'Select all'}
                </button>
                <button
                  id="aiTranslateSelected"
                  className="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 text-sm"
                  title="AI translate selected"
                  onClick={handleAiTranslate}
                  disabled={selection.size === 0 || !providerSettings.providerId}
                >
                  AI Translate
                </button>
                <button
                  id="saveBtn"
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 text-sm"
                  title="Save (Ctrl/Cmd+S)"
                  onClick={handleSave}
                  disabled={entries.length === 0}
                >
                  Save
                </button>
                <button
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm"
                  onClick={() => setExportOpen(true)}
                  disabled={!selectedFileId}
                  title="Export"
                  aria-label="Export"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
              <div>
                File: <span id="currentFileLabel" className="font-medium">{selectedFile?.path || '—'}</span>
                <span className={`ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle ${dirty ? '' : 'hidden'}`} id="dirtyDot"></span>
              </div>
              <div id="counters">
                {formatNumber(doneEntries)}/{formatNumber(totalEntries)} translated · {formatNumber(shownEntries)} shown
              </div>
              <div className="ml-auto">
                Shortcuts: <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 border dark:border-slate-600">/</kbd> focus search ·{' '}
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 border dark:border-slate-600">Ctrl/Cmd+S</kbd> save
              </div>
            </div>
          </header>
          )}

          {activeTab === 'settings' ? (
            <section className="grow overflow-auto">
              <div className="max-w-4xl mx-auto w-full px-4 py-4 grid gap-6">
                {settingsProviderId === 'general' ? (
                  <GeneralSettings theme={themePref} onChangeTheme={handleChangeTheme} />
                ) : (
                <ProviderEditor
                  provider={settingsProviderId === 'new' ? null : providers.find(p => p.id === settingsProviderId) || null}
                  onCreate={async (data) => {
                    if (!(window as any)?.go?.app) { setStatus('Backend not available in web mode.'); return }
                    try {
                      const created = await (ProviderAPI as any).Create({ ...data })
                      setStatus('Provider created.')
                      await loadProviders()
                      if (created?.id) { setSettingsProviderId(created.id); selectProvider(String(created.id)) }
                    } catch (e) { console.error(e); setStatus('Failed to create provider.') }
                  }}
                  onUpdate={async (data) => {
                    if (!(window as any)?.go?.app) { setStatus('Backend not available in web mode.'); return }
                    try {
                      await (ProviderAPI as any).Update({ ...data })
                      setStatus('Provider updated.')
                      await loadProviders()
                    } catch (e) { console.error(e); setStatus('Failed to update provider.') }
                  }}
                  onDelete={async (id) => {
                    if (!(window as any)?.go?.app) { setStatus('Backend not available in web mode.'); return }
                    try {
                      await (ProviderAPI as any).Delete(id)
                      setStatus('Provider deleted.')
                      await loadProviders()
                    } catch (e) { console.error(e); setStatus('Failed to delete provider.') }
                  }}
                  onTest={async (id) => {
                    if (!(window as any)?.go?.app) { setStatus('Backend not available in web mode.'); return }
                    try {
                      const res = await (ProviderAPI as any).Test(id)
                      setStatus(res?.ok ? 'Provider test OK' : `Provider test failed: ${res?.error || 'unknown error'}`)
                    } catch (e: any) { console.error(e); setStatus(`Provider test failed: ${String(e?.message || e)}`) }
                  }}
                />)}
              </div>
            </section>
          ) : activeTab === 'scanner' ? (
            <section className="grow overflow-auto">
              <ScannerPanel />
            </section>
          ) : (
          <section id="tableWrap" className="grow overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 z-10">
                <tr className="text-left text-slate-500 dark:text-slate-300 select-none">
                  <th className="px-3 py-2 w-10"></th>
                  <th className="px-3 py-2 relative" style={{ width: colWidths.key }}>
                    Key
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      title="Resize key column"
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-slate-200 dark:hover:bg-slate-600"
                      onMouseDown={(e) => beginResize('key', e)}
                    />
                  </th>
                  <th className="px-3 py-2 relative" style={{ width: colWidths.source }}>
                    Source
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      title="Resize source column"
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-slate-200 dark:hover:bg-slate-600"
                      onMouseDown={(e) => beginResize('source', e)}
                    />
                  </th>
                  <th className="px-3 py-2 relative" style={{ width: colWidths.saved }}>
                    Saved
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      title="Resize saved column"
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-slate-200 dark:hover:bg-slate-600"
                      onMouseDown={(e) => beginResize('saved', e)}
                    />
                  </th>
                  <th className="px-3 py-2 relative" style={{ width: colWidths.translation }}>
                    Translation
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      title="Resize translation column"
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-slate-200 dark:hover:bg-slate-600"
                      onMouseDown={(e) => beginResize('translation', e)}
                    />
                  </th>
                  <th className="px-3 py-2 relative" style={{ width: colWidths.actions }}>
                    Actions
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      title="Resize actions column"
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-slate-200 dark:hover:bg-slate-600"
                      onMouseDown={(e) => beginResize('actions', e)}
                    />
                  </th>
                </tr>
              </thead>
              <tbody id="rows" className="divide-y divide-slate-200 dark:divide-slate-700">
                {visibleEntries.map(entry => (
                  <TranslationRow
                    key={entry.unitId}
                    entry={entry}
                    targetLang={targetLang}
                    checked={selection.has(entry.unitId)}
                    onToggle={checked => handleToggle(entry, checked)}
                    onChange={value => handleEntryChange(entry, value)}
                    onTranslate={() => handleAiTranslateRow(entry)}
                    onSave={() => handleSaveRow(entry)}
                    sourceWidth={colWidths.source}
                    translationWidth={colWidths.translation}
                    keyWidth={colWidths.key}
                    savedWidth={colWidths.saved}
                    actionsWidth={colWidths.actions}
                  />
                ))}
                {visibleEntries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No entries to show.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filteredEntries.length > visibleEntries.length && (
              <div className="py-3 flex items-center justify-center gap-2">
                <button
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm"
                  onClick={() => setVisibleCount(v => v + ROWS_STEP)}
                >
                  Load {Math.min(ROWS_STEP, filteredEntries.length - visibleEntries.length)} more
                </button>
                <button
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm"
                  onClick={() => setVisibleCount(filteredEntries.length)}
                >
                  Show all
                </button>
              </div>
            )}
          </section>
          )}

          <footer className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
            <div id="footerStatus">{status}</div>
            <div className="flex items-center gap-3 min-w-[220px] justify-end">
              {jobProgress.total > 0 && (
                <>
                  <div className="text-[11px] text-slate-500 whitespace-nowrap">
                    {jobProgress.done}/{jobProgress.total} · {jobProgress.status}
                  </div>
                  <div className="w-48">
                    <Progress value={jobProgress.done} max={jobProgress.total || 100} />
                  </div>
                </>
              )}
              {jobProgress.jobId && jobProgress.status && jobProgress.status !== 'done' && (
                <button
                  className="p-1 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                  onClick={handleCancelJob}
                  title="Stop job"
                  aria-label="Stop job"
                >
                  <CircleX className="h-4 w-4 text-red-600" />
                </button>
              )}
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App
