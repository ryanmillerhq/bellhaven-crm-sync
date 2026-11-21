"use client";
// Loaded client-side only (lottie needs the DOM). See lord-icon.tsx for the public component.
import { Player } from "@lordicon/react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ICONS, type IconName } from "./icons";

export interface LordIconPlayerProps {
  name: IconName;
  size: number;
  state?: string;
  /** Hex color. When omitted, the icon follows the CSS text color of its wrapper (theme-aware). */
  color?: string;
  /** Play once when the nearest [data-lord-host] ancestor (or the parent element) is hovered. Default true. */
  hover?: boolean;
  /** Play once on mount. */
  autoplay?: boolean;
  /** Replay whenever this value changes (e.g. a decision was just made). */
  playKey?: string | number;
  host: React.RefObject<HTMLSpanElement | null>;
}

/** Lordicon's colorize needs a concrete hex; computed colors may be oklch(), so resolve through a canvas pixel. */
function cssColorToHex(color: string): string | undefined {
  try {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return undefined;
  }
}

export default function LordIconPlayer({ name, size, state, color, hover = true, autoplay, playKey, host }: LordIconPlayerProps) {
  const player = useRef<Player>(null);
  const [themeColor, setThemeColor] = useState<string>();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (color || !host.current) return;
    setThemeColor(cssColorToHex(getComputedStyle(host.current).color));
  }, [color, resolvedTheme, host]);

  useEffect(() => {
    if (!hover || !host.current) return;
    const target = host.current.closest<HTMLElement>("[data-lord-host]") ?? host.current.parentElement;
    if (!target) return;
    const play = () => player.current?.playFromBeginning();
    target.addEventListener("mouseenter", play);
    return () => target.removeEventListener("mouseenter", play);
  }, [hover, host]);

  useEffect(() => {
    if (autoplay || playKey !== undefined) {
      const t = setTimeout(() => player.current?.playFromBeginning(), 60);
      return () => clearTimeout(t);
    }
  }, [autoplay, playKey]);

  return <Player ref={player} icon={ICONS[name]} size={size} state={state} colorize={color ?? themeColor} />;
}
