const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const { runCypher, closeDriver } = require("../src/db/neo4j");
const { env } = require("../src/config/env");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [key, maybeValue] = token.split("=");
    const name = key.replace(/^--/, "");
    if (maybeValue !== undefined) {
      args[name] = maybeValue;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[name] = true;
      continue;
    }

    args[name] = next;
    i += 1;
  }
  return args;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function normalizeItemInt(value) {
  if (value === null || value === undefined) return null;
  const n = Number.parseInt(String(value).replace(/^0+/, "") || "0", 10);
  return Number.isFinite(n) ? n : null;
}

async function* readJsonLines(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}

async function listJsonlFiles(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".jsonl"))
    .map((e) => path.join(dirPath, e.name));
}

async function ensureConstraints({ dryRun }) {
  const queries = [
    "CREATE CONSTRAINT customer_entityId IF NOT EXISTS FOR (n:Customer) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT address_entityId IF NOT EXISTS FOR (n:Address) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT product_entityId IF NOT EXISTS FOR (n:Product) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT order_entityId IF NOT EXISTS FOR (n:Order) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT orderLine_entityId IF NOT EXISTS FOR (n:OrderLine) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT delivery_entityId IF NOT EXISTS FOR (n:Delivery) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT deliveryLine_entityId IF NOT EXISTS FOR (n:DeliveryLine) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT invoice_entityId IF NOT EXISTS FOR (n:Invoice) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT invoiceLine_entityId IF NOT EXISTS FOR (n:InvoiceLine) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT payment_entityId IF NOT EXISTS FOR (n:Payment) REQUIRE n.entityId IS UNIQUE",
    "CREATE CONSTRAINT journalEntryItem_entityId IF NOT EXISTS FOR (n:JournalEntryItem) REQUIRE n.entityId IS UNIQUE"
  ];

  if (dryRun) return;
  for (const q of queries) {
    // Neo4j doesn't allow multiple schema commands in one transaction in some configs; keep it simple.
    await runCypher({ query: q });
  }
}

async function resetDb({ dryRun }) {
  if (dryRun) return;
  await runCypher({ query: "MATCH (n) DETACH DELETE n" });
}

async function batchUpsert({
  label,
  files,
  batchSize,
  normalizeRow,
  cypher,
  dryRun,
  logEvery = 5000
}) {
  let total = 0;
  let batch = [];

  for (const file of files) {
    for await (const row of readJsonLines(file)) {
      const normalized = normalizeRow(row);
      if (!normalized) continue;
      batch.push(normalized);
      total += 1;

      if (batch.length >= batchSize) {
        if (!dryRun) await runCypher({ query: cypher, params: { rows: batch }, timeoutMs: env.querySafety.timeoutMs });
        batch = [];
      }

      if (total % logEvery === 0) {
        // eslint-disable-next-line no-console
        console.log(`[${label}] processed ${total.toLocaleString()} rows...`);
      }
    }
  }

  if (batch.length > 0) {
    if (!dryRun) await runCypher({ query: cypher, params: { rows: batch }, timeoutMs: env.querySafety.timeoutMs });
  }

  // eslint-disable-next-line no-console
  console.log(`[${label}] done: ${total.toLocaleString()} rows`);
  return total;
}

