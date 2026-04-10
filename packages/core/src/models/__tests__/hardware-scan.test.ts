import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('scanHardware', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.restoreAllMocks())

  it('reads RAM and GPU from Linux /proc/meminfo + nvidia-smi', async () => {
    const procMeminfo = [
      'MemTotal:       33554432 kB',
      'MemFree:         4194304 kB',
      'Buffers:          524288 kB',
      'Cached:          2097152 kB',
      'SReclaimable:     262144 kB',
    ].join('\n')
    vi.doMock('node:fs', () => ({
      readFileSync: (p: string) => {
        if (p === '/proc/meminfo') return procMeminfo
        throw new Error('ENOENT')
      },
      existsSync: () => false,
    }))
    vi.doMock('node:child_process', () => ({
      execSync: (cmd: string) => {
        if (cmd.includes('nvidia-smi')) return 'NVIDIA RTX 3070, 8192, 7000, 45\n'
        if (cmd.includes('df -B1')) return '/dev/sda1  500G  50G  450G  10% /\n'
        throw new Error('not found')
      },
    }))
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const { scanHardware } = await import('../hardware-scan.js')
    const hw = scanHardware('/var/lib/coastalclaw/data')

    expect(hw.ramGb).toBeGreaterThan(30)
    expect(hw.vramGb).toBe(8)
    expect(hw.gpuName).toContain('RTX 3070')
    expect(hw.dataDir).toBe('/var/lib/coastalclaw/data')
  })

  it('returns null vramGb when nvidia-smi is absent', async () => {
    const procMeminfo = 'MemTotal: 8388608 kB\nMemFree: 4194304 kB\nBuffers: 0 kB\nCached: 0 kB\nSReclaimable: 0 kB\n'
    vi.doMock('node:fs', () => ({
      readFileSync: (p: string) => {
        if (p === '/proc/meminfo') return procMeminfo
        throw new Error('ENOENT')
      },
    }))
    vi.doMock('node:child_process', () => ({
      execSync: (cmd: string) => {
        if (cmd.includes('df -B1')) return '/dev/sda1  100G  20G  80G  20% /\n'
        throw new Error('command not found')
      },
    }))
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const { scanHardware } = await import('../hardware-scan.js')
    const hw = scanHardware('/data')

    expect(hw.vramGb).toBeNull()
    expect(hw.gpuName).toBeNull()
    expect(hw.ramGb).toBeGreaterThan(7)
  })
})

describe('recommendModels', () => {
  it('always returns exactly 3 entries with tiers minimum/recommended/optimal', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const hw = { ramGb: 16, freeRamGb: 8, cpuCores: 8, vramGb: null, gpuName: null, diskFreeGb: 100, dataDir: '/data' }
    const recs = recommendModels(hw)
    expect(recs).toHaveLength(3)
    expect(recs.map(r => r.tier)).toEqual(['minimum', 'recommended', 'optimal'])
  })

  it('minimum is always llama3.2:1b when RAM >= 4 GB', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 8, freeRamGb: 4, cpuCores: 4, vramGb: null, gpuName: null, diskFreeGb: 50, dataDir: '/data' })
    expect(recs[0].tier).toBe('minimum')
    expect(recs[0].model).toBe('llama3.2:1b')
  })

  it('minimum is tinyllama when RAM < 4 GB', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 3, freeRamGb: 1, cpuCores: 2, vramGb: null, gpuName: null, diskFreeGb: 20, dataDir: '/data' })
    expect(recs[0].model).toBe('tinyllama')
  })

  it('VRAM >= 12 GB: optimal = q8_0', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 32, freeRamGb: 16, cpuCores: 16, vramGb: 12, gpuName: 'RTX 3090', diskFreeGb: 200, dataDir: '/data' })
    expect(recs.find(r => r.tier === 'optimal')?.model).toBe('llama3.1:8b-instruct-q8_0')
  })

  it('VRAM 8-11 GB: optimal = q4_K_M', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 32, freeRamGb: 16, cpuCores: 8, vramGb: 8, gpuName: 'RTX 3070', diskFreeGb: 200, dataDir: '/data' })
    expect(recs.find(r => r.tier === 'optimal')?.model).toBe('llama3.1:8b-instruct-q4_K_M')
    expect(recs.find(r => r.tier === 'recommended')?.model).toBe('llama3.1:8b-instruct-q4_K_M')
  })

  it('VRAM 4-7 GB: optimal + recommended = llama3.2', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 16, freeRamGb: 8, cpuCores: 8, vramGb: 6, gpuName: 'RTX 2060', diskFreeGb: 100, dataDir: '/data' })
    expect(recs.find(r => r.tier === 'optimal')?.model).toBe('llama3.2')
    expect(recs.find(r => r.tier === 'recommended')?.model).toBe('llama3.2')
  })

  it('VRAM < 4 GB: falls back to RAM tiers', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 32, freeRamGb: 20, cpuCores: 8, vramGb: 2, gpuName: 'GTX 1050', diskFreeGb: 100, dataDir: '/data' })
    // 32GB RAM no-GPU path
    expect(recs.find(r => r.tier === 'optimal')?.model).toBe('llama3.1:8b-instruct-q8_0')
  })

  it('RAM >= 32 GB (no GPU): optimal = q8_0', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 64, freeRamGb: 40, cpuCores: 32, vramGb: null, gpuName: null, diskFreeGb: 500, dataDir: '/data' })
    expect(recs.find(r => r.tier === 'optimal')?.model).toBe('llama3.1:8b-instruct-q8_0')
  })

  it('RAM 16-31 GB (no GPU): optimal = q4_K_M, recommended = q4_K_M', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 16, freeRamGb: 10, cpuCores: 8, vramGb: null, gpuName: null, diskFreeGb: 200, dataDir: '/data' })
    expect(recs.find(r => r.tier === 'optimal')?.model).toBe('llama3.1:8b-instruct-q4_K_M')
    expect(recs.find(r => r.tier === 'recommended')?.model).toBe('llama3.1:8b-instruct-q4_K_M')
  })

  it('RAM 8-15 GB (no GPU): optimal + recommended = llama3.2', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 8, freeRamGb: 4, cpuCores: 4, vramGb: null, gpuName: null, diskFreeGb: 100, dataDir: '/data' })
    expect(recs.find(r => r.tier === 'optimal')?.model).toBe('llama3.2')
    expect(recs.find(r => r.tier === 'recommended')?.model).toBe('llama3.2')
  })

  it('RAM < 8 GB (no GPU): recommended = llama3.2:1b', async () => {
    const { recommendModels } = await import('../hardware-scan.js')
    const recs = recommendModels({ ramGb: 6, freeRamGb: 2, cpuCores: 2, vramGb: null, gpuName: null, diskFreeGb: 50, dataDir: '/data' })
    expect(recs.find(r => r.tier === 'recommended')?.model).toBe('llama3.2:1b')
  })
})
