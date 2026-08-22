import type { CSSProperties, ReactElement } from 'react'

export type AgentId = string

interface AgentMeta {
  label: string
  color: string
  svg: () => ReactElement
}

// Default SVG for custom agents
const DefaultAgent = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#0a1628" stroke="#94adc4" strokeWidth="1.5"/>
    <circle cx="40" cy="40" r="32" fill="#051420" opacity="0.6"/>
    <text x="40" y="46" fontSize="18" fill="#94adc4" fontWeight="bold" textAnchor="middle" fontFamily="monospace">?</text>
  </svg>
)

const FALLBACK_COLORS = ['#00e5ff', '#4ade80', '#a78bfa', '#f59e0b', '#f472b6', '#38bdf8', '#a855f7', '#fbbf24', '#fb923c', '#ec4899']

// Generate fallback metadata for unknown agents using a color hash
function getDefaultAgentMeta(agentId: string, displayName?: string): AgentMeta {
  const hash = agentId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const color = FALLBACK_COLORS[hash % FALLBACK_COLORS.length]

  const rawLabel = displayName?.trim() || agentId
  const label = rawLabel
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .substring(0, 10)

  return { label, color, svg: DefaultAgent }
}

// ─── SVG characters ──────────────────────────────────────────────────────────
// Style ref: vibrant cartoon scenes, each character has a signature object/creature.
// viewBox 0 0 80 80 — drawn to fill the circle avatar.

/** General Assistant — friendly round robot with big smile & headphones */
const General = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* bg glow */}
    <circle cx="40" cy="40" r="38" fill="#051832"/>
    <circle cx="40" cy="55" r="22" fill="#0a2540" opacity="0.8"/>
    {/* body */}
    <rect x="27" y="50" width="26" height="18" rx="6" fill="#1a3a5c" stroke="#00e5ff" strokeWidth="1.2"/>
    {/* neck */}
    <rect x="36" y="46" width="8" height="6" rx="2" fill="#0d2a40"/>
    {/* head */}
    <rect x="20" y="22" width="40" height="28" rx="12" fill="#1a3a5c" stroke="#00e5ff" strokeWidth="1.5"/>
    {/* headphones */}
    <path d="M20 32 Q16 32 16 38 Q16 44 20 44" stroke="#00e5ff" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M60 32 Q64 32 64 38 Q64 44 60 44" stroke="#00e5ff" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <rect x="14" y="35" width="7" height="8" rx="2" fill="#00e5ff" opacity="0.7"/>
    <rect x="59" y="35" width="7" height="8" rx="2" fill="#00e5ff" opacity="0.7"/>
    {/* antenna */}
    <line x1="40" y1="22" x2="40" y2="14" stroke="#00e5ff" strokeWidth="1.5"/>
    <circle cx="40" cy="12" r="3" fill="#00e5ff" opacity="0.9"/>
    {/* eyes */}
    <circle cx="31" cy="34" r="6" fill="#051832" stroke="#00e5ff" strokeWidth="1"/>
    <circle cx="49" cy="34" r="6" fill="#051832" stroke="#00e5ff" strokeWidth="1"/>
    <circle cx="31" cy="34" r="3.5" fill="#00e5ff" opacity="0.9"/>
    <circle cx="49" cy="34" r="3.5" fill="#00e5ff" opacity="0.9"/>
    <circle cx="32.5" cy="32.5" r="1.5" fill="white" opacity="0.8"/>
    <circle cx="50.5" cy="32.5" r="1.5" fill="white" opacity="0.8"/>
    {/* smile */}
    <path d="M32 43 Q40 50 48 43" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" fill="none"/>
    {/* chest panel */}
    <rect x="32" y="54" width="16" height="8" rx="2" fill="#051832" stroke="#00e5ff" strokeWidth="0.8" opacity="0.7"/>
    <circle cx="38" cy="58" r="2" fill="#00e5ff" opacity="0.6"/>
    <circle cx="44" cy="58" r="2" fill="#00e5ff" opacity="0.3"/>
  </svg>
)

