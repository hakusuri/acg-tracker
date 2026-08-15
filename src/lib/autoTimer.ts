import { useEffect, useState } from 'react';
import { gamesRunning } from './api';
import { finishPlaySession, listWorks } from './db';
import type { Work } from '../types';

/**
 * Galgame 自动计时：
 * - 全局轮询（由 App 启动），检测每个配置了游戏路径的 Galgame 其 exe 是否在运行；
 * - 检测到运行则开始计时，检测到停止则自动结算并写入游玩时长与会话记录；
 * - 计时状态持久化在 localStorage，应用重启后若游戏仍在运行会继续累计。
 */

const STORAGE_KEY = 'acg_auto_timers';

export interface AutoTimerState {
  /** workId -> 计时开始时间(ISO) */
  timers: Record<number, string>;
}

function loadTimers(): Record<number, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      if (Number.isFinite(id) && typeof v === 'string' && !Number.isNaN(new Date(v).getTime())) {
        out[id] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

let state: AutoTimerState = { timers: loadTimers() };
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.timers));
  } catch {
    // 持久化失败不阻塞
  }
}

function notify(): void {
  for (const l of listeners) l();
}

export function subscribeAutoTimer(cb: () => void): () => void {
  listeners.add(cb);
  cb();
  return () => {
    listeners.delete(cb);
  };
}

export function useAutoTimerState(): AutoTimerState {
  const [s, setS] = useState<AutoTimerState>(state);
  useEffect(() => subscribeAutoTimer(() => setS({ ...state })), []);
  return s;
}

async function settleTimer(workId: number, startedAt: string, nowIso: string, nowMs: number): Promise<void> {
  const secs = Math.max(1, Math.round((nowMs - new Date(startedAt).getTime()) / 1000));
  try {
    await finishPlaySession(workId, startedAt, nowIso, secs);
  } catch (e) {
    console.error('自动计时结算失败', e);
  }
}

let ticking = false;

/** 执行一次检测与结算（轮询或启动时调用）。 */
export async function autoTimerTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const works = await listWorks();
    const byId = new Map<number, Work>(works.map((w) => [w.id, w]));
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let changed = false;

    // 清理：作品已删除或已无游戏路径的过期计时
    for (const idStr of Object.keys(state.timers)) {
      const id = Number(idStr);
      const w = byId.get(id);
      if (!w || !w.game_path) {
        const started = state.timers[id];
        delete state.timers[id];
        changed = true;
        await settleTimer(id, started, nowIso, nowMs);
      }
    }

    const games = works.filter((w) => w.category === 'galgame' && !!w.game_path);
    if (games.length > 0) {
      const running = await gamesRunning(games.map((g) => g.game_path as string));
      for (let i = 0; i < games.length; i++) {
        const w = games[i];
        const isRun = !!running[i];
        const started = state.timers[w.id];
        if (isRun && !started) {
          state.timers[w.id] = nowIso;
          changed = true;
        } else if (!isRun && started) {
          delete state.timers[w.id];
          changed = true;
          await settleTimer(w.id, started, nowIso, nowMs);
        }
      }
    }

    if (changed) {
      persist();
      notify();
    }
  } catch (e) {
    console.error('自动计时检测失败', e);
  } finally {
    ticking = false;
  }
}