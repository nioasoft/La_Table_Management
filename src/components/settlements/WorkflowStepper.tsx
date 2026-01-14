"use client";

import { cn } from "@/lib/utils";
import {
  Check,
  Circle,
  Clock,
  FileText,
  Upload,
  GitCompare,
  Settings,
  CheckCircle2,
  FileCheck,
} from "lucide-react";

// Settlement workflow steps
export type WorkflowStep =
  | "collecting"      // איסוף קבצים
  | "processing"      // עיבוד קבצים
  | "reconciliation"  // הצלבה
  | "adjustments"     // התאמות
  | "approval"        // אישור
  | "invoiced";       // חשבונית

export interface StepConfig {
  id: WorkflowStep;
  label: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}

// Step configuration
export const WORKFLOW_STEPS: StepConfig[] = [
  {
    id: "collecting",
    label: "איסוף קבצים",
    description: "קבלת קבצים מספקים",
    icon: <Upload className="h-5 w-5" />,
    href: "files",
  },
  {
    id: "processing",
    label: "עיבוד",
    description: "עיבוד הקבצים שהתקבלו",
    icon: <FileText className="h-5 w-5" />,
    href: "files",
  },
  {
    id: "reconciliation",
    label: "הצלבה",
    description: "הצלבת נתוני ספקים וזכיינים",
    icon: <GitCompare className="h-5 w-5" />,
    href: "reconciliation",
  },
  {
    id: "adjustments",
    label: "התאמות",
    description: "טיפול בפערים והתאמות",
    icon: <Settings className="h-5 w-5" />,
    href: "adjustments",
  },
  {
    id: "approval",
    label: "אישור",
    description: "אישור סופי לחישוב עמלות",
    icon: <CheckCircle2 className="h-5 w-5" />,
    href: "approve",
  },
  {
    id: "invoiced",
    label: "חשבונית",
    description: "הפקת דוחות וחשבוניות",
    icon: <FileCheck className="h-5 w-5" />,
    href: "reports",
  },
];

// Map settlement status to workflow step
export function getStepFromStatus(status: string): WorkflowStep {
  switch (status) {
    case "open":
    case "draft":
      return "collecting";
    case "collecting":
      return "collecting";
    case "processing":
      return "processing";
    case "pending_approval":
      return "approval";
    case "approved":
      return "invoiced";
    case "invoiced":
    case "completed":
      return "invoiced";
    default:
      return "collecting";
  }
}

// Get step index
export function getStepIndex(step: WorkflowStep): number {
  return WORKFLOW_STEPS.findIndex((s) => s.id === step);
}

// Check if step is complete
export function isStepComplete(currentStep: WorkflowStep, checkStep: WorkflowStep): boolean {
  return getStepIndex(currentStep) > getStepIndex(checkStep);
}

// Check if step is active
export function isStepActive(currentStep: WorkflowStep, checkStep: WorkflowStep): boolean {
  return currentStep === checkStep;
}

interface WorkflowStepperProps {
  currentStep: WorkflowStep;
  settlementId: string;
  onStepClick?: (step: StepConfig) => void;
  className?: string;
}

export function WorkflowStepper({
  currentStep,
  settlementId,
  onStepClick,
  className,
}: WorkflowStepperProps) {
  const currentIndex = getStepIndex(currentStep);

  return (
    <div className={cn("w-full", className)}>
      {/* Desktop stepper */}
      <div className="hidden md:flex items-center justify-between">
        {WORKFLOW_STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isActive = index === currentIndex;
          const isFuture = index > currentIndex;

          return (
            <div key={step.id} className="flex items-center flex-1">
              {/* Step */}
              <button
                onClick={() => onStepClick?.(step)}
                disabled={isFuture}
                className={cn(
                  "flex flex-col items-center gap-2 p-2 rounded-lg transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                  isActive && "bg-primary/10",
                  !isFuture && "hover:bg-muted cursor-pointer",
                  isFuture && "cursor-not-allowed opacity-50"
                )}
              >
                {/* Icon */}
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                    isComplete && "bg-green-500 border-green-500 text-white",
                    isActive && "bg-primary border-primary text-white",
                    isFuture && "bg-muted border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  {isComplete ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    step.icon
                  )}
                </div>

                {/* Label */}
                <div className="text-center">
                  <div
                    className={cn(
                      "text-sm font-medium",
                      isActive && "text-primary",
                      isFuture && "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </div>
                  <div className="text-xs text-muted-foreground hidden lg:block">
                    {step.description}
                  </div>
                </div>
              </button>

              {/* Connector */}
              {index < WORKFLOW_STEPS.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    index < currentIndex ? "bg-green-500" : "bg-muted"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile stepper */}
      <div className="md:hidden space-y-2">
        {WORKFLOW_STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isActive = index === currentIndex;
          const isFuture = index > currentIndex;

          return (
            <button
              key={step.id}
              onClick={() => onStepClick?.(step)}
              disabled={isFuture}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                isActive && "bg-primary/10 border-2 border-primary",
                isComplete && "bg-green-50 dark:bg-green-950/20",
                !isFuture && "hover:bg-muted cursor-pointer",
                isFuture && "cursor-not-allowed opacity-50"
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 flex-shrink-0",
                  isComplete && "bg-green-500 border-green-500 text-white",
                  isActive && "bg-primary border-primary text-white",
                  isFuture && "bg-muted border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {isComplete ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 text-right">
                <div
                  className={cn(
                    "text-sm font-medium",
                    isActive && "text-primary",
                    isFuture && "text-muted-foreground"
                  )}
                >
                  {step.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {step.description}
                </div>
              </div>

              {/* Status indicator */}
              {isComplete && (
                <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
              )}
              {isActive && (
                <Clock className="h-5 w-5 text-primary flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default WorkflowStepper;
