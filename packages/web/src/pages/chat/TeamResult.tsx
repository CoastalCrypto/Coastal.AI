// packages/web/src/pages/chat/TeamResult.tsx
import React, { useState } from 'react'
import { ChatBubble } from '../../components/ChatBubble'
import type { Message } from './types'

export const TeamResult = React.memo(function TeamResult({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false)
  const trace = msg.trace ?? []
  const lastTurn = trace[trace.length - 1]
  const priorTurns = trace.slice(0, -1)

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%] bg-gray-800 border border-cyan-900/60 rounded-2xl px-4 py-3 text-sm">
        <div className="flex items-center gap-2 mb-2 text-xs text-cyan-500 font-mono">
          <span>TEAM</span>
          <span className="text-gray-600">·</span>
          <span>{trace.length} {trace.length === 1 ? 'agent' : 'agents'}</span>
          {priorTurns.length > 0 && (
            <button onClick={() => setOpen(o => !o)} className="ml-auto text-gray-600 hover:text-gray-400">
              {open ? 'hide relay' : 'show relay'}
            </button>
          )}
        </div>

        {open && priorTurns.length > 0 && (
          <div className="mb-3 space-y-2 border-b border-gray-700 pb-3">
            {priorTurns.map((t, i) => (
              <div key={i} className="text-xs bg-gray-900 rounded p-2">
                <div className="text-gray-500 font-mono mb-1">
                  {t.agentName}
                  {t.handoffTo && (
                    <span className="text-gray-600"> → handed off to {t.handoffTo}{t.expectation ? `: ${t.expectation}` : ''}</span>
                  )}
                </div>
                <div className="text-gray-300">{t.reply}</div>
                {t.unresolved && (
                  <div className="mt-1 text-amber-500">
                    ⚠ commitment not verified{t.verificationNote ? ` — ${t.verificationNote}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {lastTurn && <div className="text-xs text-gray-500 font-mono mb-1">{lastTurn.agentName}</div>}
        <ChatBubble role="assistant" content={lastTurn?.reply ?? msg.content} />
        {lastTurn?.unresolved && (
          <div className="mt-2 text-xs text-amber-500">
            ⚠ commitment not verified{lastTurn.verificationNote ? ` — ${lastTurn.verificationNote}` : ''}
          </div>
        )}
      </div>
    </div>
  )
})
