import type { FastifyInstance } from 'fastify'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../config.js'
import { HardwareProbe } from '../../system/hardware.js'
import { VibeVoiceClient } from '../../voice/vibevoice.js'
import { restartServer } from './system-restart.js'
import { scanHardware, recommendModels } from '../../models/hardware-scan.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Voices available in the VibeVoice TTS service
const VIBE_VOICES = [
  { id: 'en_us_female_1', label: 'US English — Female 1' },
  { id: 'en_us_female_2', label: 'US English — Female 2' },
  { id: 'en_us_male_1',   label: 'US English — Male 1' },
  { id: 'en_us_male_2',   label: 'US English — Male 2' },
  { id: 'en_gb_female_1', label: 'British English — Female' },
  { id: 'en_gb_male_1',   label: 'British English — Male' },
  { id: 'en_au_female_1', label: 'Australian English — Female' },
  { id: 'en_au_male_1',   label: 'Australian English — Male' },
]

function pcmToWav(pcm: Buffer, sampleRate = 24_000, channels = 1, bitDepth = 16): Buffer {
  const byteRate = (sampleRate * channels * bitDepth) / 8
  const blockAlign = (channels * bitDepth) / 8
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(byteRate, 28)
  h.writeUInt16LE(blockAlign, 32)
  h.writeUInt16LE(bitDepth, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'))
    return pkg.version ?? '0.0.0'
  } catch { return '0.0.0' }
}

function gitCommit(): string {
  try { return execSync('git rev-parse --short HEAD', { timeout: 2000 }).toString().trim() } catch { return 'unknown' }
}

interface DiskStat { path: string; total: number; used: number; free: number }

