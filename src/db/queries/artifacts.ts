import type { InsertArtifact } from '~/db/zod'
import { and, desc, eq, ilike } from 'drizzle-orm'
import { db, tables } from '~/db'

export async function saveArtifact(data: Pick<InsertArtifact, 'sessionId' | 'patientId' | 'type' | 'content' | 'verbatimQuote' | 'clinicalRelevance'>) {
  const [artifact] = await db
    .insert(tables.clinicalArtifacts)
    .values(data)
    .returning()
  return artifact
}

export async function getArtifactsByPatient(patientId: number) {
  return db
    .select()
    .from(tables.clinicalArtifacts)
    .where(eq(tables.clinicalArtifacts.patientId, patientId))
    .orderBy(desc(tables.clinicalArtifacts.createdAt))
}

export async function getArtifactsBySession(sessionId: number) {
  return db
    .select()
    .from(tables.clinicalArtifacts)
    .where(eq(tables.clinicalArtifacts.sessionId, sessionId))
    .orderBy(desc(tables.clinicalArtifacts.createdAt))
}

export async function searchArtifacts(patientId: number, keyword: string) {
  return db
    .select()
    .from(tables.clinicalArtifacts)
    .where(
      and(
        eq(tables.clinicalArtifacts.patientId, patientId),
        ilike(tables.clinicalArtifacts.content, `%${keyword}%`),
      ),
    )
    .orderBy(desc(tables.clinicalArtifacts.clinicalRelevance))
}
