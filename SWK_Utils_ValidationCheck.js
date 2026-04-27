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

  /** Transaction Category (Not Confirmed / Cancel) */
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

  /** Tax Code */
  const resolveInternalIdsByValue = (recordType, rawValues, filterNames) => {
    const resolvedIds = {};

    (rawValues || []).forEach((rawValue) => {
      if (!hasValue(rawValue)) {
        return;
      }

      const normalizedValue = String(rawValue).trim();

      if (!Object.prototype.hasOwnProperty.call(resolvedIds, normalizedValue)) {
        resolvedIds[normalizedValue] = resolveInternalId(
          recordType,
          normalizedValue,
          filterNames,
        );
      }
    });

    return resolvedIds;
  };

  const getWrongTaxLineNumbers = (stagedRows) => {
    const candidateRows = (stagedRows || [])
      .map((row, index) => {
        const rowData = row.rowData || {};

        return {
          account: rowData["Expense Account"],
          lineNumber: row.lineNumber || index + 2,
          taxCode: rowData["Tax Code"],
        };
      })
      .filter((row) => hasValue(row.account) && hasValue(row.taxCode));

    if (candidateRows.length === 0) {
      return [];
    }

    const accountIdByValue = resolveInternalIdsByValue(
      search.Type.ACCOUNT,
      candidateRows.map((row) => row.account),
      ["displayname", "name", "number"],
    );
    const accountIds = Object.values(accountIdByValue).filter(hasValue);

    if (accountIds.length === 0) {
      return [];
    }

    const noTaxAccountIds = new Set();
    search
      .create({
        type: search.Type.ACCOUNT,
        filters: [["internalid", search.Operator.ANYOF, accountIds]],
        columns: [
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: libConstants.FLDS.ACCT.FLAG }),
        ],
      })
      .run()
      .each((result) => {
        const accountFlagText =
          result.getText({ name: libConstants.FLDS.ACCT.FLAG }) || "";

        if (String(accountFlagText).trim().toLowerCase() === "no-tax account") {
          noTaxAccountIds.add(String(result.getValue({ name: "internalid" })));
        }

        return true;
      });

    const noTaxRows = candidateRows.filter((row) =>
      noTaxAccountIds.has(String(accountIdByValue[String(row.account).trim()])),
    );

    if (noTaxRows.length === 0) {
      return [];
    }

    const taxCodeIdByValue = resolveInternalIdsByValue(
      search.Type.SALES_TAX_ITEM,
      noTaxRows.map((row) => row.taxCode),
      ["itemid", "name"],
    );
    const taxCodeIds = Object.values(taxCodeIdByValue).filter(hasValue);

    if (taxCodeIds.length === 0) {
      return [];
    }

    const wrongTaxCodeIds = new Set();
    search
      .create({
        type: search.Type.SALES_TAX_ITEM,
        filters: [
          ["internalid", search.Operator.ANYOF, taxCodeIds],
          "AND",
          [libConstants.FLDS.TAX_CODE.EXCLUDE, search.Operator.IS, "F"],
        ],
        columns: [search.createColumn({ name: "internalid" })],
      })
      .run()
      .each((result) => {
        wrongTaxCodeIds.add(String(result.getValue({ name: "internalid" })));
        return true;
      });

    return noTaxRows
      .filter((row) =>
        wrongTaxCodeIds.has(
          String(taxCodeIdByValue[String(row.taxCode).trim()]),
        ),
      )
      .map((row) => row.lineNumber);
  };

  const assertWrongTaxCodesLines = (stagedRows) => {
    const invalidLineNumbers = getWrongTaxLineNumbers(stagedRows);

    if (invalidLineNumbers.length > 0) {
      throw new Error(`The Tax Code has been entered incorrectly.`);
    }
  };

  /* (1) Bill and Bill Credit require either Department (Line) or Project(Line).
  (2) If the main Transaction Category Code is "Not Confirmed" or
      "Not Confirmed - Cancel", the main Account must match the unconfirmed flag.
  (3) If an Expense Account has SWK Account Flags = "No-tax Account",
      its Tax Code must have "Exclude From VAT Reports" checked.
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

    // log.debug("data check", `idCat : ${idCat}, bUnconAcct:${bUnconAcct}`);

    //(2) Transaction Category <-> Account validation
    if (!isMainTransCatAcctMatched(idCat, bUnconAcct)) {
      throw new Error(
        `An incorrect account has been entered for estimated cost/expense.`,
      );
    }

    //(1) Department / Project validation
    assertDeptOrProjectLines(billRows);

    //(3) Tax Code Check
    assertWrongTaxCodesLines(billRows);

    // if (arrNoAmorts.length > 0) {
    //   const MSG = lib.getTransMsgParams(libConstants.TRANS.KEYS.AMORT_SKED, [
    //     arrNoAmorts.toString(),
    //   ]);
    //   lib.processError(MSG, bClient, "NO_AMORT_SKED");
    //   bSave = false;
    // }
  };

  return {
    doPurchaseLinesValidations,
  };
});
