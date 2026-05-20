/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/url",
  "N/file",
  "./SWK_Utils_UploadCsvFiles",
], (serverWidget, search, url, file, csvUtils) => {
  const SAVED_SEARCH_ID = "customsearch_uploadcsv_errorlogfile_2";
  const SCRIPT_ID = "customscript_swk_sl_downloaderrorcsv";
  const DEPLOYMENT_ID = "customdeploy_swk_sl_downloaderrorcsv";
  const FILE_ID_COLUMN = "internalid";
  const FILE_NAME_COLUMN = "name";
  const CREATED_BY_COLUMN_INDEX = 7;

  const writeText = (response, output) => {
    response.write({
      output: output,
    });
  };

  const getSearchData = (filters) => {
    const loadedSearch = search.load({ id: SAVED_SEARCH_ID });

    if (filters && filters.createdFrom) {
      loadedSearch.filters.push(
        search.createFilter({
          name: "created",
          operator: search.Operator.ONORAFTER,
          values: filters.createdFrom,
        }),
      );
    }

    if (filters && filters.createdTo) {
      loadedSearch.filters.push(
        search.createFilter({
          name: "created",
          operator: search.Operator.ONORBEFORE,
          values: filters.createdTo,
        }),
      );
    }

    return {
      columns: loadedSearch.columns,
      results: loadedSearch.run().getRange({ start: 0, end: 1000 }) || [],
    };
  };

  const getRequestFilters = (parameters) => ({
    createdBy: parameters.custpage_filter_createdby || "",
    createdFrom: parameters.custpage_filter_createdfrom || "",
    createdTo: parameters.custpage_filter_createdto || "",
  });

  const getSelectedValues = (value) =>
    String(value || "")
      .split(/\u0005|,/)
      .map((selectedValue) => selectedValue.trim())
      .filter((selectedValue) => selectedValue);

  const getColumnValue = (result, columnName) => {
    if (!result || !columnName) {
      return "";
    }

    return (
      result.getValue({ name: columnName }) ||
      result.getText({ name: columnName }) ||
      ""
    );
  };

  const getColumnValueByIndex = (result, columns, index) => {
    const column = columns[index];

    if (!result || !column) {
      return "";
    }

    return result.getText(column) || result.getValue(column) || "";
  };

  const getColumnInternalValueByIndex = (result, columns, index) => {
    const column = columns[index];

    if (!result || !column) {
      return "";
    }

    return result.getValue(column) || "";
  };

  const loadJsonFile = (fileId) => {
    if (!fileId) {
      return null;
    }

    return file.load({ id: fileId });
  };

  const createSuiteletUrl = (params) =>
    url.resolveScript({
      scriptId: SCRIPT_ID,
      deploymentId: DEPLOYMENT_ID,
      params: params || {},
    });

  const writeDownloadResponse = (response, contents, filename) => {
    response.setHeader({
      name: "Content-Type",
      value: "text/csv; charset=UTF-8",
    });
    response.setHeader({
      name: "Content-Disposition",
      value: `attachment; filename="${filename}"`,
    });
    writeText(response, `\uFEFF${contents}`);
  };

  const renderList = (response, filters) => {
    const form = serverWidget.createForm({
      title: "Error CSV Download",
    });

    const createdByField = form.addField({
      id: "custpage_filter_createdby",
      type: serverWidget.FieldType.MULTISELECT,
      label: "Created By",
      source: "employee",
    });
    createdByField.defaultValue = filters.createdBy || "";

    const createdFromField = form.addField({
      id: "custpage_filter_createdfrom",
      type: serverWidget.FieldType.DATE,
      label: "Created From",
    });
    createdFromField.defaultValue = filters.createdFrom || "";

    const createdToField = form.addField({
      id: "custpage_filter_createdto",
      type: serverWidget.FieldType.DATE,
      label: "Created To",
    });
    createdToField.defaultValue = filters.createdTo || "";

    form.addSubmitButton({
      label: "Search",
    });

    const sublist = form.addSublist({
      id: "custpage_error_list",
      type: serverWidget.SublistType.LIST,
      label: "Error Files",
    });

    sublist.addField({
      id: "custpage_name",
      type: serverWidget.FieldType.TEXT,
      label: "Name",
    });

    sublist.addField({
      id: "custpage_created",
      type: serverWidget.FieldType.TEXT,
      label: "Created Date",
    });

    sublist.addField({
      id: "custpage_setby",
      type: serverWidget.FieldType.TEXT,
      label: "Created By",
    });
    sublist.addField({
      id: "custpage_download",
      type: serverWidget.FieldType.URL,
      label: "Download CSV",
    }).linkText = "Download";

    const searchData = getSearchData(filters);
    const createdByFilterValues = getSelectedValues(filters.createdBy);

    let line = 0;

    searchData.results.forEach((result, index) => {
      const fileId = getColumnValue(result, FILE_ID_COLUMN);
      const name =
        getColumnValue(result, FILE_NAME_COLUMN) || `error_${index + 1}`;
      const createdDate = getColumnValue(result, "created");
      const setBy = getColumnValueByIndex(
        result,
        searchData.columns,
        CREATED_BY_COLUMN_INDEX,
      );
      const setById = getColumnInternalValueByIndex(
        result,
        searchData.columns,
        CREATED_BY_COLUMN_INDEX,
      );

      if (
        createdByFilterValues.length > 0 &&
        createdByFilterValues.indexOf(String(setById)) === -1
      ) {
        return;
      }

      const downloadUrl = createSuiteletUrl({
        action: "download",
        fileId: fileId,
      });

      sublist.setSublistValue({
        id: "custpage_name",
        line: line,
        value: name,
      });

      if (createdDate) {
        sublist.setSublistValue({
          id: "custpage_created",
          line: line,
          value: createdDate,
        });
      }

      if (setBy) {
        sublist.setSublistValue({
          id: "custpage_setby",
          line: line,
          value: setBy,
        });
      }

      sublist.setSublistValue({
        id: "custpage_download",
        line: line,
        value: downloadUrl,
      });

      line += 1;
    });

    response.writePage(form);
  };

  const downloadCsv = (response, fileId) => {
    const jsonFile = loadJsonFile(fileId);

    if (!jsonFile) {
      response.write("No file found.");
      return;
    }

    const name = jsonFile.name || `error_${fileId}`;
    const fileName = String(name)
      .replace(/\.[^.]+$/i, "")
      .concat(".csv");

    writeDownloadResponse(
      response,
      csvUtils.decodeUnicodeEscapes(jsonFile.getContents() || ""),
      fileName,
    );
  };

  const onRequest = (context) => {
    const parameters = context.request.parameters || {};

    if (parameters.action === "download") {
      downloadCsv(context.response, parameters.fileId);
      return;
    }

    renderList(context.response, getRequestFilters(parameters));
  };

  return {
    onRequest,
  };
});
