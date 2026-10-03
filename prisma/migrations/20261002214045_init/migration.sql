-- CreateTable
CREATE TABLE "Authority" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "onsCode" TEXT,
    "population" INTEGER,
    "populationSource" TEXT,
    "notes" TEXT,

    CONSTRAINT "Authority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDataset" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourcePageUrl" TEXT,
    "licence" TEXT,
    "publishedAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "archivePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "isFixture" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SourceDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT,
    "adapter" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsRead" INTEGER,
    "rowsImported" INTEGER,
    "rowsRejected" INTEGER,
    "totalAmount" DECIMAL(18,2),
    "checks" JSONB,
    "message" TEXT,
    "error" TEXT,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "financialYear" TEXT NOT NULL,
    "supplierRaw" TEXT NOT NULL,
    "supplierId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "amountIsNet" BOOLEAN,
    "department" TEXT,
    "serviceArea" TEXT,
    "category" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "extra" JSONB,
    "rowHash" TEXT NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "normalisedKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyNumber" TEXT,
    "notes" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAlias" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAuthorityStat" (
    "supplierId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "SupplierAuthorityStat_pkey" PRIMARY KEY ("supplierId","authorityId","financialYear")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "reference" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "supplierRaw" TEXT NOT NULL,
    "supplierId" TEXT,
    "value" DECIMAL(18,2),
    "valueBasis" TEXT,
    "awardDate" DATE,
    "startDate" DATE,
    "endDate" DATE,
    "reviewDate" DATE,
    "department" TEXT,
    "category" TEXT,
    "procurementRoute" TEXT,
    "sourceRecordUrl" TEXT,
    "extra" JSONB,
    "rowHash" TEXT NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "budget" DECIMAL(18,2),
    "actual" DECIMAL(18,2),
    "unit" TEXT NOT NULL DEFAULT 'GBP',
    "note" TEXT,
    "pageRef" TEXT,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "decisionDate" DATE,
    "status" TEXT,
    "proposal" TEXT,
    "councilReason" TEXT,
    "alternatives" TEXT,
    "financialImplications" TEXT,
    "outcome" TEXT,
    "summaryKind" TEXT,
    "sourceUrl" TEXT NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "datasetId" TEXT,
    "decisionId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "meetingDate" DATE,
    "bodyName" TEXT,
    "textExcerpt" TEXT,
    "fullText" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMeasure" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "PerformanceMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyFlag" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "supplierId" TEXT,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodLabel" TEXT,

    CONSTRAINT "AnomalyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceDataset_authorityId_kind_idx" ON "SourceDataset"("authorityId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDataset_authorityId_sourceUrl_sha256_key" ON "SourceDataset"("authorityId", "sourceUrl", "sha256");

-- CreateIndex
CREATE INDEX "ImportRun_adapter_startedAt_idx" ON "ImportRun"("adapter", "startedAt");

-- CreateIndex
CREATE INDEX "Transaction_authorityId_date_idx" ON "Transaction"("authorityId", "date");

-- CreateIndex
CREATE INDEX "Transaction_supplierId_date_idx" ON "Transaction"("supplierId", "date");

-- CreateIndex
CREATE INDEX "Transaction_financialYear_idx" ON "Transaction"("financialYear");

-- CreateIndex
CREATE INDEX "Transaction_category_idx" ON "Transaction"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_datasetId_rowHash_rowNumber_key" ON "Transaction"("datasetId", "rowHash", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_normalisedKey_key" ON "Supplier"("normalisedKey");

-- CreateIndex
CREATE INDEX "Supplier_displayName_idx" ON "Supplier"("displayName");

-- CreateIndex
CREATE INDEX "SupplierAlias_supplierId_idx" ON "SupplierAlias"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAlias_rawName_key" ON "SupplierAlias"("rawName");

-- CreateIndex
CREATE INDEX "SupplierAuthorityStat_authorityId_financialYear_total_idx" ON "SupplierAuthorityStat"("authorityId", "financialYear", "total");

-- CreateIndex
CREATE INDEX "Contract_authorityId_idx" ON "Contract"("authorityId");

-- CreateIndex
CREATE INDEX "Contract_supplierId_idx" ON "Contract"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_datasetId_rowHash_rowNumber_key" ON "Contract"("datasetId", "rowHash", "rowNumber");

-- CreateIndex
CREATE INDEX "BudgetLine_authorityId_financialYear_idx" ON "BudgetLine"("authorityId", "financialYear");

-- CreateIndex
CREATE INDEX "Decision_authorityId_decisionDate_idx" ON "Decision"("authorityId", "decisionDate");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_authorityId_sourceUrl_key" ON "Decision"("authorityId", "sourceUrl");

-- CreateIndex
CREATE INDEX "Document_authorityId_kind_idx" ON "Document"("authorityId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Document_authorityId_sourceUrl_key" ON "Document"("authorityId", "sourceUrl");

-- CreateIndex
CREATE INDEX "PerformanceMeasure_authorityId_service_financialYear_idx" ON "PerformanceMeasure"("authorityId", "service", "financialYear");

-- CreateIndex
CREATE INDEX "AnomalyFlag_authorityId_rule_idx" ON "AnomalyFlag"("authorityId", "rule");

-- CreateIndex
CREATE INDEX "AnomalyFlag_supplierId_idx" ON "AnomalyFlag"("supplierId");

-- AddForeignKey
ALTER TABLE "SourceDataset" ADD CONSTRAINT "SourceDataset_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "SourceDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "SourceDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAlias" ADD CONSTRAINT "SupplierAlias_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAuthorityStat" ADD CONSTRAINT "SupplierAuthorityStat_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAuthorityStat" ADD CONSTRAINT "SupplierAuthorityStat_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "SourceDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "SourceDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "SourceDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceMeasure" ADD CONSTRAINT "PerformanceMeasure_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceMeasure" ADD CONSTRAINT "PerformanceMeasure_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "SourceDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyFlag" ADD CONSTRAINT "AnomalyFlag_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyFlag" ADD CONSTRAINT "AnomalyFlag_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
