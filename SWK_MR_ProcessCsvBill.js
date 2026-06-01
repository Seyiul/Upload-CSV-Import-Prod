/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Description: CSV 파일에서 Vendor Bill 데이터를 읽어와 NetSuite에 Vendor Bill 레코드로 생성하는 Map/Reduce 스크립트
 *
 *  * Version    Date            Author           Remarks
 * ----------- -------------   --------------    --------------------------------------
 * 1.00         2026-04-13        Seulyi           Initial development
 * 1.01         2026-04-21        Seulyi           Added header validation and error handling improvements
 * 1.02         2026-05-20        Seulyi           Add Upload Option (Add/Update/Upsert) and related logic in map/reduce functions
 * 1.03         2026-06-01        Seulyi           Updated to handle specific transaction categories
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
  const CSV_FILE_ID_PARAM = "custscript_swk_csv_file_id";
  const TRANSACTION_TYPE_PARAM = "custscript_swk_csv_tran_type";
  const UPLOAD_OPTION_PARAM = "custscript_swk_csv_upload_option";
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
  const { doPurchaseLinesValidations } = validCheck;

  const FIELD_PROJECT_BODY = "custbody_swk_project_mainsingle";
  const FIELD_PROJECT_LINE = "custcol_swk_project_line";
  const FIELD_PROJECT_SEG = "cseg_swk_lapopjt";

  const parseCheckboxValue = (value) => {
    if (!hasValue(value)) {
      return null;
    }

    const normalizedValue = String(value).trim().toUpperCase();
    return normalizedValue === "T" || normalizedValue === "TRUE";
  };

  const setBillBodyFields = (rec, firstRowData) => {
    const locationId = findLocationIdByValue(firstRowData["Location"]);

    if (firstRowData["Location"] && !locationId) {
      const trans = i18n.load();

      throw new Error(
        `${trans.LOCATION_NOT_FOUND()} ${firstRowData["Location"]}`,
      );
    }

    setBodyValueIfPresent(rec, "externalid", firstRowData["External ID"]);
    setBodyTextIfPresent(rec, "entity", firstRowData["Vendor"]);
    setBodyValueIfPresent(
      rec,
      "custbody_swk_bill_vendorqual",
      parseCheckboxValue(firstRowData["Qualified Invoice Issuer"]),
    );
    setBodyTextIfPresent(
      rec,
      "custbody_swk_bill_wht",
      firstRowData["WHT Category"],
    );
    setBodyValueIfPresent(
      rec,
      "custbody_swk_wht_update",
      parseCheckboxValue(firstRowData["Manual Update"]),
    );
    setBodyValueIfPresent(
      rec,
      "trandate",
      parseDateValue(firstRowData["Date"]),
    );
    setBodyTextIfPresent(
      rec,
      "custbody_swk_bill_whtamt",
      firstRowData["WHT Amount"],
    );
    setBodyValueIfPresent(rec, "tranid", firstRowData["Reference No."]);
    setBodyValueIfPresent(rec, "memo", firstRowData["Memo"]);
    setBodyTextIfPresent(rec, "account", firstRowData["Account"]);
    setBodyTextIfPresent(rec, "department", firstRowData["Department"]);
    setBodyValueIfPresent(rec, "location", locationId);

    // 26-06-01
    // (1) Transaction Category : 예정 원가 - term을 입력하지않음
    // (2) Transaction Category : 예정 원가 - due date가 입력된 경우 에러 발생
    const transactionCategory = firstRowData["Transaction Category"];
    const dueDate = firstRowData["Due Date"];
    if (
      ![
        "예정 원가/매출 - 취소",
        "예정 원가/매출 -",
        "予定原価/売上",
        "予定原価/売上－取消",
      ].includes(transactionCategory)
    ) {
      setBodyTextIfPresent(rec, "terms", firstRowData["Terms"]);
    } else {
      if (hasValue(dueDate)) {
        throw new Error(
          "Due Date should be empty when Transaction Category is " +
            transactionCategory,
        );
      }
    }

    setBodyValueIfPresent(rec, "duedate", parseDateValue(dueDate));

    setBodyTextIfPresent(
      rec,
      "custbody_swk_transcategory",
      firstRowData["Transaction Category"],
    );
    setBodyTextIfPresent(
      rec,
      "custbody_15529_vendor_entity_bank",
      firstRowData["Entity Bank"],
    );
    setBodyTextIfPresent(
      rec,
      FIELD_PROJECT_BODY,
      firstRowData["Project(Main, Single)"],
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

    return locationId;
  };

  const addBillExpenseLines = (rec, billRows, locationId) => {
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
        parseNumberValue(rowData["Amount"]),
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
      setCurrentLineValueIfPresent(
        rec,
        "expense",
        "custcol_swk_billline_wht",
        parseCheckboxValue(rowData["Apply WHT"]),
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

      setCurrentLineTextIfPresent(
        rec,
        "expense",
        FIELD_PROJECT_LINE,
        rowData["Project(Line)"],
      );
      setCurrentLineTextIfPresent(
        rec,
        "expense",
        FIELD_PROJECT_SEG,
        rowData["Project(Seg)"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "expense",
        "amortizationresidual",
        parseNumberValue(rowData["Residual"]),
      );
      rec.commitLine({ sublistId: "expense" });
    });
  };

  const createBillRecord = (billRows) => {
    const firstRowData = (billRows && billRows[0] && billRows[0].rowData) || {};

    // Body 필드 매핑
    const rec = record.create({
      type: record.Type.VENDOR_BILL,
      isDynamic: true,
    });
    const locationId = setBillBodyFields(rec, firstRowData);

    doPurchaseLinesValidations(billRows);
    addBillExpenseLines(rec, billRows, locationId);

    return rec.save();
  };

  const findBillIdByExternalId = (externalId) => {
    if (!externalId) {
      return null;
    }

    const results = search
      .create({
        type: record.Type.VENDOR_BILL,
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

  const removeExpenseLines = (rec) => {
    const lineCount = rec.getLineCount({ sublistId: "expense" });

    for (let line = lineCount - 1; line >= 0; line -= 1) {
      rec.removeLine({
        sublistId: "expense",
        line: line,
        ignoreRecalc: true,
      });
    }
  };

  const updateBillRecord = (billRows, existingBillId) => {
    const firstRowData = (billRows && billRows[0] && billRows[0].rowData) || {};
    const rec = record.load({
      type: record.Type.VENDOR_BILL,
      id: existingBillId,
      isDynamic: true,
    });
    const locationId = setBillBodyFields(rec, firstRowData);

    doPurchaseLinesValidations(billRows);
    removeExpenseLines(rec);
    addBillExpenseLines(rec, billRows, locationId);

    return rec.save();
  };

  const submitBillRecord = (billRows, uploadOption) => {
    const firstRowData = (billRows && billRows[0] && billRows[0].rowData) || {};
    const externalId = firstRowData["External ID"];
    const normalizedUploadOption = uploadOption || "ADD";
    const existingBillId =
      normalizedUploadOption === "ADD"
        ? null
        : findBillIdByExternalId(externalId);

    if (normalizedUploadOption === "ADD") {
      return createBillRecord(billRows);
    }

    if (normalizedUploadOption === "UPDATE") {
      if (!existingBillId) {
        throw new Error("Vendor Bill not found for External ID: " + externalId);
      }

      return updateBillRecord(billRows, existingBillId);
    }

    if (normalizedUploadOption === "UPSERT") {
      return existingBillId
        ? updateBillRecord(billRows, existingBillId)
        : createBillRecord(billRows);
    }

    throw new Error("Unsupported upload option: " + normalizedUploadOption);
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

    //external id를 키로, 전체 행 데이터를 값으로 전달
    mapContext.write({
      key: String(externalId),
      value: JSON.stringify(input),
    });
    // log.audit("map:write", "lineNumber=" + lineNumber + ", key=" + externalId);
  };

  const reduce = (reduceContext) => {
    const billRows = reduceContext.values.map((value) => JSON.parse(value));
    const firstValue = reduceContext.values[0]
      ? JSON.parse(reduceContext.values[0])
      : {};
    const uploadOption = firstValue.uploadOption || "ADD";

    try {
      let recordId = "";
      recordId = submitBillRecord(billRows, uploadOption);
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

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
