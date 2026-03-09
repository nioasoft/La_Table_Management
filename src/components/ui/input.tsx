import * as React from "react";
import { cn } from "@/lib/utils";
import { DateInput } from "./date-input";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...allProps }, ref) => {
    if (type === "date") {
      const { onChange, value, disabled, required, id } = allProps;
      return (
        <DateInput
          ref={ref}
          value={(value as string) ?? ""}
          onChange={(dateStr) => {
            if (onChange) {
              onChange({
                target: { value: dateStr },
                currentTarget: { value: dateStr },
              } as React.ChangeEvent<HTMLInputElement>);
            }
          }}
          disabled={disabled}
          required={required}
          className={className}
          id={id}
        />
      );
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...allProps}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
