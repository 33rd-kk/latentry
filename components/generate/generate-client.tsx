"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeftRight, Dices, Download, FolderCheck, ImageUp, Loader2, RotateCcw, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImageLightbox, type LightboxItem } from "@/components/ui/image-lightbox"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BackendPicker } from "@/components/generate/backend-picker"
import { SetupNotice } from "@/components/setup-notice"
import { SourceImageSlot, toSourceImage, type SourceImage, type SourceMode } from "@/components/generate/source-image-slot"
import { TagExtractPanel } from "@/components/generate/tag-extract-panel"
import { CharacterPresets } from "@/components/generate/character-presets"
import { PoseSlot, type PoseSkeleton } from "@/components/generate/pose-slot"
import { useBackends } from "@/hooks/use-backends"
import { useEngineModels, type EngineModelOption } from "@/hooks/use-engine-models"
import { fetchPicture } from "@/hooks/use-gallery"
import { img2imgSteps } from "@/lib/diffusion/img2img"
import { isSecretMode } from "@/lib/secret-mode"
import { composePrompt, fitToImage, formatForProfile, getProfile, isProfileId, type Profile, type ProfileId } from "@/lib/profiles"
import {
  drainHandoff,
  preferences,
  STORAGE_EVENT_NAME,
  STORAGE_KEYS,
  type CharacterPreset,
  type HandoffItem,
  type HandoffSettings,
  type PromptScope,
} from "@/lib/storage"
import { CHARACTER_GROUPS, POSE_GROUPS } from "@/lib/tag-groups"
import { appendTags, prependTags } from "@/lib/tags"
import type { BackendStatus, Preset } from "@/lib/backends/types"
import { useT } from "@/lib/i18n"

// Never show the current-image bar as fully done from the step count alone —
// it snaps to 100% only when the "image" event for real completion arrives.
const MAX_STEP_PERCENT = 99
const DEFAULT = "Default"
// Shown once any preset-driven control is changed by hand, so the picker never
// claims settings that are not the ones in the boxes.
const CUSTOM_PRESET = "custom"

interface GeneratedImage {
  seed: number
  image_base64: string
  saved_name: string | null
}

/**
 * The part of the form that outlives the page, kept per backend: what the
 * user typed and the knobs they set, not results or progress. An Anima server
 * and an SDXL web UI want different sizes, steps and negatives, so switching
 * between them swaps forms instead of dragging one's settings into the other.
 * Secret mode makes the write a no-op (see lib/secret-mode.ts).
 */
interface FormState {
  profile: ProfileId
  artist: string
  prompt: string
  negativePrompt: string
  /** Put the profile's quality tags in front of the prompt. */
  quality: boolean
  width: number
  height: number
  seed: number
  imageCount: number
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  presetName: string
}

function defaultForm(profile: Profile): FormState {
  return {
    profile: profile.id,
    artist: "",
    prompt: "",
    negativePrompt: profile.defaults.negativePrompt,
    quality: Boolean(profile.qualityTags),
    width: profile.defaults.width,
    height: profile.defaults.height,
    seed: -1,
    imageCount: 1,
    sampler: DEFAULT,
    scheduler: DEFAULT,
    steps: profile.defaults.steps,
    cfg: profile.defaults.cfg,
    presetName: CUSTOM_PRESET,
  }
}

// A stored blob can predate the current shape of the form (or have been edited
// by hand), so every field is checked and falls back instead of being trusted.
function readStoredForm(backendId: string, fallbackProfile: ProfileId): FormState | null {
  const raw = preferences.getForm(backendId)
  if (!raw) return null
  const profile = getProfile(isProfileId(raw.profile) ? raw.profile : fallbackProfile)
  const base = defaultForm(profile)
  const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback)
  const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback)
  return {
    profile: profile.id,
    artist: text(raw.artist, base.artist),
    prompt: text(raw.prompt, base.prompt),
    negativePrompt: text(raw.negativePrompt, base.negativePrompt),
    quality: typeof raw.quality === "boolean" ? raw.quality : base.quality,
    width: number(raw.width, base.width),
    height: number(raw.height, base.height),
    seed: number(raw.seed, base.seed),
    imageCount: number(raw.imageCount, base.imageCount),
    sampler: text(raw.sampler, base.sampler),
    scheduler: text(raw.scheduler, base.scheduler),
    steps: number(raw.steps, base.steps),
    cfg: number(raw.cfg, base.cfg),
    presetName: text(raw.presetName, base.presetName),
  }
}

/** A form with the shared prompt over its own, when the prompt is shared. */
function withSharedPrompt(form: FormState): FormState {
  if (preferences.getPromptScope() !== "shared") return form
  const shared = preferences.getSharedPrompt()
  return shared ? { ...form, prompt: shared.prompt, artist: shared.artist } : form
}

function subscribePromptScope(listener: () => void) {
  const onChange = (event: Event) => {
    if ((event as CustomEvent).detail?.key === STORAGE_KEYS.PROMPT_SCOPE) listener()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEYS.PROMPT_SCOPE) listener()
  }
  window.addEventListener(STORAGE_EVENT_NAME, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(STORAGE_EVENT_NAME, onChange)
    window.removeEventListener("storage", onStorage)
  }
}

