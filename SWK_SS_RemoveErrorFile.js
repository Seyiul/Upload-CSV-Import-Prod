/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(["N/search", "N/file", "N/log", "N/runtime"], (
  search,
  file,
  log,
  runtime,
) => {
  /**
   * Defines the Scheduled script trigger point.
   * @param {Object} scriptContext
   * @param {string} scriptContext.type - Script execution context. Use values from the scriptContext.InvocationType enum.
   * @since 2015.2
   */

  const SAVEDSEARCH_ID = "custscript_swk_errorlog_folder_id";
  const execute = (scriptContext) => {
    try {
      log.audit({
        title: "start:removeErrorFile",
        details: "Delete Error Log - CSV FILE UPLOAD",
      });

      const SEARCH_ID = runtime.getCurrentScript().getParameter({
        name: SAVEDSEARCH_ID,
      });

      const fileSearch = search.load({
        id: SEARCH_ID,
      });

      fileSearch.run().each((result) => {
        try {
          const fileId = result.getValue("internalid");
          const fileName = result.getValue("name");

          file.delete({
            id: fileId,
          });

          log.audit("DELETED", `${fileName} (${fileId})`);

          return true;
        } catch (e) {
          log.error("Delete Error", e);
          return true;
        }
      });
    } catch (e) {
      log.error("SCRIPT_ERROR", e);
    }
  };

  return { execute };
});
