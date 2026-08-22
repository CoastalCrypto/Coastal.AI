/**
 * RiveAgent — Rive interactive animation for agent avatars
 *
 * Rive animations have STATE MACHINES — the avatar transitions between
 * idle, thinking, and speaking states based on the agent's live status.
 *
 * How to create the .riv file:
 *   1. Go to rive.app → New file
 *   2. Design 3 states: "idle" (gentle pulse), "thinking" (spin/rotate),
 *      "speaking" (wave/bounce)
 *   3. Add a State Machine called "AgentController"
 *   4. Add a Boolean input "isThinking" and a Boolean "isSpeaking"
 *   5. Export → Download .riv → place in packages/web/public/animations/
 *
 * Usage:
 *   <RiveAgent domain="cfo" isThinking={loading} isSpeaking={false} />
 *
 * Until you have a .riv file, this component renders the CSS fallback.
 */

import { useEffect } from 'react'
import { useRive, useStateMachineInput } from '@rive-app/react-canvas'

export type AgentState = 'idle' | 'thinking' | 'speaking'

const DOMAIN_COLORS: Record<string, string> = {
  coo: '#0094c8',
  cfo: '#00b4d8',
  cto: '#00e5ff',
  general: '#004e70',
}

const DOMAIN_LABELS: Record<string, string> = {
  coo: 'COO',
  cfo: 'CFO',
  cto: 'CTO',
  general: 'AGENT',
}

interface RiveAgentProps {
  domain: 'coo' | 'cfo' | 'cto' | 'general'
  isThinking?: boolean
  isSpeaking?: boolean
  size?: number
}

export function RiveAgent({
  domain,
  isThinking = false,
  isSpeaking = false,
  size = 120,
}: RiveAgentProps) {
  const { RiveComponent, rive } = useRive({
    // Drop your exported .riv file into public/animations/
    // Create one at rive.app — free tier supports full state machines
    src: '/animations/agent-avatar.riv',
    stateMachines: 'AgentController',
    autoplay: true,
    onLoadError: () => {
      // .riv file not yet created — silently fall back to CSS avatar below
    },
  })

  // Wire live state to the Rive state machine inputs
  const thinkingInput = useStateMachineInput(rive, 'AgentController', 'isThinking')
  const speakingInput = useStateMachineInput(rive, 'AgentController', 'isSpeaking')

  useEffect(() => {
    // Rive's StateMachineInput API is a mutable binding — assigning .value
    // is how you drive the state machine, not a React-owned value.
    // eslint-disable-next-line react-hooks/immutability
    if (thinkingInput) thinkingInput.value = isThinking
  }, [thinkingInput, isThinking])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    if (speakingInput) speakingInput.value = isSpeaking
  }, [speakingInput, isSpeaking])

  const color = DOMAIN_COLORS[domain]
  const label = DOMAIN_LABELS[domain]

  // ── CSS fallback avatar (shown until .riv file is provided) ────────────────
  const state: AgentState = isThinking ? 'thinking' : isSpeaking ? 'speaking' : 'idle'

  const ring: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    border: `2px solid ${color}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    animation:
      state === 'thinking'
        ? 'cc-claw-beat 0.9s ease-in-out infinite'
        : state === 'speaking'
        ? 'cc-wave 0.6s ease-in-out infinite'
        : 'cc-node-glow 3s ease-in-out infinite',
    boxShadow: `0 0 ${state === 'idle' ? 8 : 20}px ${color}55`,
  }

  if (!rive) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={ring}>
          <svg width={size * 0.5} height={size * 0.55} viewBox="0 0 44 52" fill="none">
            <g transform="translate(22,28)">
              <path d="M0 0 C-8 -5 -14 -13 -11 -23 C-9 -32 -1 -33 3 -28 C5 -24 4 -18 0 -14"
                stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round"/>
              <path d="M0 0 C8 -5 14 -13 11 -23 C9 -32 1 -33 -3 -28 C-5 -24 -4 -18 0 -14"
                stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round"/>
              <path d="M0 0 L0 12" stroke={color} strokeWidth={2.5} strokeLinecap="round"/>
              <circle cx={-11} cy={-23} r={3} fill={color}/>
              <circle cx={11} cy={-23} r={3} fill={color}/>
              <circle cx={0} cy={0} r={4} fill={color}/>
            </g>
          </svg>
        </div>
        <div style={{ color, fontSize: 11, fontFamily: 'monospace', letterSpacing: 3, marginTop: 8 }}>
          {label}
        </div>
        <div style={{ color: '#e8f6fb', fontSize: 11, opacity: 0.5, marginTop: 2 }}>
          {state}
        </div>
      </div>
    )
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <RiveComponent style={{ width: size, height: size }} />
      <div style={{ color, fontSize: 11, fontFamily: 'monospace', letterSpacing: 3, marginTop: 8 }}>
        {label}
      </div>
    </div>
  )
}