/** CFO — abacus with gear, coins, shark fin */
const CFO = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#051a10"/>
    {/* neon ring */}
    <circle cx="40" cy="40" r="34" stroke="#4ade80" strokeWidth="1" opacity="0.25" fill="none"/>
    {/* abacus frame */}
    <rect x="18" y="20" width="34" height="36" rx="3" fill="#1a3a20" stroke="#4ade80" strokeWidth="1.5"/>
    {/* abacus rods */}
    {[28,35,42,49].map((y,i) => (
      <g key={i}>
        <line x1="21" y1={y} x2="49" y2={y} stroke="#4ade80" strokeWidth="0.8" opacity="0.5"/>
        {/* beads */}
        {[24,29,34,39,44].map((x,j) => (
          <circle key={j} cx={x} cy={y} r="3.2" fill={j < 2 ? '#4ade80' : '#1a3a20'} stroke="#4ade80" strokeWidth="0.7"/>
        ))}
      </g>
    ))}
    {/* top bar */}
    <rect x="18" y="20" width="34" height="5" rx="2" fill="#0d2a15" stroke="#4ade80" strokeWidth="1"/>
    {/* gear */}
    <circle cx="58" cy="26" r="11" fill="#0d2a15" stroke="#4ade80" strokeWidth="1.2"/>
    <circle cx="58" cy="26" r="6" fill="#1a3a20" stroke="#4ade80" strokeWidth="0.8"/>
    {[0,45,90,135,180,225,270,315].map((a,i) => (
      <rect key={i} x="56.5" y="13" width="3" height="4" rx="1" fill="#4ade80"
        transform={`rotate(${a} 58 26)`} opacity="0.8"/>
    ))}
    {/* coin stack */}
    {[60,57,54].map((y,i) => (
      <ellipse key={i} cx="62" cy={y} rx="9" ry="3.5" fill="#4ade80" opacity={0.7 - i*0.15} stroke="#4ade80" strokeWidth="0.5"/>
    ))}
    <text x="56.5" y="62" fontSize="6" fill="#051a10" fontWeight="bold" fontFamily="monospace">$</text>
    {/* bar chart */}
    <rect x="21" y="62" width="5" height="8" fill="#4ade80" opacity="0.5"/>
    <rect x="28" y="58" width="5" height="12" fill="#4ade80" opacity="0.65"/>
    <rect x="35" y="54" width="5" height="16" fill="#4ade80" opacity="0.8"/>
    {/* shark fin */}
    <path d="M46 70 L50 58 L56 70 Z" fill="#4ade80" opacity="0.4"/>
  </svg>
)

/** CTO — giant mechanical eye on circuit board, server racks */
const CTO = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#0a051a"/>
    {/* server racks bg */}
    <rect x="4" y="18" width="10" height="44" rx="2" fill="#120820" stroke="#a78bfa" strokeWidth="0.7" opacity="0.5"/>
    <rect x="66" y="18" width="10" height="44" rx="2" fill="#120820" stroke="#a78bfa" strokeWidth="0.7" opacity="0.5"/>
    {[22,28,34,40,46,52].map((y,i) => (
      <g key={i}>
        <rect x="5" y={y} width="8" height="4" rx="1" fill="#1a0d30" stroke="#a78bfa" strokeWidth="0.4"/>
        <circle cx="11" cy={y+2} r="1" fill="#a78bfa" opacity={i%2===0?0.8:0.3}/>
        <rect x="67" y={y} width="8" height="4" rx="1" fill="#1a0d30" stroke="#a78bfa" strokeWidth="0.4"/>
        <circle cx="73" cy={y+2} r="1" fill="#a78bfa" opacity={i%2!==0?0.8:0.3}/>
      </g>
    ))}
    {/* neon ring */}
    <circle cx="40" cy="40" r="22" stroke="#a78bfa" strokeWidth="1.5" opacity="0.4" fill="none"/>
    <circle cx="40" cy="40" r="22" stroke="#00ff88" strokeWidth="1" strokeDasharray="4 8" opacity="0.3" fill="none"/>
    {/* eyeball housing */}
    <circle cx="40" cy="40" r="18" fill="#120820" stroke="#a78bfa" strokeWidth="1.5"/>
    {/* iris */}
    <circle cx="40" cy="40" r="12" fill="#1a0d30" stroke="#a78bfa" strokeWidth="1"/>
    {/* pupil */}
    <circle cx="40" cy="40" r="7" fill="#0a051a" stroke="#a78bfa" strokeWidth="0.8"/>
    <circle cx="40" cy="40" r="4" fill="#a78bfa" opacity="0.9"/>
    <circle cx="38" cy="38" r="2" fill="white" opacity="0.7"/>
    {/* circuit lines from eye */}
    <line x1="58" y1="40" x2="65" y2="40" stroke="#a78bfa" strokeWidth="0.8" opacity="0.6"/>
    <line x1="65" y1="40" x2="65" y2="30" stroke="#a78bfa" strokeWidth="0.8" opacity="0.6"/>
    <line x1="22" y1="40" x2="15" y2="40" stroke="#a78bfa" strokeWidth="0.8" opacity="0.6"/>
    <line x1="40" y1="58" x2="40" y2="65" stroke="#a78bfa" strokeWidth="0.8" opacity="0.6"/>
    <line x1="40" y1="22" x2="40" y2="15" stroke="#a78bfa" strokeWidth="0.8" opacity="0.6"/>
    {/* bolts */}
    {[[-13,-13],[13,-13],[13,13],[-13,13]].map(([dx,dy],i) => (
      <circle key={i} cx={40+dx} cy={40+dy} r="2.5" fill="#120820" stroke="#a78bfa" strokeWidth="0.8"/>
    ))}
  </svg>
)

