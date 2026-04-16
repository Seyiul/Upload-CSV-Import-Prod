/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Description : CSV 파일 업로드와 Map/Reduce 처리 시작, 상태 조회를 담당하는 Suitelet
 *
 *  * Version  Date          Author           Remarks
 * -------  ------------    --------------    --------------------------------------
 * 1.00     2026-04-13      Seulyi Ri          Initial development
 */
define([
  "N/ui/serverWidget",
  "N/log",
  "N/file",
  "N/task",
  "N/search",
  "N/redirect",
  "N/url",
  "./SWK_Utils_UploadCsvFiles",
], (serverWidget, log, file, task, search, redirect, url, csvUtils) => {
  const SUITELET_SCRIPT_ID = "customscript_swk_sl_uploadcsvfile";
  const SUITELET_DEPLOYMENT_ID = "customdeploy_swk_sl_uploadcsvfile";

  const ACTIONS = {
    taskStatus: "taskstatus",
    downloadErrorCsv: "downloaderrorcsv",
  };

  const RESULT_SUMMARY_PREFIX = "swk_mr_summary_";

  const TRANSACTION_CONFIG = {
    PO: {
      templateFileId: 16682,
      templateName: "PO Template.csv",
    },
    BILL: {
      templateFileId: 16680,
      templateName: "Bill Template.csv",
      task: {
        scriptId: "customscript_swk_mr_processcsvbill",
        deploymentId: "customdeploy_swk_mr_processcsvbill",
        params: {
          fileId: "custscript_swk_csv_file_id",
          transactionType: "custscript_swk_csv_tran_type",
        },
      },
    },
    INVOICE: {
      templateFileId: 16681,
      templateName: "Invoice Template.csv",
    },
    JOURNAL: {
      templateFileId: 16683,
      templateName: "Journal Template.csv",
      task: {
        scriptId: "customscript_swk_mr_processcsvjournal",
        deploymentId: "customdeploy_swk_mr_processcsvjournal",
        params: {
          fileId: "custscript_swk_csv_file_id_jn",
          transactionType: "custscript_swk_csv_tran_type_jn",
        },
      },
    },
  };

  const createSuiteletUrl = (params) =>
    url.resolveScript({
      scriptId: SUITELET_SCRIPT_ID,
      deploymentId: SUITELET_DEPLOYMENT_ID,
      params: params || {},
    });

  const writeText = (response, output) => {
    response.write({
      output: output,
    });
  };

  const writeJson = (response, payload) => {
    writeText(response, JSON.stringify(payload || {}));
  };

  /**
   *  Form 생성 및 랜더링
   */
  const buildForm = ({
    transactionType,
    statusTitle,
    statusMessage,
    taskId,
    stagingFileId,
    errorFileId,
  }) => {
    const form = serverWidget.createForm({
      title: "Upload CSV File",
    });
    const transactionConfig = TRANSACTION_CONFIG[transactionType] || {};

    form.addFieldGroup({
      id: "custpage_group_template_download",
      label: "Template Download",
    });
    form.addFieldGroup({
      id: "custpage_group_upload_options",
      label: "Upload Options",
    });
    form.addFieldGroup({
      id: "custpage_group_upload_status",
      label: "Upload Status",
    });

    // 파일 업로드 필드
    const fileField = form.addField({
      id: "custpage_import_file",
      type: serverWidget.FieldType.FILE,
      label: " ",
    });
    fileField.updateBreakType({
      breakType: serverWidget.FieldBreakType.STARTROW,
    });
    fileField.updateLayoutType({
      layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE,
    });

    const templateNameField = form.addField({
      id: "custpage_template_name",
      type: serverWidget.FieldType.TEXT,
      label: "Template",
      container: "custpage_group_template_download",
    });
    templateNameField.defaultValue =
      transactionConfig.templateName || "Select a transaction type first";
    templateNameField.updateDisplayType({
      displayType: serverWidget.FieldDisplayType.INLINE,
    });

    const templateLinkHtmlField = form.addField({
      id: "custpage_template_link_html",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
      container: "custpage_group_template_download",
    });
    templateLinkHtmlField.defaultValue = `
      <div style="margin-top:10px;">
        <div class="smallgraytextnolink uir-label">Download Link</div>
        <div id="custpage_template_link_container">Template link will appear after selection</div>
      </div>
    `;

    const transactionTypeField = form.addField({
      id: "custpage_transaction_type",
      type: serverWidget.FieldType.SELECT,
      label: "Transaction Type",
      container: "custpage_group_upload_options",
    });
    transactionTypeField.isMandatory = true;
    transactionTypeField.addSelectOption({
      value: "",
      text: "Select Transaction Type",
    });

    Object.keys(TRANSACTION_CONFIG).forEach((type) => {
      transactionTypeField.addSelectOption({
        value: type,
        text: type,
      });
    });

    if (transactionType) {
      transactionTypeField.defaultValue = transactionType;
    }

    // Map/Reduce Task ID와 Staging File ID를 저장하는 숨겨진 필드 START
    const taskIdField = form.addField({
      id: "custpage_task_id",
      type: serverWidget.FieldType.TEXT,
      label: "Task ID",
    });
    taskIdField.updateDisplayType({
      displayType: serverWidget.FieldDisplayType.HIDDEN,
    });
    taskIdField.defaultValue = taskId || "";

    const stagingFileIdField = form.addField({
      id: "custpage_staging_file_id",
      type: serverWidget.FieldType.TEXT,
      label: "Staging File ID",
    });
    stagingFileIdField.updateDisplayType({
      displayType: serverWidget.FieldDisplayType.HIDDEN,
    });
    stagingFileIdField.defaultValue = stagingFileId || "";
    // Map/Reduce Task ID와 Staging File ID를 저장하는 숨겨진 필드 END

    if (taskId) {
      form.addButton({
        id: "custpage_refresh_status",
        label: "Refresh Status",
        functionName: "refreshStatus",
      });
    }

    const statusField = form.addField({
      id: "custpage_result_html",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
      container: "custpage_group_upload_status",
    });

    if (statusTitle && statusMessage) {
      // 에러 파일이 존재하는 경우 다운로드 링크 생성
      const downloadUrl = errorFileId
        ? createSuiteletUrl({
            action: ACTIONS.downloadErrorCsv,
            errorFileId: errorFileId,
          })
        : "";

      statusField.defaultValue = `
        <div id="swk-status-panel" style="margin-top:12px;border:1px solid #dbe4f0;border-radius:14px;background:#ffffff;padding:18px 20px;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
          <div style="font-size:18px;font-weight:600;color:#0f172a;margin-bottom:8px;">${csvUtils.escapeHtml(statusTitle)}</div>
          <div style="font-size:14px;line-height:1.6;color:#475569;white-space:pre-wrap;">${csvUtils.escapeHtml(statusMessage)}</div>
          ${
            downloadUrl
              ? `<div style="margin-top:14px;"><a href="${downloadUrl}" style="color:#1d4ed8;font-weight:600;text-decoration:none;">Download Error CSV</a></div>`
              : ""
          }
        </div>
      `;
    } else {
      statusField.defaultValue = '<div id="swk-status-panel"></div>';
    }

    form.addSubmitButton({
      label: "Submit",
    });
    form.clientScriptModulePath = "./SWK_CS_UploadCsvFile.js";
    return form;
  };

  // 오류 보고서 CSV 파일 내용 생성
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

  // Map/Reduce Task 상태 조회
  const getTaskStatusDetails = (taskId) => {
    if (!taskId) {
      return null;
    }

    const status = task.checkStatus({
      taskId: taskId,
    });

    return {
      title: "Upload Status",
      message:
        `Task ID: ${taskId}\n` +
        `Status: ${status.status}` +
        (status.stage ? `\nStage: ${status.stage}` : ""),
      status: status.status,
    };
  };

  // Staging File에서 업로드된 Json 데이터 로드
  const getSummaryFile = (stagingFileId) => {
    if (!stagingFileId) {
      return null;
    }

    const result = search
      .create({
        type: "file",
        filters: [
          ["name", "is", `${RESULT_SUMMARY_PREFIX}${stagingFileId}.json`],
        ],
        columns: ["internalid"],
      })
      .run()
      .getRange({ start: 0, end: 1 });

    if (!result || result.length === 0) {
      return null;
    }

    return file.load({
      id: result[0].getValue({ name: "internalid" }),
    });
  };

  // Map/Reduce Task 완료 후 결과 조회
  const getCompletedTaskResult = (taskId, stagingFileId) => {
    const taskStatus = getTaskStatusDetails(taskId);
    if (!taskStatus || String(taskStatus.status).toUpperCase() !== "COMPLETE") {
      return taskStatus;
    }

    const summaryFile = getSummaryFile(stagingFileId);
    if (!summaryFile) {
      return taskStatus;
    }

    const summary = JSON.parse(summaryFile.getContents() || "{}");

    log.debug(
      "getCompletedTaskResult",
      "Task completed with summary: " + JSON.stringify(summary),
    );

    return {
      title:
        summary.errorCount > 0
          ? "Upload Completed With Errors"
          : "Upload Completed",
      message:
        `Status: ${taskStatus.status}\n` +
        `Success: ${summary.successCount || 0}\n` +
        `Errors: ${summary.errorCount || 0}`,
      status: taskStatus.status,
      errorFileId: summary.errorFileId || "",
      successCount: summary.successCount || 0,
      errorCount: summary.errorCount || 0,
    };
  };

  const renderForm = (response, formOptions) => {
    response.writePage(buildForm(formOptions || {}));
  };

  // 업로드한 CSV 파일 Parsing하여 rowData 형태로 변환
  const getUploadedCsvRows = (uploadedFile, transactionType) => {
    uploadedFile.encoding = file.Encoding.UTF8;
    const lines = uploadedFile
      .getContents()
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");

    const headers = lines.length > 0 ? csvUtils.parseCsvLine(lines[0]) : [];

    return lines.slice(1).map((line, index) => {
      const values = csvUtils.parseCsvLine(line);
      const rowData = {};

      for (let i = 0; i < headers.length; i += 1) {
        rowData[headers[i]] = values[i] || "";
      }

      return {
        lineNumber: index + 2,
        transactionType: transactionType,
        rowData: rowData,
      };
    });
  };

  // RowData를 기반으로 Staging File 저장
  const saveStagingFile = (uploadedFile, transactionType, folderId) => {
    const stagingRows = getUploadedCsvRows(uploadedFile, transactionType);

    log.debug(
      "First staging row before save",
      JSON.stringify(stagingRows[0] || {}),
    );

    const stagingFile = file.create({
      name:
        (uploadedFile.name || `upload_${Date.now()}`).replace(/\.csv$/i, "") +
        ".json",
      fileType: file.Type.PLAINTEXT,
      contents: csvUtils.encodeUnicodeEscapes(JSON.stringify(stagingRows)),
      folder: folderId,
    });

    log.debug(
      "JSON before save",
      JSON.stringify(stagingRows).substring(0, 500),
    );

    return stagingFile.save();
  };

  const submitProcessingTask = (transactionType, stagingFileId) => {
    const transactionConfig = TRANSACTION_CONFIG[transactionType];
    const taskConfig = transactionConfig && transactionConfig.task;

    if (!taskConfig) {
      return null;
    }

    const mrTask = task.create({
      taskType: task.TaskType.MAP_REDUCE,
      scriptId: taskConfig.scriptId,
      deploymentId: taskConfig.deploymentId,
      params: {
        [taskConfig.params.fileId]: stagingFileId,
        [taskConfig.params.transactionType]: transactionType,
      },
    });

    return mrTask.submit();
  };

  const redirectToStatusPage = (transactionType, taskId, stagingFileId) => {
    redirect.toSuitelet({
      scriptId: SUITELET_SCRIPT_ID,
      deploymentId: SUITELET_DEPLOYMENT_ID,
      parameters: {
        trantype: transactionType,
        taskid: taskId,
        stagingfileid: stagingFileId,
      },
    });
  };

  const handleGetRequest = (scriptContext) => {
    const { request, response } = scriptContext;
    const { parameters } = request;
    const action = parameters.action;

    if (action === ACTIONS.taskStatus) {
      try {
        writeJson(
          response,
          getCompletedTaskResult(parameters.taskid, parameters.stagingfileid),
        );
      } catch (e) {
        writeJson(response, {
          title: "Upload Failed",
          message: e.message,
          status: "FAILED",
        });
      }
      return;
    }

    if (action === ACTIONS.downloadErrorCsv) {
      if (!parameters.errorFileId) {
        writeText(response, "Missing error file.");
        return;
      }

      const errorFile = file.load({ id: parameters.errorFileId });
      const downloadFileName = (errorFile.name || "error")
        .replace(/\.(txt|json)$/i, "")
        .concat(".csv");

      writeDownloadResponse(
        response,
        csvUtils.decodeUnicodeEscapes(errorFile.getContents() || ""),
        downloadFileName,
      );
      return;
    }

    if (parameters.transactionType) {
      const transactionConfig = TRANSACTION_CONFIG[parameters.transactionType];

      if (!transactionConfig || !transactionConfig.templateFileId) {
        writeJson(response, { error: "Invalid transaction type" });
        return;
      }

      try {
        const templateFile = file.load({
          id: transactionConfig.templateFileId,
        });
        // 템플릿 파일 URL 반환 - client에 전달
        writeJson(response, { finalURL: templateFile.url });
      } catch (e) {
        writeJson(response, { error: e.message });
      }
      return;
    }

    const transactionType =
      parameters.custpage_transaction_type || parameters.trantype || "";

    log.debug("Received GET request, rendering form");

    if (parameters.taskid) {
      const taskStatus = getCompletedTaskResult(
        parameters.taskid,
        parameters.stagingfileid,
      );

      renderForm(response, {
        transactionType: transactionType,
        statusTitle: taskStatus && taskStatus.title,
        statusMessage: taskStatus && taskStatus.message,
        taskId: parameters.taskid,
        stagingFileId: parameters.stagingfileid,
        errorFileId: taskStatus && taskStatus.errorFileId,
      });
      return;
    }

    if (parameters.statusTitle || parameters.statusMessage) {
      renderForm(response, {
        transactionType: transactionType,
        statusTitle: parameters.statusTitle,
        statusMessage: parameters.statusMessage,
        errorFileId: parameters.errorFileId,
      });
      return;
    }

    renderForm(response, {});
  };

  const handlePostRequest = (scriptContext) => {
    const { request, response } = scriptContext;
    const transactionType = request.parameters.custpage_transaction_type;
    const uploadedFile = request.files.custpage_import_file;
    const transactionConfig = TRANSACTION_CONFIG[transactionType];

    log.debug("Received POST request, queueing MR");

    if (!transactionType || !uploadedFile) {
      renderForm(response, {
        transactionType: transactionType,
        statusTitle: "Upload Failed",
        statusMessage: "Missing transaction type or file.",
      });
      return;
    }

    if (!transactionConfig || !transactionConfig.templateFileId) {
      renderForm(response, {
        transactionType: transactionType,
        statusTitle: "Upload Failed",
        statusMessage: "Unsupported transaction type: " + transactionType,
      });
      return;
    }

    try {
      const templateFile = file.load({
        id: transactionConfig.templateFileId,
      });
      const stagingFileId = saveStagingFile(
        uploadedFile,
        transactionType,
        templateFile.folder,
      );

      log.debug(
        "POST request",
        "Uploaded file saved with ID: " + stagingFileId,
      );

      // Map/Reduce Task 제출
      const taskId = submitProcessingTask(transactionType, stagingFileId);
      if (!taskId) {
        renderForm(response, {
          transactionType: transactionType,
          statusTitle: "Upload Failed",
          statusMessage: "Unsupported transaction type: " + transactionType,
        });
        return;
      }

      redirectToStatusPage(transactionType, taskId, stagingFileId);
    } catch (e) {
      log.error("POST queue error", e);
      renderForm(response, {
        transactionType: transactionType,
        statusTitle: "Upload Failed",
        statusMessage: "Error processing file: " + e.message,
      });
    }
  };

  const onRequest = (scriptContext) => {
    if (scriptContext.request.method === "GET") {
      handleGetRequest(scriptContext);
    } else {
      handlePostRequest(scriptContext);
    }
  };

  return {
    onRequest: onRequest,
  };
});
