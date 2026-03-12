import type { InsertArtifact } from '~/db/zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, tables } from '~/db'
import { withDbSpan } from '~/telemetry/tracing'

export async function saveArtifact(data: Pick<InsertArtifact, 'sessionId' | 'patientId' | 'type' | 'content' | 'verbatimQuote' | 'clinicalRelevance'>) {
  const [artifact] = await withDbSpan(
    db.insert(tables.clinicalArtifacts)
      .values(data)
      .returning(),
  )
  return artifact
}

export async function getArtifactsByPatient(patientId: number) {
  return withDbSpan(
    db.select()
      .from(tables.clinicalArtifacts)
      .where(eq(tables.clinicalArtifacts.patientId, patientId))
      .orderBy(desc(tables.clinicalArtifacts.createdAt)),
  )
}

export async function getArtifactsBySession(sessionId: number) {
  return withDbSpan(
    db.select()
      .from(tables.clinicalArtifacts)
      .where(eq(tables.clinicalArtifacts.sessionId, sessionId))
      .orderBy(desc(tables.clinicalArtifacts.createdAt)),
  )
}

export async function searchArtifacts(patientId: number, keyword: string) {
  return withDbSpan(
    db.select()
      .from(tables.clinicalArtifacts)
      .where(
        and(
          eq(tables.clinicalArtifacts.patientId, patientId),
          sql`LOWER(${tables.clinicalArtifacts.content}) LIKE LOWER(${`%${keyword}%`})`,
        ),
      )
      .orderBy(desc(tables.clinicalArtifacts.clinicalRelevance)),
  )
}