/** COO — metronome with piano keys, globe, coastal city silhouette */
const COO = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#0d1020"/>
    {/* city silhouette */}
    <rect x="4" y="58" width="72" height="20" fill="#0d1020"/>
    <rect x="6" y="50" width="8" height="28" fill="#151828"/>
    <rect x="16" y="54" width="6" height="24" fill="#151828"/>
    <rect x="24" y="46" width="10" height="32" fill="#151828"/>
    <rect x="55" y="52" width="8" height="26" fill="#151828"/>
    <rect x="65" y="48" width="9" height="30" fill="#151828"/>
    {/* lighthouse */}
    <rect x="34" y="42" width="12" height="20" rx="1" fill="#1a2040" stroke="#f59e0b" strokeWidth="0.7"/>
    <path d="M34 42 L40 30 L46 42 Z" fill="#1a2040" stroke="#f59e0b" strokeWidth="0.7"/>
    <circle cx="40" cy="28" r="4" fill="#f59e0b" opacity="0.8"/>
    {/* metronome */}
    <path d="M40 20 L25 68 L55 68 Z" fill="#1a2040" stroke="#f59e0b" strokeWidth="1.5"/>
    <line x1="25" y1="68" x2="55" y2="68" stroke="#f59e0b" strokeWidth="2"/>
    {/* pendulum */}
    <line x1="40" y1="22" x2="52" y2="52" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="52" cy="52" r="4" fill="#f59e0b" opacity="0.8"/>
    {/* globe on top */}
    <circle cx="40" cy="20" r="8" fill="#0d2040" stroke="#f59e0b" strokeWidth="1"/>
    <ellipse cx="40" cy="20" rx="5" ry="8" fill="none" stroke="#f59e0b" strokeWidth="0.7" opacity="0.5"/>
    <line x1="32" y1="20" x2="48" y2="20" stroke="#f59e0b" strokeWidth="0.7" opacity="0.5"/>
    {/* piano keys */}
    {[26,30,34,38,42,46,50].map((x,i) => (
      <rect key={i} x={x} y="63" width="3" height="8" rx="0.5" fill="white" stroke="#0d1020" strokeWidth="0.3"/>
    ))}
    {[28,32,40,44,48].map((x,i) => (
      <rect key={i} x={x} y="63" width="2.5" height="5" rx="0.5" fill="#0d1020"/>
    ))}
    {/* bitcoin */}
    <circle cx="62" cy="22" r="6" fill="#0d2040" stroke="#f59e0b" strokeWidth="0.8"/>
    <text x="58.5" y="25.5" fontSize="7" fill="#f59e0b" fontFamily="monospace" fontWeight="bold">₿</text>
  </svg>
)

