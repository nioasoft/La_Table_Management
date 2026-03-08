import * as React from "react";
import { cn } from "@/lib/utils";
import { clampDateValue } from "@/lib/date-utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onChange, max, ...props }, ref) => {
    const isDate = type === "date";

    const handleChange = isDate && onChange
      ? (e: React.ChangeEvent<HTMLInputElement>) => {
          const clamped = clampDateValue(e.target.value);
          if (clamped !== e.target.value) {
            e.target.value = clamped;
          }
          onChange(e);
        }
      : onChange;

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
        onChange={handleChange}
        max={isDate ? (max ?? "9999-12-31") : max}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
