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
  "./SWK_Constants_UploadCsv",
], (file, log, record, runtime, csvUtils, uploadCsvConstants) => {
  const CSV_FILE_ID_PARAM = "custscript_swk_csv_file_id";
  const TRANSACTION_TYPE_PARAM = "custscript_swk_csv_tran_type";
  const {
    RECORD_TYPES,
    REQUIRED_CSV_HEADERS,
    RESULT_SUMMARY_PREFIX,
    RESULT_ERROR_PREFIX,
  } = uploadCsvConstants;

  const {
    setBodyValueIfPresent,
    setBodyTextIfPresent,
    parseDateValue,
    parseNumberValue,
    hasValue,
    escapeCsvValue,
    buildCsvLine,
    assertValidMappedHeaders,
    indexStagedRowsByLine,
    getErrorDisplayMessage,
    buildErrorReportCsvContents,
    saveErrorReportFile,
    saveProcessingSummaryFile,
    setCurrentLineValueIfPresent,
    setCurrentLineTextIfPresent,
    findLocationIdByValue,
    getHeaderLabel,
    getHeaderAliases,
    validateMappedHeaders,
  } = csvUtils;

  const createBillRecord = (billRows) => {
    const firstRowData = (billRows && billRows[0] && billRows[0].rowData) || {};

    // Body 필드 매핑
    const rec = record.create({
      type: record.Type.VENDOR_BILL,
      isDynamic: true,
    });
    const locationId = findLocationIdByValue(firstRowData["Location"]);

    if (firstRowData["Location"] && !locationId) {
      throw new Error("Location not found: " + firstRowData["Location"]);
    }

    setBodyValueIfPresent(rec, "externalid", firstRowData["EXTERNAL ID"]);
    setBodyTextIfPresent(rec, "entity", firstRowData["Vendor"]);
    setBodyValueIfPresent(
      rec,
      "trandate",
      parseDateValue(firstRowData["Date"]),
    );
    setBodyValueIfPresent(rec, "tranid", firstRowData["Reference No."]);
    setBodyValueIfPresent(rec, "memo", firstRowData["Memo"]);
    setBodyTextIfPresent(rec, "account", firstRowData["Account"]);
    setBodyTextIfPresent(rec, "department", firstRowData["Department"]);
    setBodyValueIfPresent(rec, "location", locationId);
    setBodyTextIfPresent(rec, "currency", firstRowData["Currency"]);
    setBodyTextIfPresent(
      rec,
      "custbody_swk_transcategory",
      firstRowData["Transaction Category"],
    );
    setBodyValueIfPresent(
      rec,
      "exchangerate",
      parseNumberValue(firstRowData["Exchange Rate"]),
    );

    // CSV의 각 행을 Vendor Bill의 Expense 라인으로 매핑
    (billRows || []).forEach((row) => {
      const rowData = row.rowData || {};

      rec.selectNewLine({ sublistId: "expense" });
      setCurrentLineTextIfPresent(
        rec,
        "expense",
        "account",
        rowData["Expense Account"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "expense",
        "memo",
        rowData["Description"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "expense",
        "amount",
        parseNumberValue(rowData["Amount"]) ||
          (parseNumberValue(rowData["Quantity"]) || 0) *
            (parseNumberValue(rowData["Rate"]) || 0),
      );
      setCurrentLineTextIfPresent(
        rec,
        "expense",
        "department",
        rowData["Department(Line)"],
      );

      setCurrentLineValueIfPresent(rec, "expense", "location", locationId);
      setCurrentLineTextIfPresent(
        rec,
        "expense",
        "taxcode",
        rowData["Tax Code"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "expense",
        "tax1amt",
        parseNumberValue(rowData["Tax AMT"]),
      );
      setCurrentLineTextIfPresent(
        rec,
        "expense",
        "amortizationsched",
        rowData["Amort. Schedule"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "expense",
        "amortizstartdate",
        parseDateValue(rowData["Amort. Start"]),
      );
      setCurrentLineValueIfPresent(
        rec,
        "expense",
        "amortizationenddate",
        parseDateValue(rowData["Amort. End"]),
      );
      rec.commitLine({ sublistId: "expense" });
    });

    return rec.save();
  };

  const loadStagedRows = (fileId, transactionType) => {
    if (!fileId) {
      return [];
    }

    const csvFile = file.load({ id: fileId });
    csvFile.encoding = file.Encoding.UTF8;

    // CSV 파일에서 내용을 읽어와 JSON으로 파싱
    const stagedContents = (csvFile.getContents() || "")
      .replace(/^\uFEFF/, "")
      .trim();

    const parsedRows = stagedContents ? JSON.parse(stagedContents) : [];
    const normalizedRows = Array.isArray(parsedRows)
      ? parsedRows
      : [parsedRows];

    const stagedRows = normalizedRows.map((row, index) => ({
      lineNumber: row.lineNumber || index + 2,
      transactionType: row.transactionType || transactionType,
      rowData: row.rowData || {},
    }));

    return stagedRows;
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

    const stagedRows = loadStagedRows(fileId, transactionType);

    // CSV 파일에서 읽어온 데이터의 헤더가 유효한지 검증
    assertValidMappedHeaders(stagedRows, REQUIRED_CSV_HEADERS[transactionType]);

    return stagedRows.map((row) => ({
      lineNumber: row.lineNumber,
      transactionType: row.transactionType || transactionType,
      recordType: recordType,
      rowData: row.rowData || {},
    }));
  };

  const map = (mapContext) => {
    const input = JSON.parse(mapContext.value);
    const { lineNumber, rowData } = input;

    const externalId = rowData["EXTERNAL ID"];

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

    //external id를 키로, 전체 행 데이터를 값으로 전달
    mapContext.write({
      key: String(externalId),
      value: JSON.stringify(input),
    });
    log.audit("map:write", "lineNumber=" + lineNumber + ", key=" + externalId);
  };

  const reduce = (reduceContext) => {
    const billRows = reduceContext.values.map((value) => JSON.parse(value));

    try {
      const recordId = createBillRecord(billRows);

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
        "Error processing row " + reduceContext.key + ": " + e.message,
      );

      billRows.forEach((row) => {
        reduceContext.write({
          key: "error",
          value: JSON.stringify({
            lineNumber: row.lineNumber,
            message: e.message,
          }),
        });
      });
    }
  };

  const summarize = (summaryContext) => {
    const script = runtime.getCurrentScript();
    const stagingFileId = script.getParameter({ name: CSV_FILE_ID_PARAM });
    const stagingFile = stagingFileId ? file.load({ id: stagingFileId }) : null;
    const stagedRows = loadStagedRows(stagingFileId);
    const stagedRowsByLine = indexStagedRowsByLine(stagedRows);
    let successCount = 0;
    let errorCount = 0;
    const errorRows = [];
    const summaryErrors = [];

    summaryContext.output.iterator().each((key, value) => {
      if (key === "success") {
        successCount += 1;
      } else if (key === "error") {
        errorCount += 1;
        errorRows.push(JSON.parse(value));
      }
      return true;
    });

    if (summaryContext.inputSummary && summaryContext.inputSummary.error) {
      const inputError = getErrorDisplayMessage(
        summaryContext.inputSummary.error,
      );
      errorCount += 1;
      summaryErrors.push(inputError);
      log.error("inputSummary", inputError);
    }

    summaryContext.mapSummary.errors.iterator().each((key, error) => {
      const mapError = "Row " + key + ": " + getErrorDisplayMessage(error);
      errorCount += 1;
      summaryErrors.push(mapError);
      log.error("mapSummary", mapError);
      return true;
    });

    /**
     * 오류가 있는 경우, 오류 메시지와 함께 새로운 CSV 파일로 저장
     */
    let errorFileId = null;
    if (errorRows.length > 0 && stagingFile) {
      const errorCsvContents = buildErrorReportCsvContents(
        errorRows,
        stagedRowsByLine,
      );

      log.debug(
        "rowData check",
        "First error row data: " +
          JSON.stringify(stagedRowsByLine[errorRows[0].lineNumber] || {}),
      );

      errorFileId = saveErrorReportFile(file, {
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
      saveProcessingSummaryFile(file, {
        folderId: stagingFile.folder,
        stagingFileId: stagingFileId,
        summaryPrefix: RESULT_SUMMARY_PREFIX,
        successCount: successCount,
        errorCount: errorCount,
        errorFileId: errorFileId,
        message: summaryErrors.join("\n"),
        errors: summaryErrors,
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