/** Product Manager — radar/sonar screen with roadmap, ship, sticky notes */
const ProductManager = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#051218"/>
    {/* whiteboard */}
    <rect x="12" y="14" width="56" height="52" rx="3" fill="#e8f0f8" stroke="#f472b6" strokeWidth="1.5"/>
    <rect x="12" y="14" width="56" height="6" rx="3" fill="#dce8f0" stroke="#f472b6" strokeWidth="1"/>
    {/* radar screen */}
    <circle cx="36" cy="42" r="18" fill="#051a22" stroke="#f472b6" strokeWidth="1.2"/>
    <circle cx="36" cy="42" r="12" stroke="#f472b6" strokeWidth="0.6" fill="none" opacity="0.4"/>
    <circle cx="36" cy="42" r="6" stroke="#f472b6" strokeWidth="0.6" fill="none" opacity="0.4"/>
    <line x1="36" y1="24" x2="36" y2="60" stroke="#f472b6" strokeWidth="0.5" opacity="0.3"/>
    <line x1="18" y1="42" x2="54" y2="42" stroke="#f472b6" strokeWidth="0.5" opacity="0.3"/>
    {/* radar sweep */}
    <path d="M36 42 L48 30 A18 18 0 0 1 54 42 Z" fill="#f472b6" opacity="0.15"/>
    <line x1="36" y1="42" x2="48" y2="30" stroke="#f472b6" strokeWidth="1.2" opacity="0.8"/>
    {/* blips */}
    <circle cx="44" cy="36" r="2" fill="#f472b6" opacity="0.9"/>
    <circle cx="30" cy="48" r="1.5" fill="#f472b6" opacity="0.6"/>
    <circle cx="40" cy="50" r="1" fill="#f472b6" opacity="0.5"/>
    {/* ship */}
    <path d="M30 38 L36 34 L42 38 L40 40 L32 40 Z" fill="#f472b6" opacity="0.7"/>
    <line x1="36" y1="34" x2="36" y2="30" stroke="#f472b6" strokeWidth="0.8"/>
    {/* sticky notes */}
    <rect x="56" y="18" width="10" height="10" rx="1" fill="#fbbf24" opacity="0.9"/>
    <rect x="56" y="30" width="10" height="10" rx="1" fill="#34d399" opacity="0.9"/>
    <rect x="56" y="42" width="10" height="10" rx="1" fill="#60a5fa" opacity="0.9"/>
    {/* ROADMAP text */}
    <text x="17" y="24" fontSize="5" fill="#0a2030" fontFamily="monospace" fontWeight="bold">ROADMAP</text>
  </svg>
)

/** Frontend Wizard — flaming wolf/fox mask on monitor with code */
const FrontendWizard = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#080518"/>
    {/* monitor */}
    <rect x="10" y="22" width="60" height="42" rx="4" fill="#100828" stroke="#38bdf8" strokeWidth="1.5"/>
    <rect x="14" y="26" width="52" height="34" rx="2" fill="#060312"/>
    <rect x="28" y="64" width="24" height="5" rx="1" fill="#100828" stroke="#38bdf8" strokeWidth="0.8"/>
    <rect x="22" y="68" width="36" height="3" rx="1" fill="#100828" stroke="#38bdf8" strokeWidth="0.8"/>
    {/* code lines */}
    {[30,35,40,45,50].map((y,i) => (
      <rect key={i} x="16" y={y} width={20 + (i%3)*8} height="2.5" rx="1" fill="#38bdf8" opacity={0.15 + i*0.05}/>
    ))}
    <rect x="16" y="30" width="10" height="2.5" rx="1" fill="#a855f7" opacity="0.4"/>
    <rect x="28" y="30" width="16" height="2.5" rx="1" fill="#38bdf8" opacity="0.3"/>
    <rect x="16" y="45" width="8" height="2.5" rx="1" fill="#f472b6" opacity="0.4"/>
    {/* flame wolf mask — centered on screen */}
    {/* flame base */}
    <path d="M40 58 Q30 50 32 38 Q36 44 38 40 Q40 34 40 28 Q42 34 44 30 Q46 36 44 42 Q46 38 50 40 Q52 52 40 58Z"
      fill="url(#flame)" opacity="0.85"/>
    <defs>
      <linearGradient id="flame" x1="40" y1="58" x2="40" y2="28" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38bdf8"/>
        <stop offset="50%" stopColor="#a855f7"/>
        <stop offset="100%" stopColor="#f472b6"/>
      </linearGradient>
    </defs>
    {/* mask face */}
    <path d="M32 48 Q36 52 40 52 Q44 52 48 48 Q50 42 48 36 Q44 32 40 32 Q36 32 32 36 Q30 42 32 48Z"
      fill="#080518" opacity="0.8"/>
    {/* glowing eyes */}
    <ellipse cx="36" cy="42" rx="3" ry="2.5" fill="#38bdf8" opacity="0.95"/>
    <ellipse cx="44" cy="42" rx="3" ry="2.5" fill="#38bdf8" opacity="0.95"/>
    <ellipse cx="36" cy="42" rx="1.5" ry="1.2" fill="white" opacity="0.6"/>
    <ellipse cx="44" cy="42" rx="1.5" ry="1.2" fill="white" opacity="0.6"/>
    {/* snout */}
    <path d="M38 46 Q40 48 42 46" stroke="#38bdf8" strokeWidth="1" fill="none" opacity="0.7"/>
    {/* ears */}
    <path d="M32 36 L28 28 L36 34 Z" fill="#a855f7" opacity="0.7"/>
    <path d="M48 36 L52 28 L44 34 Z" fill="#a855f7" opacity="0.7"/>
  </svg>
)

