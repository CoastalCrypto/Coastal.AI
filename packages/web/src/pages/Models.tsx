import { useState, useEffect, useCallback } from 'react'
import { adminClient, type AgentRecord, type ModelGroup, type RegistryUpdate } from '../api/client'
import { coreWsOrigin } from '../platform/coreOrigin'
import { ModelCard } from '../components/ModelCard'
import { ModelInstaller } from '../components/ModelInstaller'
import { DomainAssigner } from '../components/DomainAssigner'
import { OllamaSection } from '../components/OllamaSection'

interface QuantProgress {
  type: 'quant_progress'
  step: number
  total: number
  message: string
}

export function Models() {
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [models, setModels] = useState<ModelGroup[]>([])
  const [registry, setRegistry] = useState<Record<string, Record<string, string>>>({})
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<QuantProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [m, reg, agentList] = await Promise.all([
        adminClient.listModels(),
        adminClient.getRegistry(),
        adminClient.listAgents(),
      ])
      setModels(m)
      setRegistry(reg as Record<string, Record<string, string>>)
      setAgents(agentList)
    } catch (e: unknown) {
      console.error('Failed to load models', e)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleInstall = async (hfModelId: string, quant: string) => {
    setInstalling(true)
    setError(null)
    setProgress(null)
    const sessionId = crypto.randomUUID()

    const ws = new WebSocket(`${coreWsOrigin()}/ws/session`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'quant_progress') setProgress(msg)
      } catch {
        /* skip malformed message */
      }
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { ws.close(); resolve() }, 5000)
      const register = () => {
        clearTimeout(timeout)
        ws.send(JSON.stringify({ type: 'register', sessionId }))
        resolve()
      }
      if (ws.readyState === WebSocket.OPEN) register()
      else ws.onopen = register
    })

    try {
      await adminClient.addModel(hfModelId, [quant], sessionId)
      await new Promise(r => setTimeout(r, 2000))
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Installation failed')
    } finally {
      ws.onmessage = null
      ws.close()
      setInstalling(false)
    }
  }

  const handleRemove = async (variantId: string) => {
    setRemovingId(variantId)
    try {
      await adminClient.removeModel(variantId)
      await refresh()
    } catch (e: unknown) {
      console.error('Remove failed', e)
    } finally {
      setRemovingId(null)
    }
  }

  const handleRegistryChange = async (update: RegistryUpdate) => {
    await adminClient.updateRegistry(update)
    setRegistry(prev => ({ ...prev, ...update }))
  }

  return (
    <div className="min-h-screen p-6" style={{ background: '#050a0f' }}>
      <div className="flex items-center gap-3 mb-6">
        <span style={{ color: '#00e5ff', fontSize: '20px' }}>✳</span>
        <h1 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Model Management</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {models.length === 0 && (
          <div className="col-span-full text-gray-500 text-sm">
            No models installed yet. Add one below.
          </div>
        )}
        {models.map(g => (
          <ModelCard key={g.baseName} group={g} onRemove={handleRemove} removingId={removingId ?? undefined} />
        ))}
      </div>

      <div className="mb-8">
        <OllamaSection onModelsChanged={refresh} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ModelInstaller
          onInstall={handleInstall}
          installing={installing}
          progress={progress}
          error={error}
        />
        <DomainAssigner
          agents={agents}
          models={models}
          registry={registry}
          onChange={handleRegistryChange}
        />
      </div>
    </div>
  )
}
