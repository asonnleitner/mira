import { and, desc, eq, ilike } from 'drizzle-orm'
import { db } from '~/db'
import { clinicalArtifacts } from '~/db/schema'

export async function saveArtifact(data: {
  sessionId: number
  patientId?: number
  type:
    | 'disclosure'
    | 'insight'
    | 'emotion'
    | 'coping_strategy'
    | 'trigger'
    | 'goal'
    | 'pattern'
    | 'homework'
  content: string
  verbatimQuote?: string
  clinicalRelevance?: number
}) {
  const [artifact] = await db
    .insert(clinicalArtifacts)
    .values(data)
    .returning()
  return artifact
}

export async function getArtifactsByPatient(patientId: number) {
  return db
    .select()
    .from(clinicalArtifacts)
    .where(eq(clinicalArtifacts.patientId, patientId))
    .orderBy(desc(clinicalArtifacts.createdAt))
}

export async function getArtifactsBySession(sessionId: number) {
  return db
    .select()
    .from(clinicalArtifacts)
    .where(eq(clinicalArtifacts.sessionId, sessionId))
    .orderBy(desc(clinicalArtifacts.createdAt))
}

export async function searchArtifacts(patientId: number, keyword: string) {
  return db
    .select()
    .from(clinicalArtifacts)
    .where(
      and(
        eq(clinicalArtifacts.patientId, patientId),
        ilike(clinicalArtifacts.content, `%${keyword}%`),
      ),
    )
    .orderBy(desc(clinicalArtifacts.clinicalRelevance))
}