/** UX Architect — glowing octopus/sea creature with clipboard, coral, user flow */
const UXArchitect = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#041218"/>
    {/* underwater bg gradient */}
    <circle cx="40" cy="40" r="38" fill="#051a20" opacity="0.8"/>
    {/* coral left */}
    <path d="M8 72 Q8 62 12 58 Q10 54 14 52 Q12 48 16 46" stroke="#f472b6" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6"/>
    <circle cx="16" cy="46" r="3" fill="#f472b6" opacity="0.5"/>
    <circle cx="14" cy="52" r="2.5" fill="#f472b6" opacity="0.4"/>
    <circle cx="12" cy="58" r="2" fill="#ec4899" opacity="0.4"/>
    {/* coral right */}
    <path d="M72 72 Q72 60 68 56 Q70 52 66 50 Q68 46 64 44" stroke="#34d399" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.5"/>
    <circle cx="64" cy="44" r="3" fill="#34d399" opacity="0.5"/>
    {/* user flow nodes */}
    <circle cx="16" cy="22" r="4" fill="#051a20" stroke="#34d399" strokeWidth="1"/>
    <circle cx="28" cy="15" r="4" fill="#051a20" stroke="#34d399" strokeWidth="1"/>
    <circle cx="40" cy="12" r="4" fill="#051a20" stroke="#34d399" strokeWidth="1"/>
    <line x1="20" y1="22" x2="24" y2="18" stroke="#34d399" strokeWidth="0.8" opacity="0.6"/>
    <line x1="32" y1="15" x2="36" y2="13" stroke="#34d399" strokeWidth="0.8" opacity="0.6"/>
    {/* octopus body */}
    <ellipse cx="40" cy="36" rx="16" ry="14" fill="#2a0a40" stroke="#a855f7" strokeWidth="1.5"/>
    {/* bioluminescent spots */}
    <circle cx="34" cy="32" r="2.5" fill="#34d399" opacity="0.7"/>
    <circle cx="44" cy="30" r="2" fill="#34d399" opacity="0.6"/>
    <circle cx="40" cy="36" r="1.5" fill="#34d399" opacity="0.5"/>
    <circle cx="36" cy="40" r="1" fill="#a855f7" opacity="0.7"/>
    {/* eyes */}
    <circle cx="34" cy="32" r="5" fill="#0d0820" stroke="#a855f7" strokeWidth="1"/>
    <circle cx="34" cy="32" r="3" fill="#a855f7" opacity="0.9"/>
    <circle cx="33" cy="31" r="1.5" fill="white" opacity="0.7"/>
    <circle cx="46" cy="32" r="5" fill="#0d0820" stroke="#a855f7" strokeWidth="1"/>
    <circle cx="46" cy="32" r="3" fill="#a855f7" opacity="0.9"/>
    <circle cx="45" cy="31" r="1.5" fill="white" opacity="0.7"/>
    {/* tentacles */}
    <path d="M28 46 Q24 56 20 62 Q18 66 22 68" stroke="#a855f7" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M32 50 Q30 62 28 70" stroke="#a855f7" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M40 52 Q40 64 38 72" stroke="#a855f7" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M48 50 Q50 62 52 70" stroke="#a855f7" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M52 46 Q56 56 60 62 Q62 66 58 68" stroke="#a855f7" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    {/* clipboard */}
    <rect x="54" y="28" width="16" height="20" rx="2" fill="#0d2020" stroke="#34d399" strokeWidth="1"/>
    <rect x="58" y="25" width="8" height="4" rx="1" fill="#0d2020" stroke="#34d399" strokeWidth="0.8"/>
    <line x1="56" y1="34" x2="68" y2="34" stroke="#34d399" strokeWidth="0.7" opacity="0.6"/>
    <line x1="56" y1="38" x2="68" y2="38" stroke="#34d399" strokeWidth="0.7" opacity="0.6"/>
    <line x1="56" y1="42" x2="64" y2="42" stroke="#34d399" strokeWidth="0.7" opacity="0.6"/>
  </svg>
)

