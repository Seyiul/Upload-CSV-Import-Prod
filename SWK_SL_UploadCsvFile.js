/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * Description : CSV 파일 업로드를 처리하는 Suitelet 스크립트로, 사용자가 CSV 파일을 업로드하면 해당 파일을 NetSuite의 File Cabinet에 저장하고, Map/Reduce 스크립트를 통해 데이터를 처리하여  레코드를 생성
 * 
 *  * Version  Date          Author           Remarks
 * -------  ------------    --------------    --------------------------------------
 * 1.00     2026-04-13      Seulyi            Initial development

 */
define([
  "N/ui/serverWidget",
  "N/log",
  "N/file",
  "N/task",
  "N/search",
  "N/redirect",
  "./SWK_Utils_UploadCsvFiles",
], (serverWidget, log, file, task, search, redirect, csvUtils) => {
  // 템플릿 파일 ID 매핑
  const TEMPLATE_FILE_IDS = {
    PO: 16682,
    BILL: 16680,
    INVOICE: 16681,
    JOURNAL: 16683,
  };

  // Map/Reduce 스크립트 ID 및 파라미터 이름 정의
  const MR_BILL_SCRIPT_ID = "customscript_swk_mr_processcsvbill";
  const MR_BILL_DEPLOYMENT_ID = "customdeploy_swk_mr_processcsvbill";

  const MR_JOURNAL_SCRIPT_ID = "customscript_swk_mr_processcsvjournal";
  const MR_JOURNAL_DEPLOYMENT_ID = "customdeploy_swk_mr_processcsvjournal";

  const CSV_FILE_ID_PARAM = "custscript_swk_csv_file_id";
  const TRANSACTION_TYPE_PARAM = "custscript_swk_csv_tran_type";
  const CSV_FILE_ID_PARAM_JN = "custscript_swk_csv_file_id_jn";
  const TRANSACTION_TYPE_PARAM_JN = "custscript_swk_csv_tran_type_jn";

  const RESULT_SUMMARY_PREFIX = "swk_mr_summary_";
  /**
   * form 빌드 함수 - 업로드 폼과 상태 메시지 패널을 생성
   */
  const buildForm = (
    transactionType,
    statusTitle,
    statusMessage,
    taskId,
    stagingFileId,
    errorFileUrl,
  ) => {
    const form = serverWidget.createForm({
      title: "Upload CSV File",
    });

    // 템플릿 다운로드 그룹
    form.addFieldGroup({
      id: "custpage_group_template_download",
      label: "Template Download",
    });

    // 업로드 옵션 그룹
    form.addFieldGroup({
      id: "custpage_group_upload_options",
      label: "Upload Options",
    });

    // 업로드 상태 그룹
    form.addFieldGroup({
      id: "custpage_group_upload_status",
      label: "Upload Status",
    });

    // CSV 파일 업로드 필드 START
    const fileFieldTopSpacing = form.addField({
      id: "custpage_file_upload_top_spacing",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });
    fileFieldTopSpacing.defaultValue = '<div style="margin-top:12px;"></div>';
    fileFieldTopSpacing.updateLayoutType({
      layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE,
    });

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

    const fileFieldBottomSpacing = form.addField({
      id: "custpage_file_upload_bottom_spacing",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });
    fileFieldBottomSpacing.defaultValue =
      '<div style="margin-bottom:12px;"></div>';
    fileFieldBottomSpacing.updateLayoutType({
      layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE,
    });

    // CSV 파일 업로드 필드 END

    // 템플릿 이름 필드 (선택된 트랜잭션 유형에 따라 업데이트)
    const templateNameField = form.addField({
      id: "custpage_template_name",
      type: serverWidget.FieldType.TEXT,
      label: "Template",
      container: "custpage_group_template_download",
    });
    templateNameField.defaultValue = "Select a transaction type first";
    templateNameField.updateDisplayType({
      displayType: serverWidget.FieldDisplayType.INLINE,
    });

    // 템플릿 다운로드 링크 필드
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

    // 트랜재션 유형 선택 필드
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
    transactionTypeField.addSelectOption({ value: "PO", text: "PO" });
    transactionTypeField.addSelectOption({ value: "BILL", text: "Bill" });
    transactionTypeField.addSelectOption({
      value: "INVOICE",
      text: "Invoice",
    });
    transactionTypeField.addSelectOption({
      value: "JOURNAL",
      text: "Journal",
    });

    if (transactionType) {
      transactionTypeField.defaultValue = transactionType;
      const templateNames = {
        PO: "PO Template.csv",
        BILL: "Bill Template.csv",
        INVOICE: "Invoice Template.csv",
        JOURNAL: "Journal Template.csv",
      };
      templateNameField.defaultValue = templateNames[transactionType] || "";
    }

    // Map/Reduce 작업 관련 필드 START
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

    // 새로고침 버튼 - Map/Reduce 작업이 진행 중일 때 상태를 새로고침할 수 있도록 함
    if (taskId) {
      form.addButton({
        id: "custpage_refresh_status",
        label: "Refresh Status",
        functionName: "refreshStatus",
      });
    }

    // 상태 메시지 필드 - 업로드 결과/진행상태
    const statusField = form.addField({
      id: "custpage_result_html",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
      container: "custpage_group_upload_status",
    });

    if (statusTitle && statusMessage) {
      statusField.defaultValue = `
        <div id="swk-status-panel" style="margin-top:12px;border:1px solid #dbe4f0;border-radius:14px;background:#ffffff;padding:18px 20px;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
          <div style="font-size:18px;font-weight:600;color:#0f172a;margin-bottom:8px;">${csvUtils.escapeHtml(statusTitle)}</div>
          <div style="font-size:14px;line-height:1.6;color:#475569;white-space:pre-wrap;">${csvUtils.escapeHtml(statusMessage)}</div>
          ${
            errorFileUrl
              ? `<div style="margin-top:14px;"><a href="${csvUtils.escapeHtml(errorFileUrl)}" target="_blank" style="color:#1d4ed8;font-weight:600;text-decoration:none;">Download Error CSV</a></div>`
              : ""
          }
        </div>
      `;
    } else {
      statusField.defaultValue = `<div id="swk-status-panel"></div>`;
    }

    // Map/Reduce 작업 관련 필드 END

    form.addSubmitButton({
      label: "Submit",
    });

    form.clientScriptModulePath = "./SWK_CS_UploadCsvFile.js";
    return form;
  };

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

  // 파일캐비넷에서 Map/Reduce 작업 결과 요약 파일 검색
  const getSummaryFile = (stagingFileId) => {
    if (!stagingFileId) {
      return null;
    }

    const summaryName = `${RESULT_SUMMARY_PREFIX}${stagingFileId}.json`;
    const result = search
      .create({
        type: "file",
        filters: [["name", "is", summaryName]],
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
    const errorFile = summary.errorFileId
      ? file.load({ id: summary.errorFileId })
      : null;
    let message =
      `Status: ${taskStatus.status}\n` +
      `Success: ${summary.successCount || 0}\n` +
      `Errors: ${summary.errorCount || 0}`;

    log.debug(
      "getCompletedTaskResult",
      "Task completed with summary: " + JSON.stringify(summary),
    );

    return {
      title:
        summary.errorCount > 0
          ? "Upload Completed With Errors"
          : "Upload Completed",
      message: message,
      status: taskStatus.status,
      errorFileUrl: errorFile ? errorFile.url : "",
      successCount: summary.successCount || 0,
      errorCount: summary.errorCount || 0,
    };
  };

  /**
   * GET 요청 처리 - 업로드 폼 렌더링, 템플릿 URL 반환, 작업 상태 조회 등
   */
  const handleGetRequest = (scriptContext) => {
    const action = scriptContext.request.parameters.action;

    // 작업 상태 조회
    if (action === "taskstatus") {
      try {
        const taskStatus = getCompletedTaskResult(
          scriptContext.request.parameters.taskid,
          scriptContext.request.parameters.stagingfileid,
        );
        scriptContext.response.write({
          output: JSON.stringify(taskStatus || {}),
        });
      } catch (e) {
        scriptContext.response.write({
          output: JSON.stringify({
            title: "Upload Failed",
            message: e.message,
            status: "FAILED",
          }),
        });
      }
      return;
    }

    // 템플릿 URL 반환
    const transactionType = scriptContext.request.parameters.transactionType;
    if (transactionType) {
      log.debug(
        "Processing URL request for transaction type: " + transactionType,
      );
      const fileId = TEMPLATE_FILE_IDS[transactionType];
      if (fileId) {
        try {
          const loadFile = file.load({ id: fileId });
          scriptContext.response.write({
            output: JSON.stringify({ finalURL: loadFile.url }),
          });
        } catch (e) {
          scriptContext.response.write({
            output: JSON.stringify({ error: e.message }),
          });
        }
      } else {
        scriptContext.response.write({
          output: JSON.stringify({ error: "Invalid transaction type" }),
        });
      }
      return;
    }

    // 기본 GET 요청 - status 메시지 또는 업로드 폼 렌더링
    const statusTaskId = scriptContext.request.parameters.taskid;
    const statusTransactionType =
      scriptContext.request.parameters.custpage_transaction_type ||
      scriptContext.request.parameters.trantype ||
      "";
    const statusTitle = scriptContext.request.parameters.statusTitle;
    const statusMessage = scriptContext.request.parameters.statusMessage;

    log.debug("Received GET request, rendering form");

    if (statusTaskId) {
      const taskStatus = getCompletedTaskResult(
        statusTaskId,
        scriptContext.request.parameters.stagingfileid,
      );
      scriptContext.response.writePage(
        buildForm(
          statusTransactionType,
          taskStatus.title,
          taskStatus.message,
          statusTaskId,
          scriptContext.request.parameters.stagingfileid,
          taskStatus.errorFileUrl,
        ),
      );
      return;
    }

    if (statusTitle || statusMessage) {
      scriptContext.response.writePage(
        buildForm(
          statusTransactionType,
          statusTitle,
          statusMessage,
          null,
          null,
          scriptContext.request.parameters.errorFileUrl,
        ),
      );
      return;
    }

    scriptContext.response.writePage(
      buildForm(null, null, null, null, null, null),
    );
  };

  /**
   * POST 요청 처리 - CSV 파일 업로드, Map/Reduce 작업 큐잉, 결과 페이지로 리디렉션 등
   */
  const handlePostRequest = (scriptContext) => {
    log.debug("Received POST request, queueing MR");

    const reqTransactionType =
      scriptContext.request.parameters.custpage_transaction_type;
    const uploadedFile = scriptContext.request.files["custpage_import_file"];

    if (!reqTransactionType || !uploadedFile) {
      scriptContext.response.writePage(
        buildForm(
          reqTransactionType,
          "Upload Failed",
          "Missing transaction type or file.",
          null,
          null,
          null,
        ),
      );
      return;
    }

    try {
      const templateFile = file.load({
        id: TEMPLATE_FILE_IDS[reqTransactionType],
      });

      // CSV 파일 내용 읽어오기 (BOM 제거 포함)
      uploadedFile.encoding = file.Encoding.UTF8;
      const csvContents = uploadedFile.getContents().replace(/^\uFEFF/, "");
      log.debug("Uploaded CSV preview", csvContents);
      const lines = csvContents
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "");

      // CSV 파일 파싱 - 첫 줄은 헤더로 사용, 나머지는 데이터로 처리하여 Map/Reduce 스크립트에 전달할 JSON 형태로 변환
      const headers = lines.length > 0 ? csvUtils.parseCsvLine(lines[0]) : [];
      const stagingRows = [];

      for (let i = 1; i < lines.length; i += 1) {
        const values = csvUtils.parseCsvLine(lines[i]);
        const rowData = {};

        for (let j = 0; j < headers.length; j += 1) {
          rowData[headers[j]] = values[j] || "";
        }

        stagingRows.push({
          lineNumber: i + 1,
          transactionType: reqTransactionType,
          rowData: rowData,
        });
      }

      log.debug(
        "First staging row before save",
        JSON.stringify(stagingRows[0] || {}),
      );

      // JSON 형태로 변환된 데이터를 File Cabinet에 임시 파일로 저장하고, 해당 파일 ID를 Map/Reduce 스크립트에 전달하여 처리
      const stagingFile = file.create({
        name:
          (uploadedFile.name || `upload_${Date.now()}`).replace(/\.csv$/i, "") +
          ".json",
        fileType: file.Type.PLAINTEXT,
        contents: JSON.stringify(stagingRows).replace(
          /[^\x00-\x7F]/g,
          (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
        ),
        folder: templateFile.folder,
      });

      log.debug("First row data", JSON.stringify(stagingRows[0] || {}));
      log.debug(
        "JSON before save",
        JSON.stringify(stagingRows).substring(0, 500),
      );

      const fileId = stagingFile.save();

      if (reqTransactionType === "BILL") {
        log.debug("POST request", "Uploaded file saved with ID: " + fileId);

        // Map/Reduce 작업 (BILL 처리) 큐잉
        const mrTask = task.create({
          taskType: task.TaskType.MAP_REDUCE,
          scriptId: MR_BILL_SCRIPT_ID,
          deploymentId: MR_BILL_DEPLOYMENT_ID,
          params: {
            [CSV_FILE_ID_PARAM]: fileId,
            [TRANSACTION_TYPE_PARAM]: reqTransactionType,
          },
        });

        const taskId = mrTask.submit();

        redirect.toSuitelet({
          scriptId: "customscript_swk_sl_uploadcsvfile",
          deploymentId: "customdeploy_swk_sl_uploadcsvfile",
          parameters: {
            trantype: reqTransactionType,
            taskid: taskId,
            stagingfileid: fileId,
          },
        });
        return;
      } else if (reqTransactionType === "JOURNAL") {
        // Map/Reduce 작업 (JOURNAL 처리) 큐잉
        const mrTask = task.create({
          taskType: task.TaskType.MAP_REDUCE,
          scriptId: MR_JOURNAL_SCRIPT_ID,
          deploymentId: MR_JOURNAL_DEPLOYMENT_ID,
          params: {
            [CSV_FILE_ID_PARAM_JN]: fileId,
            [TRANSACTION_TYPE_PARAM_JN]: reqTransactionType,
          },
        });

        const taskId = mrTask.submit();

        redirect.toSuitelet({
          scriptId: "customscript_swk_sl_uploadcsvfile",
          deploymentId: "customdeploy_swk_sl_uploadcsvfile",
          parameters: {
            trantype: reqTransactionType,
            taskid: taskId,
            stagingfileid: fileId,
          },
        });
        return;
      }

      // 지원되지 않는 트랜잭션 유형인 경우 에러 메시지 표시
      scriptContext.response.writePage(
        buildForm(
          reqTransactionType,
          "Upload Failed",
          "Unsupported transaction type: " + reqTransactionType,
          null,
          null,
          null,
        ),
      );
    } catch (e) {
      log.error("POST queue error", e);
      scriptContext.response.writePage(
        buildForm(
          reqTransactionType,
          "Upload Failed",
          "Error processing file: " + e.message,
          null,
          null,
          null,
        ),
      );
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
