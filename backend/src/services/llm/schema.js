// Hard-coded schema contract for the imported SAP O2C dataset.
// This prevents LLMs from referencing non-existent labels/relationship types.

const graphSchema = {
  labels: [
    "Customer",
    "Address",
    "Product",
    "Order",
    "OrderLine",
    "Delivery",
    "DeliveryLine",
    "Invoice",
    "InvoiceLine",
    "Payment",
    "JournalEntryItem"
  ],
  relationshipTypes: [
    "HAS_ADDRESS",
    "PLACED",
    "BILLED",
    "HAS_LINE",
    "ITEM",
    "FULFILLS",
    "CHARGES",
    "PAID_BY",
    "CLEARS",
    "AR_FOR",
    "APPLIED_TO"
  ],
  conventions: {
    // Stable addressing for nodes created by the import script.
    entityId: {
      Customer: "businessPartner",
      Address: "addressUuid",
      Product: "product",
      Order: "salesOrder",
      OrderLine: "salesOrder:itemInt",
      Delivery: "deliveryDocument",
      DeliveryLine: "deliveryDocument:itemInt",
      Invoice: "billingDocument",
      InvoiceLine: "billingDocument:itemInt",
      Payment: "companyCode:fiscalYear:accountingDocument:accountingDocumentItem",
      JournalEntryItem: "companyCode:fiscalYear:accountingDocument:accountingDocumentItem"
    }
  }
};

function schemaForPrompt() {
  return {
    labels: graphSchema.labels,
    relationships: graphSchema.relationshipTypes,
    nodeIdConventions: graphSchema.conventions.entityId
  };
}

module.exports = { graphSchema, schemaForPrompt };