/** QA Lead — robot with blue glowing eyes, magnifying glass, bug on screen */
const QALead = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#0a0e18"/>
    {/* monitor in background */}
    <rect x="8" y="18" width="50" height="36" rx="3" fill="#0d1525" stroke="#fbbf24" strokeWidth="1"/>
    <rect x="12" y="22" width="42" height="28" rx="1" fill="#060e1a"/>
    {/* bug on screen */}
    <ellipse cx="30" cy="34" rx="8" ry="6" fill="#8b0000" stroke="#fbbf24" strokeWidth="0.8" opacity="0.8"/>
    <line x1="26" y1="30" x2="22" y2="26" stroke="#fbbf24" strokeWidth="0.8" opacity="0.6"/>
    <line x1="30" y1="29" x2="30" y2="24" stroke="#fbbf24" strokeWidth="0.8" opacity="0.6"/>
    <line x1="34" y1="30" x2="38" y2="26" stroke="#fbbf24" strokeWidth="0.8" opacity="0.6"/>
    <line x1="26" y1="38" x2="22" y2="42" stroke="#fbbf24" strokeWidth="0.8" opacity="0.6"/>
    <line x1="34" y1="38" x2="38" y2="42" stroke="#fbbf24" strokeWidth="0.8" opacity="0.6"/>
    <circle cx="28" cy="34" r="2" fill="#ff4444" opacity="0.9"/>
    <circle cx="32" cy="34" r="2" fill="#ff4444" opacity="0.9"/>
    {/* bar chart on screen */}
    <rect x="42" y="40" width="4" height="8" fill="#34d399" opacity="0.6"/>
    <rect x="47" y="36" width="4" height="12" fill="#f59e0b" opacity="0.6"/>
    {/* robot head */}
    <rect x="46" y="30" width="26" height="22" rx="5" fill="#1a2535" stroke="#60a5fa" strokeWidth="1.5"/>
    {/* visor */}
    <rect x="49" y="34" width="20" height="10" rx="3" fill="#051832" stroke="#60a5fa" strokeWidth="1"/>
    {/* eyes */}
    <circle cx="56" cy="39" r="4" fill="#051832" stroke="#60a5fa" strokeWidth="0.8"/>
    <circle cx="56" cy="39" r="2.5" fill="#60a5fa" opacity="0.9"/>
    <circle cx="55" cy="38" r="1.2" fill="white" opacity="0.7"/>
    <circle cx="66" cy="39" r="4" fill="#051832" stroke="#60a5fa" strokeWidth="0.8"/>
    <circle cx="66" cy="39" r="2.5" fill="#60a5fa" opacity="0.9"/>
    <circle cx="65" cy="38" r="1.2" fill="white" opacity="0.7"/>
    {/* mouth panel */}
    <rect x="52" y="46" width="14" height="4" rx="1" fill="#051832" stroke="#60a5fa" strokeWidth="0.6"/>
    <line x1="55" y1="48" x2="57" y2="48" stroke="#60a5fa" strokeWidth="0.8"/>
    <line x1="59" y1="48" x2="61" y2="48" stroke="#60a5fa" strokeWidth="0.8"/>
    <line x1="63" y1="48" x2="64" y2="48" stroke="#60a5fa" strokeWidth="0.8"/>
    {/* magnifying glass */}
    <circle cx="36" cy="56" r="12" stroke="#fbbf24" strokeWidth="2" fill="#060e1a" fillOpacity="0.7"/>
    <circle cx="36" cy="56" r="8" stroke="#fbbf24" strokeWidth="1" fill="none" opacity="0.4"/>
    <line x1="45" y1="65" x2="54" y2="74" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round"/>
    {/* found bug inside magnifier */}
    <circle cx="35" cy="56" r="3.5" fill="#ff4444" opacity="0.8"/>
    <line x1="32" y1="53" x2="30" y2="51" stroke="#fbbf24" strokeWidth="0.8"/>
    <line x1="38" y1="53" x2="40" y2="51" stroke="#fbbf24" strokeWidth="0.8"/>
    {/* checklist */}
    <rect x="60" y="56" width="14" height="18" rx="2" fill="#0d1525" stroke="#fbbf24" strokeWidth="0.8"/>
    <line x1="62" y1="62" x2="72" y2="62" stroke="#fbbf24" strokeWidth="0.5" opacity="0.5"/>
    <line x1="62" y1="66" x2="72" y2="66" stroke="#fbbf24" strokeWidth="0.5" opacity="0.5"/>
    <line x1="62" y1="70" x2="72" y2="70" stroke="#fbbf24" strokeWidth="0.5" opacity="0.5"/>
    <path d="M62 62 L64 64 L68 60" stroke="#34d399" strokeWidth="1" strokeLinecap="round"/>
    <path d="M62 66 L64 68 L68 64" stroke="#34d399" strokeWidth="1" strokeLinecap="round"/>
    <path d="M62 70 L63 71" stroke="#fbbf24" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
  </svg>
)

