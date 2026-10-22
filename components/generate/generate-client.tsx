"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Grid3x3, ListPlus, Loader2, RotateCcw, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSecretMode } from "@/components/app-header"
import { BackendPicker } from "@/components/generate/backend-picker"
import { SetupNotice } from "@/components/setup-notice"
import { SourceImageSlot, type SourceImage, type SourceMode } from "@/components/generate/source-image-slot"
import { ExtendControls } from "@/components/generate/extend-controls"
import { TagExtractPanel } from "@/components/generate/tag-extract-panel"
import { CharacterPresets } from "@/components/generate/character-presets"
import { PoseSlot, type PoseSkeleton } from "@/components/generate/pose-slot"
import { problemText, UnavailableFeatures } from "@/components/generate/unavailable-features"
import { PromptSection } from "@/components/generate/prompt-section"
import { SettingsSection } from "@/components/generate/settings-section"
import { ResultsPanel } from "@/components/generate/results-panel"
import { HiresSection } from "@/components/generate/hires-section"
import { WorkflowPicker } from "@/components/generate/workflow-picker"
import { DEFAULT_GRID_FORM, GridSection, type GridForm } from "@/components/generate/grid-section"
import { useBackends } from "@/hooks/use-backends"
import { useEngineLoras } from "@/hooks/use-engine-loras"
import { useWildcards } from "@/hooks/use-wildcards"
import { useEngineModels, type EngineModelOption } from "@/hooks/use-engine-models"
import { useBackendPresets, useGenerateForm } from "@/hooks/use-generate-form"
import { useGalleryHandoff } from "@/hooks/use-gallery-handoff"
import { useJobWatch } from "@/hooks/use-job-watch"
import { useRunQueue } from "@/hooks/use-run-queue"
import { useGridRuns } from "@/hooks/use-grid-runs"
import { gridErrorParts, joinValues, parseGrid, splitValues, type GridSpecInput } from "@/lib/generate/grid"
import { useTabMemory } from "@/lib/generate/tab-memory"
import { useComfyWorkflows } from "@/hooks/use-comfy-workflows"
import { HIRES_LIMITS, hiresSize, LANCZOS } from "@/lib/diffusion/hires"
import { img2imgSteps } from "@/lib/diffusion/img2img"
import { accepted, DEFAULT } from "@/lib/generate/form"
import { NO_SIDES, outpaintCanvas, outpaintFits, OUTPAINT_STRENGTH, type OutpaintSides } from "@/lib/generate/outpaint"
import { isSecretMode } from "@/lib/secret-mode"
import { MAX_REQUEST_BODY_BYTES } from "@/lib/limits"
import { composePrompt, fitToImage, formatForProfile } from "@/lib/profiles"
import type { CharacterPreset } from "@/lib/storage"
import { CHARACTER_GROUPS, POSE_GROUPS } from "@/lib/tag-groups"
import { prependTags } from "@/lib/tags"
import { expandWildcards } from "@/lib/wildcards/client"
import { hasWildcards } from "@/lib/wildcards/syntax"
import { useT } from "@/lib/i18n"

/**
 * The generate page: the chosen backend's form on the left, its run on the
 * right. The form and its storage live in useGenerateForm, the run in
 * useJobWatch (on the server, watched here), and what the gallery sends in
 * useGalleryHandoff; this puts them together and starts and cancels runs.
 */
// Where the skeleton's strength slider starts: the pose followed as given.
const DEFAULT_POSE_STRENGTH = 1

