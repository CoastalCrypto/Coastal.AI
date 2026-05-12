import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface HardwareSummary {
  ramGb: number
  freeRamGb: number
  cpuCores: number
  vramGb: number | null
  gpuName: string | null
  diskFreeGb: number
  dataDir: string
}

export interface ModelRecommendation {
  model: string
  reason: string
  sizeGb: number
  tier: 'minimum' | 'recommended' | 'optimal'
}

// ── Linux helpers ────────────────────────────────────────────────

function readMemInfoLinux(): { totalGb: number; freeGb: number } | null {
  try {
    const raw = readFileSync('/proc/meminfo', 'utf8')
    const parse = (key: string) => {
      const m = raw.match(new RegExp(`${key}:\\s+(\\d+)`))
      return m ? Number(m[1]) * 1024 : 0
    }
    const total = parse('MemTotal')
    const free  = parse('MemFree')
    const bufs  = parse('Buffers')
    const cache = parse('Cached')
    const srec  = parse('SReclaimable')
    return {
      totalGb: total / (1024 ** 3),
      freeGb: (free + bufs + cache + srec) / (1024 ** 3),
    }
  } catch { return null }
}

function readGpuNvidia(): { name: string; vramGb: number } | null {
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits',
      { timeout: 2000 }
    ).toString().trim()
    const parts = out.split(',').map(s => s.trim())
    if (parts.length < 2) return null
    const [name, vramMb] = parts
    return { name, vramGb: Number(vramMb) / 1024 }
  } catch { return null }
}

function readDiskLinux(path: string): number {
  try {
    const out = execSync(`df -B1 "${path}" 2>/dev/null | tail -1`, { timeout: 2000 }).toString().trim()
    const [, , , free] = out.split(/\s+/).map(Number)
    return (free ?? 0) / (1024 ** 3)
  } catch { return 0 }
}

function readCpuCores(): number {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors"',
        { timeout: 3000 }
      ).toString().trim()
      return Number(out) || 1
    }
    const out = execSync('nproc 2>/dev/null || grep -c processor /proc/cpuinfo', { timeout: 2000 }).toString().trim()
    return Number(out) || 1
  } catch { return 1 }
}

// ── Windows helpers (no wmic — removed in Windows 11) ────────────

function readMemInfoWindows(): { totalGb: number; freeGb: number } | null {
  try {
    const totalOut = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"',
      { timeout: 3000 }
    ).toString().trim()
    const freeOut = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory"',
      { timeout: 3000 }
    ).toString().trim()
    const totalBytes = Number(totalOut)
    const freeKb     = Number(freeOut)
    if (!totalBytes) return null
    return {
      totalGb: totalBytes / (1024 ** 3),
      freeGb:  freeKb / (1024 ** 2),
    }
  } catch { return null }
}

function readGpuWindows(): { name: string; vramGb: number } | null {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Where-Object { $_.AdapterRAM -gt 0 } | Select-Object -First 1 -ExpandProperty Name,AdapterRAM | ConvertTo-Json"',
      { timeout: 3000 }
    ).toString().trim()
    const obj = JSON.parse(out) as { Name?: string; AdapterRAM?: number }
    if (!obj.AdapterRAM) return null
    return { name: obj.Name ?? 'Unknown GPU', vramGb: obj.AdapterRAM / (1024 ** 3) }
  } catch { return null }
}

function readDiskWindows(path: string): number {
  try {
    const drive = path.match(/^[A-Za-z]:/)?.[0] ?? 'C:'
    const out = execSync(
      `powershell -NoProfile -Command "(Get-PSDrive ${drive.replace(':', '')} | Select-Object -ExpandProperty Free)"`,
      { timeout: 3000 }
    ).toString().trim()
    return Number(out) / (1024 ** 3)
  } catch { return 0 }
}

// ── Public API ───────────────────────────────────────────────────

