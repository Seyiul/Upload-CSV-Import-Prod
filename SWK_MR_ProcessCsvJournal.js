/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Description: CSV 파일에서 Journal Entry 데이터를 읽어와 NetSuite에 Journal Entry 레코드로 생성하는 Map/Reduce 스크립트
 *
 *  * Version    Date            Author           Remarks
 * ----------- -------------   --------------    --------------------------------------
 * 1.00         2026-04-15        Seulyi           Initial development
 */
define([
  "N/file",
  "N/log",
  "N/record",
  "N/runtime",
  "./SWK_Utils_UploadCsvFiles",
], (file, log, record, runtime, csvUtils) => {
  const CSV_FILE_ID_PARAM_JN = "custscript_swk_csv_file_id_jn";
  const TRANSACTION_TYPE_PARAM_JN = "custscript_swk_csv_tran_type_jn";
  const RESULT_SUMMARY_PREFIX = "swk_mr_summary_";
  const RESULT_ERROR_PREFIX = "swk_mr_errors_";

  const RECORD_TYPES = {
    PO: "purchaseorder",
    BILL: "vendorbill",
    INVOICE: "invoice",
    JOURNAL: "journalentry",
  };

  const createJournalRecord = (journalRows) => {
    const firstRowData =
      (journalRows && journalRows[0] && journalRows[0].rowData) || {};
    log.audit(
      "createJournalRecord:start",
      "externalId=" +
        (firstRowData["External ID"] || "") +
        ", lines=" +
        ((journalRows && journalRows.length) || 0),
    );
    const rec = record.create({
      type: record.Type.JOURNAL_ENTRY,
      isDynamic: true,
    });

    // Main Body 필드 설정
    csvUtils.setBodyValueIfPresent(
      rec,
      "externalid",
      firstRowData["External ID"],
    );
    csvUtils.setBodyValueIfPresent(
      rec,
      "trandate",
      csvUtils.parseDateValue(firstRowData["Date"]),
    );
    csvUtils.setBodyTextIfPresent(
      rec,
      "subsidiary",
      firstRowData["Subsidiary"],
    );
    csvUtils.setBodyValueIfPresent(rec, "memo", firstRowData["Memo"]);
    csvUtils.setBodyValueIfPresent(
      rec,
      "reversaldate",
      csvUtils.parseDateValue(firstRowData["Reversal Date"]),
    );
    csvUtils.setBodyTextIfPresent(rec, "currency", firstRowData["Currency"]);
    csvUtils.setBodyTextIfPresent(
      rec,
      "custbody_swk_transcategory",
      firstRowData["Transaction Category"],
    );
    csvUtils.setBodyValueIfPresent(
      rec,
      "exchangerate",
      csvUtils.parseNumberValue(firstRowData["Exchange Rate"]),
    );

    // Journal Entry 라인 설정
    (journalRows || []).forEach((journalRow) => {
      const rowData = journalRow.rowData || {};

      log.audit(
        "createJournalRecord:line",
        "Processing line with Account: " +
          rowData["Account"] +
          ", Debit: " +
          rowData["Debit"] +
          ", Credit: " +
          rowData["Credit"],
      );

      rec.selectNewLine({ sublistId: "line" });

      csvUtils.setCurrentLineTextIfPresent(
        rec,
        "line",
        "account",
        rowData["Account"],
      );
      csvUtils.setCurrentLineTextIfPresent(
        rec,
        "line",
        "department",
        rowData["Department"],
      );
      csvUtils.setCurrentLineValueIfPresent(
        rec,
        "line",
        "debit",
        csvUtils.parseNumberValue(rowData["Debit"]),
      );
      csvUtils.setCurrentLineValueIfPresent(
        rec,
        "line",
        "credit",
        csvUtils.parseNumberValue(rowData["Credit"]),
      );
      csvUtils.setCurrentLineTextIfPresent(
        rec,
        "line",
        "entity",
        rowData["Name"],
      );
      csvUtils.setCurrentLineValueIfPresent(
        rec,
        "line",
        "memo",
        rowData["Memo(line)"],
      );
      csvUtils.setCurrentLineTextIfPresent(
        rec,
        "line",
        "custcol_swk_project_line",
        rowData["Project(Line)"],
      );
      rec.commitLine({ sublistId: "line" });
    });

    const recordId = rec.save();
    log.audit("createJournalRecord:saved", "recordId=" + recordId);
    return recordId;
  };

  const loadStagedRows = (fileId, transactionType) => {
    if (!fileId) {
      return [];
    }

    log.audit(
      "loadStagedRows:start",
      "fileId=" + fileId + ", transactionType=" + transactionType,
    );
    const csvFile = file.load({ id: fileId });
    csvFile.encoding = file.Encoding.UTF8;
    const stagedContents = (csvFile.getContents() || "").replace(/^\uFEFF/, "").trim();
    log.audit(
      "loadStagedRows:contents",
      "length=" + stagedContents.length + ", preview=" + stagedContents.substring(0, 500),
    );
    const parsedRows = stagedContents ? JSON.parse(stagedContents) : [];
    const normalizedRows = Array.isArray(parsedRows) ? parsedRows : [parsedRows];
    const stagedRows = normalizedRows.map((row, index) => ({
      lineNumber: row.lineNumber || index + 2,
      transactionType: row.transactionType || transactionType,
      rowData: row.rowData || {},
    }));

    log.audit("loadStagedRows:done", "stagedRows=" + stagedRows.length);
    return stagedRows;
  };

  const getInputData = () => {
    const script = runtime.getCurrentScript();
    const fileId = script.getParameter({ name: CSV_FILE_ID_PARAM_JN });
    const transactionType = script.getParameter({
      name: TRANSACTION_TYPE_PARAM_JN,
    });
    const recordType = RECORD_TYPES[transactionType];

    if (!fileId) {
      throw new Error("Missing CSV file parameter.");
    }
    if (!recordType) {
      throw new Error("Invalid transaction type: " + transactionType);
    }

    log.audit(
      "getInputData:start",
      "fileId=" + fileId + ", transactionType=" + transactionType,
    );
    const stagedRows = loadStagedRows(fileId, transactionType);
    log.audit("getInputData:rows", "count=" + stagedRows.length);
    return stagedRows.map((row) => ({
      lineNumber: row.lineNumber,
      transactionType: row.transactionType || transactionType,
      recordType: recordType,
      rowData: row.rowData || {},
    }));
  };

  const map = (mapContext) => {
    const input = JSON.parse(mapContext.value);
    log.audit("map:start", "lineNumber=" + input.lineNumber);

    log.audit(
      "map:data",
      "Processing line " +
        input.lineNumber +
        " with data: " +
        JSON.stringify(input.rowData),
    );
    const { lineNumber, rowData } = input;
    const externalId = rowData["External ID"];

    if (!externalId) {
      mapContext.write({
        key: "error",
        value: JSON.stringify({
            lineNumber: lineNumber,
            message: "Missing External ID",
          }),
      });
      return;
    }

    // external id를 키로, 전체 행 데이터를 값으로 전달
    mapContext.write({
      key: String(externalId),
      value: JSON.stringify(input),
    });
    log.audit("map:write", "lineNumber=" + lineNumber + ", key=" + externalId);
  };

  const reduce = (reduceContext) => {
    const journalRows = reduceContext.values.map((value) => JSON.parse(value));
    log.audit(
      "reduce:start",
      "key=" + reduceContext.key + ", rows=" + journalRows.length,
    );

    try {
      const recordId = createJournalRecord(journalRows);

      reduceContext.write({
        key: "success",
        value: JSON.stringify({
          externalId: reduceContext.key,
          recordId: recordId,
        }),
      });
      log.audit(
        "reduce:success",
        "key=" + reduceContext.key + ", recordId=" + recordId,
      );
    } catch (e) {
      log.error(
        "reduce",
        "Error processing journal " + reduceContext.key + ": " + e.message,
      );

      journalRows.forEach((journalRow) => {
        reduceContext.write({
          key: "error",
          value: JSON.stringify({
            lineNumber: journalRow.lineNumber,
            message: e.message,
          }),
        });
      });
    }
  };

  const summarize = (summaryContext) => {
    const script = runtime.getCurrentScript();
    const stagingFileId = script.getParameter({ name: CSV_FILE_ID_PARAM_JN });
    const stagingFile = stagingFileId ? file.load({ id: stagingFileId }) : null;
    const transactionType = script.getParameter({
      name: TRANSACTION_TYPE_PARAM_JN,
    });
    log.audit(
      "summarize:start",
      "fileId=" + stagingFileId + ", transactionType=" + transactionType,
    );
    const stagedRows = loadStagedRows(stagingFileId, transactionType);
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
     * 오류가 있는 경우, 오류 메시지와 원본 내용을 포함한 CSV 파일로 저장
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

    // 임시로 업로드한 파일 삭제
    // if (stagingFileId) {
    //   try {
    //     file.delete({ id: stagingFileId });
    //     log.debug("summarize", "Deleted staging file: " + stagingFileId);
    //   } catch (deleteError) {
    //     log.error(
    //       "summarize",
    //       "Failed to delete staging file " +
    //         stagingFileId +
    //         ": " +
    //         deleteError.message,
    //     );
    //   }
    // }

    log.audit(
      "summarize",
      "Processing complete. Success: " +
        successCount +
        ", Errors: " +
        errorCount,
    );
  };

  return { getInputData, map, reduce, summarize };
});
