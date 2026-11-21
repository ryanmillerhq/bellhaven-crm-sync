"use client";
/**
 * Animated Lordicon that plays once when its host is hovered (Zenith's sidebar pattern), follows the theme color,
 * and stays still for reduced-motion users. Zenith has no shared wrapper, so this is ours.
 */
import dynamic from "next/dynamic";
import { useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import type { LordIconPlayerProps } from "./lord-icon-player";

const Player = dynamic(() => import("./lord-icon-player"), { ssr: false });

type Props = Omit<LordIconPlayerProps, "host" | "size"> & { size?: number; className?: string; label?: string };

export function LordIcon({ size = 20, className, label, hover, autoplay, playKey, ...rest }: Props) {
  const host = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  return (
    <span
      ref={host}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <Player
        {...rest}
        size={size}
        host={host}
        hover={reduce ? false : hover}
        autoplay={reduce ? false : autoplay}
        playKey={reduce ? undefined : playKey}
      />
    </span>
  );
}
