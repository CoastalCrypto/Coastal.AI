import { useState } from 'react'
import { coreClient } from '../../api/client'

export function FirstRunWizard({ onComplete }: { onComplete: (mode: string) => void }) {
  const [selected, setSelected] = useState('hands-on')

  const modes = [
    { id: 'hands-on', label: 'Hands-on', sublabel: '(safest)', desc: 'See every change before it happens.' },
    { id: 'hands-off', label: 'Hands-off', sublabel: '', desc: 'Only see pull requests.' },
    { id: 'autopilot', label: 'Autopilot', sublabel: '(riskiest)', desc: "Don't ask me unless something breaks." },
  ]

  const handleSave = async () => {
    try {
      await coreClient.architectSetMode(selected)
      await coreClient.architectSetPower('on')
    } catch (err) {
      console.error('[FirstRunWizard] failed to save architect mode/power', err)
    }
    localStorage.setItem('architect_setup_done', '1')
    onComplete(selected)
  }

  const handleSkip = () => {
    localStorage.setItem('architect_setup_done', '1')
    onComplete('hands-on')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(5, 10, 15, 0.9)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-lg p-8 rounded-xl" style={{ background: '#112240', border: '1px solid rgba(0, 229, 255, 0.15)' }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: '#e2f4ff' }}>Welcome to the Architect.</h2>
        <p className="text-xs mb-6" style={{ color: '#94adc4' }}>This is the part of Coastal.AI that improves itself.</p>

        <p className="text-xs font-mono mb-3" style={{ color: '#4a6a8a' }}>How much do you want to be involved?</p>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {modes.map(m => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={`p-4 rounded-lg text-left transition-all ${selected === m.id ? 'ring-2 ring-cyan-500/50' : 'hover:bg-white/[0.02]'}`}
              style={{ background: selected === m.id ? 'rgba(0, 229, 255, 0.05)' : '#0d1f33', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <p className="text-sm font-semibold" style={{ color: selected === m.id ? '#00e5ff' : '#e2f4ff' }}>
                {m.label}
              </p>
              {m.sublabel && <p className="text-[10px]" style={{ color: '#4a6a8a' }}>{m.sublabel}</p>}
              <p className="text-xs mt-2" style={{ color: '#94adc4' }}>{m.desc}</p>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={handleSkip} className="text-xs px-4 py-2 text-gray-500 hover:text-gray-300">
            Skip — Use Defaults
          </button>
          <button onClick={handleSave} className="btn-primary text-xs px-4 py-2">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