/** Whether the prompt is per backend or shared, read live. */
function usePromptScope(): PromptScope {
  return useSyncExternalStore(subscribePromptScope, preferences.getPromptScope, () => "backend")
}

/** `value` if the backend accepts it, else what it does accept first. */
function accepted(value: string, options: string[]): string {
  return options.length === 0 || options.includes(value) ? value : options[0]
}

// Progress and results live on the server (see lib/diffusion/job-store.ts), not
// in this component: POST .../generate starts a run and answers with its id,
// and this page watches it through an EventSource. That indirection is what
// makes a reload — or a tab the browser backgrounded and disconnected — pick
// the run back up instead of going blank while the GPU keeps working.
type JobStatus = "running" | "done" | "cancelled" | "error"

interface JobProgress {
  completed: number
  total: number
  currentStep: number
  stepsPerImage: number
}

export function GenerateClient() {
  const t = useT()
  const { backends, tagger, loaded, refresh: refreshBackends } = useBackends()

  // ── Which backend, and its form ──────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The form together with the backend it belongs to, so a switch can never
  // save one backend's settings under another's name.
  const [owned, setOwned] = useState<{ owner: string; form: FormState } | null>(null)
  const status: BackendStatus | null = backends.find((backend) => backend.id === selectedId) ?? null
  const form = owned?.form ?? null
  const profile = getProfile(form?.profile ?? status?.profile)

  const update = useCallback((patch: Partial<FormState>) => {
    setOwned((current) => (current ? { ...current, form: { ...current.form, ...patch } } : current))
  }, [])

  // Whether the loaded form came from storage, so the backend's default preset
  // does not overwrite the user's own last settings.
  const restoredRef = useRef(false)

  // Settle on a backend once the list is known: the remembered one, else the first.
  /* eslint-disable react-hooks/set-state-in-effect -- the list of backends arrives from
     the server after mount; choosing one from it is the synchronisation itself. */
  useEffect(() => {
    if (!loaded || backends.length === 0) return
    if (selectedId && backends.some((backend) => backend.id === selectedId)) return
    const remembered = preferences.getSelectedBackend()
    setSelectedId(backends.some((backend) => backend.id === remembered) ? remembered : backends[0].id)
  }, [loaded, backends, selectedId])

  // Load (or create) the selected backend's form.
  useEffect(() => {
    if (!selectedId || !status || owned?.owner === selectedId) return
    const stored = readStoredForm(selectedId, status.profile)
    restoredRef.current = stored !== null
    setOwned({ owner: selectedId, form: withSharedPrompt(stored ?? defaultForm(getProfile(status.profile))) })
  }, [selectedId, status, owned?.owner])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist on every change, debounced so typing does not hit localStorage on
  // each keystroke. A shared prompt is kept apart, and the backend's own
  // prompt stays as it was, for when the prompt goes back to per backend.
  const promptScope = usePromptScope()
  useEffect(() => {
    if (!owned) return
    const timer = setTimeout(() => {
      if (promptScope === "shared") {
        const own = preferences.getForm(owned.owner)
        preferences.setSharedPrompt({ prompt: owned.form.prompt, artist: owned.form.artist })
        preferences.setForm(owned.owner, {
          ...owned.form,
          prompt: typeof own?.prompt === "string" ? own.prompt : owned.form.prompt,
          artist: typeof own?.artist === "string" ? own.artist : owned.form.artist,
        })
      } else preferences.setForm(owned.owner, { ...owned.form })
    }, 300)
    return () => clearTimeout(timer)
  }, [owned, promptScope])

  const changePromptScope = useCallback(
    (scope: PromptScope) => {
      if (!owned) return
      if (scope === "shared") {
        // What is on the form now becomes the prompt every backend shares.
        preferences.setSharedPrompt({ prompt: owned.form.prompt, artist: owned.form.artist })
      } else {
        // Back to this backend's own prompt, as it was before sharing.
        const own = readStoredForm(owned.owner, owned.form.profile)
        if (own) update({ prompt: own.prompt, artist: own.artist })
      }
      preferences.setPromptScope(scope)
    },
    [owned, update]
  )

  const selectBackend = useCallback(
    (id: string) => {
      // The next form reads the shared prompt at once; the debounced save above
      // may not have run yet, and the last words typed would stay behind.
      if (owned && promptScope === "shared") preferences.setSharedPrompt({ prompt: owned.form.prompt, artist: owned.form.artist })
      setSelectedId(id)
      preferences.setSelectedBackend(id)
    },
    [owned, promptScope]
  )

  const changeProfile = useCallback(
    (id: ProfileId) => {
      // A profile switch reseeds what the profile decides and keeps the words.
      const next = getProfile(id)
      update({
        profile: next.id,
        width: next.defaults.width,
        height: next.defaults.height,
        steps: next.defaults.steps,
        cfg: next.defaults.cfg,
        negativePrompt: next.defaults.negativePrompt,
        quality: Boolean(next.qualityTags),
      })
    },
    [update]
  )

  // ── The engine's model, when the backend is Latentry's own engine ────────
  const engineModels = useEngineModels()
  const { load: loadEngineModel } = engineModels
  const isEngine = Boolean(selectedId && engineModels.engines.includes(selectedId))
  const chooseModel = useCallback(
    async (model: EngineModelOption) => {
      const error = await loadEngineModel(model.id)
      if (error) {
        toast.error(t("generate.modelLoadFailed", { error }))
        return
      }
      // The form follows the model's family, as it would on a fresh start.
      if (model.profile !== form?.profile) changeProfile(model.profile)
    },
    [loadEngineModel, form?.profile, changeProfile, t]
  )
  // The status line names the model; once a load ends it should name the new one.
  const engineLoading = Boolean(engineModels.loading)
  useEffect(() => {
    if (!engineLoading) refreshBackends()
  }, [engineLoading, refreshBackends])

  const resetForm = useCallback(() => {
    if (!owned) return
    preferences.clearForm(owned.owner)
    // A shared prompt belongs to every backend, so resetting one keeps it.
    setOwned({ owner: owned.owner, form: withSharedPrompt(defaultForm(getProfile(status?.profile))) })
  }, [owned, status?.profile])

  // ── img2img source, mask and pose ────────────────────────────────────────
  // Deliberately not part of the stored form: a data URL of a 2048px PNG would
  // eat most of localStorage's quota for one convenience.
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null)
  const [strength, setStrength] = useState(profile.defaultStrength)
  // Inpaint mask over sourceImage; null means redraw the whole image.
  const [mask, setMask] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<SourceMode>("variation")
  // Each mode has its own sensible strength, so switching puts the slider at
  // that mode's starting point instead of carrying a variation's 0.6 into a
  // pose reference (where it would mostly copy the reference).
  const changeSourceMode = useCallback(
    (mode: SourceMode) => {
      setSourceMode(mode)
      setStrength(mode === "pose" ? profile.defaultPoseStrength : profile.defaultStrength)
      setMask(null)
    },
    [profile]
  )
  // Bumped per source, to give the tag extractor a fresh start.
  const [sourceVersion, setSourceVersion] = useState(0)
  // A mask is drawn over one particular source, so a new source always drops it.
  const changeSource = useCallback((next: SourceImage | null) => {
    setSourceImage(next)
    setMask(null)
    setSourceVersion((version) => version + 1)
  }, [])
  // The tags the extractor last carried into the prompt — what "save character" offers to keep.
  const [lastExtractedTags, setLastExtractedTags] = useState("")
  const [poseSkeleton, setPoseSkeleton] = useState<PoseSkeleton | null>(null)
  const [poseStrength, setPoseStrength] = useState(1)

  const addExtractedTags = useCallback(
    (tags: string[]) => {
      setOwned((current) =>
        current ? { ...current, form: { ...current.form, prompt: prependTags(current.form.prompt, tags) } } : current
      )
      setLastExtractedTags(tags.join(", "))
    },
    []
  )

  const applyCharacter = useCallback((preset: CharacterPreset) => {
    setOwned((current) =>
      current
        ? {
            ...current,
            form: {
              ...current.form,
              prompt: prependTags(current.form.prompt, preset.tags.split(",")),
              artist: preset.artist,
              negativePrompt: preset.negativePrompt,
              seed: preset.seed,
            },
          }
        : current
    )
  }, [])

  // ── Presets served by the backend ────────────────────────────────────────
  const [presets, setPresets] = useState<{ owner: string; list: Preset[]; fallback: string | null } | null>(null)
  const presetList = presets && presets.owner === selectedId ? presets.list : []

  const applyPreset = useCallback(
    (name: string, available: Preset[]) => {
      if (name === CUSTOM_PRESET) {
        update({ presetName: CUSTOM_PRESET })
        return
      }
      const preset = available.find((candidate) => candidate.name === name)
      if (!preset) return
      update({
        presetName: preset.name,
        sampler: preset.sampler,
        scheduler: preset.scheduler,
        steps: preset.num_inference_steps,
      })
    },
    [update]
  )

  useEffect(() => {
    if (!selectedId || !status?.capabilities.presets || owned?.owner !== selectedId) return
    let active = true
    fetch(`/api/gen/${encodeURIComponent(selectedId)}/presets`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !Array.isArray(data?.presets)) return
        const list = data.presets as Preset[]
        setPresets({ owner: selectedId, list, fallback: typeof data.default === "string" ? data.default : null })
        // A restored form already carries the sampler/steps the user last chose.
        if (!restoredRef.current && typeof data.default === "string") applyPreset(data.default, list)
      })
      .catch(() => {
        // The page is fully usable without the picker.
      })
    return () => {
      active = false
    }
  }, [selectedId, status?.capabilities.presets, owned?.owner, applyPreset])

  // ── Watching the backend's run ───────────────────────────────────────────
  const [isCancelling, setIsCancelling] = useState(false)
  const [results, setResults] = useState<GeneratedImage[]>([])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  // Separate from jobError: the run succeeded, saving it to the gallery did not.
  const [saveWarning, setSaveWarning] = useState<string | null>(null)
  const isGenerating = jobStatus === "running"

  const previewItems = useMemo<LightboxItem[]>(
    () =>
      results.map((image) => ({
        src: `data:image/png;base64,${image.image_base64}`,
        name: `seed: ${image.seed}`,
        downloadName: image.saved_name ?? `latentry_${image.seed}.png`,
      })),
    [results]
  )

  const currentImagePercent =
    progress && progress.currentStep > 0
      ? Math.min(MAX_STEP_PERCENT, (progress.currentStep / Math.max(1, progress.stepsPerImage)) * 100)
      : null
  // The images already done, plus how far into the one in flight — a bar that
  // only counted finished images would sit at 0% for a one-image run.
  const overallPercent = progress
    ? Math.min(100, ((progress.completed + (currentImagePercent ?? 0) / 100) / Math.max(1, progress.total)) * 100)
    : 0

  // Refs rather than state: the handlers below must see the current values
  // without being rebuilt, which would drop the stream they are reading.
  const sourceRef = useRef<EventSource | null>(null)
  const watchedIdRef = useRef<string | null>(null)
  const statusRef = useRef<JobStatus | null>(null)
  const backendRef = useRef<string | null>(null)
  // refresh() and attach() need each other, so one goes through a ref.
  const refreshRef = useRef<() => void>(() => {})

  const applyStatus = useCallback((next: JobStatus | null) => {
    statusRef.current = next
    setJobStatus(next)
    if (next !== "running") setIsCancelling(false)
  }, [])

  const closeSource = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  /**
   * Subscribes to a run: the stream opens with a full snapshot (progress and
   * every image so far) and then sends only what is new, so this is both
   * "start watching" and "resume watching after a reload".
   */
  const attach = useCallback(
    (backend: string, id: string) => {
      closeSource()
      watchedIdRef.current = id
      const source = new EventSource(`/api/gen/${encodeURIComponent(backend)}/job/stream?id=${encodeURIComponent(id)}`)
      sourceRef.current = source
      const mine = () => sourceRef.current === source && backendRef.current === backend

      source.addEventListener("snapshot", (event) => {
        if (!mine()) return
        const job = JSON.parse((event as MessageEvent).data)
        setProgress({ completed: job.completed, total: job.total, currentStep: job.currentStep, stepsPerImage: job.stepsPerImage })
        setResults(job.images ?? [])
        setJobError(job.error ?? null)
        setSaveWarning(job.saveError ?? null)
        applyStatus(job.status)
      })
      source.addEventListener("progress", (event) => {
        if (!mine()) return
        const { savedNames, ...numbers } = JSON.parse((event as MessageEvent).data)
        setProgress(numbers)
        if (Array.isArray(savedNames)) {
          setResults((previous) =>
            previous.map((image, index) =>
              savedNames[index] !== undefined && savedNames[index] !== image.saved_name
                ? { ...image, saved_name: savedNames[index] }
                : image
            )
          )
        }
      })
      source.addEventListener("image", (event) => {
        if (!mine()) return
        const image = JSON.parse((event as MessageEvent).data)
        // Placed by index so a reconnect that replays an image cannot duplicate it.
        setResults((previous) => {
          const next = previous.slice()
          next[image.index] = { seed: image.seed, image_base64: image.image_base64, saved_name: image.saved_name ?? null }
          return next
        })
      })
      source.addEventListener("end", (event) => {
        const { status: ended, error, saveError } = JSON.parse((event as MessageEvent).data)
        source.close()
        if (sourceRef.current === source) sourceRef.current = null
        if (backendRef.current !== backend) return

        // "gone": a newer run replaced this one (started from another tab), or
        // the server restarted and forgot it. Either way, ask what is current.
        if (ended === "gone") {
          watchedIdRef.current = null
          refreshRef.current()
          return
        }
        const wasRunning = statusRef.current === "running"
        // The backend is free again; say so now rather than at the next poll.
        refreshBackends()
        setJobError(error ?? null)
        setSaveWarning(saveError ?? null)
        setProgress((previous) => (previous ? { ...previous, currentStep: 0 } : previous))
        applyStatus(ended)
        // Only announce an ending this page watched happen.
        if (!wasRunning) return
        if (ended === "cancelled") toast(t("generate.cancelled"))
        else if (ended === "error") toast.error(t("generate.failed"), { description: error ? t.server(error) : t("generate.serverError") })
      })
      // No onerror handler: EventSource reconnects by itself, and the reconnect
      // re-sends the snapshot.
    },
    [applyStatus, closeSource, refreshBackends, t]
  )

  /** Asks the backend's job store what it is doing and attaches if that is not already on screen. */
  const refresh = useCallback(async () => {
    const backend = backendRef.current
    if (!backend) return
    try {
      const response = await fetch(`/api/gen/${encodeURIComponent(backend)}/job`, { cache: "no-store" })
      if (!response.ok || backendRef.current !== backend) return
      const job = (await response.json())?.job
      if (!job) {
        if (statusRef.current === "running") {
          closeSource()
          watchedIdRef.current = null
          setProgress(null)
          applyStatus(null)
        }
        return
      }
      const inSync = job.id === watchedIdRef.current && statusRef.current === job.status
      if (inSync && (sourceRef.current !== null || job.status !== "running")) return
      attach(backend, job.id)
    } catch {
      // Offline or down; the next visibility change tries again.
    }
  }, [applyStatus, attach, closeSource])

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  // Switching backend shows that backend's run (if any) and nothing else.
  /* eslint-disable react-hooks/set-state-in-effect -- clearing the previous backend's
     results is part of switching to another; refresh() then asks the server. */
  useEffect(() => {
    backendRef.current = selectedId
    closeSource()
    watchedIdRef.current = null
    setResults([])
    setProgress(null)
    setJobError(null)
    setSaveWarning(null)
    applyStatus(null)
    if (selectedId) void refresh()
  }, [selectedId, applyStatus, closeSource, refresh])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Again whenever the page comes back into view: a background tab can have its
  // stream cut without warning, and bfcache restores one whose socket is gone.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "visible") void refreshRef.current()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recheck()
    }
    document.addEventListener("visibilitychange", recheck)
    window.addEventListener("pageshow", onPageShow)
    window.addEventListener("online", recheck)
    return () => {
      document.removeEventListener("visibilitychange", recheck)
      window.removeEventListener("pageshow", onPageShow)
      window.removeEventListener("online", recheck)
    }
  }, [])

  useEffect(() => closeSource, [closeSource])

  // ── What the gallery sent over ───────────────────────────────────────────
  const applyHandoff = useCallback(
    (items: HandoffItem[]) => {
      for (const item of items) {
        if (item.type === "tag" || item.type === "tags") {
          const tags = item.type === "tag" ? [item.tag] : item.tags
          setOwned((current) => {
            if (!current) return current
            const key = item.target === "positive" ? "prompt" : "negativePrompt"
            // In the spelling of the model they are going to.
            const spelled = tags.map((tag) => formatForProfile(tag, getProfile(current.form.profile)))
            return { ...current, form: { ...current.form, [key]: appendTags(current.form[key], spelled) } }
          })
        } else if (item.type === "settings") {
          // Into the backend chosen here, not the one the picture came from:
          // reusing a prompt on another backend is the point.
          const sameBackend = item.settings.backend === backendRef.current
          setOwned((current) =>
            current ? { ...current, form: applySettings(current.form, item.settings, sameBackend) } : current
          )
        } else if (item.type === "source") {
          fetchPicture(item.url)
            .then(toSourceImage)
            .then((picture) => {
              changeSource(picture)
              changeSourceMode(item.as)
            })
            .catch(() => toast.error(t("generate.sourceLoadFailed")))
        }
      }
    },
    [changeSource, changeSourceMode, t]
  )

  const ready = owned !== null && owned.owner === selectedId
  /* eslint-disable react-hooks/set-state-in-effect -- the queue lives in localStorage,
     written by the gallery (often in another tab); draining it into the form once the
     form exists is exactly the synchronisation with an external store this is for. */
  useEffect(() => {
    if (!ready) return
    applyHandoff(drainHandoff())
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.HANDOFF && event.newValue) applyHandoff(drainHandoff())
    }
    const onSameTab = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.key === STORAGE_KEYS.HANDOFF && detail.value) applyHandoff(drainHandoff())
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(STORAGE_EVENT_NAME, onSameTab)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(STORAGE_EVENT_NAME, onSameTab)
    }
  }, [ready, applyHandoff])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Generate and cancel ──────────────────────────────────────────────────
  const capabilities = status?.capabilities
  const sampler = form ? accepted(form.sampler, status?.samplers ?? []) : DEFAULT
  const scheduler = form ? accepted(form.scheduler, status?.schedulers ?? []) : DEFAULT

  const handleGenerate = useCallback(async () => {
    if (!form || !selectedId) return
    if (!form.prompt.trim()) {
      toast.error(t("generate.promptRequired"), { description: t("generate.promptRequiredBody") })
      return
    }
    const useSource = Boolean(sourceImage && capabilities?.img2img)
    // Optimistic, so the bars appear on click; the first snapshot replaces it.
    setResults([])
    setJobError(null)
    setSaveWarning(null)
    setProgress({
      completed: 0,
      total: form.imageCount,
      currentStep: 0,
      stepsPerImage: useSource ? img2imgSteps(form.steps, strength, profile.id) : form.steps,
    })
    applyStatus("running")

    try {
      const response = await fetch(`/api/gen/${encodeURIComponent(selectedId)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: composePrompt(form.prompt, { profile, artist: form.artist, quality: form.quality }),
          negative_prompt: formatForProfile(form.negativePrompt, profile),
          width: form.width,
          height: form.height,
          seed: form.seed,
          image_count: form.imageCount,
          sampler,
          scheduler,
          num_inference_steps: form.steps,
          guidance_scale: form.cfg,
          profile: form.profile,
          // Secret mode: the server keeps this run to this page only.
          secret: isSecretMode(),
          ...(useSource && sourceImage ? { init_image_base64: sourceImage.dataUrl, strength } : {}),
          ...(useSource && mask && capabilities?.inpaint ? { mask_base64: mask } : {}),
          ...(capabilities?.pose && poseSkeleton
            ? { pose_image_base64: poseSkeleton.dataUrl, pose_is_skeleton: true, pose_strength: poseStrength }
            : {}),
        }),
      })
      const data = await response.json().catch(() => null)

      // 409 with a job: this backend is already busy with a run this page had
      // lost track of. Watch that one instead of reporting a failure.
      if (response.status === 409 && data?.job?.id) {
        attach(selectedId, data.job.id)
        toast(t("generate.alreadyGenerating"), { description: t("generate.alreadyGeneratingBody") })
        return
      }
      // 409 without one: something else is using the backend (another app, or
      // its own UI). There is nothing here to reattach to.
      if (response.status === 409) {
        setProgress(null)
        applyStatus(null)
        toast.error(t("generate.gpuBusy"), { description: data?.error ? t.server(data.error) : t("generate.gpuBusyBody") })
        return
      }
      if (!response.ok || !data?.job?.id) {
        throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
      }
      attach(selectedId, data.job.id)
    } catch (error) {
      setProgress(null)
      applyStatus(null)
      toast.error(t("generate.failed"), { description: error instanceof Error ? error.message : t("generate.unreachable") })
    }
  }, [form, selectedId, sourceImage, capabilities, strength, mask, poseSkeleton, poseStrength, profile, sampler, scheduler, applyStatus, attach, t])

  const handleCancel = useCallback(async () => {
    if (!selectedId) return
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/gen/${encodeURIComponent(selectedId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
      }
      // The flags clear when the stream reports the end — the backend stops at
      // its next step, not instantly.
    } catch (error) {
      setIsCancelling(false)
      toast.error(t("generate.cancelFailed"), { description: error instanceof Error ? error.message : t("generate.unreachable") })
    }
  }, [selectedId, t])

  // ── Render ───────────────────────────────────────────────────────────────
  if (loaded && backends.length === 0) return <SetupNotice />

  if (!form || !status) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("app.loading")}
      </div>
    )
  }

  const selectedPreset = presetList.find((preset) => preset.name === form.presetName) ?? null
  const outputSize = sourceImage ? fitToImage(sourceImage, form.width, form.height, profile.sizeMultiple) : { width: form.width, height: form.height }

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
        <Card>
          <CardHeader className="space-y-3">
            <BackendPicker
              backends={backends}
              selected={status}
              onSelect={selectBackend}
              profile={form.profile}
              onProfileChange={changeProfile}
              disabled={isGenerating}
              engineModels={
                isEngine && engineModels.models
                  ? {
                      models: engineModels.models,
                      current: engineModels.current,
                      loading: engineModels.loading,
                      loadError: engineModels.loadError,
                      onLoad: (model) => void chooseModel(model),
                    }
                  : undefined
              }
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <CharacterPresets
              suggestedTags={lastExtractedTags}
              artist={form.artist}
              negativePrompt={form.negativePrompt}
              seed={form.seed}
              onApply={applyCharacter}
              disabled={isGenerating}
            />
            {profile.artistTemplate && (
              <div className="space-y-1.5">
                <Label htmlFor="artist">{t("generate.artist")}</Label>
                <Input
                  id="artist"
                  placeholder={t("generate.artistPlaceholder", { example: profile.artistTemplate.replace("{artist}", "name") })}
                  value={form.artist}
                  onChange={(event) => update({ artist: event.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="prompt">{t("generate.positivePrompt")}</Label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground" title={t("generate.sharedPromptHint")}>
                    <Switch
                      checked={promptScope === "shared"}
                      onCheckedChange={(shared) => changePromptScope(shared ? "shared" : "backend")}
                    />
                    {t("generate.sharedPrompt")}
                  </label>
                  {profile.qualityTags && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground" title={profile.qualityTags}>
                      <Switch checked={form.quality} onCheckedChange={(quality) => update({ quality })} />
                      {t("generate.qualityTags")}
                    </label>
                  )}
                </div>
              </div>
              <Textarea
                id="prompt"
                rows={6}
                placeholder={t("generate.positivePlaceholder")}
                value={form.prompt}
                onChange={(event) => update({ prompt: event.target.value })}
              />
              {form.quality && profile.qualityTags && (
                <p className="text-xs text-muted-foreground">{t("generate.qualityTagsHint", { tags: profile.qualityTags })}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="negative-prompt">{t("generate.negativePrompt")}</Label>
              <Textarea
                id="negative-prompt"
                rows={3}
                value={form.negativePrompt}
                onChange={(event) => update({ negativePrompt: event.target.value })}
              />
            </div>

            {capabilities?.img2img && (
              <SourceImageSlot
                value={sourceImage}
                onChange={changeSource}
                strength={strength}
                onStrengthChange={setStrength}
                mask={mask}
                onMaskChange={setMask}
                mode={sourceMode}
                onModeChange={changeSourceMode}
                canInpaint={capabilities.inpaint}
                disabled={isGenerating}
              />
            )}
            {sourceImage && capabilities?.img2img && tagger && (
              <TagExtractPanel
                key={sourceVersion}
                source={sourceImage}
                onAdd={addExtractedTags}
                defaultGroups={sourceMode === "pose" ? POSE_GROUPS : CHARACTER_GROUPS}
                hint={t(sourceMode === "pose" ? "generate.tagsHintPose" : "generate.tagsHint")}
                disabled={isGenerating}
              />
            )}
            {capabilities?.pose && (
              <PoseSlot
                backend={status.id}
                value={poseSkeleton}
                onChange={setPoseSkeleton}
                strength={poseStrength}
                onStrengthChange={setPoseStrength}
                outputSize={outputSize}
                source={sourceImage}
                disabled={isGenerating}
              />
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {profile.resolutions.map(([w, h]) => (
                  <Button
                    key={`${w}x${h}`}
                    type="button"
                    size="sm"
                    variant={form.width === w && form.height === h ? "secondary" : "ghost"}
                    className="h-6 px-1.5 font-mono text-[11px]"
                    onClick={() => update({ width: w, height: h })}
                    disabled={isGenerating}
                  >
                    {w}×{h}
                  </Button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label>{t("generate.width", { value: form.width })}</Label>
                  <Slider min={256} max={2048} step={64} value={[form.width]} onValueChange={([value]) => update({ width: value })} />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => update({ width: form.height, height: form.width })}
                      aria-label={t("generate.swapDimensions")}
                      className="shrink-0"
                    >
                      <ArrowLeftRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("generate.swapDimensions")}</TooltipContent>
                </Tooltip>
                <div className="flex-1 space-y-1.5">
                  <Label>{t("generate.height", { value: form.height })}</Label>
                  <Slider min={256} max={2048} step={64} value={[form.height]} onValueChange={([value]) => update({ height: value })} />
                </div>
              </div>
              {(form.width % profile.sizeMultiple !== 0 || form.height % profile.sizeMultiple !== 0) && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {t("generate.sizeMultiple", { multiple: profile.sizeMultiple })}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="seed">{t("generate.seed")}</Label>
                <div className="flex gap-2">
                  <SeedInput value={form.seed} onChange={(seed) => update({ seed })} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => update({ seed: -1 })}
                        disabled={form.seed === -1}
                        aria-label={t("generate.randomSeed")}
                        className="shrink-0"
                      >
                        <Dices className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("generate.randomSeed")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="space-y-1.5">
                {/* With a source, only the tail of the schedule runs; the label says
                    so, or it would disagree with the progress bar's count. */}
                <Label>
                  {sourceImage && capabilities?.img2img
                    ? t("generate.stepsI2i", { value: form.steps, actual: img2imgSteps(form.steps, strength, profile.id) })
                    : t("generate.steps", { value: form.steps })}
                </Label>
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[form.steps]}
                  onValueChange={([value]) => update({ steps: value, presetName: CUSTOM_PRESET })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("generate.imageCount", { value: form.imageCount })}</Label>
              <Slider min={1} max={16} step={1} value={[form.imageCount]} onValueChange={([value]) => update({ imageCount: value })} />
            </div>

            {presetList.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("generate.speedPreset")}</Label>
                <Select value={form.presetName} onValueChange={(name) => applyPreset(name, presetList)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {presetList.map((preset) => (
                      <SelectItem key={preset.name} value={preset.name}>
                        {preset.label} — ~{Math.round(preset.approx_seconds)}s
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_PRESET}>{t("generate.custom")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{selectedPreset ? selectedPreset.description : t("generate.customHint")}</p>
              </div>
            )}

            {(status.samplers.length > 0 || status.schedulers.length > 0) && (
              <div className="grid grid-cols-2 gap-4">
                {status.samplers.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>{t("generate.sampler")}</Label>
                    <Select value={sampler} onValueChange={(value) => update({ sampler: value, presetName: CUSTOM_PRESET })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {status.samplers.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === DEFAULT ? t("generate.backendDefault") : option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {status.schedulers.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>{t("generate.scheduler")}</Label>
                    <Select value={scheduler} onValueChange={(value) => update({ scheduler: value, presetName: CUSTOM_PRESET })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {status.schedulers.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === DEFAULT ? t("generate.backendDefault") : option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t("generate.guidanceScale", { value: form.cfg.toFixed(1) })}</Label>
              <Slider min={1} max={15} step={0.1} value={[form.cfg]} onValueChange={([value]) => update({ cfg: value })} />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleGenerate} disabled={isGenerating || !status.alive || (isEngine && engineLoading)} className="flex-1">
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("generate.generating")}
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-4 w-4" />
                    {t("generate.generateButton")}
                  </>
                )}
              </Button>
              {isGenerating && (
                <Button onClick={handleCancel} disabled={isCancelling} variant="destructive">
                  {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : t("generate.cancel")}
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" onClick={resetForm} disabled={isGenerating} aria-label={t("generate.reset")}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("generate.reset")}</TooltipContent>
              </Tooltip>
            </div>
            {!status.alive && <p className="text-xs text-destructive">{t("generate.backendOffline", { backend: status.id })}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("generate.results")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isGenerating && progress && (
              <div className="mb-4 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("generate.overall")}</span>
                    <span>
                      {progress.completed} / {progress.total}
                    </span>
                  </div>
                  <Progress value={overallPercent} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("generate.currentImage")}</span>
                    <span>
                      {progress.currentStep > 0
                        ? t("generate.stepProgress", { current: progress.currentStep, total: progress.stepsPerImage })
                        : t("generate.starting")}
                    </span>
                  </div>
                  <Progress value={currentImagePercent ?? 0} indeterminate={currentImagePercent === null} />
                </div>
              </div>
            )}

            {/* Survives a reload along with the images, so a run that failed
                while the page was closed still says why. */}
            {jobError && !isGenerating && <p className="mb-4 text-sm text-destructive">{t.server(jobError)}</p>}
            {/* Not destructive: the images are right there and the run was fine. */}
            {saveWarning && !isGenerating && (
              <p className="mb-4 text-sm text-amber-600 dark:text-amber-500">{t.server(saveWarning)}</p>
            )}
            {jobStatus === "cancelled" && !jobError && <p className="mb-4 text-sm text-muted-foreground">{t("generate.runCancelled")}</p>}

            {results.length === 0 ? (
              !isGenerating && !jobError && <p className="text-sm text-muted-foreground">{t("generate.noImages")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {results.map((image, index) =>
                  image ? (
                    <div key={`${image.seed}-${index}`} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setPreviewIndex(index)}
                        title={t("generate.fullScreen")}
                        className="block w-full cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <img
                          src={`data:image/png;base64,${image.image_base64}`}
                          alt={t("generate.imageAlt", { seed: image.seed })}
                          className="w-full rounded-md border border-border/50 bg-muted/50 object-contain"
                        />
                      </button>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>seed: {image.seed}</span>
                        {image.saved_name && (
                          <Link href="/gallery" className="inline-flex items-center gap-1 hover:text-foreground" title={image.saved_name}>
                            <FolderCheck className="h-3 w-3" />
                            {t("generate.saved")}
                          </Link>
                        )}
                        {capabilities?.img2img && (
                          <button
                            type="button"
                            onClick={() => {
                              const probe = new window.Image()
                              probe.onload = () => changeSource({ dataUrl: probe.src, width: probe.naturalWidth, height: probe.naturalHeight })
                              probe.src = `data:image/png;base64,${image.image_base64}`
                            }}
                            disabled={isGenerating}
                            className="ml-auto inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                          >
                            <ImageUp className="h-3 w-3" />
                            {t("generate.useAsSource")}
                          </button>
                        )}
                        <a
                          href={`data:image/png;base64,${image.image_base64}`}
                          download={image.saved_name ?? `latentry_${image.seed}.png`}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          <Download className="h-3 w-3" />
                          {t("generate.save")}
                        </a>
                      </div>
                    </div>
                  ) : null
                )}
              </div>
            )}
            <ImageLightbox
              items={previewItems}
              index={previewIndex}
              onIndexChange={setPreviewIndex}
              onClose={() => setPreviewIndex(null)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/**
 * Keeps the typed text apart from the number: "" and "-" are steps on the way
 * to "-1", and turning them into 0 on every keystroke made -1 unreachable.
 */
function SeedInput({ value, onChange }: { value: number; onChange: (seed: number) => void }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)

  // A preset or handoff can change the seed from outside; show it unless the
  // text already means the same number. Adjusted while rendering, as React
  // recommends for state that follows a prop, rather than in an effect.
  if (shown !== value) {
    setShown(value)
    if (!(Number(text) === value && text.trim() !== "")) setText(String(value))
  }

  return (
    <Input
      id="seed"
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(event) => {
        const next = event.target.value
        if (!/^-?\d*$/.test(next)) return
        setText(next)
        if (/^-?\d+$/.test(next)) onChange(Number(next))
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

/** A gallery picture's settings over a form: what it says replaces, what it does not say stays. */
function applySettings(form: FormState, settings: HandoffSettings, sameBackend: boolean): FormState {
  // The words are respelled for the model they are going to: the profile the
  // picture brings along when it comes with its settings, the form's otherwise.
  const profile = getProfile(sameBackend && isProfileId(settings.profile) ? settings.profile : form.profile)
  const words = {
    prompt: formatForProfile(settings.prompt, profile),
    // The prompt as saved already carries its artist and quality tags.
    artist: "",
    quality: false,
    ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
  }
  // From another backend only the words and the seed carry over: its size,
  // steps, CFG and sampler were tuned for a different model.
  if (!sameBackend) return { ...form, ...words }
  return {
    ...form,
    ...words,
    ...(settings.profile && isProfileId(settings.profile) ? { profile: settings.profile } : {}),
    negativePrompt: formatForProfile(settings.negativePrompt, profile),
    ...(settings.width ? { width: settings.width } : {}),
    ...(settings.height ? { height: settings.height } : {}),
    ...(settings.steps ? { steps: settings.steps } : {}),
    ...(settings.cfg !== undefined ? { cfg: settings.cfg } : {}),
    ...(settings.sampler ? { sampler: settings.sampler } : {}),
    ...(settings.scheduler ? { scheduler: settings.scheduler } : {}),
    presetName: CUSTOM_PRESET,
  }
}
