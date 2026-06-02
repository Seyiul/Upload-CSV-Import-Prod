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
 *
 */
define([
  "N/file",
  "N/log",
  "N/record",
  "N/runtime",
  "./SWK_Utils_UploadCsvFiles",
  "./SWK_Constants_UploadCsv",
  "./SWK_Utils_ValidationCheck",
  "./i18n",
], (
  file,
  log,
  record,
  runtime,
  csvUtils,
  uploadCsvConstants,
  validCheck,
  i18n,
) => {
  const CSV_FILE_ID_PARAM = "custscript_swk_csv_file_id_billitem";
  const TRANSACTION_TYPE_PARAM = "custscript_swk_csv_tran_type_billitem";
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

  const createBillRecord = (billRows) => {
    const firstRowData = (billRows && billRows[0] && billRows[0].rowData) || {};

    // Body 필드 매핑
    const rec = record.create({
      type: record.Type.VENDOR_BILL,
      isDynamic: true,
    });
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
    setBodyTextIfPresent(rec, "currency", firstRowData["Currency"]);

    // 26-06-01
    // (1) Transaction Category : 예정 원가 - term을 입력하지않음
    // (2) Transaction Category : 예정 원가 - due date가 입력된 경우 에러 발생
    const transactionCategory = firstRowData["Transaction Category"];
    const dueDate = firstRowData["Due Date"];
    if (
      ![
        "예정 원가/매출 - 취소",
        "예정 원가/매출",
        "予定原価/売上",
        "予定原価/売上－取消",
      ].includes(transactionCategory)
    ) {
      setBodyTextIfPresent(rec, "terms", firstRowData["Terms"]);
    } else {
      rec.setText({
        fieldId: "terms",
        text: "",
      });
      setBodyValueIfPresent(rec, "duedate", parseDateValue(dueDate));
    }

    // else {
    //   if (hasValue(dueDate)) {
    //     throw new Error(
    //       `取引カテゴリが${transactionCategory}の場合、支払期日は入力できません。`,
    //     );
    //   }
    // }

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

    doPurchaseLinesValidations(billRows);

    // CSV의 각 행을 Vendor Bill의 Item 라인으로 매핑
    (billRows || []).forEach((row) => {
      const rowData = row.rowData || {};

      rec.selectNewLine({ sublistId: "item" });
      setCurrentLineTextIfPresent(rec, "item", "item", rowData["Item"]);
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "description",
        rowData["Description"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "amount",
        parseNumberValue(rowData["Amount"]) ||
          (parseNumberValue(rowData["Quantity"]) || 0) *
            (parseNumberValue(rowData["Rate"]) || 0),
      );
      setCurrentLineTextIfPresent(rec, "item", "rate", rowData["Rate"]);
      setCurrentLineTextIfPresent(rec, "item", "quantity", rowData["Quantity"]);
      setCurrentLineTextIfPresent(
        rec,
        "item",
        "department",
        rowData["Department(Line)"],
      );
      setCurrentLineTextIfPresent(
        rec,
        "item",
        "grossamount",
        rowData["Gross Amt"],
      );
      setCurrentLineValueIfPresent(rec, "item", "location", locationId);
      setCurrentLineTextIfPresent(rec, "item", "taxcode", rowData["Tax Code"]);
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "tax1amt",
        parseNumberValue(rowData["Tax AMT"]),
      );
      setCurrentLineTextIfPresent(
        rec,
        "item",
        "amortizationsched",
        rowData["Amort. Schedule"],
      );
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "custcol_swk_billline_wht",
        parseCheckboxValue(rowData["Apply WHT"]),
      );
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "amortizstartdate",
        parseDateValue(rowData["Amort. Start"]),
      );
      setCurrentLineValueIfPresent(
        rec,
        "item",
        "amortizationenddate",
        parseDateValue(rowData["Amort. End"]),
      );

      setCurrentLineValueIfPresent(
        rec,
        "item",
        "amortizationresidual",
        parseNumberValue(rowData["Residual"]),
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
        rowData["Project(Seg)"],
      );
      rec.commitLine({ sublistId: "item" });
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
    const trans = i18n.load();
    const script = runtime.getCurrentScript();
    const fileId = script.getParameter({ name: CSV_FILE_ID_PARAM });
    const transactionType = script.getParameter({
      name: TRANSACTION_TYPE_PARAM,
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
