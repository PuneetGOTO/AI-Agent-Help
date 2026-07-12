CREATE TABLE "agent_version_knowledge_bases" (
    "agentVersionId" UUID NOT NULL,
    "knowledgeBaseId" UUID NOT NULL,
    CONSTRAINT "agent_version_knowledge_bases_pkey" PRIMARY KEY ("agentVersionId", "knowledgeBaseId")
);

CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_chunks_documentId_sequence_key"
ON "knowledge_chunks"("documentId", "sequence");

CREATE INDEX "knowledge_chunks_documentId_idx" ON "knowledge_chunks"("documentId");

ALTER TABLE "agent_version_knowledge_bases"
ADD CONSTRAINT "agent_version_knowledge_bases_agentVersionId_fkey"
FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_version_knowledge_bases"
ADD CONSTRAINT "agent_version_knowledge_bases_knowledgeBaseId_fkey"
FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "knowledge_chunks"
ADD CONSTRAINT "knowledge_chunks_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
