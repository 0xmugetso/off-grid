"use client";

import type { CSSProperties } from "react";

type LoaderProps = {
  size?: number;
  className?: string;
  "aria-label"?: string;
};

export function OffGridLoader({ size = 64, className = "", "aria-label": ariaLabel = "Loading" }: LoaderProps) {
  const style = { "--offgrid-loader-unit": `${Math.max(size, 10) / 100}px` } as CSSProperties;

  return (
    <span className={`offgrid-loader ${className}`.trim()} style={style} role="status" aria-label={ariaLabel}>
      <i aria-hidden="true" />
    </span>
  );
}

