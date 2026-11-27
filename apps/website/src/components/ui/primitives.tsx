import * as React from "react";
import { cn } from "@/lib/utils";

export function Logo({ size = 28 }: { size?: number }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <defs>
          <linearGradient id="dg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6ee7b7" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="#0b0d13" stroke="url(#dg)" strokeWidth="1.6" />
        <path d="M10 10.5h5.4M10 16h6.4M10 21.5h4.6" stroke="#4b5567" strokeWidth="2" strokeLinecap="round" />
        <path d="M19 9v14M23.5 9v14" stroke="url(#dg)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">
        diffs<span className="text-brand">.work</span>
      </span>
    </span>
  );
}

export function Badge({
  children,
  tone = "default",
  className,
  ...rest
}: {
  children: React.ReactNode;
  tone?: "default" | "brand" | "warn" | "muted";
  className?: string;
  [key: `data-${string}`]: string | undefined;
}): React.ReactElement {
  const tones = {
    default: "border-line bg-panel-2 text-slate-300",
    brand: "border-brand/30 bg-brand/10 text-brand",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    muted: "border-line bg-transparent text-slate-500",
  } as const;
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
}): React.ReactElement {
  const variants = {
    primary:
      "bg-brand text-emerald-950 hover:bg-emerald-300 shadow-[0_0_0_1px_rgba(110,231,183,.25),0_8px_30px_-12px_rgba(110,231,183,.6)]",
    outline: "border border-line bg-panel-2 text-slate-200 hover:border-slate-500 hover:bg-panel",
    ghost: "text-slate-300 hover:bg-white/5",
    danger: "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  } as const;
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-[15px]" } as const;
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return (
    // `min-w-0` matters: inside a CSS grid a child defaults to `min-width: auto`, so one long
    // unbreakable run (the 36-extension list) widened the column past the viewport and the whole
    // page scrolled sideways on a phone.
    <div className={cn("min-w-0 rounded-2xl border border-line bg-panel/70 backdrop-blur-sm", className)}>{children}</div>
  );
}

export function SectionTitle({
  kicker,
  title,
  desc,
}: {
  kicker?: string;
  title: React.ReactNode;
  desc?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {kicker ? (
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-brand/80">{kicker}</div>
      ) : null}
      <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {desc ? <p className="mt-3 text-pretty text-[15px] leading-7 text-slate-400">{desc}</p> : null}
    </div>
  );
}