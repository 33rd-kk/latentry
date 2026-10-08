"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, RotateCcw, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BackendPicker } from "@/components/generate/backend-picker"
import { SetupNotice } from "@/components/setup-notice"
import { SourceImageSlot, type SourceImage, type SourceMode } from "@/components/generate/source-image-slot"
import { TagExtractPanel } from "@/components/generate/tag-extract-panel"
import { CharacterPresets } from "@/components/generate/character-presets"
import { PoseSlot, type PoseSkeleton } from "@/components/generate/pose-slot"
import { UnavailableFeatures } from "@/components/generate/unavailable-features"
import { PromptSection } from "@/components/generate/prompt-section"
import { SettingsSection } from "@/components/generate/settings-section"
import { ResultsPanel } from "@/components/generate/results-panel"
import { useBackends } from "@/hooks/use-backends"
import { useEngineModels, type EngineModelOption } from "@/hooks/use-engine-models"
import { useBackendPresets, useGenerateForm } from "@/hooks/use-generate-form"
import { useGalleryHandoff } from "@/hooks/use-gallery-handoff"
import { useJobWatch } from "@/hooks/use-job-watch"
import { img2imgSteps } from "@/lib/diffusion/img2img"
import { accepted, DEFAULT } from "@/lib/generate/form"
import { isSecretMode } from "@/lib/secret-mode"
import { MAX_REQUEST_BODY_BYTES } from "@/lib/limits"
import { composePrompt, fitToImage, formatForProfile } from "@/lib/profiles"
import type { CharacterPreset } from "@/lib/storage"
import { CHARACTER_GROUPS, POSE_GROUPS } from "@/lib/tag-groups"
import { prependTags } from "@/lib/tags"
import { useT } from "@/lib/i18n"

/**
 * The generate page: the chosen backend's form on the left, its run on the
 * right. The form and its storage live in useGenerateForm, the run in
 * useJobWatch (on the server, watched here), and what the gallery sends in
 * useGalleryHandoff; this puts them together and starts and cancels runs.
 */
// Where the skeleton's strength slider starts: the pose followed as given.
const DEFAULT_POSE_STRENGTH = 1

export function GenerateClient() {
  const t = useT()
  const { backends, tagger, loaded, refresh: refreshBackends } = useBackends()

  // ── Which backend, and its form ──────────────────────────────────────────
  const formState = useGenerateForm(backends, loaded)
  const { selectedId, status, form, profile, ready, update, editForm, changeProfile } = formState
  const { presetList, applyPreset } = useBackendPresets(formState)

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
  const [poseStrength, setPoseStrength] = useState(DEFAULT_POSE_STRENGTH)

  const addExtractedTags = useCallback(
    (tags: string[]) => {
      editForm((current) => ({ ...current, prompt: prependTags(current.prompt, tags) }))
      setLastExtractedTags(tags.join(", "))
    },
    [editForm]
  )

  const applyCharacter = useCallback(
    (preset: CharacterPreset) => {
      editForm((current) => ({
        ...current,
        prompt: prependTags(current.prompt, preset.tags.split(",")),
        artist: preset.artist,
        negativePrompt: preset.negativePrompt,
        seed: preset.seed,
      }))
    },
    [editForm]
  )

  // ── The backend's run, and what the gallery sent over ────────────────────
  const job = useJobWatch(selectedId, refreshBackends, t)
  const { isGenerating, isCancelling, setIsCancelling, begin, abandon, attach, backendRef, runId } = job
  useGalleryHandoff({ ready, editForm, backendRef, changeSource, changeSourceMode, t })

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
    const body = JSON.stringify({
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
    })
    // The server would refuse it anyway (the body is cut at this size), so say
    // why here rather than after uploading it. The pictures are base64, so the
    // length in characters is the size in bytes, near enough.
    if (body.length > MAX_REQUEST_BODY_BYTES) {
      toast.error(t("generate.tooLarge"), {
        description: t("generate.tooLargeBody", { limit: MAX_REQUEST_BODY_BYTES / 1024 / 1024 }),
      })
      return
    }
    // Optimistic, so the bars appear on click; the first snapshot replaces it.
    begin({
      completed: 0,
      total: form.imageCount,
      currentStep: 0,
      stepsPerImage: useSource ? img2imgSteps(form.steps, strength, profile.id) : form.steps,
    })

    try {
      const response = await fetch(`/api/gen/${encodeURIComponent(selectedId)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
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
        abandon()
        toast.error(t("generate.gpuBusy"), { description: data?.error ? t.server(data.error) : t("generate.gpuBusyBody") })
        return
      }
      if (!response.ok || !data?.job?.id) {
        throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
      }
      attach(selectedId, data.job.id)
    } catch (error) {
      abandon()
      toast.error(t("generate.failed"), { description: error instanceof Error ? error.message : t("generate.unreachable") })
    }
  }, [form, selectedId, sourceImage, capabilities, strength, mask, poseSkeleton, poseStrength, profile, sampler, scheduler, begin, abandon, attach, t])

  const handleCancel = useCallback(async () => {
    if (!selectedId || !runId) return
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/gen/${encodeURIComponent(selectedId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Names the run this page watches: only that one may be stopped.
        body: JSON.stringify({ job: runId }),
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
  }, [selectedId, runId, setIsCancelling, t])

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

  const outputSize = sourceImage ? fitToImage(sourceImage, form.width, form.height, profile.sizeMultiple) : { width: form.width, height: form.height }

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
        <Card>
          <CardHeader className="space-y-3">
            <BackendPicker
              backends={backends}
              selected={status}
              onSelect={formState.selectBackend}
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
            <PromptSection
              form={form}
              profile={profile}
              update={update}
              promptScope={formState.promptScope}
              onPromptScopeChange={formState.changePromptScope}
              backendKind={status.kind}
            />

            {capabilities?.img2img && (
              <SourceImageSlot
                value={sourceImage}
                onChange={changeSource}
                strength={strength}
                defaultStrength={sourceMode === "pose" ? profile.defaultPoseStrength : profile.defaultStrength}
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
                defaultStrength={DEFAULT_POSE_STRENGTH}
                onStrengthChange={setPoseStrength}
                outputSize={outputSize}
                source={sourceImage}
                disabled={isGenerating}
              />
            )}
            {!capabilities?.pose && poseSkeleton && (
              <p className="text-xs text-amber-600 dark:text-amber-500">{t("generate.poseDropped")}</p>
            )}
            {status.alive && <UnavailableFeatures hints={status.hints ?? {}} />}

            <SettingsSection
              form={form}
              profile={profile}
              status={status}
              update={update}
              disabled={isGenerating}
              img2imgSteps={sourceImage && capabilities?.img2img ? img2imgSteps(form.steps, strength, profile.id) : null}
              presetList={presetList}
              onPresetChange={applyPreset}
              sampler={sampler}
              scheduler={scheduler}
            />

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
                  <Button type="button" variant="ghost" size="icon" onClick={formState.resetForm} disabled={isGenerating} aria-label={t("generate.reset")}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("generate.reset")}</TooltipContent>
              </Tooltip>
            </div>
            {!status.alive && <p className="text-xs text-destructive">{t("generate.backendOffline", { backend: status.id })}</p>}
          </CardContent>
        </Card>

        <ResultsPanel job={job} onUseAsSource={capabilities?.img2img ? changeSource : undefined} />
      </div>
    </div>
  )
}
