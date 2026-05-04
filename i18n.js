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
    "MEMO",
    "TERMS",
    "POSTING_PERIOD",
  ];

  const load = () => {
    const localized = translation.load({
      collections: [
        {
          alias: "msg",
          collection: COLLECTION,
          keys: KEYS,
        },
      ],
    });

    return localized.msg;
  };

  return {
    load,
  };
});
