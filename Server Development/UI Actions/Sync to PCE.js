function doSyncWithPCEAdd() {
    var dialog;
    var gaCustomTableData,
        answer,
        sys_id = [],
        checkedRecordsSysID = [];

    var userFirstName = g_user.firstName;
    var userLastName = g_user.lastName;
    var userName = userFirstName + " " + userLastName;

    // Get the required values from the form

    sys_id = g_form.getUniqueValue();

    var loadingDialog = new GlideModal();
    loadingDialog.setTitle("Starting sync process");
    loadingDialog.setWidth(400);
    loadingDialog.renderWithContent(
        '<html><body><div class="row loading-container" id="loadingDialog"><label style="font-size: medium;">Validating Sync process...</label><br /><div class="loading-indicator icon-loading icon-lg"></div></div></html>'
    );

    gaCustomTableData = new GlideAjax("GetLabelGroupsAjax");
    gaCustomTableData.addParam("sysparm_name", "fetchCriticalLabels");
    gaCustomTableData.getXML(gaParseResponse);

    function gaParseResponse() {
        getLabelGroups();
    }

    function getLabelGroups() {
        gaCustomTableData = new GlideAjax("GetLabelGroupsAjax");
        gaCustomTableData.addParam("sysparm_name", "fetchLabelsForLabelGroups");
        gaCustomTableData.addParam("sysparm_sys_ids", JSON.stringify(sys_id));
        gaCustomTableData.getXML(gaParseLResponse);

        /**
         * Callback function for AJAX call to IllumioGetCustomTableRecord
         */
        function gaParseLResponse(response) {
            answer = response.responseXML.documentElement.getAttribute("answer");

            answer = JSON.parse(answer);
            checkedRecordsSysID = answer;
            getCustomtableRecord();
        }
    }

    function getCustomtableRecord() {
        loadingDialog.destroy();

        var snowApp = g_form.getValue("select_application").trim() || "";
        var snowEnv = g_form.getValue("select_environment").trim() || "";
        var snowLoc = g_form.getValue("select_location").trim() || "";
        var snowRole = g_form.getValue("select_role").trim() || "";
        var snowIP = g_form.getValue("select_ip_address").trim();

        var hostname = g_form.getValue("hostname");
        var add_ip_address =
            g_form.getValue("add_ip_address") === "true" ? true : false;
        if (add_ip_address && snowIP == "") {
            dialog = new GlideDialogWindow("x_illu2_illumio_IllumioInfoPopup");
            dialog.setTitle("Cannot sync empty IP Address on PCE.");
            dialog.render();
            return;
        }

        if (checkedRecordsSysID.length == 0) {
            dialog = new GlideDialogWindow("x_illu2_illumio_IllumioInfoPopup");
            dialog.setTitle("Cannot sync a workload that has a critical label.");
            dialog.render();
            return;
        }
        /**
         * Create the workload object.
         */
        var payload = {
            hostname: hostname,
            sys_id: g_form.getUniqueValue(),
            labels: [],
            createlabels: [],
            updateFields: [],
        };

        var labelsToFetch = {};

        var labelApp = snowApp;
        var labelLoc = snowLoc;
        var labelEnv = snowEnv;
        var labelRole = snowRole;

        if (labelApp) labelsToFetch["app"] = labelApp;
        if (labelLoc) labelsToFetch["loc"] = labelLoc;
        if (labelEnv) labelsToFetch["env"] = labelEnv;
        if (labelRole) labelsToFetch["role"] = labelRole;
        if (add_ip_address) {
            if (snowIP) {
                payload.ip_address = snowIP;
            }

            var snowIP2 = g_form.getValue("select_ip_address_2").trim();
            if (snowIP2) {
                payload.umw1 = snowIP2;
            }

            var snowIP3 = g_form.getValue("select_ip_address_3").trim();
            if (snowIP3) {
                payload.umw2 = snowIP3;
            }
            
            var snowIP4 = g_form.getValue("select_ip_address_4").trim();
            if (snowIP4) {
                payload.umw3 = snowIP4;
            }
            
            var snowIP5 = g_form.getValue("select_ip_address_5").trim();
            if (snowIP5) {
                payload.umw4 = snowIP5;
            }
            
            var snowIP6 = g_form.getValue("select_ip_address_6").trim();
            if (snowIP6) {
                payload.umw5 = snowIP6;
            }

        }

        var ga_labels = new GlideAjax("IllumioPrepareWorkload");
        ga_labels.addParam("sysparm_name", "getHrefs");
        ga_labels.addParam("sysparm_labels_to_map", JSON.stringify(labelsToFetch));
        ga_labels.addParam("sysparm_workload", JSON.stringify(payload));

        ga_labels.getXML(function(response) {
            gaParseLabelsResponse(response);
        });

        /**
         * Fetch the label details and send the workload object to server script
         */
        function gaParseLabelsResponse(response) {
            var jobSysId;
            var answer_raw = JSON.parse(
                response.responseXML.documentElement.getAttribute("answer")
            );

            answer = answer_raw.retVal;
            var instanceURL = answer_raw.instanceURL;

            var workload_object = {
                hostname: answer_raw.workload.hostname,
                ip_address: answer_raw.workload.ip_address,
                sys_id: answer_raw.workload.sys_id,
                labels: [],
                createlabels: [],
            };

            if (answer_raw.workload.umw1) {
                workload_object.umw1 = answer_raw.workload.umw1;
            }
            if (answer_raw.workload.umw2) {
                workload_object.umw2 = answer_raw.workload.umw2;
            }
            if (answer_raw.workload.umw3) {
                workload_object.umw3 = answer_raw.workload.umw3;
            }
            if (answer_raw.workload.umw4) {
                workload_object.umw4 = answer_raw.workload.umw4;
            }
            if (answer_raw.workload.umw5) {
                workload_object.umw5 = answer_raw.workload.umw5;
            }

            // Filter the successful responses and append them to label and rest to createlabel list
            for (var lr = 0; lr < answer.length; lr++) {
                var label_response = answer[lr];
                if (label_response.status == "success") {
                    workload_object.labels.push({
                        href: label_response["href"],
                    });
                } else if (label_response.status == "failed" && label_response.value) {
                    workload_object.createlabels.push({
                        key: label_response.key,
                        value: label_response.value,
                    });
                }
            }
            workload_object["description"] =
                "Created by " +
                userName +
                " [" + instanceURL + "] at " +
                new Date().toLocaleString();

            var managed_workload = [workload_object];

            // Create scheduled job for adding unknown workload to PCE
            var createJob = new GlideAjax("IllumioManageJobs");
            createJob.addParam("sysparm_name", "createScheduledJob");
            createJob.addParam("sysparm_job_status", "running");
            createJob.addParam("sysparm_type_flag", "false");
            createJob.addParam(
                "sysparm_current_operation",
                "Creating " + workload_object.hostname + " workload on PCE"
            );
            createJob.addParam(
                "sysparm_logs",
                "Creating " + workload_object.hostname + " workload on PCE"
            );
            createJob.addParam("sysparm_job_type", "data sync");
            createJob.getXML(gaGetJobSysID);

            function gaGetJobSysID(response1) {
                jobSysId = response1.responseXML.documentElement.getAttribute("answer");

                // Check if sceduled job is created or not
                if (jobSysId == null) {
                    dialog = new GlideDialogWindow("x_illu2_illumio_IllumioInfoPopup");
                    dialog.setTitle(
                        "Can not start data sync process as there is another job in running state."
                    );
                    dialog.render();
                } else {
                    // Make the AJAX call to the server script that will push the job to ECC queue
                    var ga_update;
                    ga_update = new GlideAjax("IllumioUpdatePCE");
                    ga_update.addParam("sysparm_name", "action");
                    ga_update.addParam("sysparm_operation", "create");
                    ga_update.addParam("sysparm_custom_record_sys_id", g_form.getUniqueValue());
                    ga_update.addParam("sysparm_jobSysId", jobSysId);
                    ga_update.addParam("sysparm_payload", JSON.stringify(managed_workload));
                    ga_update.getXML();
                    dialog = new GlideDialogWindow("x_illu2_illumio_IllumioInfoPopup");
                    dialog.setTitle("Sync process started.");
                    dialog.render();
                }
            }
        }
    }
}