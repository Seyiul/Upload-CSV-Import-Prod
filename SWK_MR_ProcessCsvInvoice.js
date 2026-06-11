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
  const CSV_FILE_ID_PARAM = "custscript_swk_csv_file_id_iv";
  const TRANSACTION_TYPE_PARAM = "custscript_swk_csv_tran_type_iv";
  const UPLOAD_OPTION_PARAM = "custscript_swk_csv_upload_option_iv";
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
    formatRichText,
  } = csvUtils;

  const { doSalesLinesValidations } = validCheck;

  const FIELD_PROJECT_BODY = "custbody_swk_project_mainsingle";
  const FIELD_PROJECT_LINE = "custcol_swk_project_line";
  const FIELD_PROJECT_SEG = "cseg_swk_lapopjt";

  const findInvoiceIdByExternalId = (externalId) => {
    if (!externalId) {
      return null;
    }

    const results = search
      .create({
        type: record.Type.INVOICE,
        filters: [["externalidstring", "is", String(externalId)]],
        columns: ["internalid"],
      })
      .run()
      .getRange({ start: 0, end: 1 });

    if (!results || results.length === 0) {
      return null;
    }

    return results[0].getValue({ name: "internalid" });
  };

  const populateInvoiceRecord = (rec, invRows) => {
    const firstRowData = (invRows && invRows[0] && invRows[0].rowData) || {};
    // Body 필드 매핑
    const locationId = findLocationIdByValue(firstRowData["Location"]);

    if (firstRowData["Location"] && !locationId) {
      const trans = i18n.load();

      throw new Error(
        `${trans.LOCATION_NOT_FOUND()} ${firstRowData["Location"]}`,
      );
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

    setBodyTextIfPresent(
      rec,
      "custbody_swk_groupwareapproval",
      firstRowData["Groupware Approval Link"],
    );
    setBodyTextIfPresent(
      rec,
      "custbody_swk_tranlink_multi",
      formatRichText(firstRowData["Groupware Approval Multiple Link"]),
    );

    doSalesLinesValidations(invRows);

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
        rowData["Department(Line)"] || rowData["Department(Line)"],
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
  };

  const removeItemLines = (rec) => {
    const lineCount = rec.getLineCount({ sublistId: "item" });

    for (let line = lineCount - 1; line >= 0; line -= 1) {
      rec.removeLine({
        sublistId: "item",
        line: line,
        ignoreRecalc: true,
      });
    }
  };

  const createInvoiceRecord = (invRows) => {
    const rec = record.create({
      type: record.Type.INVOICE,
      isDynamic: true,
    });

    populateInvoiceRecord(rec, invRows);

    return rec.save();
  };

  const updateInvoiceRecord = (invRows, existingInvoiceId) => {
    const rec = record.load({
      type: record.Type.INVOICE,
      id: existingInvoiceId,
      isDynamic: true,
    });

    removeItemLines(rec);
    populateInvoiceRecord(rec, invRows);

    return rec.save();
  };

  const submitInvoiceRecord = (invRows, uploadOption) => {
    const firstRowData = (invRows && invRows[0] && invRows[0].rowData) || {};
    const externalId =
      firstRowData["External ID"] || firstRowData["EXTERNAL ID"];
    const normalizedUploadOption = uploadOption || "ADD";
    const existingInvoiceId =
      normalizedUploadOption === "ADD"
        ? null
        : findInvoiceIdByExternalId(externalId);

    if (normalizedUploadOption === "ADD") {
      return createInvoiceRecord(invRows);
    }

    if (normalizedUploadOption === "UPDATE") {
      if (!existingInvoiceId) {
        throw new Error("Invoice not found for External ID: " + externalId);
      }

      return updateInvoiceRecord(invRows, existingInvoiceId);
    }

    if (normalizedUploadOption === "UPSERT") {
      return existingInvoiceId
        ? updateInvoiceRecord(invRows, existingInvoiceId)
        : createInvoiceRecord(invRows);
    }

    throw new Error("Unsupported upload option: " + normalizedUploadOption);
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
    const trans = i18n.load();
    const script = runtime.getCurrentScript();
    const fileId = script.getParameter({ name: CSV_FILE_ID_PARAM });
    const transactionType = script.getParameter({
      name: TRANSACTION_TYPE_PARAM,
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

    const externalId = rowData["External ID"] || rowData["EXTERNAL ID"];

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

    //external id를 키로, 전체 행 데이터를 값으로 전달
    mapContext.write({
      key: String(externalId),
      value: JSON.stringify(input),
    });
    // log.audit("map:write", "lineNumber=" + lineNumber + ", key=" + externalId);
  };

  const reduce = (reduceContext) => {
    const invRows = reduceContext.values
      .map((value) => JSON.parse(value))
      .sort((a, b) => a.lineNumber - b.lineNumber);
    const firstValue = reduceContext.values[0]
      ? JSON.parse(reduceContext.values[0])
      : {};
    const uploadOption = firstValue.uploadOption || "ADD";

    try {
      const recordId = submitInvoiceRecord(invRows, uploadOption);

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
            externalId: reduceContext.key,
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
