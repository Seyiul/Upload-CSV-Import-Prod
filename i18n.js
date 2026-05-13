/**
 * @NApiVersion 2.1
 */
define(["N/translation"], (translation) => {
  const COLLECTION = "custcollection_swk_upload_csv_file";

  const KEYS = [
    "TITLE",
    "TEMPLATE",
    "TEMPLATE_DOWNLOAD",
    "UPLOAD_OPTION",
    "UPLOAD_STATUS",
    "SELECT_TRANSACTION_TYPE_REQUIRED",
    "DOWNLOAD_LINK",
    "TRANSACTION_TYPE",
    "SELECT_TRANSACTION_TYPE",
    "BILL_EXPENSE",
    "BILL_ITEM",
    "PURCHASE_ORDER",
    "INVOICE",
    "JOURNAL",
    "REFRESH",
    "DOWNLOAD_ERROR_CSV",
    "SUBMIT",
    "TASK_ID",
    "STATUS",
    "STAGE",
    "SUCCESS",
    "ERRORS",
    "UPLOAD_COMPLETED_WITH_ERRORS",
    "UPLOAD_COMPLETED",
    "UPLOAD_FAILED",
    "MISSING_TYPE_OR_FILE",
    "UNSUPPORTED_TRANSACTION_TYPE",
    "ERROR_PROCESSING_FILE",
    "MISSING_ERROR_FILE",
    "INVALID_TRANSACTION_TYPE",
    "PO_TEMPLATE",
    "BILL_EXPENSE_TEMPLATE",
    "BILL_ITEM_TEMPLATE",
    "INVOICE_TEMPLATE",
    "JOURNAL_TEMPLATE",
    "DOWNLOAD",
    "ERROR_LOADING_TEMPLATE_LINK",
    "CSV_UPLOAD_IN_PROGRESS",
    "PLEASE_WAIT_PROCESSING",
    "MISSING_COLUMN",
    "CSV_HEADER_VALIDATION_FAILED",
    "INVALID_REFERENCE_VALUE",
    "TRANSACTION_CATEGORY",
    "DEPARTMENT",
    "VENDOR_OR_CUSTOMER",
    "ACCOUNT",
    "SUBSIDIARY",
    "LOCATION",
    "CURRENCY",
    "TAX_CODE",
    "ITEM",
    "ITEM_NOT_FOUND",
    "MEMO",
    "TERMS",
    "POSTING_PERIOD",
    "LOCATION_NOT_FOUND",
    "MISSING_TRANSACTION_CATEGORY",
    "MISSING_CSV_FILE_PARAMETER",
    "INVALID_TRANSACTION_TYPE_WITH_VALUE",
    "MAIN_PROJECT",
    "MISSING_DEPARTMENT",
    "MISSING_ACCOUNT",
    "INVALID_TAX_CODE",
    "MISSING_AMORTIZATION_SCHEDULE",
    "INVALID_ESTIMATED_COST_ACCOUNT",
    "MISSING_PROJECT_FOR_SALES_ENTRY",
    "PROJECT_NOT_FOUND",
    "SALES_NOT_ALLOWED_COST_PROJECT",
    "SALES_NOT_ALLOWED_ASSET_PROJECT",
    "MISSING_DEPARTMENT_FOR_COST_ACCOUNT",
    "MISSING_PROJECT_FOR_SALES_ACCOUNT",
    "MISSING_EXTERNAL_ID",
    "CSV_NO_DATA_ROWS",
    "CSV_NO_MAPPED_HEADERS",
  ];

  let cachedMessages = null;

  const load = () => {
    if (cachedMessages) {
      return cachedMessages;
    }

    const localized = translation.load({
      collections: [
        {
          alias: "msg",
          collection: COLLECTION,
          keys: KEYS,
        },
      ],
    });

    cachedMessages = localized.msg;
    return cachedMessages;
  };

  return {
    load,
  };
});