const round2 = (value: number) => Math.round(value * 100) / 100

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
  const engineLoras = useEngineLoras()
  const wildcards = useWildcards()
  // The LoRA picker has its own rule: a paired device gets it too when sharing is on.
  const pickLoras = Boolean(selectedId && engineLoras.engines.includes(selectedId))
  // The loaded model's family, to grey out LoRAs for the other one. A client
  // without the model list (a paired device) goes by the form's profile.
  const loraFamily =
    engineModels.models?.find((model) => model.id === engineModels.current)?.family ??
    (form?.profile === "anima" ? "anima" : form?.profile === "sdxl" || form?.profile === "illustrious" || form?.profile === "pony" ? "sdxl" : null)
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
  // Extend: how far the canvas grows on each side.
  const [extendSides, setExtendSides] = useState<OutpaintSides>(NO_SIDES)
  const modeStrength = (mode: SourceMode) =>
    mode === "pose" ? profile.defaultPoseStrength : mode === "extend" ? OUTPAINT_STRENGTH : profile.defaultStrength
  // Each mode has its own sensible strength, so switching puts the slider at
  // that mode's starting point instead of carrying a variation's 0.6 into a
  // pose reference (where it would mostly copy the reference).
  const changeSourceMode = useCallback(
    (mode: SourceMode) => {
      setSourceMode(mode)
      setStrength(mode === "pose" ? profile.defaultPoseStrength : mode === "extend" ? OUTPAINT_STRENGTH : profile.defaultStrength)
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
  const queue = useRunQueue(selectedId, attach, t)
  const grids = useGridRuns(selectedId, t)
  // The X/Y grid's axes as typed; this tab's memory only, like the queue.
  const [gridForm, setGridForm] = useTabMemory<GridForm>("generate.gridForm", () => DEFAULT_GRID_FORM)
  // The start of each run's prompt, to tell earlier runs apart; this tab's
  // memory only, and never in secret mode.
  const [labels, setLabels] = useTabMemory<ReadonlyMap<string, string | null>>("generate.labels", () => new Map())
  const label = useCallback((id: string, text: string | null) => setLabels((previous) => new Map(previous).set(id, text)), [setLabels])
  useGalleryHandoff({ ready, editForm, backendRef, changeSource, changeSourceMode, t })

  // Secret mode turned on while a run is on screen makes that run secret on
  // the server too (one way: turning it off again changes nothing there).
  // So do the runs this page has waiting in the queue.
  const secret = useSecretMode()
  const markedSecret = useRef(new Set<string>())
  useEffect(() => {
    const backend = backendRef.current
    if (!secret || !backend) return
    for (const id of [runId, ...queue.items.map((item) => item.id), ...grids.activeIds]) {
      if (!id || markedSecret.current.has(id)) continue
      markedSecret.current.add(id)
      void fetch(`/api/gen/${encodeURIComponent(backend)}/job/secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: id }),
      }).catch(() => {})
    }
  }, [secret, runId, queue.items, grids.activeIds, backendRef])

  // ── Generate and cancel ──────────────────────────────────────────────────
  // A ComfyUI workflow from the backend's folder draws from a prompt, and
  // follows a skeleton when it has a `latentry:pose` LoadImage. It needs only
  // the engine for that (the backend's ControlNet is the built-in graph's), and
  // the engine is the first thing the backend's pose hint names when missing.
  const workflows = useComfyWorkflows(status)
  const workflow = form && workflows.some((item) => item.name === form.workflow && !item.problem) ? form.workflow : ""
  const workflowPose = workflows.some((item) => item.name === workflow && item.pose === true)
  const statusCapabilities = status?.capabilities
  const statusHints = status?.hints
  const engineReady = statusHints?.pose?.need !== "engine"
  const capabilities = useMemo(
    () =>
      statusCapabilities && workflow
        ? { ...statusCapabilities, img2img: false, inpaint: false, pose: workflowPose && engineReady, hires: false }
        : statusCapabilities,
    [statusCapabilities, workflow, workflowPose, engineReady]
  )
  const hints = useMemo(() => {
    if (!statusHints || !workflow || !engineReady) return statusHints
    const { pose: _builtIn, ...rest } = statusHints
    return workflowPose ? rest : { ...rest, pose: { reason: "setup" as const, need: "marker" as const } }
  }, [statusHints, workflow, workflowPose, engineReady])
  const sampler = form ? accepted(form.sampler, status?.samplers ?? []) : DEFAULT
  const scheduler = form ? accepted(form.scheduler, status?.schedulers ?? []) : DEFAULT
  // Hires fix redraws a txt2img picture; with a source image the run is img2img.
  const canHires = Boolean(capabilities?.hires && !(sourceImage && capabilities.img2img))
  const hires = Boolean(form?.hires && canHires)
  // Upscale redraws the source itself, larger: the source slot's third mode.
  const canUpscale = Boolean(capabilities?.upscale && capabilities.img2img)
  const shownMode: SourceMode =
    (sourceMode === "upscale" && !canUpscale) || (sourceMode === "extend" && !capabilities?.inpaint) ? "variation" : sourceMode
  const upscaling = Boolean(sourceImage && canUpscale && shownMode === "upscale")
  // Extend sends the source and the four amounts; the server pads and masks it.
  const extending = Boolean(sourceImage && capabilities?.img2img && capabilities.inpaint && shownMode === "extend")
  // A1111's extras enlarge pixels: its latent modes are for hires fix only.
  const upscalers = useMemo(
    () => (upscaling && status?.kind === "a1111" ? (status.upscalers ?? []).filter((name) => !/^Latent\b/.test(name)) : (status?.upscalers ?? [])),
    [upscaling, status]
  )
  const upscaler = form ? accepted(form.hrUpscaler, upscalers) : LANCZOS
  const hrFields = useMemo(
    () =>
      form
        ? // Rounded as the sliders show them: their steps add up to 1.9500000000000002.
          { hr_scale: round2(form.hrScale), hr_steps: form.hrSteps, hr_denoise: round2(form.hrDenoise), hr_upscaler: upscaler }
        : null,
    [form, upscaler]
  )

  // The grid as it would be sent, and what the page makes of it before sending.
  const gridInput = useMemo<GridSpecInput | null>(
    () => (gridForm.on ? { x: gridForm.x, ...(gridForm.y.kind !== "none" ? { y: { kind: gridForm.y.kind, text: gridForm.y.text } } : {}) } : null),
    [gridForm]
  )
  const gridParsed = useMemo(
    () =>
      gridInput && form
        ? parseGrid(gridInput, {
            prompt: form.prompt,
            negative_prompt: form.negativePrompt,
            image_count: form.imageCount,
            hr_scale: hires || upscaling ? form.hrScale : undefined,
          })
        : null,
    [gridInput, form, hires, upscaling]
  )

  const handleGenerate = useCallback(async () => {
    if (!form || !selectedId) return
    if (gridParsed && !gridParsed.ok) {
      toast.error(t("generate.failed"), { description: t(...gridErrorParts(gridParsed.error)) })
      return
    }
    if (!form.prompt.trim()) {
      toast.error(t("generate.promptRequired"), { description: t("generate.promptRequiredBody") })
      return
    }
    const useSource = Boolean(sourceImage && capabilities?.img2img)
    if (extending && sourceImage && !outpaintFits(sourceImage, extendSides)) {
      toast.error(t("generate.extendNothing"), { description: t("generate.extendNothingBody") })
      return
    }
    // Wildcards are replaced first, once for the whole run, so the lines put
    // in are respelled for the profile like the rest of the prompt.
    const expanded = await expandWildcards(form.prompt, form.negativePrompt, form.seed)
    if (!expanded.ok) {
      toast.error(t("generate.wildcards.failed"), { description: expanded.error ? t.server(expanded.error) : t("generate.unreachable") })
      return
    }
    const compose = (prompt: string) => composePrompt(prompt, { profile, artist: form.artist, quality: form.quality })
    // Prompt S/R's values are respelled as the prompt is, so they are found in it.
    const respell = (axis: { kind: string; text: string }) =>
      axis.kind === "prompt_sr" ? { ...axis, text: joinValues(splitValues(axis.text).map((value) => formatForProfile(value, profile))) } : axis
    const grid = gridInput ? { x: respell(gridInput.x), ...(gridInput.y ? { y: respell(gridInput.y) } : {}) } : null
    const body = JSON.stringify({
      prompt: compose(expanded.prompt),
      negative_prompt: formatForProfile(expanded.negativePrompt, profile),
      // Kept with the picture, so the gallery can show what was typed.
      ...(hasWildcards(form.prompt) ? { prompt_template: compose(form.prompt) } : {}),
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
      ...(workflow ? { workflow } : {}),
      ...(grid ? { grid } : {}),
      ...(upscaling && sourceImage
        ? { init_image_base64: sourceImage.dataUrl, upscale: true, ...hrFields }
        : extending && sourceImage
          ? { init_image_base64: sourceImage.dataUrl, strength, outpaint: extendSides }
        : {
            ...(useSource && sourceImage ? { init_image_base64: sourceImage.dataUrl, strength } : {}),
            ...(useSource && mask && capabilities?.inpaint ? { mask_base64: mask } : {}),
            ...(capabilities?.pose && poseSkeleton
              ? { pose_image_base64: poseSkeleton.dataUrl, pose_is_skeleton: true, pose_strength: poseStrength }
              : {}),
            ...(hires ? hrFields : {}),
          }),
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
    // A run already going: this one waits in the queue, and the bars stay on
    // the one running.
    const queueing = isGenerating || queue.items.length > 0 || grids.activeIds.length > 0 || grid !== null
    // The prompt as typed, to tell runs apart (cut short on screen, whole on
    // hover). In secret mode not even its start is shown.
    const shortPrompt = isSecretMode() ? null : form.prompt.trim().slice(0, 2000)
    // Optimistic, so the bars appear on click; the first snapshot replaces it.
    if (!queueing) begin({
      completed: 0,
      total: form.imageCount,
      currentStep: 0,
      stepsPerImage: upscaling
        ? form.hrSteps || form.steps
        : useSource
          ? img2imgSteps(form.steps, strength, profile.id)
          : form.steps + (hires ? form.hrSteps || form.steps : 0),
    })

    try {
      const response = await fetch(`/api/gen/${encodeURIComponent(selectedId)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      const data = await response.json().catch(() => null)

      // 202: the backend is busy, and the run waits its turn in the queue.
      // A grid always waits in the queue, as one run; the page shows its cells.
      if (response.status === 202 && data?.queued?.id && data.queued.grid) {
        const { x, y, seed } = data.queued.grid
        grids.add({ id: data.queued.id, backend: selectedId, label: shortPrompt, x, y: y ?? null, seed, position: data.queued.position ?? 0 })
        return
      }
      if (response.status === 202 && data?.queued?.id) {
        if (!queueing) abandon()
        label(data.queued.id, shortPrompt)
        queue.add(selectedId, { id: data.queued.id, label: shortPrompt, position: data.queued.position ?? 0, waiting: false })
        return
      }
      // 409: the queue is full, or the backend refused for its own reasons.
      if (response.status === 409) {
        if (!queueing) abandon()
        toast.error(t("generate.gpuBusy"), { description: data?.error ? t.server(data.error) : t("generate.gpuBusyBody") })
        return
      }
      if (!response.ok || !data?.job?.id) {
        throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
      }
      label(data.job.id, shortPrompt)
      attach(selectedId, data.job.id)
    } catch (error) {
      if (!queueing) abandon()
      toast.error(t("generate.failed"), { description: error instanceof Error ? error.message : t("generate.unreachable") })
    }
  }, [form, selectedId, sourceImage, capabilities, strength, mask, poseSkeleton, poseStrength, profile, sampler, scheduler, workflow, hires, upscaling, extending, extendSides, hrFields, isGenerating, queue, grids, gridInput, gridParsed, label, begin, abandon, attach, t])

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

  const outputSize = upscaling && sourceImage
    ? hiresSize(sourceImage.width, sourceImage.height, form.hrScale, profile.sizeMultiple)
    : extending && sourceImage
      ? outpaintCanvas(sourceImage, extendSides)
    : sourceImage
      ? fitToImage(sourceImage, form.width, form.height, profile.sizeMultiple)
      : { width: form.width, height: form.height }

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
            {workflows.length > 0 && (
              <WorkflowPicker workflows={workflows} value={workflow} onChange={(name) => update({ workflow: name })} />
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <CharacterPresets
              suggestedTags={lastExtractedTags}
              artist={form.artist}
              negativePrompt={form.negativePrompt}
              seed={form.seed}
              onApply={applyCharacter}
            />
            <PromptSection
              form={form}
              profile={profile}
              update={update}
              promptScope={formState.promptScope}
              onPromptScopeChange={formState.changePromptScope}
              appliesLoras={Boolean(capabilities?.lora)}
              loraPicker={
                pickLoras && capabilities?.lora
                  ? {
                      loras: engineLoras.loras,
                      family: loraFamily,
                      onOpen: engineLoras.refresh,
                    }
                  : undefined
              }
              wildcardPicker={wildcards.available ? { names: wildcards.names, onOpen: wildcards.refresh } : undefined}
            />

            {capabilities?.img2img && (
              <SourceImageSlot
                value={sourceImage}
                onChange={changeSource}
                strength={strength}
                defaultStrength={modeStrength(shownMode)}
                onStrengthChange={setStrength}
                mask={mask}
                onMaskChange={setMask}
                mode={shownMode}
                onModeChange={changeSourceMode}
                canInpaint={capabilities.inpaint}
                canUpscale={canUpscale}
                upscaleControls={
                  sourceImage && (
                    <HiresSection
                      form={form}
                      update={update}
                      upscalers={upscalers}
                      upscaler={upscaler}
                      sizeMultiple={profile.sizeMultiple}
                      embedded={{ base: sourceImage, maxScale: HIRES_LIMITS.maxScale }}
                    />
                  )
                }
                extendControls={(veiled) =>
                  sourceImage && <ExtendControls source={sourceImage} sides={extendSides} onChange={setExtendSides} veiled={veiled} />
                }
              />
            )}
            {sourceImage && capabilities?.img2img && tagger && (
              <TagExtractPanel
                key={sourceVersion}
                source={sourceImage}
                onAdd={addExtractedTags}
                defaultGroups={sourceMode === "pose" ? POSE_GROUPS : CHARACTER_GROUPS}
                hint={t(sourceMode === "pose" ? "generate.tagsHintPose" : "generate.tagsHint")}
              />
            )}
            {capabilities?.pose && (
              <PoseSlot
                backend={status.id}
                workflow={workflow}
                value={poseSkeleton}
                onChange={setPoseSkeleton}
                strength={poseStrength}
                defaultStrength={DEFAULT_POSE_STRENGTH}
                onStrengthChange={setPoseStrength}
                outputSize={outputSize}
                source={sourceImage}
              />
            )}
            {!capabilities?.pose && poseSkeleton && (
              <p className="text-xs text-amber-600 dark:text-amber-500">{t("generate.poseDropped")}</p>
            )}
            {status.alive && <UnavailableFeatures hints={hints ?? {}} kind={status.kind} />}

            <SettingsSection
              form={form}
              profile={profile}
              status={status}
              update={update}
              img2imgSteps={sourceImage && capabilities?.img2img ? img2imgSteps(form.steps, strength, profile.id) : null}
              presetList={presetList}
              onPresetChange={applyPreset}
              sampler={sampler}
              scheduler={scheduler}
            />
            {canHires && (
              <HiresSection
                form={form}
                update={update}
                upscalers={status.upscalers}
                upscaler={upscaler}
                sizeMultiple={profile.sizeMultiple}
              />
            )}
            <GridSection
              value={gridForm}
              onChange={setGridForm}
              parsed={gridParsed}
              imageCount={form.imageCount}
              samplers={status.samplers}
              schedulers={status.schedulers}
              hires={hires || upscaling}
            />

            <div className="flex gap-2">
              <Button
                onClick={handleGenerate}
                disabled={!status.alive || (isEngine && engineLoading) || (gridParsed !== null && !gridParsed.ok)}
                className="flex-1"
              >
                {gridParsed?.ok ? (
                  <>
                    <Grid3x3 className="mr-2 h-4 w-4" />
                    {t("generate.grid.queue", { cells: gridParsed.value.x.values.length * (gridParsed.value.y?.values.length ?? 1) })}
                  </>
                ) : isGenerating || grids.activeIds.length > 0 ? (
                  <>
                    <ListPlus className="mr-2 h-4 w-4" />
                    {t("generate.queue.add")}
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
                  <Button type="button" variant="ghost" size="icon" onClick={formState.resetForm} aria-label={t("generate.reset")}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("generate.reset")}</TooltipContent>
              </Tooltip>
            </div>
            {!status.alive && (
              <p className="text-xs text-destructive">
                {t("generate.backendOffline", { backend: status.id })}
                {status.problem && ` ${problemText(t, status.problem)}`}
              </p>
            )}
          </CardContent>
        </Card>

        <ResultsPanel job={job} queue={queue} grids={grids} labels={labels} onUseAsSource={capabilities?.img2img ? changeSource : undefined} />
      </div>
    </div>
  )
}
