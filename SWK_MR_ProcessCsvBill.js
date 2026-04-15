/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Description: CSV 파일에서 Vendor Bill 데이터를 읽어와 NetSuite에 Vendor Bill 레코드로 생성하는 Map/Reduce 스크립트
 *
 *  * Version    Date            Author           Remarks
 * ----------- -------------   --------------    --------------------------------------
 * 1.00         2026-04-13        Seulyi           Initial development
 *
 * Script
 */
define([
  "N/file",
  "N/log",
  "N/record",
  "N/runtime",
  "./SWK_Utils_UploadCsvFiles",
], (file, log, record, runtime, csvUtils) => {
  const CSV_FILE_ID_PARAM = "custscript_swk_csv_file_id";
  const TRANSACTION_TYPE_PARAM = "custscript_swk_csv_tran_type";
  const RESULT_SUMMARY_PREFIX = "swk_mr_summary_";
  const RESULT_ERROR_PREFIX = "swk_mr_errors_";

  const RECORD_TYPES = {
    PO: "purchaseorder",
    BILL: "vendorbill",
    INVOICE: "invoice",
    JOURNAL: "journalentry",
  };

  const createBillRecord = (rowData) => {
    const rec = record.create({
      type: record.Type.VENDOR_BILL,
      isDynamic: true,
    });
    const locationId = csvUtils.findLocationIdByValue(rowData["Location"]);

    if (rowData["Location"] && !locationId) {
      throw new Error("Location not found: " + rowData["Location"]);
    }

    csvUtils.setBodyValueIfPresent(rec, "externalid", rowData["EXTERNAL ID"]);
    csvUtils.setBodyTextIfPresent(rec, "entity", rowData["Vendor"]);
    csvUtils.setBodyValueIfPresent(
      rec,
      "trandate",
      csvUtils.parseDateValue(rowData["Date"]),
    );
    csvUtils.setBodyValueIfPresent(rec, "tranid", rowData["Reference No."]);
    csvUtils.setBodyValueIfPresent(rec, "memo", rowData["Memo"]);
    csvUtils.setBodyTextIfPresent(rec, "account", rowData["Account"]);
    csvUtils.setBodyTextIfPresent(rec, "department", rowData["Department"]);
    csvUtils.setBodyValueIfPresent(rec, "location", locationId);
    csvUtils.setBodyTextIfPresent(rec, "currency", rowData["Currency"]);
    csvUtils.setBodyTextIfPresent(
      rec,
      "custbody_swk_transcategory",
      rowData["Transaction Category"],
    );
    csvUtils.setBodyValueIfPresent(
      rec,
      "exchangerate",
      csvUtils.parseNumberValue(rowData["Exchange Rate"]),
    );

    rec.selectNewLine({ sublistId: "expense" });
    csvUtils.setCurrentLineTextIfPresent(
      rec,
      "expense",
      "account",
      rowData["Account(Expense)"],
    );
    csvUtils.setCurrentLineValueIfPresent(
      rec,
      "expense",
      "memo",
      rowData["Description"],
    );
    csvUtils.setCurrentLineValueIfPresent(
      rec,
      "expense",
      "amount",
      csvUtils.parseNumberValue(rowData["Amount"]) ||
        (csvUtils.parseNumberValue(rowData["Quantity"]) || 0) *
          (csvUtils.parseNumberValue(rowData["Rate"]) || 0),
    );
    csvUtils.setCurrentLineTextIfPresent(
      rec,
      "expense",
      "department",
      rowData["Department(Line)"],
    );
    csvUtils.setCurrentLineValueIfPresent(
      rec,
      "expense",
      "location",
      locationId,
    );
    csvUtils.setCurrentLineTextIfPresent(
      rec,
      "expense",
      "taxcode",
      rowData["Tax Code"],
    );
    csvUtils.setCurrentLineValueIfPresent(
      rec,
      "expense",
      "tax1amt",
      csvUtils.parseNumberValue(rowData["Tax AMT"]),
    );
    csvUtils.setCurrentLineTextIfPresent(
      rec,
      "expense",
      "amortizationsched",
      rowData["Amort. Schedule"],
    );
    csvUtils.setCurrentLineValueIfPresent(
      rec,
      "expense",
      "amortizstartdate",
      csvUtils.parseDateValue(rowData["Amort. Start"]),
    );
    csvUtils.setCurrentLineValueIfPresent(
      rec,
      "expense",
      "amortizationenddate",
      csvUtils.parseDateValue(rowData["Amort. End"]),
    );
    rec.commitLine({ sublistId: "expense" });

    return rec.save();
  };

  const loadStagedRows = (fileId) => {
    if (!fileId) {
      return [];
    }

    const csvFile = file.load({ id: fileId });
    csvFile.encoding = file.Encoding.UTF8;
    return JSON.parse(csvFile.getContents() || "[]");
  };

  const getInputData = () => {
    const script = runtime.getCurrentScript();
    const fileId = script.getParameter({ name: CSV_FILE_ID_PARAM });
    const transactionType = script.getParameter({
      name: TRANSACTION_TYPE_PARAM,
    });
    const recordType = RECORD_TYPES[transactionType];

    if (!fileId) {
      throw new Error("Missing CSV file parameter.");
    }
    if (!recordType) {
      throw new Error("Invalid transaction type: " + transactionType);
    }

    const stagedRows = loadStagedRows(fileId);
    return stagedRows.map((row) => ({
      lineNumber: row.lineNumber,
      transactionType: row.transactionType || transactionType,
      recordType: recordType,
      rowData: row.rowData || {},
    }));
  };

  const map = (mapContext) => {
    const input = JSON.parse(mapContext.value);
    const { lineNumber, transactionType, recordType, rowData } = input;

    try {
      const recordId = createBillRecord(rowData);

      mapContext.write({
        key: "success",
        value: JSON.stringify({
          lineNumber: lineNumber,
          recordId: recordId,
        }),
      });
    } catch (e) {
      log.error("map", "Error processing row " + lineNumber + ": " + e.message);
      mapContext.write({
        key: "error",
        value: JSON.stringify({
          lineNumber: lineNumber,
          message: e.message,
        }),
      });
    }
  };

  const reduce = (reduceContext) => {
    reduceContext.values.forEach((value) => {
      reduceContext.write({
        key: reduceContext.key,
        value: value,
      });
    });
  };

  const summarize = (summaryContext) => {
    const script = runtime.getCurrentScript();
    const stagingFileId = script.getParameter({ name: CSV_FILE_ID_PARAM });
    const stagingFile = stagingFileId ? file.load({ id: stagingFileId }) : null;
    const stagedRows = loadStagedRows(stagingFileId);
    const stagedRowsByLine = csvUtils.indexStagedRowsByLine(stagedRows);
    let successCount = 0;
    let errorCount = 0;
    const errorRows = [];

    summaryContext.output.iterator().each((key, value) => {
      if (key === "success") {
        successCount += 1;
      } else if (key === "error") {
        errorCount += 1;
        errorRows.push(JSON.parse(value));
      }
      return true;
    });

    summaryContext.mapSummary.errors.iterator().each((key, error) => {
      log.error("mapSummary", "Row " + key + ": " + error);
      return true;
    });

    /**
     * 오류가 있는 경우, 오류 메시지와 함께 새로운 CSV 파일로 저장
     */
    let errorFileId = null;
    if (errorRows.length > 0 && stagingFile) {
      const errorCsvContents = csvUtils.buildErrorReportCsvContents(
        errorRows,
        stagedRowsByLine,
      );

      log.debug(
        "rowData check",
        "First error row data: " +
          JSON.stringify(stagedRowsByLine[errorRows[0].lineNumber] || {}),
      );

      errorFileId = csvUtils.saveErrorReportFile(file, {
        folderId: stagingFile.folder,
        stagingFileId: stagingFileId,
        errorPrefix: RESULT_ERROR_PREFIX,
        contents: errorCsvContents,
      });
    }

    /**
     * 처리 결과를 JSON 파일로 저장 (성공/실패 건수 및 오류 파일 URL)
     */
    const loadedErrorFile = errorFileId ? file.load({ id: errorFileId }) : null;

    if (!loadedErrorFile && errorCount > 0) {
      log.error(
        "summarize",
        "Error file could not be created for " + errorCount + " errors.",
      );
    }

    if (loadedErrorFile) {
      log.debug(
        "summarize",
        "Error file created with ID " +
          errorFileId +
          " for " +
          errorCount +
          " errors.",
      );
    }

    if (stagingFile) {
      csvUtils.saveProcessingSummaryFile(file, {
        folderId: stagingFile.folder,
        stagingFileId: stagingFileId,
        summaryPrefix: RESULT_SUMMARY_PREFIX,
        successCount: successCount,
        errorCount: errorCount,
        errorFileId: errorFileId,
      });
    }

    // 임시로 저장한 파일 삭제
    if (stagingFileId) {
      try {
        file.delete({ id: stagingFileId });
        log.debug("summarize", "Deleted staging file: " + stagingFileId);
      } catch (deleteError) {
        log.error(
          "summarize",
          "Failed to delete staging file " +
            stagingFileId +
            ": " +
            deleteError.message,
        );
      }
    }

    log.audit(
      "summarize",
      "Processing complete. Success: " +
        successCount +
        ", Errors: " +
        errorCount,
    );
  };

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