export function scanHardware(dataDir: string): HardwareSummary {
  const isWindows = process.platform === 'win32'
  const mem  = isWindows ? readMemInfoWindows() : readMemInfoLinux()
  const gpu  = readGpuNvidia() ?? (isWindows ? readGpuWindows() : null)
  const disk = isWindows ? readDiskWindows(dataDir) : readDiskLinux(dataDir)

  return {
    ramGb:     Math.round((mem?.totalGb ?? 0) * 10) / 10,
    freeRamGb: Math.round((mem?.freeGb  ?? 0) * 10) / 10,
    cpuCores:  readCpuCores(),
    vramGb:    gpu ? Math.round(gpu.vramGb * 10) / 10 : null,
    gpuName:   gpu?.name ?? null,
    diskFreeGb: Math.round(disk * 10) / 10,
    dataDir,
  }
}

export function recommendModels(hw: HardwareSummary): ModelRecommendation[] {
  // Minimum: always RAM-derived regardless of GPU
  const minimum: ModelRecommendation = hw.ramGb < 4
    ? { model: 'tinyllama',    reason: 'Minimum viable — fits in < 4 GB RAM',  sizeGb: 0.6, tier: 'minimum' }
    : { model: 'llama3.2:1b', reason: 'Minimum viable — fits in 4 GB RAM',    sizeGb: 1.3, tier: 'minimum' }

  // Use GPU tiers only when VRAM >= 4 GB
  const hasUsableGpu = hw.vramGb !== null && hw.vramGb >= 4

  let recommended: ModelRecommendation
  let optimal: ModelRecommendation

  if (hasUsableGpu) {
    const v = hw.vramGb!
    recommended = v >= 8
      ? { model: 'llama3.1:8b-instruct-q4_K_M', reason: 'Best balance for 8 GB VRAM',     sizeGb: 4.7, tier: 'recommended' }
      : { model: 'llama3.2',                     reason: 'Best balance for 4–8 GB VRAM',    sizeGb: 2.0, tier: 'recommended' }
    optimal = v >= 12
      ? { model: 'llama3.1:8b-instruct-q8_0',   reason: 'Near-full quality — 12 GB VRAM', sizeGb: 8.5, tier: 'optimal' }
      : v >= 8
        ? { model: 'llama3.1:8b-instruct-q4_K_M', reason: 'Best quality for 8 GB VRAM',   sizeGb: 4.7, tier: 'optimal' }
        : { model: 'llama3.2',                     reason: 'Best for 4–8 GB VRAM',          sizeGb: 2.0, tier: 'optimal' }
  } else {
    // No GPU or VRAM < 4 GB — use RAM tiers
    const r = hw.ramGb
    recommended = r >= 16
      ? { model: 'llama3.1:8b-instruct-q4_K_M', reason: 'Best balance for 16+ GB RAM',    sizeGb: 4.7, tier: 'recommended' }
      : r >= 8
        ? { model: 'llama3.2',                   reason: 'Best balance for 8+ GB RAM',      sizeGb: 2.0, tier: 'recommended' }
        : { model: 'llama3.2:1b',                reason: 'Lightweight — fits in < 8 GB RAM', sizeGb: 1.3, tier: 'recommended' }
    optimal = r >= 32
      ? { model: 'llama3.1:8b-instruct-q8_0',   reason: 'Near-full quality — 32+ GB RAM', sizeGb: 8.5, tier: 'optimal' }
      : r >= 16
        ? { model: 'llama3.1:8b-instruct-q4_K_M', reason: 'Best quality for 16+ GB RAM',  sizeGb: 4.7, tier: 'optimal' }
        : r >= 8
          ? { model: 'llama3.2',                 reason: 'Best for 8+ GB RAM',              sizeGb: 2.0, tier: 'optimal' }
          : { model: 'llama3.2:1b',              reason: 'Lightweight — fits in < 8 GB RAM', sizeGb: 1.3, tier: 'optimal' }
  }

  return [minimum, recommended, optimal]
}