/** System Integrator — central CPU chip with thick cables/wires radiating out */
const SystemIntegrator = () => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#0a0d18"/>
    {/* cables — thick steampunk style */}
    <path d="M40 40 Q20 30 8 20" stroke="#fb923c" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q20 40 8 40" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q20 50 8 60" stroke="#fb923c" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q50 20 60 8" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q40 20 40 8" stroke="#fb923c" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6"/>
    <path d="M40 40 Q60 30 72 20" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q60 40 72 40" stroke="#fb923c" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q60 50 72 60" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q50 60 60 72" stroke="#fb923c" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M40 40 Q40 60 40 72" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6"/>
    <path d="M40 40 Q20 60 8 72" stroke="#fb923c" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
    {/* connector ends */}
    {[[8,20],[8,40],[8,60],[40,8],[72,20],[72,40],[72,60],[60,8],[60,72],[40,72],[8,72]].map(([x,y],i)=>(
      <rect key={i} x={x-4} y={y-4} width="8" height="8" rx="2" fill="#1a1005" stroke="#fb923c" strokeWidth="1" opacity="0.8"/>
    ))}
    {/* CPU chip */}
    <rect x="22" y="22" width="36" height="36" rx="4" fill="#1a1005" stroke="#fb923c" strokeWidth="2"/>
    <rect x="26" y="26" width="28" height="28" rx="2" fill="#0d0a02" stroke="#fbbf24" strokeWidth="1"/>
    {/* chip pins top/bottom */}
    {[28,33,38,43,48].map((x,i)=>(
      <g key={i}>
        <rect x={x} y="18" width="3" height="5" rx="0.5" fill="#fb923c" opacity="0.8"/>
        <rect x={x} y="57" width="3" height="5" rx="0.5" fill="#fb923c" opacity="0.8"/>
      </g>
    ))}
    {/* chip pins left/right */}
    {[28,33,38,43,48].map((y,i)=>(
      <g key={i}>
        <rect x="18" y={y} width="5" height="3" rx="0.5" fill="#fb923c" opacity="0.8"/>
        <rect x="57" y={y} width="5" height="3" rx="0.5" fill="#fb923c" opacity="0.8"/>
      </g>
    ))}
    {/* circuit text */}
    <text x="29" y="37" fontSize="5" fill="#fb923c" fontFamily="monospace" opacity="0.8">SYS</text>
    <text x="28" y="44" fontSize="5" fill="#fbbf24" fontFamily="monospace" opacity="0.8">INT</text>
    {/* center glow */}
    <circle cx="40" cy="40" r="6" fill="#fb923c" opacity="0.15"/>
    <circle cx="40" cy="40" r="3" fill="#fbbf24" opacity="0.4"/>
  </svg>
)

// ─── Registry ─────────────────────────────────────────────────────────────────

const AGENT_META_KNOWN: Record<string, AgentMeta> = {
  general:           { label: 'General',   color: '#00e5ff', svg: General },
  cfo:               { label: 'CFO',       color: '#4ade80', svg: CFO },
  cto:               { label: 'CTO',       color: '#a78bfa', svg: CTO },
  coo:               { label: 'COO',       color: '#f59e0b', svg: COO },
  product_manager:   { label: 'PM',        color: '#f472b6', svg: ProductManager },
  frontend_wizard:   { label: 'Frontend',  color: '#38bdf8', svg: FrontendWizard },
  ux_architect:      { label: 'UX',        color: '#a855f7', svg: UXArchitect },
  qa_lead:           { label: 'QA',        color: '#fbbf24', svg: QALead },
  system_integrator: { label: 'SysInt',    color: '#fb923c', svg: SystemIntegrator },
}

// eslint-disable-next-line react-refresh/only-export-components
export function getAgentMeta(agentId: string, displayName?: string): AgentMeta {
  return AGENT_META_KNOWN[agentId] ?? getDefaultAgentMeta(agentId, displayName)
}

