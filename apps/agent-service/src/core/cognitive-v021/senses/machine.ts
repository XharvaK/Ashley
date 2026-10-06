// H1 (User 2026-10-06: her own computer is part of her body): the machine she runs on, as plain
// facts. Read from the operating system at the moment of the turn; anything unreadable is unknown.
import { cpus, freemem, loadavg, totalmem, uptime } from "node:os";
import { readFileSync, readdirSync, statfsSync } from "node:fs";

export type MachineVitals = {
  load1: number | null;
  cores: number;
  memAvailableFraction: number | null;
  memTotalBytes: number;
  diskFreeFraction: number | null;
  diskFreeBytes: number | null;
  tempC: number | null;
  uptimeS: number | null;
};

function memAvailableBytes(): number {
  // Linux counts reclaimable cache as available; freemem() does not.
  try {
    const line = readFileSync("/proc/meminfo", "utf8").split("\n").find(row => row.startsWith("MemAvailable:"));
    const kb = line ? Number(line.replace(/[^0-9]/g, "")) : NaN;
    if (Number.isFinite(kb) && kb > 0) return kb * 1024;
  } catch { /* not Linux */ }
  return freemem();
}

function hottestZoneC(): number | null {
  try {
    const temps = readdirSync("/sys/class/thermal").filter(name => name.startsWith("thermal_zone")).map(name => {
      try { return Number(readFileSync(`/sys/class/thermal/${name}/temp`, "utf8").trim()) / 1000; } catch { return NaN; }
    }).filter(value => Number.isFinite(value) && value > 0 && value < 150);
    return temps.length ? Math.max(...temps) : null;
  } catch { return null; }
}

export function readMachineVitals(dataDir?: string): MachineVitals {
  const cores = Math.max(1, cpus().length);
  const total = totalmem();
  let diskFreeFraction: number | null = null;
  let diskFreeBytes: number | null = null;
  try {
    const stats = statfsSync(dataDir ?? process.cwd());
    diskFreeBytes = Number(stats.bavail) * Number(stats.bsize);
    const size = Number(stats.blocks) * Number(stats.bsize);
    diskFreeFraction = size > 0 ? diskFreeBytes / size : null;
  } catch { /* unknown */ }
  const load = loadavg()[0];
  return {
    load1: typeof load === "number" && Number.isFinite(load) && (load > 0 || process.platform !== "win32") ? load : null,
    cores,
    memAvailableFraction: total > 0 ? memAvailableBytes() / total : null,
    memTotalBytes: total,
    diskFreeFraction,
    diskFreeBytes,
    tempC: hottestZoneC(),
    uptimeS: Number.isFinite(uptime()) ? uptime() : null,
  };
}

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}GiB`;
}

export function machineDetails(vitals: MachineVitals): { cpu?: string; memory?: string; disk?: string; temperature?: string } {
  return {
    ...(vitals.load1 === null ? {} : { cpu: `load=${vitals.load1.toFixed(2)} on ${vitals.cores} cores${vitals.uptimeS === null ? "" : `; up ${Math.floor(vitals.uptimeS / 86400)}d`}` }),
    ...(vitals.memAvailableFraction === null ? {} : { memory: `available=${Math.round(vitals.memAvailableFraction * 100)}% of ${gib(vitals.memTotalBytes)}` }),
    ...(vitals.diskFreeFraction === null || vitals.diskFreeBytes === null ? {} : { disk: `free=${gib(vitals.diskFreeBytes)} (${Math.round(vitals.diskFreeFraction * 100)}%)` }),
    ...(vitals.tempC === null ? {} : { temperature: `hottest=${Math.round(vitals.tempC)}°C` }),
  };
}
