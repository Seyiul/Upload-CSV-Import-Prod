/**
 * @NApiVersion 2.1
 */
define(["N/search", "./i18n"], (search, i18n) => {
  const hasValue = (value) =>
    value !== null && value !== undefined && value !== "";

  /** Parsing 관련 유틸리티 함수 모음 START */

  // 유니코드 이스케이프 처리 함수
  const encodeUnicodeEscapes = (text) =>
    String(text || "").replace(
      /[^\x00-\x7F]/g,
      (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
    );

  // 유니코드 이스케이프 해제 함수
  const decodeUnicodeEscapes = (text) =>
    String(text || "").replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );

  /**
   * CSV 줄을 파싱하여 값을 배열로 반환
   * @param {string} line - 파싱할 CSV 줄
   * @returns {string[]} 파싱된 값 배열
   */
  const parseCsvLine = (line) => {
    const values = [];
    let current = "";
    let quoted = false;

    const pushValue = () => {
      values.push(current.trim());
      current = "";
    };

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (char === '"' && quoted && next === '"') {
        current += '"';
        i += 1;
        continue;
      }

      if (char === '"') {
        quoted = !quoted;
        continue;
      }

      if (char === "," && !quoted) {
        pushValue();
        continue;
      }

      current += char;
    }

    pushValue();
    return values;
  };

  /**
   * HTML 이스케이프 처리
   * @param {*} value
   * @returns {string} 이스케이프 처리된 문자열
   */
  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  /**
   * 날짜 문자열을 파싱하여 Date 객체로 반환
   * @param {*} value
   * @returns {Date|null} 파싱된 Date 객체
   */
  const parseDateValue = (value) => {
    if (!value) {
      return null;
    }

    const normalizedValue = value.replace(/\./g, "/").replace(/-/g, "/");
    const parts = normalizedValue.split("/");
    if (parts.length === 3) {
      return new Date(parts[0], Number(parts[1]) - 1, parts[2]);
    }

    return new Date(value);
  };

  /**
   * 숫자 문자열을 파싱하여 Number로 반환
   * @param {*} value
   * @returns {number|null} 파싱된 숫자 값
   */
  const parseNumberValue = (value) => {
    if (!hasValue(value) && value !== 0) {
      return null;
    }

    const normalizedValue = String(value).replace(/,/g, "").trim();
    return normalizedValue ? parseFloat(normalizedValue) : null;
  };

  /**
   * CSV 값 이스케이프 처리
   * @param {*} value
   * @returns {string} 이스케이프 처리된 CSV 값
   */
  const escapeCsvValue = (value) => {
    const normalizedValue = String(value == null ? "" : value);
    if (
      normalizedValue.indexOf(",") !== -1 ||
      normalizedValue.indexOf('"') !== -1 ||
      normalizedValue.indexOf("\n") !== -1
    ) {
      return `"${normalizedValue.replace(/"/g, '""')}"`;
    }
    return normalizedValue;
  };

  const buildCsvLine = (values) => {
    return values.map(escapeCsvValue).join(",");
  };

  /** Parsing 관련 유틸리티 함수 모음 END */

  /** NetSuite 레코드에 값 설정 관련 유틸리티 함수 모음 START */

  const setBodyTextIfPresent = (rec, fieldId, value) => {
    if (!value) {
      return;
    }

    rec.setText({
      fieldId: fieldId,
      text: value,
    });
  };

  const setBodyValueIfPresent = (rec, fieldId, value) => {
    if (!hasValue(value)) {
      return;
    }

    rec.setValue({
      fieldId: fieldId,
      value: value,
    });
  };

  const setCurrentLineTextIfPresent = (rec, sublistId, fieldId, value) => {
    if (!value) {
      return;
    }

    rec.setCurrentSublistText({
      sublistId: sublistId,
      fieldId: fieldId,
      text: value,
    });
  };

  // 현재 라인에 값이 존재하는 경우에 line에 값 설정
  const setCurrentLineValueIfPresent = (rec, sublistId, fieldId, value) => {
    if (!hasValue(value)) {
      return;
    }

    rec.setCurrentSublistValue({
      sublistId: sublistId,
      fieldId: fieldId,
      value: value,
    });
  };

  const findFirstInternalId = (recordType, filters) => {
    const lookupSearch = search.create({
      type: recordType,
      filters: filters,
      columns: ["internalid"],
    });

    const results = lookupSearch.run().getRange({ start: 0, end: 1 });
    if (!results || results.length === 0) {
      return null;
    }

    return results[0].getValue({ name: "internalid" });
  };

  // Location 레코드를 검색하여 Internal ID 반환
  const findLocationIdByValue = (locationValue) => {
    if (!locationValue) {
      return null;
    }

    const normalizedValue = String(locationValue).trim();

    return (
      findFirstInternalId(search.Type.LOCATION, [
        ["name", "is", normalizedValue],
      ]) ||
      findFirstInternalId(search.Type.LOCATION, [
        ["namenohierarchy", "is", normalizedValue],
      ])
    );
  };

  // 라인 번호를 키로, 행 데이터를 값으로 하는 객체 생성
  const indexStagedRowsByLine = (stagedRows) => {
    const stagedRowsByLine = {};

    (stagedRows || []).forEach((row) => {
      stagedRowsByLine[row.lineNumber] = row.rowData || {};
    });

    return stagedRowsByLine;
  };

  function normalizeReferenceError(message) {
    const trans = i18n.load();
    const match = message.match(/^Invalid\s+(.+?)\s+reference key\s+(.+)\.?$/);

    if (!match) return message;

    const fieldId = match[1];
    const value = match[2];

    const FIELD_LABEL_MAP = {
      custbody_swk_transcategory: trans.TRANSACTION_CATEGORY(),
      department: trans.DEPARTMENT(),
      entity: trans.VENDOR_OR_CUSTOMER(),
      account: trans.ACCOUNT(),
      subsidiary: trans.SUBSIDIARY(),
      location: trans.LOCATION(),
      currency: trans.CURRENCY(),
      taxcode: trans.TAX_CODE(),
      item: trans.ITEM(),
      memo: trans.MEMO(),
      terms: trans.TERMS(),
      postingperiod: trans.POSTING_PERIOD(),
    };

    const fieldLabel = FIELD_LABEL_MAP[fieldId] || fieldId;

    return trans.INVALID_REFERENCE_VALUE({
      params: [fieldLabel, value],
    });
  }
  // 에러가 발생한 행들의 데이터를 CSV 형식으로 변환하여 반환
  const buildErrorReportCsvContents = (errorRows, stagedRowsByLine) => {
    if (!errorRows || errorRows.length === 0) {
      return "";
    }

    const firstRowData = stagedRowsByLine[errorRows[0].lineNumber] || {};
    const headers = Object.keys(firstRowData);
    const csvLines = [buildCsvLine(["Error", ...headers])];
    const shownErrorKeys = {};

    errorRows.forEach((row) => {
      const originalRowData = stagedRowsByLine[row.lineNumber] || {};
      const externalId =
        row.externalId ||
        originalRowData["External ID"] ||
        originalRowData["EXTERNAL ID"] ||
        "";
      const normalizedMessage = String(row.message || "").trim();
      const errorKey = `${String(externalId).trim()}::${normalizedMessage}`;
      const displayMessage = shownErrorKeys[errorKey]
        ? ""
        : normalizeReferenceError(row.message);

      shownErrorKeys[errorKey] = true;

      csvLines.push(
        buildCsvLine([
          displayMessage,
          ...headers.map((header) => originalRowData[header] ?? ""),
        ]),
      );
    });

    return csvLines.join("\r\n");
  };

  // 에러 보고서 CSV 파일 저장
  const saveErrorReportFile = (fileModule, options) => {
    const { folderId, stagingFileId, errorPrefix, contents } = options;

    if (!contents || !folderId || !stagingFileId || !errorPrefix) {
      return null;
    }

    const errorFile = fileModule.create({
      name: `${errorPrefix}${stagingFileId}.txt`,
      fileType: fileModule.Type.PLAINTEXT,
      contents: encodeUnicodeEscapes(contents),
      folder: folderId,
    });

    return errorFile.save();
  };

  // 처리 결과 요약 파일 저장(json 형식 : 성공/실패 건수 및 오류 파일 ID 포함)
  const saveProcessingSummaryFile = (fileModule, options) => {
    const {
      folderId,
      stagingFileId,
      summaryPrefix,
      successCount,
      errorCount,
      errorFileId,
      message,
      errors,
    } = options;

    if (!folderId || !stagingFileId || !summaryPrefix) {
      return null;
    }

    const summaryFile = fileModule.create({
      name: `${summaryPrefix}${stagingFileId}.json`,
      fileType: fileModule.Type.CSV,
      contents: JSON.stringify({
        successCount: successCount || 0,
        errorCount: errorCount || 0,
        errorFileId: errorFileId || "",
        message: message || "",
        errors: errors || [],
      }),
      encoding: fileModule.Encoding.UTF8,
      folder: folderId,
    });

    return summaryFile.save();
  };

  /** NetSuite 레코드에 값 설정 관련 유틸리티 함수 모음 END */

  /** CSV header validation / error formatting START */

  const getHeaderLabel = (headerConfig) =>
    Array.isArray(headerConfig) ? headerConfig.join(" or ") : headerConfig;

  const getHeaderAliases = (headerConfig) =>
    Array.isArray(headerConfig) ? headerConfig : [headerConfig];

  const validateMappedHeaders = (stagedRows, requiredHeaders) => {
    const firstRowData =
      (stagedRows && stagedRows[0] && stagedRows[0].rowData) || {};
    const uploadedHeaders = Object.keys(firstRowData);

    if (!stagedRows || stagedRows.length === 0) {
      return ["Uploaded CSV has no data rows."];
    }

    if (uploadedHeaders.length === 0) {
      return ["Uploaded CSV has no mapped headers."];
    }

    const trans = i18n.load();

    return (requiredHeaders || [])
      .filter((headerConfig) =>
        getHeaderAliases(headerConfig).every(
          (header) => uploadedHeaders.indexOf(header) === -1,
        ),
      )
      .map(
        (headerConfig) =>
          `${trans.MISSING_COLUMN()} ${getHeaderLabel(headerConfig)}`,
      );
  };

  const assertValidMappedHeaders = (stagedRows, requiredHeaders) => {
    const trans = i18n.load();
    const errors = validateMappedHeaders(stagedRows, requiredHeaders);

    if (errors.length > 0) {
      throw new Error(
        `${trans.CSV_HEADER_VALIDATION_FAILED()}\n ${errors.join("\n")}`,
      );
    }
  };

  const getErrorDisplayMessage = (error) => {
    let message = String(error || "");

    try {
      const parsedError = JSON.parse(message);
      message = parsedError.message || parsedError.name || message;
    } catch (e) {
      // NetSuite summary errors are usually JSON strings, but plain text is OK.
    }

    return message.replace(/^Error:\s*/, "").replace(/\s+\[[\s\S]*\]$/, "");
  };

  /** CSV header validation / error formatting END */

  return {
    parseCsvLine,
    escapeHtml,
    parseDateValue,
    parseNumberValue,
    encodeUnicodeEscapes,
    decodeUnicodeEscapes,
    escapeCsvValue,
    buildCsvLine,
    setBodyTextIfPresent,
    setBodyValueIfPresent,
    setCurrentLineTextIfPresent,
    setCurrentLineValueIfPresent,
    findLocationIdByValue,
    indexStagedRowsByLine,
    buildErrorReportCsvContents,
    saveErrorReportFile,
    saveProcessingSummaryFile,
    getHeaderLabel,
    getHeaderAliases,
    validateMappedHeaders,
    assertValidMappedHeaders,
    getErrorDisplayMessage,
    hasValue,
  };
});
