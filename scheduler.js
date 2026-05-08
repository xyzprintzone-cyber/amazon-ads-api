// scheduler.js — cron ogni ora: fetch → AI → esegui → log
import cron from "node-cron";
import { fetchAllData } from "./data-fetcher.js";
import { analyzeAndGenerateActions } from "./ai-engine.js";
import { executeActions } from "./optimizer.js";
import * as db from "./db.js";

let isRunning = false;
let lastRunResult = null;
let nextRunAt = null;

export function getSchedulerStatus() {
  return {
    isRunning,
    lastRunResult,
    nextRunAt,
  };
}

export async function runOptimizationCycle() {
  if (isRunning) {
    console.log("[SCHED] Ciclo già in corso, skip");
    return { skipped: true };
  }

  isRunning = true;
  const runId = db.startRun();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[SCHED] Avvio ciclo ottimizzazione #${runId} — ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  try {
    // 1. Fetch dati reali
    console.log("[SCHED] Step 1: Fetch dati Amazon...");
    const data = await fetchAllData(7);

    // Salva snapshot in DB
    db.saveCampaignSnapshots(data.campaigns, data.dateRange.start, data.dateRange.end);
    if (data.keywords?.length) db.saveKeywordSnapshots(data.keywords);

    // 2. AI analysis
    console.log("[SCHED] Step 2: Analisi AI...");
    const aiResult = await analyzeAndGenerateActions(data);
    const actions = aiResult.actions || [];
    console.log(`[SCHED] AI ha generato ${actions.length} azioni`);

    // 3. Esegui azioni
    let appliedCount = 0;
    if (actions.length > 0) {
      console.log("[SCHED] Step 3: Esecuzione azioni...");
      const results = await executeActions(runId, actions);
      appliedCount = results.filter(r => r.status === "applied").length;
      console.log(`[SCHED] Azioni applicate: ${appliedCount}/${actions.length}`);
    } else {
      console.log("[SCHED] Nessuna azione necessaria");
    }

    // 4. Finalizza run
    db.finishRun(runId, {
      actionsTaken: appliedCount,
      campaigns: data.campaigns.length,
      keywords: data.keywords?.length || 0,
      aiSummary: aiResult.summary,
    });

    lastRunResult = {
      runId,
      at: new Date().toISOString(),
      campaigns: data.campaigns.length,
      keywords: data.keywords?.length || 0,
      actionsGenerated: actions.length,
      actionsApplied: appliedCount,
      aiSummary: aiResult.summary,
      ok: true,
    };

    console.log(`[SCHED] ✓ Ciclo #${runId} completato. ${appliedCount} azioni applicate.`);
    return lastRunResult;

  } catch (err) {
    console.error(`[SCHED] ✗ Ciclo #${runId} fallito:`, err.message);
    db.finishRun(runId, { error: err.message });

    lastRunResult = {
      runId,
      at: new Date().toISOString(),
      ok: false,
      error: err.message,
    };
    return lastRunResult;

  } finally {
    isRunning = false;
  }
}

export function startScheduler() {
  console.log("[SCHED] Avvio scheduler — ogni ora alle :00");

  // Ogni ora
  const job = cron.schedule("0 * * * *", async () => {
    console.log("[SCHED] Trigger cron orario");
    await runOptimizationCycle();
    updateNextRun();
  });

  updateNextRun();

  // Primo run dopo 5 minuti dall'avvio (evita conflitti con fetch UI all'avvio)
  setTimeout(async () => {
    console.log("[SCHED] Primo run iniziale (5min post-boot)...");
    await runOptimizationCycle();
    updateNextRun();
  }, 5 * 60 * 1000);

  return job;
}

function updateNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  nextRunAt = next.toISOString();
}
