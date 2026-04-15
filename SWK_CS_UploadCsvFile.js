/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(["N/log", "N/url"], function (log, url) {
  function ensureLoadingOverlay() {
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
  }

  function showLoadingOverlay() {
    ensureLoadingOverlay();
    const overlay = document.getElementById("swk-upload-loading");
    if (overlay) {
      overlay.style.display = "flex";
    }
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById("swk-upload-loading");
    if (overlay) {
      overlay.style.display = "none";
    }
  }

  function pageInit() {
    log.debug("Client Script", "loaded successfully");
    ensureLoadingOverlay();
    hideLoadingOverlay();
  }

  function fieldChanged(scriptContext) {
    if (scriptContext.fieldId !== "custpage_transaction_type") {
      return;
    }

    const transactionType = scriptContext.currentRecord.getValue({
      fieldId: "custpage_transaction_type",
    });

    let templateName = "Select a transaction type first";
    if (transactionType === "PO") {
      templateName = "PO Template.csv";
    } else if (transactionType === "BILL") {
      templateName = "Bill Template.csv";
    } else if (transactionType === "INVOICE") {
      templateName = "Invoice Template.csv";
    } else if (transactionType === "JOURNAL") {
      templateName = "Journal Template.csv";
    }

    scriptContext.currentRecord.setValue({
      fieldId: "custpage_template_name",
      value: templateName,
    });

    const container = document.getElementById("custpage_template_link_container");
    if (!transactionType) {
      if (container) {
        container.innerHTML = "Template link will appear after selection";
      }
      return;
    }

    const suiteletURL = url.resolveScript({
      scriptId: "customscript_swk_sl_uploadcsvfile",
      deploymentId: "customdeploy_swk_sl_uploadcsvfile",
      params: { transactionType: transactionType },
    });

    const xhr = new XMLHttpRequest();
    xhr.open("GET", suiteletURL, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || xhr.status !== 200) {
        return;
      }

      try {
        const response = JSON.parse(xhr.responseText);
        if (container) {
          container.innerHTML = response.finalURL
            ? `<a href="${response.finalURL}" target="_blank">Download ${templateName}</a>`
            : "Error loading template link";
        }
      } catch (e) {
        log.debug("Client Script", "JSON parse error: " + e.message);
      }
    };
    xhr.send();
  }

  function saveRecord(scriptContext) {
    const transactionType = scriptContext.currentRecord.getValue({
      fieldId: "custpage_transaction_type",
    });
    const fileValue = scriptContext.currentRecord.getValue({
      fieldId: "custpage_import_file",
    });

    if (transactionType && fileValue) {
      showLoadingOverlay();
    }

    return true;
  }

  function refreshStatus() {
    const taskField = document.getElementById("custpage_task_id");
    const taskId = taskField ? taskField.value : "";
    const stagingField = document.getElementById("custpage_staging_file_id");
    const stagingFileId = stagingField ? stagingField.value : "";
    const tranTypeField = document.getElementById("custpage_transaction_type");
    const transactionType = tranTypeField ? tranTypeField.value : "";

    if (!taskId) {
      return;
    }

    showLoadingOverlay();
    window.location.href = url.resolveScript({
      scriptId: "customscript_swk_sl_uploadcsvfile",
      deploymentId: "customdeploy_swk_sl_uploadcsvfile",
      params: {
        taskid: taskId,
        trantype: transactionType,
        stagingfileid: stagingFileId,
      },
    });
  }

  return {
    pageInit: pageInit,
    fieldChanged: fieldChanged,
    saveRecord: saveRecord,
    refreshStatus: refreshStatus,
  };
});
