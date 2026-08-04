"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ<>[]{}()+-*/=#$%@&;:?|\\^~";

type Stream = {
  x: number;
  y: number;
  speed: number;
  length: number;
  alpha: number;
  lineHeight: number;
  mint: boolean;
  glyphs: string[];
  mutationAt: number;
};

function glyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

export function ReceiptCodeRain({ modal = false }: { modal?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;
    const surface: HTMLCanvasElement = canvas;
    const drawing: CanvasRenderingContext2D = context;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let streams: Stream[] = [];
    let frame = 0;
    let startFrame = 0;
    let previousFrame = 0;
    let stopped = false;
    let paintedOnce = false;
    let dark = document.documentElement.dataset.theme !== "light";
    const frameInterval = 1000 / 20;

    function buildStreams(width: number, height: number) {
      const preferredSpacing = width < 640 ? 18 : 22;
      const count = Math.min(88, Math.ceil(width / preferredSpacing) + 2);
      const spacing = width / Math.max(1, count - 1);
      const fontSize = width < 640 ? 8.5 : 10;
      streams = Array.from({ length: count }, (_, index) => {
        const length = 11 + Math.floor(Math.random() * 12);
        return {
          x: index * spacing + (Math.random() - .5) * 2.5,
          y: -height * .6 + Math.random() * height * 1.7,
          speed: 34 + Math.random() * 58,
          length,
          alpha: .2 + Math.random() * .42,
          lineHeight: fontSize * (1.24 + Math.random() * .18),
          mint: index % 7 === 0 || Math.random() > .9,
          glyphs: Array.from({ length }, glyph),
          mutationAt: Math.random() * 700,
        };
      });
    }

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = window.innerWidth;
      const height = window.innerHeight;
      surface.width = Math.floor(width * ratio);
      surface.height = Math.floor(height * ratio);
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
      buildStreams(width, height);
    }

    function resetStream(stream: Stream, height: number) {
      stream.y = -stream.length * stream.lineHeight - Math.random() * height * .65;
      stream.speed = 34 + Math.random() * 58;
      stream.alpha = .2 + Math.random() * .42;
      stream.glyphs = Array.from({ length: stream.length }, glyph);
    }

    function draw(timestamp: number) {
      if (stopped || document.hidden) return;
      if (timestamp - previousFrame < frameInterval) {
        if (!motion.matches) frame = window.requestAnimationFrame(draw);
        return;
      }

      const elapsed = previousFrame ? Math.min((timestamp - previousFrame) / 1000, .06) : 0;
      previousFrame = timestamp;
      const width = window.innerWidth;
      const height = window.innerHeight;
      drawing.clearRect(0, 0, width, height);
      drawing.textAlign = "center";
      drawing.textBaseline = "middle";
      drawing.globalCompositeOperation = "source-over";
      drawing.font = `600 ${width < 640 ? 8.5 : 10}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      drawing.shadowBlur = 0;

      for (const stream of streams) {
        if (!motion.matches) stream.y += stream.speed * elapsed;

        if (timestamp > stream.mutationAt) {
          stream.glyphs[Math.floor(Math.random() * stream.glyphs.length)] = glyph();
          stream.mutationAt = timestamp + 180 + Math.random() * 360;
        }

        for (let index = stream.length - 1; index >= 0; index -= 1) {
          const y = stream.y - index * stream.lineHeight;
          if (y < -stream.lineHeight || y > height + stream.lineHeight) continue;
          const position = 1 - index / stream.length;
          const fade = Math.pow(position, 1.75) * stream.alpha;

          if (index === 0) {
            drawing.fillStyle = dark ? "#efffca" : "#0c6744";
            drawing.globalAlpha = Math.min(dark ? .94 : .72, fade + (dark ? .36 : .2));
          } else if (stream.mint) {
            drawing.fillStyle = dark ? "#55e7d1" : "#007f89";
            drawing.globalAlpha = fade * (dark ? .72 : .48);
          } else {
            drawing.fillStyle = dark ? "#c7ff3d" : "#15875b";
            drawing.globalAlpha = fade * (dark ? 1 : .54);
          }
          drawing.fillText(stream.glyphs[index], stream.x, y);
        }

        if (stream.y - stream.length * stream.lineHeight > height) resetStream(stream, height);
      }
      drawing.globalAlpha = 1;
      drawing.globalCompositeOperation = "source-over";
      if (!paintedOnce) {
        paintedOnce = true;
        setReady(true);
      }
      if (!motion.matches) frame = window.requestAnimationFrame(draw);
    }

    function restartAnimation() {
      window.cancelAnimationFrame(frame);
      previousFrame = 0;
      if (!document.hidden) frame = window.requestAnimationFrame(draw);
    }

    const themeObserver = new MutationObserver(() => {
      dark = document.documentElement.dataset.theme !== "light";
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", restartAnimation);
    motion.addEventListener("change", restartAnimation);
    startFrame = window.requestAnimationFrame(() => {
      if (!stopped) {
        resize();
        frame = window.requestAnimationFrame(draw);
      }
    });

    return () => {
      stopped = true;
      window.cancelAnimationFrame(startFrame);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", restartAnimation);
      motion.removeEventListener("change", restartAnimation);
      themeObserver.disconnect();
    };
  }, []);

  return <div className={`receipt-code-rain${modal ? " receipt-code-rain--modal" : ""}${ready ? " is-ready" : ""}`} aria-hidden="true"><canvas ref={canvasRef} /></div>;
}
