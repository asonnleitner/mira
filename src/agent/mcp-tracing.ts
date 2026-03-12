import type { HookCallback, PostToolUseFailureHookInput, PostToolUseHookInput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import type { Span } from '@opentelemetry/api'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { ATTR_ERROR_TYPE } from '@opentelemetry/semantic-conventions'
import { ATTR_GEN_AI_OPERATION_NAME, ATTR_GEN_AI_TOOL_CALL_ARGUMENTS, ATTR_GEN_AI_TOOL_CALL_ID, ATTR_GEN_AI_TOOL_CALL_RESULT, ATTR_GEN_AI_TOOL_NAME, ATTR_MCP_METHOD_NAME, ATTR_MCP_SESSION_ID, GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL, MCP_METHOD_NAME_VALUE_TOOLS_CALL } from '@opentelemetry/semantic-conventions/incubating'
import { config } from '~/config'

const tracer = trace.getTracer('mira')

const MCP_PREFIX = 'mcp__'

export function parseMcpToolName(name: string): { serverName: string, toolName: string } | null {
  if (!name.startsWith(MCP_PREFIX))
    return null

  const parts = name.slice(MCP_PREFIX.length).split('__')
  if (parts.length < 2)
    return null

  const toolName = parts.at(-1)!
  const serverName = parts.slice(0, -1).join('__')

  return { serverName, toolName }
}

export function createMcpTracingHooks(): {
  preToolUse: HookCallback
  postToolUse: HookCallback
  postToolUseFailure: HookCallback
} {
  const activeSpans = new Map<string, Span>()

  const preToolUse: HookCallback = async (input) => {
    const hookInput = input as PreToolUseHookInput
    const parsed = parseMcpToolName(hookInput.tool_name)
    if (!parsed)
      return {}

    const span = tracer.startSpan(`tools/call ${parsed.toolName}`, {
      kind: SpanKind.SERVER,
      attributes: {
        [ATTR_MCP_METHOD_NAME]: MCP_METHOD_NAME_VALUE_TOOLS_CALL,
        [ATTR_GEN_AI_TOOL_NAME]: parsed.toolName,
        [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
        [ATTR_GEN_AI_TOOL_CALL_ID]: hookInput.tool_use_id,
        [ATTR_MCP_SESSION_ID]: hookInput.session_id,
        ...(config.OTEL_CAPTURE_CONTENT && hookInput.tool_input != null
          ? { [ATTR_GEN_AI_TOOL_CALL_ARGUMENTS]: JSON.stringify(hookInput.tool_input) }
          : {}
        ),
      },
    })

    activeSpans.set(hookInput.tool_use_id, span)
    return {}
  }

  const postToolUse: HookCallback = async (input) => {
    const hookInput = input as PostToolUseHookInput
    const span = activeSpans.get(hookInput.tool_use_id)
    if (!span)
      return {}

    if (config.OTEL_CAPTURE_CONTENT && hookInput.tool_response != null) {
      span.setAttribute(ATTR_GEN_AI_TOOL_CALL_RESULT, JSON.stringify(hookInput.tool_response))
    }

    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
    activeSpans.delete(hookInput.tool_use_id)
    return {}
  }

  const postToolUseFailure: HookCallback = async (input) => {
    const hookInput = input as PostToolUseFailureHookInput
    const span = activeSpans.get(hookInput.tool_use_id)
    if (!span)
      return {}

    span.setAttribute(ATTR_ERROR_TYPE, hookInput.error)
    span.setStatus({ code: SpanStatusCode.ERROR, message: hookInput.error })
    span.end()
    activeSpans.delete(hookInput.tool_use_id)
    return {}
  }

  return { preToolUse, postToolUse, postToolUseFailure }
}
