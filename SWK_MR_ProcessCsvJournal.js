/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Description: CSV 파일에서 Journal Entry 데이터를 읽어와 NetSuite에 Journal Entry 레코드로 생성하는 Map/Reduce 스크립트
 *
 *  * Version    Date            Author           Remarks
 * ----------- -------------   --------------    --------------------------------------
 * 1.00         2026-04-13        Seulyi           Initial development
 * 1.01         2026-04-21        Seulyi           Added header validation and error handling improvements
 * 1.02         2026-05-20        Seulyi           Add Upload Option (Add/Update/Upsert) and related logic in map/reduce functions
 *
 */
define([
  "N/file",
  "N/log",
  "N/record",
  "N/runtime",
  "N/search",
  "./SWK_Utils_UploadCsvFiles",
  "./SWK_Constants_UploadCsv",
  "./SWK_Utils_ValidationCheck",
  "./i18n",
], (
  file,
  log,
  record,
  runtime,
  search,
  csvUtils,
  uploadCsvConstants,
  validCheck,
  i18n,
) => {
  const CSV_FILE_ID_PARAM_JN = "custscript_swk_csv_file_id_jn";
  const TRANSACTION_TYPE_PARAM_JN = "custscript_swk_csv_tran_type_jn";
  const UPLOAD_OPTION_PARAM = "custscript_swk_csv_upload_option_jn";
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

  const { doJournalLinesValdations } = validCheck;

  const findJnIdByExternalId = (externalId) => {
    if (!hasValue(externalId)) return null;

    const results = search
      .create({
        type: record.Type.JOURNAL_ENTRY,
        filters: [["externalidstring", "is", externalId]],
        columns: ["internalid"],
      })
      .run()
      .getRange({ start: 0, end: 1 });

    if (!results || results.length === 0) {
      return null;
    }

    return results[0].getValue({ name: "internalid" });
  };

  const submitJnRecord = (journalRows, uploadOption) => {
    const firstRowData =
      (journalRows && journalRows[0] && journalRows[0].rowData) || {};

    const externalId = firstRowData["External ID"];
    const normalizedUploadOption = uploadOption || "ADD";
    const existingJnId =
      normalizedUploadOption === "ADD"
        ? null
        : findJnIdByExternalId(externalId);

    if (normalizedUploadOption === "ADD") {
      return createJournalRecord(journalRows);
    }

    if (normalizedUploadOption === "UPDATE") {
      if (!existingJnId) {
        throw new Error(
          "Journal Entry not found for External ID: " + externalId,
        );
      }

      return updateJournalRecord(journalRows, existingJnId);
    }

    if (normalizedUploadOption === "UPSERT") {
      return existingJnId
        ? updateJournalRecord(journalRows, existingJnId)
        : createJournalRecord(journalRows);
    }

    throw new Error("Unsupported upload option: " + normalizedUploadOption);
  };

  const setJnBodyFields = (rec, firstRowData) => {
    // Main Body 필드 설정
    setBodyValueIfPresent(rec, "externalid", firstRowData["External ID"]);
    setBodyValueIfPresent(
      rec,
      "trandate",
      parseDateValue(firstRowData["Date"]),
    );
    setBodyTextIfPresent(
      rec,
      "subsidiary",
      firstRowData["Subsidiary"] ||
        firstRowData["\u4f1a\u793e\u540d"] ||
        firstRowData["会社名"],
    );
    setBodyValueIfPresent(rec, "memo", firstRowData["Memo"]);

    rec.setValue({
      fieldId: "reversaldate",
      value: parseDateValue(firstRowData["Reversal Date"]),
    });
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

    // 승인 상태 수정
    rec.setValue({
      fieldId: "approved",
      value: false,
    });
  };

  const addJnLines = (rec, journalRows) => {
    // Journal Entry 라인 설정
    (journalRows || []).forEach((journalRow) => {
      const rowData = journalRow.rowData || {};

      rec.selectNewLine({ sublistId: "line" });

      setCurrentLineTextIfPresent(rec, "line", "account", rowData["Account"]);
      setCurrentLineTextIfPresent(
        rec,
        "line",
        "department",
        rowData["Department"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "line",
        "debit",
        parseNumberValue(rowData["Debit"]),
      );
      setCurrentLineValueIfPresent(
        rec,
        "line",
        "credit",
        parseNumberValue(rowData["Credit"]),
      );
      setCurrentLineTextIfPresent(rec, "line", "entity", rowData["Name"]);
      setCurrentLineValueIfPresent(rec, "line", "memo", rowData["Memo(line)"]);
      setCurrentLineTextIfPresent(
        rec,
        "line",
        "custcol_swk_project_line",
        rowData["Project(Line)"],
      );
      setCurrentLineTextIfPresent(
        rec,
        "line",
        "cseg_swk_lapopjt",
        rowData["Project(Line)"],
      );
      setCurrentLineTextIfPresent(
        rec,
        "line",
        "taxcode",
        rowData["Tax"] || rowData["Tax Code"],
      );

      rec.commitLine({ sublistId: "line" });
    });
  };

  const removeJournalLines = (rec) => {
    const lineCount = rec.getLineCount({ sublistId: "line" });

    for (let line = lineCount - 1; line >= 0; line -= 1) {
      rec.removeLine({
        sublistId: "line",
        line: line,
        ignoreRecalc: true,
      });
    }
  };

  const createJournalRecord = (journalRows) => {
    const firstRowData =
      (journalRows && journalRows[0] && journalRows[0].rowData) || {};

    const rec = record.create({
      type: record.Type.JOURNAL_ENTRY,
      isDynamic: true,
    });

    setJnBodyFields(rec, firstRowData);
    doJournalLinesValdations(journalRows);
    addJnLines(rec, journalRows);

    const recordId = rec.save();
    return recordId;
  };

  const updateJournalRecord = (journalRows, existingJnId) => {
    const firstRowData =
      (journalRows && journalRows[0] && journalRows[0].rowData) || {};
    const rec = record.load({
      type: record.Type.JOURNAL_ENTRY,
      id: existingJnId,
      isDynamic: true,
    });

    removeJournalLines(rec);
    setJnBodyFields(rec, firstRowData);
    doJournalLinesValdations(journalRows);
    addJnLines(rec, journalRows);

    const recordId = rec.save();
    return recordId;
  };

  const loadStagedRows = (fileId, transactionType) => {
    if (!fileId) {
      return [];
    }

    const csvFile = file.load({ id: fileId });
    csvFile.encoding = file.Encoding.UTF8;
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
    const trans = i18n.load();
    const script = runtime.getCurrentScript();
    const fileId = script.getParameter({ name: CSV_FILE_ID_PARAM_JN });
    const transactionType = script.getParameter({
      name: TRANSACTION_TYPE_PARAM_JN,
    });
    const uploadOption = script.getParameter({
      name: UPLOAD_OPTION_PARAM,
    });
    const recordType = RECORD_TYPES[transactionType];

    if (!fileId) {
      throw new Error(trans.MISSING_CSV_FILE_PARAMETER());
    }
    if (!recordType) {
      throw new Error(
        `${trans.INVALID_TRANSACTION_TYPE_WITH_VALUE()} : ${transactionType}`,
      );
    }

    const stagedRows = loadStagedRows(fileId, transactionType);

    // CSV 파일에서 읽어온 데이터의 헤더가 유효한지 검증
    assertValidMappedHeaders(stagedRows, REQUIRED_CSV_HEADERS[transactionType]);

    return stagedRows.map((row) => ({
      lineNumber: row.lineNumber,
      transactionType: row.transactionType || transactionType,
      uploadOption: uploadOption,
      recordType: recordType,
      rowData: row.rowData || {},
    }));
  };

  const map = (mapContext) => {
    const input = JSON.parse(mapContext.value);

    const { lineNumber, rowData } = input;
    const externalId = rowData["External ID"];

    if (!externalId) {
      const trans = i18n.load();

      mapContext.write({
        key: "error",
        value: JSON.stringify({
          lineNumber: lineNumber,
          message: trans.MISSING_EXTERNAL_ID(),
        }),
      });
      return;
    }

    // external id를 키로, 전체 행 데이터를 값으로 전달
    mapContext.write({
      key: String(externalId),
      value: JSON.stringify(input),
    });
    // log.audit("map:write", "lineNumber=" + lineNumber + ", key=" + externalId);
  };

  const reduce = (reduceContext) => {
    const journalRows = reduceContext.values.map((value) => JSON.parse(value));
    const firstValue = reduceContext.values[0]
      ? JSON.parse(reduceContext.values[0])
      : {};
    const uploadOption = firstValue.uploadOption || "ADD";

    try {
      const recordId = submitJnRecord(journalRows, uploadOption);

      reduceContext.write({
        key: "success",
        value: JSON.stringify({
          externalId: reduceContext.key,
          recordId: recordId,
        }),
      });

      // log.audit(
      //   "reduce:success",
      //   "key=" + reduceContext.key + ", recordId=" + recordId,
      // );
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
            externalId: reduceContext.key,
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
    const stagedRows = loadStagedRows(stagingFileId, transactionType);
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
     * 오류가 있는 경우, 오류 메시지와 원본 내용을 포함한 CSV 파일로 저장
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