async function main() {
  const args = parseArgs(process.argv);

  const dataDir = path.resolve(
    args.dataDir || path.join(__dirname, "..", "..", "data", "sap-order-to-cash", "sap-o2c-data")
  );

  const dryRun = Boolean(args.dryRun);
  const reset = Boolean(args.reset);
  const batchSize = clampInt(args.batchSize, { min: 50, max: 5000, fallback: 1000 });

  // eslint-disable-next-line no-console
  console.log("Import configuration:");
  // eslint-disable-next-line no-console
  console.log(`- dataDir: ${dataDir}`);
  // eslint-disable-next-line no-console
  console.log(`- DB_KIND: ${env.dbKind}`);
  // eslint-disable-next-line no-console
  console.log(`- Neo4j: ${env.neo4j.uri} (db=${env.neo4j.database})`);
  // eslint-disable-next-line no-console
  console.log(`- batchSize: ${batchSize}`);
  // eslint-disable-next-line no-console
  console.log(`- dryRun: ${dryRun}`);
  // eslint-disable-next-line no-console
  console.log(`- reset: ${reset}`);

  if (env.dbKind !== "neo4j") {
    throw new Error(`DB_KIND=${env.dbKind} not supported by this import script (neo4j only).`);
  }

  if (!fs.existsSync(dataDir)) {
    throw new Error(`dataDir not found: ${dataDir}`);
  }

  try {
    if (reset) await resetDb({ dryRun });
    await ensureConstraints({ dryRun });

    // 1) Customers (Business Partners)
    await batchUpsert({
      label: "customers",
      files: await listJsonlFiles(path.join(dataDir, "business_partners")),
      batchSize,
      dryRun,
      normalizeRow: (r) => ({
        entityType: "Customer",
        entityId: String(r.businessPartner),
        businessPartner: String(r.businessPartner),
        customer: r.customer ? String(r.customer) : null,
        name: r.businessPartnerFullName || r.businessPartnerName || null,
        category: r.businessPartnerCategory || null,
        grouping: r.businessPartnerGrouping || null,
        isBlocked: Boolean(r.businessPartnerIsBlocked),
        createdAt: toIsoDate(r.creationDate),
        lastChangedAt: toIsoDate(r.lastChangeDate)
      }),
      cypher: `
UNWIND $rows AS row
MERGE (c:Customer { entityId: row.entityId })
SET c.entityType = row.entityType
SET c.businessPartner = row.businessPartner
SET c.customer = row.customer
SET c.name = row.name
SET c.category = row.category
SET c.grouping = row.grouping
SET c.isBlocked = row.isBlocked
SET c.createdAt = row.createdAt
SET c.lastChangedAt = row.lastChangedAt
`
    });

    // 2) Addresses + Customer-[:HAS_ADDRESS]->Address
    await batchUpsert({
      label: "addresses",
      files: await listJsonlFiles(path.join(dataDir, "business_partner_addresses")),
      batchSize,
      dryRun,
      normalizeRow: (r) => {
        const addressUuid = r.addressUuid ? String(r.addressUuid) : null;
        if (!addressUuid) return null;
        return {
          addressUuid,
          businessPartner: r.businessPartner ? String(r.businessPartner) : null,
          addressId: r.addressId ? String(r.addressId) : null,
          validityStartDate: toIsoDate(r.validityStartDate),
          validityEndDate: toIsoDate(r.validityEndDate),
          city: r.cityName || null,
          region: r.region || null,
          postalCode: r.postalCode || null,
          country: r.country || null,
          street: r.streetName || null,
          timeZone: r.addressTimeZone || null
        };
      },
      cypher: `
UNWIND $rows AS row
MERGE (a:Address { entityId: row.addressUuid })
SET a.entityType = "Address"
SET a.addressUuid = row.addressUuid
SET a.addressId = row.addressId
SET a.city = row.city
SET a.region = row.region
SET a.postalCode = row.postalCode
SET a.country = row.country
SET a.street = row.street
SET a.timeZone = row.timeZone
SET a.validityStartDate = row.validityStartDate
SET a.validityEndDate = row.validityEndDate
WITH a, row
OPTIONAL MATCH (c:Customer { entityId: row.businessPartner })
FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
  MERGE (c)-[r:HAS_ADDRESS]->(a)
  SET r.validityStartDate = row.validityStartDate
  SET r.validityEndDate = row.validityEndDate
)
`
    });

    // 3) Products + Product descriptions
    await batchUpsert({
      label: "products",
      files: await listJsonlFiles(path.join(dataDir, "products")),
      batchSize,
      dryRun,
      normalizeRow: (r) => ({
        entityType: "Product",
        entityId: String(r.product),
        product: String(r.product),
        productType: r.productType || null,
        productOldId: r.productOldId || null,
        productGroup: r.productGroup || null,
        baseUnit: r.baseUnit || null,
        division: r.division || null,
        grossWeight: toNumber(r.grossWeight),
        netWeight: toNumber(r.netWeight),
        weightUnit: r.weightUnit || null,
        isDeleted: Boolean(r.isMarkedForDeletion),
        createdAt: toIsoDate(r.creationDate),
        lastChangedAt: toIsoDate(r.lastChangeDateTime || r.lastChangeDate)
      }),
      cypher: `
UNWIND $rows AS row
MERGE (p:Product { entityId: row.entityId })
SET p.entityType = row.entityType
SET p.product = row.product
SET p.productType = row.productType
SET p.productOldId = row.productOldId
SET p.productGroup = row.productGroup
SET p.baseUnit = row.baseUnit
SET p.division = row.division
SET p.grossWeight = row.grossWeight
SET p.netWeight = row.netWeight
SET p.weightUnit = row.weightUnit
SET p.isDeleted = row.isDeleted
SET p.createdAt = row.createdAt
SET p.lastChangedAt = row.lastChangedAt
`
    });

    await batchUpsert({
      label: "product_descriptions",
      files: await listJsonlFiles(path.join(dataDir, "product_descriptions")),
      batchSize,
      dryRun,
      normalizeRow: (r) => ({
        product: r.product ? String(r.product) : null,
        language: r.language || null,
        description: r.productDescription || null
      }),
      cypher: `
UNWIND $rows AS row
MATCH (p:Product { entityId: row.product })
SET p.description = CASE WHEN row.language = "EN" THEN row.description ELSE p.description END
`
    });

    // 4) Sales orders (headers) + Customer-[:PLACED]->Order
    await batchUpsert({
      label: "sales_order_headers",
      files: await listJsonlFiles(path.join(dataDir, "sales_order_headers")),
      batchSize,
      dryRun,
      normalizeRow: (r) => ({
        entityType: "Order",
        entityId: String(r.salesOrder),
        salesOrder: String(r.salesOrder),
        soldToParty: r.soldToParty ? String(r.soldToParty) : null,
        salesOrderType: r.salesOrderType || null,
        salesOrganization: r.salesOrganization || null,
        distributionChannel: r.distributionChannel || null,
        division: r.organizationDivision || null,
        currency: r.transactionCurrency || null,
        totalNetAmount: toNumber(r.totalNetAmount),
        creationDate: toIsoDate(r.creationDate),
        requestedDeliveryDate: toIsoDate(r.requestedDeliveryDate),
        overallDeliveryStatus: r.overallDeliveryStatus || null,
        overallBillingStatus: r.overallOrdReltdBillgStatus || null,
        incoterms: r.incotermsClassification || null,
        incotermsLocation1: r.incotermsLocation1 || null
      }),
      cypher: `
UNWIND $rows AS row
MERGE (o:Order { entityId: row.entityId })
SET o.entityType = row.entityType
SET o.salesOrder = row.salesOrder
SET o.salesOrderType = row.salesOrderType
SET o.salesOrganization = row.salesOrganization
SET o.distributionChannel = row.distributionChannel
SET o.division = row.division
SET o.currency = row.currency
SET o.totalNetAmount = row.totalNetAmount
SET o.creationDate = row.creationDate
SET o.requestedDeliveryDate = row.requestedDeliveryDate
SET o.overallDeliveryStatus = row.overallDeliveryStatus
SET o.overallBillingStatus = row.overallBillingStatus
SET o.incoterms = row.incoterms
SET o.incotermsLocation1 = row.incotermsLocation1
WITH o, row
OPTIONAL MATCH (c:Customer { entityId: row.soldToParty })
FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
  MERGE (c)-[:PLACED]->(o)
)
`
    });

    // 5) Sales order items (lines) + Order-[:HAS_LINE]->OrderLine + OrderLine-[:ITEM]->Product
    await batchUpsert({
      label: "sales_order_items",
      files: await listJsonlFiles(path.join(dataDir, "sales_order_items")),
      batchSize,
      dryRun,
      normalizeRow: (r) => {
        const itemInt = normalizeItemInt(r.salesOrderItem);
        if (!r.salesOrder || itemInt === null) return null;
        return {
          orderId: String(r.salesOrder),
          itemInt,
          entityId: `${String(r.salesOrder)}:${itemInt}`,
          salesOrderItem: r.salesOrderItem ? String(r.salesOrderItem) : null,
          category: r.salesOrderItemCategory || null,
          material: r.material ? String(r.material) : null,
          requestedQuantity: toNumber(r.requestedQuantity),
          requestedQuantityUnit: r.requestedQuantityUnit || null,
          currency: r.transactionCurrency || null,
          netAmount: toNumber(r.netAmount),
          materialGroup: r.materialGroup || null,
          productionPlant: r.productionPlant || null,
          storageLocation: r.storageLocation || null
        };
      },
      cypher: `
UNWIND $rows AS row
MERGE (ol:OrderLine { entityId: row.entityId })
SET ol.entityType = "OrderLine"
SET ol.salesOrder = row.orderId
SET ol.itemInt = row.itemInt
SET ol.salesOrderItem = row.salesOrderItem
SET ol.category = row.category
SET ol.material = row.material
SET ol.requestedQuantity = row.requestedQuantity
SET ol.requestedQuantityUnit = row.requestedQuantityUnit
SET ol.currency = row.currency
SET ol.netAmount = row.netAmount
SET ol.materialGroup = row.materialGroup
SET ol.productionPlant = row.productionPlant
SET ol.storageLocation = row.storageLocation
WITH ol, row
MATCH (o:Order { entityId: row.orderId })
MERGE (o)-[:HAS_LINE]->(ol)
WITH ol, row
OPTIONAL MATCH (p:Product { entityId: row.material })
FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END |
  MERGE (ol)-[:ITEM]->(p)
)
`
    });

    // 6) Delivery headers + Delivery items (lines) + DeliveryLine-[:FULFILLS]->OrderLine
    await batchUpsert({
      label: "outbound_delivery_headers",
      files: await listJsonlFiles(path.join(dataDir, "outbound_delivery_headers")),
      batchSize,
      dryRun,
      normalizeRow: (r) => ({
        entityType: "Delivery",
        entityId: String(r.deliveryDocument),
        deliveryDocument: String(r.deliveryDocument),
        creationDate: toIsoDate(r.creationDate),
        overallGoodsMovementStatus: r.overallGoodsMovementStatus || null,
        overallPickingStatus: r.overallPickingStatus || null,
        shippingPoint: r.shippingPoint || null
      }),
      cypher: `
UNWIND $rows AS row
MERGE (d:Delivery { entityId: row.entityId })
SET d.entityType = row.entityType
SET d.deliveryDocument = row.deliveryDocument
SET d.creationDate = row.creationDate
SET d.overallGoodsMovementStatus = row.overallGoodsMovementStatus
SET d.overallPickingStatus = row.overallPickingStatus
SET d.shippingPoint = row.shippingPoint
`
    });

    await batchUpsert({
      label: "outbound_delivery_items",
      files: await listJsonlFiles(path.join(dataDir, "outbound_delivery_items")),
      batchSize,
      dryRun,
      normalizeRow: (r) => {
        const itemInt = normalizeItemInt(r.deliveryDocumentItem);
        const refItemInt = normalizeItemInt(r.referenceSdDocumentItem);
        if (!r.deliveryDocument || itemInt === null) return null;
        return {
          deliveryId: String(r.deliveryDocument),
          itemInt,
          entityId: `${String(r.deliveryDocument)}:${itemInt}`,
          deliveryDocumentItem: r.deliveryDocumentItem ? String(r.deliveryDocumentItem) : null,
          quantity: toNumber(r.actualDeliveryQuantity),
          quantityUnit: r.deliveryQuantityUnit || null,
          plant: r.plant || null,
          storageLocation: r.storageLocation || null,
          referenceSalesOrder: r.referenceSdDocument ? String(r.referenceSdDocument) : null,
          referenceSalesOrderItemInt: refItemInt
        };
      },
      cypher: `
UNWIND $rows AS row
MERGE (dl:DeliveryLine { entityId: row.entityId })
SET dl.entityType = "DeliveryLine"
SET dl.deliveryDocument = row.deliveryId
SET dl.itemInt = row.itemInt
SET dl.deliveryDocumentItem = row.deliveryDocumentItem
SET dl.quantity = row.quantity
SET dl.quantityUnit = row.quantityUnit
SET dl.plant = row.plant
SET dl.storageLocation = row.storageLocation
SET dl.referenceSalesOrder = row.referenceSalesOrder
SET dl.referenceSalesOrderItemInt = row.referenceSalesOrderItemInt
WITH dl, row
MATCH (d:Delivery { entityId: row.deliveryId })
MERGE (d)-[:HAS_LINE]->(dl)
WITH dl, row
OPTIONAL MATCH (ol:OrderLine { entityId: row.referenceSalesOrder + ':' + toString(row.referenceSalesOrderItemInt) })
FOREACH (_ IN CASE WHEN ol IS NULL THEN [] ELSE [1] END |
  MERGE (dl)-[f:FULFILLS]->(ol)
  SET f.qty = row.quantity
  SET f.unit = row.quantityUnit
)
`
    });

    // 7) Invoices (billing docs) + invoice items (often reference deliveries)
    await batchUpsert({
      label: "billing_document_headers",
      files: await listJsonlFiles(path.join(dataDir, "billing_document_headers")),
      batchSize,
      dryRun,
      normalizeRow: (r) => ({
        entityType: "Invoice",
        entityId: String(r.billingDocument),
        billingDocument: String(r.billingDocument),
        billingDocumentType: r.billingDocumentType || null,
        billingDocumentDate: toIsoDate(r.billingDocumentDate),
        creationDate: toIsoDate(r.creationDate),
        lastChangeDateTime: toIsoDate(r.lastChangeDateTime),
        isCancelled: Boolean(r.billingDocumentIsCancelled),
        cancelledBillingDocument: r.cancelledBillingDocument ? String(r.cancelledBillingDocument) : null,
        soldToParty: r.soldToParty ? String(r.soldToParty) : null,
        currency: r.transactionCurrency || null,
        totalNetAmount: toNumber(r.totalNetAmount),
        companyCode: r.companyCode || null,
        fiscalYear: r.fiscalYear ? String(r.fiscalYear) : null,
        accountingDocument: r.accountingDocument ? String(r.accountingDocument) : null
      }),
      cypher: `
UNWIND $rows AS row
MERGE (i:Invoice { entityId: row.entityId })
SET i.entityType = row.entityType
SET i.billingDocument = row.billingDocument
SET i.billingDocumentType = row.billingDocumentType
SET i.billingDocumentDate = row.billingDocumentDate
SET i.creationDate = row.creationDate
SET i.lastChangeDateTime = row.lastChangeDateTime
SET i.isCancelled = row.isCancelled
SET i.cancelledBillingDocument = row.cancelledBillingDocument
SET i.currency = row.currency
SET i.totalNetAmount = row.totalNetAmount
SET i.companyCode = row.companyCode
SET i.fiscalYear = row.fiscalYear
SET i.accountingDocument = row.accountingDocument
WITH i, row
OPTIONAL MATCH (c:Customer { entityId: row.soldToParty })
FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
  MERGE (c)-[:BILLED]->(i)
)
`
    });

    await batchUpsert({
      label: "billing_document_items",
      files: await listJsonlFiles(path.join(dataDir, "billing_document_items")),
      batchSize,
      dryRun,
      normalizeRow: (r) => {
        const itemInt = normalizeItemInt(r.billingDocumentItem);
        const refItemInt = normalizeItemInt(r.referenceSdDocumentItem);
        if (!r.billingDocument || itemInt === null) return null;
        return {
          invoiceId: String(r.billingDocument),
          itemInt,
          entityId: `${String(r.billingDocument)}:${itemInt}`,
          billingDocumentItem: r.billingDocumentItem ? String(r.billingDocumentItem) : null,
          material: r.material ? String(r.material) : null,
          billingQuantity: toNumber(r.billingQuantity),
          billingQuantityUnit: r.billingQuantityUnit || null,
          netAmount: toNumber(r.netAmount),
          currency: r.transactionCurrency || null,
          referenceDelivery: r.referenceSdDocument ? String(r.referenceSdDocument) : null,
          referenceDeliveryItemInt: refItemInt
        };
      },
      cypher: `
UNWIND $rows AS row
MERGE (il:InvoiceLine { entityId: row.entityId })
SET il.entityType = "InvoiceLine"
SET il.billingDocument = row.invoiceId
SET il.itemInt = row.itemInt
SET il.billingDocumentItem = row.billingDocumentItem
SET il.material = row.material
SET il.billingQuantity = row.billingQuantity
SET il.billingQuantityUnit = row.billingQuantityUnit
SET il.netAmount = row.netAmount
SET il.currency = row.currency
SET il.referenceDelivery = row.referenceDelivery
SET il.referenceDeliveryItemInt = row.referenceDeliveryItemInt
WITH il, row
MATCH (i:Invoice { entityId: row.invoiceId })
MERGE (i)-[:HAS_LINE]->(il)
WITH il, row
OPTIONAL MATCH (p:Product { entityId: row.material })
FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END |
  MERGE (il)-[:ITEM]->(p)
)
WITH il, row
OPTIONAL MATCH (dl:DeliveryLine { entityId: row.referenceDelivery + ':' + toString(row.referenceDeliveryItemInt) })
FOREACH (_ IN CASE WHEN dl IS NULL THEN [] ELSE [1] END |
  MERGE (il)-[ch:CHARGES]->(dl)
  SET ch.qty = row.billingQuantity
  SET ch.unit = row.billingQuantityUnit
)
`
    });

    // 8) Journal entry items (AR) to link payments to invoices.
    await batchUpsert({
      label: "journal_entry_items_ar",
      files: await listJsonlFiles(path.join(dataDir, "journal_entry_items_accounts_receivable")),
      batchSize,
      dryRun,
      normalizeRow: (r) => {
        if (!r.companyCode || !r.fiscalYear || !r.accountingDocument || !r.accountingDocumentItem) return null;
        return {
          entityId: `${String(r.companyCode)}:${String(r.fiscalYear)}:${String(r.accountingDocument)}:${String(
            r.accountingDocumentItem
          )}`,
          companyCode: String(r.companyCode),
          fiscalYear: String(r.fiscalYear),
          accountingDocument: String(r.accountingDocument),
          accountingDocumentItem: String(r.accountingDocumentItem),
          referenceBillingDocument: r.referenceDocument ? String(r.referenceDocument) : null,
          customer: r.customer ? String(r.customer) : null,
          postingDate: toIsoDate(r.postingDate),
          documentDate: toIsoDate(r.documentDate),
          amount: toNumber(r.amountInTransactionCurrency),
          currency: r.transactionCurrency || null,
          clearingAccountingDocument: r.clearingAccountingDocument ? String(r.clearingAccountingDocument) : null,
          clearingDate: toIsoDate(r.clearingDate)
        };
      },
      cypher: `
UNWIND $rows AS row
MERGE (je:JournalEntryItem { entityId: row.entityId })
SET je.entityType = "JournalEntryItem"
SET je.companyCode = row.companyCode
SET je.fiscalYear = row.fiscalYear
SET je.accountingDocument = row.accountingDocument
SET je.accountingDocumentItem = row.accountingDocumentItem
SET je.referenceBillingDocument = row.referenceBillingDocument
SET je.customer = row.customer
SET je.postingDate = row.postingDate
SET je.documentDate = row.documentDate
SET je.amount = row.amount
SET je.currency = row.currency
SET je.clearingAccountingDocument = row.clearingAccountingDocument
SET je.clearingDate = row.clearingDate
WITH je, row
OPTIONAL MATCH (i:Invoice { entityId: row.referenceBillingDocument })
FOREACH (_ IN CASE WHEN i IS NULL THEN [] ELSE [1] END |
  MERGE (je)-[:AR_FOR]->(i)
)
`
    });

    // 9) Payments + Payment-[:PAID_BY]->Customer + Payment-[:CLEARS]->JournalEntryItem + Payment-[:APPLIED_TO]->Invoice
    await batchUpsert({
      label: "payments_ar",
      files: await listJsonlFiles(path.join(dataDir, "payments_accounts_receivable")),
      batchSize,
      dryRun,
      normalizeRow: (r) => {
        if (!r.companyCode || !r.fiscalYear || !r.accountingDocument || !r.accountingDocumentItem) return null;
        return {
          entityId: `${String(r.companyCode)}:${String(r.fiscalYear)}:${String(r.accountingDocument)}:${String(
            r.accountingDocumentItem
          )}`,
          companyCode: String(r.companyCode),
          fiscalYear: String(r.fiscalYear),
          accountingDocument: String(r.accountingDocument),
          accountingDocumentItem: String(r.accountingDocumentItem),
          clearingAccountingDocument: r.clearingAccountingDocument ? String(r.clearingAccountingDocument) : null,
          clearingDocFiscalYear: r.clearingDocFiscalYear ? String(r.clearingDocFiscalYear) : null,
          clearingDate: toIsoDate(r.clearingDate),
          postingDate: toIsoDate(r.postingDate),
          documentDate: toIsoDate(r.documentDate),
          amount: toNumber(r.amountInTransactionCurrency),
          currency: r.transactionCurrency || null,
          customer: r.customer ? String(r.customer) : null
        };
      },
      cypher: `
UNWIND $rows AS row
MERGE (p:Payment { entityId: row.entityId })
SET p.entityType = "Payment"
SET p.companyCode = row.companyCode
SET p.fiscalYear = row.fiscalYear
SET p.accountingDocument = row.accountingDocument
SET p.accountingDocumentItem = row.accountingDocumentItem
SET p.clearingAccountingDocument = row.clearingAccountingDocument
SET p.clearingDocFiscalYear = row.clearingDocFiscalYear
SET p.clearingDate = row.clearingDate
SET p.postingDate = row.postingDate
SET p.documentDate = row.documentDate
SET p.amount = row.amount
SET p.currency = row.currency
WITH p, row
OPTIONAL MATCH (c:Customer { entityId: row.customer })
FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
  MERGE (p)-[:PAID_BY]->(c)
)
WITH p, row
OPTIONAL MATCH (je:JournalEntryItem { entityId: row.entityId })
FOREACH (_ IN CASE WHEN je IS NULL THEN [] ELSE [1] END |
  MERGE (p)-[:CLEARS]->(je)
)
`
    });

    if (!dryRun) {
      await runCypher({
        query: `
MATCH (p:Payment)-[:CLEARS]->(:JournalEntryItem)-[:AR_FOR]->(i:Invoice)
MERGE (p)-[:APPLIED_TO]->(i)
`
      });
    }

    // eslint-disable-next-line no-console
    console.log("Import complete.");
  } finally {
    await closeDriver();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

