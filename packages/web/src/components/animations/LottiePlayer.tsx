/**
 * LottiePlayer — wrapper around lottie-react for Coastal.AI
 *
 * Lottie plays JSON animation files at 60fps with tiny bundle size.
 * Use for success states, loading spinners, onboarding illustrations.
 *
 * Usage:
 *   // With a local JSON file:
 *   import successAnim from '../../assets/lottie/success.json'
 *   <LottiePlayer animationData={successAnim} size={120} />
 *
 *   // One-shot then freeze:
 *   <LottiePlayer animationData={data} loop={false} onComplete={() => setDone(true)} />
 *
 *   // Preset: pulsing claw while waiting
 *   <LottieSpinner />
 */

import { Lottie } from 'lottie-react'
import type { CSSProperties } from 'react'

interface LottiePlayerProps {
  /** Imported JSON animation data */
  animationData: object
  /** Whether to loop (default true) */
  loop?: boolean
  /** Whether to autoplay (default true) */
  autoplay?: boolean
  /** Square size in px */
  size?: number
  /** Additional CSS class */
  className?: string
  /** Called when a non-looping animation completes */
  onComplete?: () => void
  /** Playback speed multiplier (default 1) */
  speed?: number
}

export function LottiePlayer({
  animationData,
  loop = true,
  autoplay = true,
  size = 80,
  className,
  onComplete,
  speed = 1,
}: LottiePlayerProps) {
  const style: CSSProperties = { width: size, height: size }

  return (
    <Lottie
      // lottie-react 3.x: `src` replaces `animationData` (accepts the parsed
      // object directly, compared by content — not just a URL/path), `speed`
      // is now a reactive prop instead of something set imperatively via
      // lottieRef.current.setSpeed() in an onDOMLoaded callback, and
      // `onComplete` becomes a `subscriptions.complete` handler.
      src={animationData}
      loop={loop}
      autoplay={autoplay}
      speed={speed}
      style={style}
      className={className}
      subscriptions={onComplete ? { complete: onComplete } : undefined}
    />
  )
}

// ─── Fallback spinner — pure CSS wave dots for when no Lottie JSON is ready ──
// Replace with a real Lottie JSON once your designer produces one.
export function LottieSpinner({ size = 48 }: { size?: number }) {
  const dot: CSSProperties = {
    width: size * 0.15,
    height: size * 0.15,
    borderRadius: '50%',
    background: '#00e5ff',
    animation: 'cc-bar 1.2s ease-in-out infinite',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: size * 0.08, height: size * 0.5 }}>
      {[0, 0.15, 0.3].map((d) => (
        <div key={d} style={{ ...dot, animationDelay: `${d}s` }} />
      ))}
    </div>
  )
}
