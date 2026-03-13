import type { HookCallback, PostToolUseHookInput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { resolve } from 'node:path'
import { logger } from '~/telemetry/logger'

export function createFileSecurityHook(allowedBase: string, dataDir: string): HookCallback {
  return async (input) => {
    const preInput = input as PreToolUseHookInput
    const toolInput = preInput.tool_input as Record<string, unknown>
    const filePath = (toolInput.file_path ?? toolInput.path ?? toolInput.pattern ?? '') as string
    const normalized = resolve(dataDir, filePath)

    if (!normalized.startsWith(allowedBase)) {
      logger.debug(`[hooks] File access denied: path="${filePath}" allowedBase="${allowedBase}"`)
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason: `File access restricted to ${allowedBase}`,
        },
      }
    }
    return {}
  }
}

export const auditToolUse: HookCallback = async (input) => {
  const postInput = input as PostToolUseHookInput
  logger.info(`[audit] Tool: ${postInput.tool_name}`, postInput.tool_input)
  return {}
}
