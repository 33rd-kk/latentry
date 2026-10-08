"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react"
import { getProfile, type Profile, type ProfileId } from "@/lib/profiles"
import { preferences, STORAGE_EVENT_NAME, STORAGE_KEYS, type PromptScope } from "@/lib/storage"
import { CUSTOM_PRESET, defaultForm, readStoredForm, withSharedPrompt, type FormState } from "@/lib/generate/form"
import type { BackendStatus, Preset } from "@/lib/backends/types"

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

export interface GenerateForm {
  selectedId: string | null
  status: BackendStatus | null
  form: FormState | null
  profile: Profile
  /** The selected backend's form is loaded and its own. */
  ready: boolean
  /** Whether the loaded form came from storage, so the backend's default preset does not overwrite it. */
  restoredRef: MutableRefObject<boolean>
  update: (patch: Partial<FormState>) => void
  /** Changes the form from its current value (for edits that build on what is there). */
  editForm: (change: (form: FormState) => FormState) => void
  promptScope: PromptScope
  changePromptScope: (scope: PromptScope) => void
  selectBackend: (id: string) => void
  changeProfile: (id: ProfileId) => void
  resetForm: () => void
}

/**
 * Which backend is chosen, and its form: loaded from storage (or the
 * profile's defaults), saved back as it changes, and the prompt shared across
 * backends when the user says so.
 */
export function useGenerateForm(backends: BackendStatus[], loaded: boolean): GenerateForm {
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

  const editForm = useCallback((change: (form: FormState) => FormState) => {
    setOwned((current) => (current ? { ...current, form: change(current.form) } : current))
  }, [])

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

  const resetForm = useCallback(() => {
    if (!owned) return
    preferences.clearForm(owned.owner)
    // A shared prompt belongs to every backend, so resetting one keeps it.
    setOwned({ owner: owned.owner, form: withSharedPrompt(defaultForm(getProfile(status?.profile))) })
  }, [owned, status?.profile])

  const ready = owned !== null && owned.owner === selectedId

  return {
    selectedId,
    status,
    form,
    profile,
    ready,
    restoredRef,
    update,
    editForm,
    promptScope,
    changePromptScope,
    selectBackend,
    changeProfile,
    resetForm,
  }
}

/**
 * The speed presets a backend serves, for its selected form. A form that came
 * from storage keeps the sampler and steps the user last chose; a fresh one
 * starts on the backend's default preset.
 */
export function useBackendPresets(
  { selectedId, status, ready, restoredRef, update }: Pick<GenerateForm, "selectedId" | "status" | "ready" | "restoredRef" | "update">
): { presetList: Preset[]; applyPreset: (name: string, available: Preset[]) => void } {
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
    if (!selectedId || !status?.capabilities.presets || !ready) return
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
  }, [selectedId, status?.capabilities.presets, ready, restoredRef, applyPreset])

  return { presetList, applyPreset }
}
