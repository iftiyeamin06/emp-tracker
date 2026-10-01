import * as React from "react";

import { cn } from "@/lib/utils";

// Minimal shadcn-style Progress (no extra dependency): track + indicator.
// `value` is a 0–100 percent; `indicatorClassName` recolors the fill.
const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value?: number; indicatorClassName?: string }
>(({ className, value = 0, indicatorClassName, ...props }, ref) => {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <div
        className={cn("h-full flex-1 rounded-full bg-primary transition-all", indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
});
Progress.displayName = "Progress";

export { Progress };
