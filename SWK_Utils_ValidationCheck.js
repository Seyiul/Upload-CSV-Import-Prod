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

  /** Department */
  const getMissingDeptLineNumbers = (
    stagedRows,
    departmentHeader = "Department(Line)",
  ) =>
    (stagedRows || [])
      .filter((row) => {
        const rowData = row.rowData || {};

        return !hasValue(rowData[departmentHeader]);
      })
      .map((row, index) => row.lineNumber || index + 2);

  const assertDeptLines = (
    stagedRows,
    departmentHeader = "Department(Line)",
  ) => {
    const invalidLineNumbers = getMissingDeptLineNumbers(
      stagedRows,
      departmentHeader,
    );

    if (invalidLineNumbers.length > 0) {
      throw new Error(`Missing ${departmentHeader}.`);
    }
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

  /** Amortization */

  const getMissingAmortLineNumbers = (
    stagedRows,
    scheduleHeader = "Amort. Schedule",
    startHeader = "Amort. Start",
    endHeader = "Amort. End",
  ) => {
    const candidateRows = (stagedRows || [])
      .map((row, index) => {
        const rowData = row.rowData || {};

        return {
          account: rowData["Expense Account"],
          schedule: rowData[scheduleHeader],
          startDate: rowData[startHeader],
          endDate: rowData[endHeader],
          lineNumber: row.lineNumber || index + 2,
        };
      })
      .filter(
        (row) =>
          hasValue(row.account) &&
          (!hasValue(row.schedule) ||
            !hasValue(row.startDate) ||
            !hasValue(row.endDate)),
      );

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

    const amortAccountIds = getAmortAccount(accountIds);

    if (amortAccountIds.size === 0) {
      return [];
    }

    return candidateRows
      .filter((row) =>
        amortAccountIds.has(
          String(accountIdByValue[String(row.account).trim()]),
        ),
      )
      .map((row) => row.lineNumber);
  };

  const getAmortAccount = (accountIds) => {
    const amortAccountIds = new Set();
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

        if (
          String(accountFlagText).trim().toLowerCase() ===
          libConstants.CODE.ACCT_FLAG_AMORT
        ) {
          amortAccountIds.add(String(result.getValue({ name: "internalid" })));
        }

        return true;
      });

    return amortAccountIds;
  };

  const assertAmortizationLines = (stagedRows) => {
    // Expense Account인 경우 schedule, startDate, endDate가 있는지 확인
    const invalidLineNumbers = getMissingAmortLineNumbers(stagedRows);

    if (invalidLineNumbers.length > 0) {
      throw new Error(`Please enter an amortization schedule.`);
    }
  };

  /*
(1) Department(Line)는 필수 입력해야 함

(2) Transaction Category의 Code가 "Not Confirmed"일 경우 Main Account에 가계정을 입력해야 함
  Transaction Category : 미정 / 매출
  Account : 92010501 미지급금가계정 : (가)미지급금

(3) (Expense) Account의 SWK Account Flag가 "No-Tax Account"일 경우 Tax Code는 "Exclude From VAT Reports"로 체크되어 있어야 함
  Account(Line) : 11190000 미지급금
  Tax Code(Line) : Exclude From VAT Reports

(4) (Expense) Account의 SWK Account Flag가 "Amortization Account"일 경우 아래 항목 필수 입력. Amort. Schedule, Amort. Start, Amort. End

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
    assertDeptLines(billRows);

    //(3) Tax Code Check
    assertWrongTaxCodesLines(billRows);

    //(4) Amortization Check
    assertAmortizationLines(billRows);
  };

  return {
    doPurchaseLinesValidations,
  };
});
