import { config } from '../config.js';
import { getPool } from '../db.js';
import { sendTelegramBroadcast } from '../telegram-api.js';
import { applyUserMessagePlaceholders } from '../user-display-name.js';
import {
  claimPendingDeliveries,
  getActiveBroadcastCampaign,
  markDeliveryFailed,
  markDeliverySent,
  promoteDueScheduledCampaigns,
  promoteQueuedCampaign,
  refreshBroadcastCampaignCounters,
  setBroadcastCampaignStatus,
  skipPendingDeliveries,
  updateBroadcastCampaignPhotoFileId,
} from '../../site/admin/broadcast-queries.js';

const BROADCAST_WORKER_LOCK_KEY = 847291001;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let workerStarted = false;

async function tryAcquireWorkerLock() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT pg_try_advisory_lock($1) AS ok', [
    BROADCAST_WORKER_LOCK_KEY,
  ]);
  return rows[0]?.ok === true;
}

async function releaseWorkerLock() {
  const pool = getPool();
  await pool.query('SELECT pg_advisory_unlock($1)', [BROADCAST_WORKER_LOCK_KEY]);
}

async function processCampaign(campaign) {
  if (campaign.status === 'queued') {
    await promoteQueuedCampaign(campaign.id);
    campaign.status = 'running';
  }

  if (campaign.status !== 'running') {
    return;
  }

  const batch = await claimPendingDeliveries(
    campaign.id,
    config.broadcastBatchSize,
  );

  if (!batch.length) {
    await refreshBroadcastCampaignCounters(campaign.id);
    return;
  }

  for (const delivery of batch) {
    const current = await getActiveBroadcastCampaign();
    if (!current || current.id !== campaign.id || current.status !== 'running') {
      return;
    }

    const result = await sendTelegramBroadcast({
      chatId: delivery.telegram_id,
      text: applyUserMessagePlaceholders(campaign.message_text, delivery, { html: true }),
      photoUrl: campaign.photo_url,
      photoFileId: campaign.photo_file_id,
      parseMode: campaign.parse_mode || 'HTML',
      replyMarkup: campaign.reply_markup,
    });

    if (result.ok) {
      await markDeliverySent(delivery.id);

      if (result.fileId && !campaign.photo_file_id && campaign.photo_url) {
        await updateBroadcastCampaignPhotoFileId(campaign.id, result.fileId);
        campaign.photo_file_id = result.fileId;
      }
    } else {
      const description = result.description ?? 'send failed';
      const blocked =
        result.errorCode === 403 ||
        /blocked|deactivated|chat not found|user is deactivated/i.test(description);

      await markDeliveryFailed(delivery.id, description);

      if (blocked) {
        // типичная ситуация — не останавливаем кампанию
      }
    }

    await sleep(config.broadcastSendDelayMs);
  }

  await refreshBroadcastCampaignCounters(campaign.id);
}

async function tick() {
  if (!(await tryAcquireWorkerLock())) {
    return;
  }

  try {
    const promoted = await promoteDueScheduledCampaigns();
    if (promoted.length) {
      console.log(`[broadcast] scheduled → queued: #${promoted.join(', #')}`);
    }

    const campaign = await getActiveBroadcastCampaign();
    if (!campaign) {
      return;
    }

    if (campaign.status === 'paused' || campaign.status === 'cancelled') {
      return;
    }

    await processCampaign(campaign);
  } catch (err) {
    console.warn('[broadcast] worker tick failed:', err?.message ?? err);
  } finally {
    await releaseWorkerLock();
  }
}

export function startBroadcastWorker() {
  if (workerStarted) {
    return;
  }

  workerStarted = true;
  console.log(
    `[broadcast] worker started (batch=${config.broadcastBatchSize}, delay=${config.broadcastSendDelayMs}ms, interval=${config.broadcastWorkerIntervalMs}ms)`,
  );

  void tick();
  const timer = setInterval(tick, config.broadcastWorkerIntervalMs);
  timer.unref?.();
}

export async function pauseBroadcastCampaign(id) {
  await setBroadcastCampaignStatus(id, 'paused');
}

export async function resumeBroadcastCampaign(id) {
  await setBroadcastCampaignStatus(id, 'running');
}

export async function cancelBroadcastCampaign(id) {
  await skipPendingDeliveries(id);
  await setBroadcastCampaignStatus(id, 'cancelled');
  await refreshBroadcastCampaignCounters(id);
}
