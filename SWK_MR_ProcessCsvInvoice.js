/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Description: CSV 파일에서 Invoice 데이터를 읽어와 Netsuite에 Invoice 레코드를 생성하는 Map/Reduce 스크립트
 *
 *  * Version    Date            Author           Remarks
 * ----------- -------------   --------------    --------------------------------------
 * 1.00         2026-04-13        Seulyi           Initial development
 * 1.01         2026-04-21        Seulyi           Added header validation and error handling improvements
 *
 */
define([
  "N/file",
  "N/log",
  "N/record",
  "N/runtime",
  "./SWK_Utils_UploadCsvFiles",
  "./SWK_Constants_UploadCsv",
], (file, log, record, runtime, csvUtils, uploadCsvConstants) => {
  const CSV_FILE_ID_PARAM = "custscript_swk_csv_file_id_iv";
  const TRANSACTION_TYPE_PARAM = "custscript_swk_csv_tran_type_iv";
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

  const FIELD_PROJECT_BODY = "custbody_swk_project_mainsingle";
  const FIELD_PROJECT_LINE = "custcol_swk_project_line";
  const FIELD_PROJECT_SEG = "cseg_swk_lapopjt";

  const createInvoiceRecord = (invRows) => {
    const firstRowData = (invRows && invRows[0] && invRows[0].rowData) || {};
    const rec = record.create({
      type: record.Type.INVOICE,
      isDynamic: true,
    });

    // Body 필드 매핑
    const locationId = findLocationIdByValue(firstRowData["Location"]);

    if (firstRowData["Location"] && !locationId) {
      throw new Error("Location not found: " + firstRowData["Location"]);
    }

    setBodyValueIfPresent(
      rec,
      "externalid",
      firstRowData["External ID"] || firstRowData["EXTERNAL ID"],
    );
    setBodyTextIfPresent(rec, "entity", firstRowData["Customer"]);
    setBodyValueIfPresent(
      rec,
      "trandate",
      parseDateValue(firstRowData["Date (YYYY/MM/DD)"] || firstRowData["Date"]),
    );
    setBodyTextIfPresent(
      rec,
      "custbody_swk_transcategory",
      firstRowData["Transaction Category"],
    );
    setBodyTextIfPresent(rec, FIELD_PROJECT_BODY, firstRowData["Project"]);
    setBodyValueIfPresent(rec, "memo", firstRowData["Memo"]);
    setBodyTextIfPresent(rec, "postingperiod", firstRowData["Posting Period"]);
    setBodyValueIfPresent(rec, "otherrefnum", firstRowData["PO #"]);
    setBodyValueIfPresent(
      rec,
      "duedate",
      parseDateValue(firstRowData["Due Date"]),
    );
    setBodyTextIfPresent(rec, "terms", firstRowData["Terms"]);
    setBodyTextIfPresent(rec, "account", firstRowData["Account(AR)"]);
    setBodyTextIfPresent(rec, "salesrep", firstRowData["Sales Rep"]);
    setBodyTextIfPresent(rec, "department", firstRowData["Department"]);
    setBodyValueIfPresent(rec, "location", locationId);
    setBodyTextIfPresent(rec, "currency", firstRowData["Currency"]);
    setBodyValueIfPresent(
      rec,
      "exchangerate",
      parseNumberValue(firstRowData["Exchange Rate"]),
    );

    // Line 필드 매핑

    (invRows || []).forEach((row) => {
      const rowData = row.rowData || {};

      rec.selectNewLine({ sublistId: "item" });
      setCurrentLineTextIfPresent(rec, "item", "item", rowData["Item"]);
      setCurrentLineTextIfPresent(
        rec,
        "item",
        "description",
        rowData["Description"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "quantity",
        parseNumberValue(rowData["Quantity"]),
      );
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "rate",
        parseNumberValue(rowData["Rate"]),
      );

      setCurrentLineValueIfPresent(
        rec,
        "item",
        "amount",
        parseNumberValue(rowData["Amount"]),
      );
      setCurrentLineTextIfPresent(rec, "item", "taxcode", rowData["Tax Code"]);
      setCurrentLineTextIfPresent(
        rec,
        "item",
        "department",
        rowData["Department(Line)"] || rowData["Department"],
      );
      setCurrentLineTextIfPresent(
        rec,
        "item",
        FIELD_PROJECT_LINE,
        rowData["Project(Line)"],
      );
      setCurrentLineTextIfPresent(
        rec,
        "item",
        FIELD_PROJECT_SEG,
        rowData["Project(seg)"],
      );
      rec.commitLine({ sublistId: "item" });
    });
    return rec.save();
  };

  // CSV 파일에서 데이터를 읽어와 Map/Reduce의 입력 데이터로 반환하는 함수
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

    const externalId = rowData["External ID"] || rowData["EXTERNAL ID"];

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
    const invRows = reduceContext.values.map((value) => JSON.parse(value));

    try {
      const recordId = createInvoiceRecord(invRows);

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

      invRows.forEach((row) => {
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

  return { getInputData, map, reduce, summarize };
});
