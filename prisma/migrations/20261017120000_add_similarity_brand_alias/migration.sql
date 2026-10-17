-- CreateTable
CREATE TABLE "SimilarityBrandAlias" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "matchName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimilarityBrandAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimilarityBrandAlias_matchName_key" ON "SimilarityBrandAlias"("matchName");