function diskStats(paths: string[]): DiskStat[] {
  if (process.platform === 'win32') {
    return paths.map(p => ({ path: p, total: 0, used: 0, free: 0 }))
  }
  return paths.map((p) => {
    try {
      // Use execFileSync (no shell) with path as a separate argument to prevent injection
      const { execFileSync } = require('node:child_process')
      const out = execFileSync('df', ['-B1', p], { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim()
      const lastLine = out.split('\n').pop() ?? ''
      const [, total, used, free] = lastLine.split(/\s+/).map(Number)
      return { path: p, total, used, free }
    } catch { return { path: p, total: 0, used: 0, free: 0 } }
  })
}

function loadedModels(): string[] {
  try {
    const out = execSync('ollama ps', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString()
    return out.split('\n').slice(1).filter(Boolean).map(l => l.split(/\s+/)[0])
  } catch { return [] }
}

export async function systemRoutes(fastify: FastifyInstance) {
  const config = loadConfig()

  // GET /api/system/stats — live hardware metrics
  fastify.get('/api/system/stats', async (_req, reply) => {
    const hardware = HardwareProbe.getStats()
    const rootPath = process.platform === 'win32' ? 'C:\\' : '/'
    const disk = diskStats([config.dataDir, rootPath])
    
    return reply.send({
      cpu: { percent: Math.round(hardware.cpuUsagePct) },
      mem: {
        total: Math.round(hardware.ramTotalGb * 1024 * 1024 * 1024),
        used: Math.round(hardware.ramUsedGb * 1024 * 1024 * 1024),
        free: Math.round((hardware.ramTotalGb - hardware.ramUsedGb) * 1024 * 1024 * 1024)
      },
      disk,
      gpu: hardware.vramTotalGb > 0 ? {
        vramUsed: Math.round(hardware.vramUsedGb * 1024 * 1024 * 1024),
        vramTotal: Math.round(hardware.vramTotalGb * 1024 * 1024 * 1024),
        utilPercent: 0 // HardwareProbe doesn't track GPU util yet
      } : null,
      tier: hardware.tier,
      models: loadedModels(),
      uptime: Math.floor(process.uptime()),
    })
  })


  // GET /api/admin/logs?service=server&lines=100
  fastify.get<{ Querystring: { service?: string; lines?: string } }>(
    '/api/admin/logs',
    async (req, reply) => {
      const service = req.query.service ?? 'coastal-ai-server'
      const lines   = Math.min(Number(req.query.lines ?? 200), 1000)

      // Prefer journald if available, fall back to log file
      if (process.platform !== 'win32') {
        try {
          const out = execSync(
            `journalctl -u "${service.replace(/[^a-z0-9._-]/gi, '')}" -n ${lines} --no-pager --output=short-iso`,
            { timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
          ).toString()
          return reply.send({ service, lines: out.split('\n').filter(Boolean) })
        } catch { /* skip */ }
      }
        // Fallback: plain log file
        const logFile = join(config.dataDir, `${service}.log`)
        if (existsSync(logFile)) {
          const raw = readFileSync(logFile, 'utf8').split('\n')
          return reply.send({ service, lines: raw.slice(-lines).filter(Boolean) })
        }
        return reply.send({ service, lines: [] })
    }
  )

  // GET /api/version — current app version (public, used by frontend update poller)
  fastify.get('/api/version', async (_req, reply) => {
    return reply.send({ version: appVersion(), commit: gitCommit() })
  })

  // GET /api/voices — list VibeVoice voices (public, used by AgentEditor)
  fastify.get('/api/voices', async (_req, reply) => {
    const vibe = new VibeVoiceClient()
    const available = await vibe.isAvailable()
    return reply.send({ vibeAvailable: available, voices: available ? VIBE_VOICES : [] })
  })

  // POST /api/admin/tts — synthesise speech via VibeVoice, return WAV
  fastify.post<{ Body: { text: string; voice: string } }>('/api/admin/tts', async (req, reply) => {
    const { text, voice } = req.body ?? {}
    if (!text || !voice) return reply.status(400).send({ error: 'text and voice required' })
    const vibe = new VibeVoiceClient()
    const chunks: Buffer[] = []
    for await (const chunk of vibe.speak(text, voice)) {
      chunks.push(chunk)
    }
    const wav = pcmToWav(Buffer.concat(chunks))
    reply.header('Content-Type', 'audio/wav')
    return reply.send(wav)
  })

  // GET /api/admin/update-check — compare local HEAD to remote HEAD (no user input)
  fastify.get('/api/admin/update-check', async (_req, reply) => {
    try {
      const localFull  = gitCommit() // already uses execSync safely
      const remoteLine = execSync('git ls-remote origin HEAD', {
        timeout: 10_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }).toString().trim()
      const remoteFull = remoteLine.split(/\s+/)[0] ?? ''
      if (!remoteFull) return reply.send({ updateAvailable: false, localCommit: localFull, remoteCommit: null })
      const localLong = execSync('git rev-parse HEAD', { timeout: 2000 }).toString().trim()
      return reply.send({
        updateAvailable: !remoteFull.startsWith(localLong.slice(0, remoteFull.length)),
        localCommit: localFull,
        remoteCommit: remoteFull.slice(0, 7),
      })
    } catch {
      return reply.send({ updateAvailable: false, localCommit: gitCommit(), remoteCommit: null })
    }
  })

  // POST /api/admin/update — pull latest + rebuild + restart
  fastify.post('/api/admin/update', async (_req, reply) => {
    const installDir = process.cwd()
    // Kick off async — reply immediately
    reply.send({ ok: true, message: 'Update started. Server will restart in ~30s.' })

    setTimeout(async () => {
      try {
        console.log('[update] Running git pull...')
        execSync('git pull --ff-only', { cwd: installDir, timeout: 60_000, stdio: 'inherit' })
        
        console.log('[update] Running pnpm install...')
        execSync('pnpm install --frozen-lockfile', { cwd: installDir, timeout: 180_000, stdio: 'inherit' })
        
        console.log('[update] Running pnpm build...')
        execSync('pnpm build', { cwd: installDir, timeout: 180_000, stdio: 'inherit' })
        
        console.log('[update] Restarting server...')
        // Platform-aware restart: Windows uses detached cmd.exe, Linux uses systemd
        restartServer(installDir)
      } catch (e: any) {
        console.error('[update] failed. Error code:', e.status, e.message)
      }
    }, 500)
  })

  // GET /api/admin/hardware-scan — scan hardware and recommend Ollama models
  fastify.get('/api/admin/hardware-scan', async (_req, reply) => {
    const hardware = scanHardware(config.dataDir)
    const recommendations = recommendModels(hardware)
    return reply.send({ hardware, recommendations })
  })
}
