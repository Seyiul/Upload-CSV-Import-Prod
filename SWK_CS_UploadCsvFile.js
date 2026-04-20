/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(["N/log", "N/url"], function (log, url) {
  const SUITELET_SCRIPT_ID = "customscript_swk_sl_uploadcsvfile";
  const SUITELET_DEPLOYMENT_ID = "customdeploy_swk_sl_uploadcsvfile";

  const FIELD_IDS = {
    transactionType: "custpage_transaction_type",
    templateName: "custpage_template_name",
    importFile: "custpage_import_file",
    taskId: "custpage_task_id",
    stagingFileId: "custpage_staging_file_id",
  };

  const TEMPLATE_NAMES = {
    PO: "PO Template.csv",
    BILL: "Bill Template.csv",
    INVOICE: "Invoice Template.csv",
    JOURNAL: "Journal Template.csv",
  };

  const TEMPLATE_LINK_DEFAULT_TEXT = "";

  const getFieldValue = (fieldId) => {
    const field = document.getElementById(fieldId);
    return field ? field.value : "";
  };

  const resolveSuiteletUrl = (params) =>
    url.resolveScript({
      scriptId: SUITELET_SCRIPT_ID,
      deploymentId: SUITELET_DEPLOYMENT_ID,
      params: params || {},
    });

  const getTemplateName = (transactionType) =>
    TEMPLATE_NAMES[transactionType] || "Select a transaction type first";

  const ensureLoadingOverlay = () => {
    if (document.getElementById("swk-upload-loading")) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "swk-upload-loading";
    overlay.style.cssText =
      "display:none;position:fixed;inset:0;background:rgba(255,255,255,0.82);z-index:99999;align-items:center;justify-content:center;";

    overlay.innerHTML = `
      <div style="min-width:320px;padding:28px 32px;border-radius:16px;background:#ffffff;box-shadow:0 12px 40px rgba(0,0,0,0.12);text-align:center;">
        <div style="width:44px;height:44px;margin:0 auto 16px;border:4px solid #d9e2f2;border-top-color:#1f5fbf;border-radius:50%;animation:swkSpin 0.8s linear infinite;"></div>
        <div style="font-size:18px;font-weight:600;color:#1f2937;">CSV Upload In Progress</div>
        <div style="margin-top:8px;font-size:13px;color:#6b7280;">Please wait while the request is being processed.</div>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent =
      "@keyframes swkSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";

    document.head.appendChild(style);
    document.body.appendChild(overlay);
  };

  const setLoadingOverlayVisible = (visible) => {
    ensureLoadingOverlay();
    const overlay = document.getElementById("swk-upload-loading");
    if (overlay) {
      overlay.style.display = visible ? "flex" : "none";
    }
  };

  const updateTemplateLink = (templateName, templateUrl) => {
    const container = document.getElementById(
      "custpage_template_link_container",
    );
    if (!container) {
      return;
    }

    container.innerHTML = templateUrl
      ? `<a href="${templateUrl}" target="_blank">Download ${templateName}</a>`
      : "Error loading template link";
  };

  // Suitelet에서 템플릿 링크를 조회하여 업데이트
  const loadTemplateLink = (transactionType, templateName) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "GET",
      resolveSuiteletUrl({ transactionType: transactionType }),
      true,
    );

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || xhr.status !== 200) {
        return;
      }

      try {
        const response = JSON.parse(xhr.responseText);
        updateTemplateLink(templateName, response.finalURL);
      } catch (e) {
        log.debug("Client Script", "JSON parse error: " + e.message);
        updateTemplateLink(templateName, "");
      }
    };

    xhr.send();
  };

  function pageInit() {
    log.debug("Client Script", "loaded successfully");
    setLoadingOverlayVisible(false);
  }

  function fieldChanged(scriptContext) {
    if (scriptContext.fieldId !== FIELD_IDS.transactionType) {
      return;
    }

    const transactionType = scriptContext.currentRecord.getValue({
      fieldId: FIELD_IDS.transactionType,
    });
    const templateName = getTemplateName(transactionType);

    scriptContext.currentRecord.setValue({
      fieldId: FIELD_IDS.templateName,
      value: templateName,
    });

    if (!transactionType) {
      const container = document.getElementById(
        "custpage_template_link_container",
      );
      if (container) {
        container.innerHTML = TEMPLATE_LINK_DEFAULT_TEXT;
      }
      return;
    }

    loadTemplateLink(transactionType, templateName);
  }

  function saveRecord(scriptContext) {
    const transactionType = scriptContext.currentRecord.getValue({
      fieldId: FIELD_IDS.transactionType,
    });
    const fileValue = scriptContext.currentRecord.getValue({
      fieldId: FIELD_IDS.importFile,
    });

    if (transactionType && fileValue) {
      setLoadingOverlayVisible(true);
    }

    return true;
  }

  function refreshStatus() {
    const taskId = getFieldValue(FIELD_IDS.taskId);

    if (!taskId) {
      return;
    }

    setLoadingOverlayVisible(true);
    window.location.href = resolveSuiteletUrl({
      taskid: taskId,
      trantype: getFieldValue(FIELD_IDS.transactionType),
      stagingfileid: getFieldValue(FIELD_IDS.stagingFileId),
    });
  }

  return {
    pageInit,
    fieldChanged,
    saveRecord,
    refreshStatus,
  };
});
