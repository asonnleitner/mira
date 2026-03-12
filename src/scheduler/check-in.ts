import type { Api } from 'grammy'
import { generateMessage } from '~/agent/messages'
import { sendMarkdownV2 } from '~/bot/utils/telegram-send'
import { config } from '~/config'
import { ATTR_SCHEDULER_CHECKIN_COUNT } from '~/constants'
import { findSessionsDueForCheckIn, getPatientInfoForChat, updateLastCheckIn } from '~/db/queries/check-in'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

function isWithinTimeWindow(): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.CHECKIN_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  })

  const hour = Number.parseInt(formatter.format(new Date()), 10)
  return hour >= config.CHECKIN_WINDOW_START && hour < config.CHECKIN_WINDOW_END
}

async function runCheckInScan(api: Api): Promise<void> {
  await withSpan('scheduler.checkIn.scan', {}, async (span) => {
    if (!isWithinTimeWindow()) {
      logger.debug('[check-in] Outside time window, skipping scan')
      span.setAttribute('scheduler.checkin.skipped', 'outside_time_window')
      return
    }

    const sessions = await findSessionsDueForCheckIn()

    span.setAttribute(ATTR_SCHEDULER_CHECKIN_COUNT, sessions.length)
    logger.info(`[check-in] Found ${sessions.length} session(s) due for check-in`)

    for (const session of sessions) {
      await withSpan('scheduler.checkIn.send', {
        'scheduler.checkin.chat_id': session.chatId,
        'scheduler.checkin.session_type': session.sessionType,
        'scheduler.checkin.unanswered_count': session.unansweredCount,
      }, async () => {
        try {
          const daysSinceLastMessage = Math.floor(
            (Date.now() - session.lastMessageAt.getTime()) / (24 * 60 * 60 * 1000),
          )

          // Get patient info for language and name (individual sessions)
          const patientInfo = session.sessionType === 'individual'
            ? await getPatientInfoForChat(session.chatId)
            : null

          const purpose = session.sessionType === 'couples' ? 'check_in_couples' : 'check_in'

          const message = await generateMessage({
            purpose,
            context: {
              daysSinceLastMessage,
              unansweredCount: session.unansweredCount,
              ...(patientInfo?.firstName && { patientName: patientInfo.firstName }),
            },
            language: patientInfo?.preferredLanguage ?? undefined,
          })

          await sendMarkdownV2({ chatId: session.chatId, text: message, api })
          await updateLastCheckIn(session.chatId)

          logger.info(`[check-in] Sent check-in to chat ${session.chatId} (${session.sessionType}, unanswered: ${session.unansweredCount})`)
        }
        catch (err) {
          logger.error(`[check-in] Failed to send check-in to chat ${session.chatId}:`, err)
        }
      })
    }
  })
}

export function startCheckInScheduler(api: Api): Timer {
  logger.info(`[check-in] Starting scheduler (interval: ${config.CHECKIN_INTERVAL_MINUTES}m, window: ${config.CHECKIN_WINDOW_START}-${config.CHECKIN_WINDOW_END} ${config.CHECKIN_TIMEZONE})`)

  // Run first scan immediately
  runCheckInScan(api).catch(err => logger.error('[check-in] Initial scan failed:', err))

  // Then run on interval
  return setInterval(
    () => runCheckInScan(api).catch(err => logger.error('[check-in] Scan failed:', err)),
    config.CHECKIN_INTERVAL_MINUTES * 60 * 1000,
  )
}

export function stopCheckInScheduler(timer: Timer): void {
  clearInterval(timer)
  logger.info('[check-in] Scheduler stopped')
}