// Backward compatibility export
export const AGENT_META = AGENT_META_KNOWN

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  agents: Array<{ id: string; name: string; active: boolean }>
  selected: string | null
  onSelect: (id: string | null) => void
  vertical?: boolean
}

export function AgentCharacters({ agents, selected, onSelect, vertical = false }: Props) {
  const active = agents.filter(a => a.active)

  if (vertical) {
    return (
      <>
        {/* AUTO button */}
        <button
          onClick={() => onSelect(null)}
          title="Auto-route to best agent"
          className="flex flex-col items-center gap-1 transition-all duration-200"
          style={{ opacity: selected === null ? 1 : 0.45 }}
        >
          <div
            className="w-12 h-12 rounded-full border flex items-center justify-center text-[9px] font-mono transition-all"
            style={selected === null
              ? { borderColor: '#00e5ff', background: 'rgba(0,229,255,0.12)', color: '#00e5ff', boxShadow: '0 0 12px rgba(0,229,255,0.4)' }
              : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#6b7280' }
            }
          >
            AUTO
          </div>
          <span className="text-[8px] font-mono" style={{ color: selected === null ? '#00e5ff' : '#4b5563' }}>
            auto
          </span>
        </button>

        <div className="w-8 h-px bg-white/5 my-1 shrink-0" />

        {active.map(agent => {
          const meta = getAgentMeta(agent.id, agent.name)
          const isSelected = selected === agent.id
          const glowColor = meta.color

          const style: CSSProperties = {
            borderColor: isSelected ? glowColor : `${glowColor}55`,
            background: 'rgba(5,10,15,0.9)',
            boxShadow: isSelected ? `0 0 0 2px ${glowColor}, 0 0 20px ${glowColor}55` : `0 0 6px ${glowColor}22`,
          }

          return (
            <button
              key={agent.id}
              onClick={() => onSelect(isSelected ? null : agent.id)}
              title={agent.name}
              className="flex flex-col items-center gap-1 transition-all duration-200"
              style={{
                opacity: isSelected ? 1 : 0.82,
                transform: isSelected ? 'scale(1.12)' : 'scale(1)',
              }}
              onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.opacity = '1' }}
              onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.opacity = '0.82' }}
            >
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 transition-all duration-200" style={style}>
                <meta.svg />
              </div>
              <span
                className="text-[8px] font-mono tracking-wide leading-none"
                style={{ color: isSelected ? glowColor : '#9ca3af' }}
              >
                {meta.label}
              </span>
            </button>
          )
        })}
      </>
    )
  }

  // Horizontal fallback
  return (
    <div className="flex items-end gap-3 overflow-x-auto py-2 px-1">
      <button onClick={() => onSelect(null)} className="shrink-0 flex flex-col items-center gap-1 transition-all"
        style={{ opacity: selected === null ? 1 : 0.45 }}>
        <div className="w-12 h-12 rounded-full border flex items-center justify-center text-xs font-mono"
          style={selected === null
            ? { borderColor: '#00e5ff', background: 'rgba(0,229,255,0.12)', color: '#00e5ff' }
            : { borderColor: 'rgba(255,255,255,0.1)', background: 'transparent', color: '#6b7280' }}>
          AUTO
        </div>
        <span className="text-[9px] font-mono text-gray-500">auto</span>
      </button>
      <div className="w-px h-12 bg-gray-800 shrink-0" />
      {active.map(agent => {
        const meta = getAgentMeta(agent.id, agent.name)
        const isSelected = selected === agent.id
        return (
          <button key={agent.id} onClick={() => onSelect(isSelected ? null : agent.id)}
            title={agent.name} className="shrink-0 flex flex-col items-center gap-1 transition-all duration-200"
            style={{ opacity: isSelected ? 1 : 0.82, transform: isSelected ? 'scale(1.1)' : 'scale(1)' }}>
            <div className="w-14 h-14 rounded-full overflow-hidden border-2 transition-all duration-200"
              style={{ borderColor: isSelected ? meta.color : `${meta.color}55`, background: 'rgba(5,10,15,0.9)',
                boxShadow: isSelected ? `0 0 0 2px ${meta.color}, 0 0 16px ${meta.color}55` : `0 0 6px ${meta.color}22` }}>
              <meta.svg />
            </div>
            <span className="text-[9px] font-mono" style={{ color: isSelected ? meta.color : '#9ca3af' }}>
              {meta.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
