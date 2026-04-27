/**
 * @NApiVersion 2.1
 */
define(["N/search", "N/log", "../TransEntValidations/SWK_TEV_Constants"], (
  search,
  log,
  libConstants,
) => {
  const hasValue = (value) => {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === "string") {
      const normalizedValue = value.trim().toLowerCase();

      return (
        normalizedValue !== "" &&
        normalizedValue !== "null" &&
        normalizedValue !== "undefined"
      );
    }

    return true;
  };

  /** Project & Department */
  const getMissingDeptOrProjectLineNumbers = (
    stagedRows,
    departmentHeader = "Department(Line)",
    projectHeader = "Project(Line)",
  ) =>
    (stagedRows || [])
      .filter((row) => {
        const rowData = row.rowData || {};

        // log.debug("dept", rowData[departmentHeader]);
        // log.debug("project", rowData[projectHeader]);

        return (
          !hasValue(rowData[departmentHeader]) &&
          !hasValue(rowData[projectHeader])
        );
      })
      .map((row, index) => row.lineNumber || index + 2);

  const assertDeptOrProjectLines = (
    stagedRows,
    departmentHeader = "Department(Line)",
    projectHeader = "Project(Line)",
  ) => {
    const invalidLineNumbers = getMissingDeptOrProjectLineNumbers(
      stagedRows,
      departmentHeader,
      projectHeader,
    );

    if (invalidLineNumbers.length > 0) {
      throw new Error(`Missing ${departmentHeader} or ${projectHeader}.`);
    }
  };

  /** Project & Department */

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

  const resolveInternalId = (recordType, rawValue, filterNames) => {
    if (!hasValue(rawValue)) {
      return null;
    }

    const normalizedValue = String(rawValue).trim();

    if (/^\d+$/.test(normalizedValue)) {
      return normalizedValue;
    }

    for (let i = 0; i < filterNames.length; i += 1) {
      const internalId = findFirstInternalId(recordType, [
        [filterNames[i], "is", normalizedValue],
      ]);

      if (internalId) {
        return internalId;
      }
    }

    return null;
  };

  /** Transaction Category(예정원가/취소) */
  const isMainTransCatAcctMatched = (idCat, bUnconAcct) => {
    const LOG_TITLE = "isMainTransCatAcctMatched";
    const NOT_CONFIRMED_CAT = isNotConfirmedCat(idCat);
    const acctFields = search.lookupFields({
      type: search.Type.ACCOUNT,
      id: bUnconAcct,
      columns: [libConstants.FLDS.ACCT.UNCON],
    });
    const NOT_CONFIRMED_ACCT = acctFields[libConstants.FLDS.ACCT.UNCON];
    log.debug(
      LOG_TITLE,
      `NOT_CONFIRMED_CAT: ${NOT_CONFIRMED_CAT} NOT_CONFIRMED_ACCT: ${NOT_CONFIRMED_ACCT}`,
    );

    return NOT_CONFIRMED_CAT === NOT_CONFIRMED_ACCT;
  };

  const isNotConfirmedCat = (idCat) => {
    let fldsCat = search.lookupFields({
      type: libConstants.REC.TRANS_CAT,
      id: idCat,
      columns: [libConstants.FLDS.TRANS_CAT.CODE],
    });

    return libConstants.CODE.TRANS_CAT.includes(
      fldsCat[libConstants.FLDS.TRANS_CAT.CODE],
    );
  };

  /* (1) Bill, Bill Credit 입력시에는 (1) Department (Line) 또는 (2) Project(Line) = Project (Seg)중 하나는 꼭 입력되어 있어야 함  
  (2) Main의 Transaction Category Code 가 Code가 "Not Confirmed" , "Not Confirmed - Cancel" 이면 , Main의 Account, Line의 Account(Line)의 Unconfirmed Account(가계정) 
  */
  const doPurchaseLinesValidations = (billRows) => {
    const firstRowData = (billRows && billRows[0] && billRows[0].rowData) || {};
    const idCat = resolveInternalId(
      libConstants.REC.TRANS_CAT,
      firstRowData["Transaction Category"],
      ["name"],
    );
    const bUnconAcct = resolveInternalId(
      search.Type.ACCOUNT,
      firstRowData["Account"],
      ["displayname", "name", "number"],
    );

    log.debug("data check", `idCat : ${idCat}, bUnconAcct:${bUnconAcct}`);

    if (!isMainTransCatAcctMatched(idCat, bUnconAcct)) {
      throw new Error(
        `An incorrect account has been entered for estimated cost/expense.`,
      );
    }
    assertDeptOrProjectLines(billRows);
  };

  return {
    doPurchaseLinesValidations,
  };
});
