"use client"

import { Workflow } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { WorkflowOption } from "@/hooks/use-comfy-workflows"
import { useT, type MessageKey } from "@/lib/i18n"

/** The select's value for the built-in graph (a workflow name is never this: it has no "<"). */
const BUILT_IN = "<built-in>"

interface WorkflowPickerProps {
  workflows: WorkflowOption[]
  /** The chosen workflow's name, or "" for the built-in graph. */
  value: string
  onChange: (name: string) => void
  disabled?: boolean
}

/**
 * A ComfyUI backend's workflows from its folder, next to the built-in graph.
 * Under the choice: what the workflow lacks (left as it is in the file), or
 * why it cannot run.
 */
export function WorkflowPicker({ workflows, value, onChange, disabled }: WorkflowPickerProps) {
  const t = useT()
  const chosen = workflows.find((workflow) => workflow.name === value)

  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-xs text-muted-foreground">
        <Workflow className="h-3 w-3" />
        {t("generate.workflow")}
      </Label>
      <Select value={chosen ? chosen.name : BUILT_IN} onValueChange={(next) => onChange(next === BUILT_IN ? "" : next)} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={t("generate.workflow")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BUILT_IN}>{t("generate.workflowBuiltIn")}</SelectItem>
          {workflows.map((workflow) => (
            <SelectItem key={workflow.name} value={workflow.name} disabled={Boolean(workflow.problem)}>
              {workflow.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {chosen?.problem && <p className="text-xs text-destructive">{chosen.problem}</p>}
      {chosen && !chosen.problem && chosen.missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("generate.workflowMissing", {
            items: chosen.missing.map((role) => t(`generate.workflowRole.${role}` as MessageKey)).join(", "),
          })}
        </p>
      )}
      {chosen && !chosen.problem && <p className="text-xs text-muted-foreground">{t("generate.workflowPromptOnly")}</p>}
    </div>
  )
}
