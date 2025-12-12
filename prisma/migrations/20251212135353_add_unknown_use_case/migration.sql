-- CreateTable
CREATE TABLE "UnknownUseCase" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT,
    "messageContent" TEXT NOT NULL,
    "detectedIntent" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "agentResponse" TEXT,
    "wasHandedOff" BOOLEAN NOT NULL DEFAULT false,
    "handoffReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnknownUseCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnknownUseCase_conversationId_idx" ON "UnknownUseCase"("conversationId");

-- CreateIndex
CREATE INDEX "UnknownUseCase_detectedIntent_idx" ON "UnknownUseCase"("detectedIntent");

-- CreateIndex
CREATE INDEX "UnknownUseCase_createdAt_idx" ON "UnknownUseCase"("createdAt");

-- CreateIndex
CREATE INDEX "UnknownUseCase_wasHandedOff_idx" ON "UnknownUseCase"("wasHandedOff");
