/**
 * @NApiVersion 2.1
 */
define([], () => {
  const SUITELET_SCRIPT_ID = "customscript_swk_sl_uploadcsvfile";
  const SUITELET_DEPLOYMENT_ID = "customdeploy_swk_sl_uploadcsvfile";

  const ACTIONS = {
    taskStatus: "taskstatus",
    downloadErrorCsv: "downloaderrorcsv",
  };

  const RESULT_SUMMARY_PREFIX = "swk_mr_summary_";
  const RESULT_ERROR_PREFIX = "swk_mr_errors_";
  const RESULT_FOLDER_ID_PARAM = "custscript_swk_csv_result_folder_id";

  const TRANSACTION_TYPES = {
    PO: "PO",
    BILL: "BILL",
    BILL_ITEM: "BILL_ITEM",
    INVOICE: "INVOICE",
    JOURNAL: "JOURNAL",
  };

  const TEMPLATE_FILE_ID_PARAMS = {
    PO: "custscript_swk_po_template_file_id",
    BILL: "custscript_swk_bill_template_file_id",
    BILL_ITEM: "custscript_swk_billitem_template_file_id",
    INVOICE: "custscript_swk_invoice_template_file_id",
    JOURNAL: "custscript_swk_journal_template_file_id",
  };

  const TRANSACTION_CONFIG = {
    PO: {
      templateName: "PO Template.csv",
      task: {
        scriptId: "customscript_swk_mr_processcsvpo",
        deploymentId: "customdeploy_swk_mr_processcsvpo",
        params: {
          fileId: "custscript_swk_csv_file_id_po",
          transactionType: "custscript_swk_csv_tran_type_po",
        },
      },
    },
    BILL: {
      templateName: "Bill Expense Template.csv",
      task: {
        scriptId: "customscript_swk_mr_processcsvbill",
        deploymentId: "customdeploy_swk_mr_processcsvbill",
        params: {
          fileId: "custscript_swk_csv_file_id",
          transactionType: "custscript_swk_csv_tran_type",
        },
      },
    },
    BILL_ITEM: {
      templateName: "Bill Item Template.csv",
      task: {
        scriptId: "customscript_swk_mr_processcsvbillitem",
        deploymentId: "customdeploy_swk_mr_processcsvbillitem",
        params: {
          fileId: "custscript_swk_csv_file_id_billitem",
          transactionType: "custscript_swk_csv_tran_type_billitem",
        },
      },
    },
    INVOICE: {
      templateName: "Invoice Template.csv",
      task: {
        scriptId: "customscript_swk_mr_processcsvinvoice",
        deploymentId: "customdeploy_swk_mr_processcsvinvoice",
        params: {
          fileId: "custscript_swk_csv_file_id_iv",
          transactionType: "custscript_swk_csv_tran_type_iv",
        },
      },
    },
    JOURNAL: {
      templateName: "Journal Template.csv",
      task: {
        scriptId: "customscript_swk_mr_processcsvjournal",
        deploymentId: "customdeploy_swk_mr_processcsvjournal",
        params: {
          fileId: "custscript_swk_csv_file_id_jn",
          transactionType: "custscript_swk_csv_tran_type_jn",
        },
      },
    },
  };

  const RECORD_TYPES = {
    PO: "purchaseorder",
    BILL: "vendorbill",
    BILL_ITEM: "vendorbill",
    INVOICE: "invoice",
    JOURNAL: "journalentry",
  };

  const PROJECT_FIELD_IDS = {
    body: "custbody_swk_project_mainsingle",
    line: "custcol_swk_project_line",
    segment: "cseg_swk_lapopjt",
  };

  // Array values mean one of the listed header aliases is required.
  const REQUIRED_CSV_HEADERS = {
    PO: [
      ["External ID", "EXTERNAL ID"],
      "Vendor",
      "Qualified Invoice Issuer",
      "Date",
      "Transaction Category",
      "Project(Main, Single)",
      "\u4f1a\u793e\u540d",
      "Terms",
      "Receive By",
      "Memo",
      "Department",
      "Location",
      "Ship To",
      "Currency",
      "Exchange Rate",
      "Comments for Print",
      "Item",
      "Description",
      "Quantity",
      "Rate",
      "Tax Code",
      "Department(Line)",
      "Project(Line)",
      ["Project(Seg)", "Project(seg)"],
      "Groupware Approval Multiple Link",
      "Groupware Approval Link",
    ],
    BILL: [
      "External ID",
      "Vendor",
      "Date",
      "Reference No.",
      "Memo",
      "Account",
      "Department",
      "Location",
      "Transaction Category",
      "Expense Account",
      "Description",
      "Amount",
      "Department(Line)",
      "Tax Code",
      "Tax AMT",
      "Amort. Schedule",
      "Amort. Start",
      "Amort. End",
      "Subsidiary",
      "Project(Line)",
      "Project(Seg)",
      "Qualified Invoice Issuer",
      "Manual Update",
      "WHT Amount",
      "Terms",
      "Project(Main, Single)",
      "Apply WHT",
      "Residual",
      "Groupware Approval Multiple Link",
      "Groupware Approval Link",
      "Entity Bank",
    ],
    BILL_ITEM: [
      "External ID",
      "Vendor",
      "Qualified Invoice Issuer",
      "Date",
      "Transaction Category",
      "Project(Main, Single)",
      "Reference No.",
      "Subsidiary",
      "Memo",
      "Manual Update",
      "WHT Amount",
      "Account",
      "Terms",
      "Due Date",
      "Department",
      "Location",
      "Item",
      "Description",
      "Quantity",
      "Rate",
      "Amount",
      "Tax Code",
      "Tax AMT",
      "Gross Amt",
      "Department(Line)",
      "Project(Line)",
      "Project(Seg)",
      "Apply WHT",
      "Amort. Schedule",
      "Amort. Start",
      "Amort. End",
      "Residual",
      "Groupware Approval Multiple Link",
      "Groupware Approval Link",
      "Entity Bank",
    ],
    INVOICE: [
      ["External ID", "EXTERNAL ID"],
      "Customer",
      ["Date (YYYY/MM/DD)", "Date"],
      "Transaction Category",
      "Project",
      "Memo",
      "PO #",
      "Due Date",
      "Terms",
      "Account(AR)",
      "Sales Rep",
      "Department",
      "Location",
      "Currency",
      "Exchange Rate",
      "Item",
      "Description",
      "Quantity",
      "Rate",
      "Amount",
      "Tax Code",
      "Department(Line)",
      "Project(Line)",
      "Project(seg)",
      "Groupware Approval Multiple Link",
      "Groupware Approval Link",
    ],
    JOURNAL: [
      "External ID",
      "Date",
      "Subsidiary",
      "Memo",
      "Reversal Date",
      "Currency",
      "Transaction Category",
      "Exchange Rate",
      "Account",
      "Department",
      "Debit",
      "Credit",
      "Name",
      "Memo(line)",
      "Project(Line)",
      "Tax",
    ],
  };

  return {
    SUITELET_SCRIPT_ID,
    SUITELET_DEPLOYMENT_ID,
    ACTIONS,
    RESULT_SUMMARY_PREFIX,
    RESULT_ERROR_PREFIX,
    RESULT_FOLDER_ID_PARAM,
    TRANSACTION_TYPES,
    TEMPLATE_FILE_ID_PARAMS,
    TRANSACTION_CONFIG,
    RECORD_TYPES,
    PROJECT_FIELD_IDS,
    REQUIRED_CSV_HEADERS,
  };
});
