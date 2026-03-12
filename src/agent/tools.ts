import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'
import { saveArtifact, searchArtifacts } from '~/db/queries/artifacts'
import { artifactTypeValues } from '~/db/schema'
import { readTranscript } from '~/storage/transcript'

export interface ToolContext {
  sessionId: number
  patientId: number
  telegramId: number
  transcriptPath: string
}

export function createTherapyTools(ctx: ToolContext) {
  return createSdkMcpServer({
    name: 'therapy-tools',
    version: '1.0.0',
    tools: [
      tool(
        'save_session_note',
        'Save an important clinical observation or note about this session. Use when the patient shares something significant, you identify a pattern, or want to record a therapeutic moment.',
        {
          type: z.enum(artifactTypeValues),
          content: z
            .string()
            .describe('Description of the clinical observation'),
          verbatimQuote: z
            .string()
            .optional()
            .describe('Exact quote from the patient, if relevant'),
          clinicalRelevance: z
            .number()
            .min(1)
            .max(10)
            .optional()
            .describe('Clinical relevance score 1-10, default 5'),
        },
        async (args) => {
          await saveArtifact({
            sessionId: ctx.sessionId,
            patientId: ctx.patientId,
            type: args.type,
            content: args.content,
            verbatimQuote: args.verbatimQuote,
            clinicalRelevance: args.clinicalRelevance ?? 5,
          })
          return {
            content: [
              { type: 'text' as const, text: `Note saved: ${args.type}` },
            ],
          }
        },
        { annotations: { readOnlyHint: false } },
      ),

      tool(
        'log_exercise',
        'Assign a therapeutic homework exercise to the patient. Use when you suggest a specific practice for them to try between sessions.',
        {
          title: z.string().describe('Short title for the exercise'),
          description: z
            .string()
            .describe('Detailed instructions for the exercise'),
          frequency: z
            .string()
            .optional()
            .describe(
              'How often to practice, e.g. "daily", "3x/week", "when triggered"',
            ),
        },
        async (args) => {
          await saveArtifact({
            sessionId: ctx.sessionId,
            patientId: ctx.patientId,
            type: 'homework',
            content: `${args.title}: ${args.description}${args.frequency ? ` (${args.frequency})` : ''}`,
            clinicalRelevance: 7,
          })
          return {
            content: [
              {
                type: 'text' as const,
                text: `Exercise logged: ${args.title}`,
              },
            ],
          }
        },
        { annotations: { readOnlyHint: false } },
      ),

      tool(
        'search_history',
        'Search past therapy transcripts and clinical artifacts by keyword. Use when you need to recall specific past conversations, quotes, or patterns. Returns matching artifacts and transcript excerpts.',
        {
          keyword: z
            .string()
            .describe('Search keyword or theme to look for'),
        },
        async (args) => {
          const results: string[] = []

          // Search artifacts DB
          const artifacts = await searchArtifacts(
            ctx.patientId,
            args.keyword,
          )
          if (artifacts.length > 0) {
            results.push('## Matching Artifacts')
            for (const a of artifacts.slice(0, 10)) {
              results.push(
                `- [${a.type}] ${a.content}${a.verbatimQuote ? ` | Quote: "${a.verbatimQuote}"` : ''}`,
              )
            }
          }

          // Search current transcript
          const transcript = await readTranscript(ctx.transcriptPath)
          if (transcript) {
            const lines = transcript.split('\n')
            const matches = lines.filter(line =>
              line.toLowerCase().includes(args.keyword.toLowerCase()),
            )
            if (matches.length > 0) {
              results.push(
                '\n## Transcript Matches',
                ...matches.slice(0, 15),
              )
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text:
                  results.length > 0
                    ? results.join('\n')
                    : `No results found for "${args.keyword}"`,
              },
            ],
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  })
}
