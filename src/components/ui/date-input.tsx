"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface DateInputProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput(
    { value = "", onChange, disabled, required, className, id },
    ref
  ) {
    const dayRef = React.useRef<HTMLInputElement>(null);
    const monthRef = React.useRef<HTMLInputElement>(null);
    const yearRef = React.useRef<HTMLInputElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useImperativeHandle(ref, () => dayRef.current as HTMLInputElement);

    const [day, setDay] = React.useState("");
    const [month, setMonth] = React.useState("");
    const [year, setYear] = React.useState("");

    // Ref tracks latest segments for async blur handler
    const segRef = React.useRef({ day: "", month: "", year: "" });
    const set = (s: "day" | "month" | "year", v: string) => {
      segRef.current[s] = v;
      if (s === "day") setDay(v);
      else if (s === "month") setMonth(v);
      else setYear(v);
    };

    // Sync from value prop
    React.useEffect(() => {
      if (value) {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          set("day", match[3]);
          set("month", match[2]);
          set("year", match[1]);
        }
      } else {
        set("day", "");
        set("month", "");
        set("year", "");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const clampAndEmit = (d: string, m: string, y: string) => {
      if (!d && !m && !y) {
        onChange?.("");
        return;
      }
      if (!d || !m || !y || y.length < 4) return;

      let monthNum = parseInt(m, 10);
      if (isNaN(monthNum) || monthNum < 1) monthNum = 1;
      if (monthNum > 12) monthNum = 12;

      const yearNum = parseInt(y, 10);
      if (isNaN(yearNum)) return;

      const maxDay = getDaysInMonth(yearNum, monthNum);
      let dayNum = parseInt(d, 10);
      if (isNaN(dayNum) || dayNum < 1) dayNum = 1;
      if (dayNum > maxDay) dayNum = maxDay;

      const dateStr = `${String(yearNum).padStart(4, "0")}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      onChange?.(dateStr);

      // Update displayed segments to clamped values
      set("day", String(dayNum).padStart(2, "0"));
      set("month", String(monthNum).padStart(2, "0"));
      set("year", String(yearNum).padStart(4, "0"));
    };

    const handleDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/\D/g, "").slice(0, 2);
      set("day", v);
      if (v.length === 2) {
        monthRef.current?.focus();
        monthRef.current?.select();
      }
    };

    const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/\D/g, "").slice(0, 2);
      set("month", v);
      if (v.length === 2) {
        yearRef.current?.focus();
        yearRef.current?.select();
      }
    };

    const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/\D/g, "").slice(0, 4);
      set("year", v);
      if (v.length === 4) {
        clampAndEmit(segRef.current.day, segRef.current.month, v);
      }
    };

    const handleKeyDown = (
      e: React.KeyboardEvent<HTMLInputElement>,
      prevRef?: React.RefObject<HTMLInputElement | null>
    ) => {
      if (
        e.key === "Backspace" &&
        !e.currentTarget.value &&
        prevRef?.current
      ) {
        e.preventDefault();
        prevRef.current.focus();
        prevRef.current.select();
      }
    };

    const handleContainerBlur = (e: React.FocusEvent) => {
      if (containerRef.current?.contains(e.relatedTarget as Node)) return;
      const { day: d, month: m, year: y } = segRef.current;
      clampAndEmit(d, m, y);
    };

    const segmentClass =
      "bg-transparent outline-none text-center tabular-nums";

    return (
      <div
        ref={containerRef}
        dir="ltr"
        className={cn(
          "flex h-10 w-fit items-center gap-0.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
        onBlur={handleContainerBlur}
      >
        <input
          ref={dayRef}
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="DD"
          value={day}
          onChange={handleDayChange}
          onKeyDown={(e) => handleKeyDown(e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          required={required}
          className={cn(segmentClass, "w-7")}
          aria-label="Day"
        />
        <span className="text-muted-foreground select-none">/</span>
        <input
          ref={monthRef}
          type="text"
          inputMode="numeric"
          placeholder="MM"
          value={month}
          onChange={handleMonthChange}
          onKeyDown={(e) => handleKeyDown(e, dayRef)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          className={cn(segmentClass, "w-7")}
          aria-label="Month"
        />
        <span className="text-muted-foreground select-none">/</span>
        <input
          ref={yearRef}
          type="text"
          inputMode="numeric"
          placeholder="YYYY"
          value={year}
          onChange={handleYearChange}
          onKeyDown={(e) => handleKeyDown(e, monthRef)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          className={cn(segmentClass, "w-12")}
          aria-label="Year"
        />
      </div>
    );
  }
);

DateInput.displayName = "DateInput";
