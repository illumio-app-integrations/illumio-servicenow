ms.include("IllumioMIDConstants");

var IllumioManageAsyncJobs = Class.create();

IllumioManageAsyncJobs.prototype = {
    initialize: function() {

        // set the parameters here
        this.logger = new IllumioLogUtil();

        var url = String(ms.getConfigParameter("url"));
        if (url.charAt(url.length - 1) == '/') {
            url = url.substring(0, url.length - 1);
        }
        this.snowUrl = url;
        this.snowUsername = ms.getConfigParameter("mid.instance.username");
        this.snowPassword = ms.getConfigParameter("mid.instance.password");

        this.pceUrl = probe.getParameter('glide.jms.pce_url');
        this.pceEndpoint = probe.getParameter('glide.jms.pce_endpoint');
        this.pceAuthorization = probe.getParameter('glide.jms.pce_authorization');
        this.currentJobSysID = probe.getParameter('glide.jms.pce_async_job_sys_id') + '';
        this.pceMIDProxy = probe.getParameter('glide.jms.enable_pce_mid_proxy');

        this.timeZone = probe.getParameter('glide.jms.time_zone');
        this.SimpleDF = Packages.java.text.SimpleDateFormat;
        this.TimeZone = Packages.java.util.TimeZone;

        this.snowDateFormat = this.SimpleDF("yyyy-MM-dd HH:mm:ss");
        this.illumioDateFormat = this.SimpleDF("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

        this.snowDateFormat.setTimeZone(this.TimeZone.getTimeZone(this.timeZone));
        this.illumioDateFormat.setTimeZone(this.TimeZone.getTimeZone('UTC'));

        this.utils = new IllumioPCEUtils(this.timeZone);

        this.protocol = this.utils.getPortFromUrl(this.pceUrl);

        this.retryParams = DEFAULT_RETRY_PARAMS;
        try {
            this.retryParams = JSON.parse(probe.getParameter('glide.jms.retry_params'));
        } catch (e) {
            this.logger._except('IllumioManageAsyncJobs - Cannot parse the JSON of retry parameters');
        }

        var decodedAuth = this.utils.decodeBase64(this.pceAuthorization);
        decodedAuth = decodedAuth.split(":");
        this.pceUsername = decodedAuth[0];
        this.pcePassword = decodedAuth.slice(1).join(':');

        this.pceHttpClient = new IllumioHTTPClient(this.pceUrl, this.pceUsername, this.pcePassword, this.protocol, this.pceMIDProxy, this.retryParams);
        this.snHttpClient = new IllumioHTTPClient(this.snowUrl, this.snowUsername, this.snowPassword, "443", null, this.retryParams);
    },

    run: function() {

        this.requiredOperation = probe.getParameter('glide.jms.operation');

        // perform required async job operation
        if (this.requiredOperation == 'create_async_job') {
            this.logger._info('IllumioManageAsyncJobs --------- Creating new async job on PCE');
            this.createNewAsyncJobRequest();

        } else if (this.requiredOperation == 'get_async_job_status') {
            this.logger._info('IllumioManageAsyncJobs - Getting async job status from PCE');
            this.getAsyncJobStatus();

        } else {
            this.logger._error('IllumioManageAsyncJobs - No async operation provided.');
        }
    },

    /**
     * Start async job on PCE
     * @return {Boolean} whether async job was created successfully or not.
     */
    createNewAsyncJobRequest: function() {

        try {
            // Required header to indicate async job
            var headers = {
                Prefer: 'respond-async'
            };

            // getting all workloads
            var response = this.pceHttpClient.get(this.pceEndpoint, '', headers);

            if (response.hasError) {
                this.logger._error("Failed to create async job on PCE.");
                this.handleException("Failed to create async job on PCE, Please check MID server logs for more details");
                return false;
            }

            var responseHeaders = response.headers;
            for (var key in responseHeaders) {
                responseHeaders[key.toLowerCase()] = responseHeaders[key];
            }
            // Async job data to be stored in Async Jobs table
            var payload = {
                job_location: responseHeaders.location,
                job_status: 'new',
                retry_interval: responseHeaders['retry-after'],
                mapping_table_name: probe.getParameter('glide.jms.mapping_table_name'),
                result_table_name: probe.getParameter('glide.jms.result_table_name'),
                keys_to_map: probe.getParameter('glide.jms.keys_to_map'),
                primary_key_to_map: probe.getParameter('glide.jms.primary_key_to_map'),
                illumio_job_id: probe.getParameter('glide.jms.illumio_scheduled_job_id'),
                job_identifier: probe.getParameter('glide.jms.job_identifier')
            };

            /*var post = */
            var endpoint = TABLE_API + ASYNC_JOB_TABLE;
            response = this.snHttpClient.post(endpoint, '', null, payload);

            if (response.hasError) {
                this.logger._error("Failed to create async job on SNOW, Response Code: " + response.status);
                this.handleException("Failed to create async job on SNOW, Please check MID server logs for more details.");
                return false;
            }

        } catch (exception) {

            this.logger._except('IllumioManageAsyncJobs - Exception occurred while creating async job on PCE. Exception: ' + exception);

            this.handleException('Exception occurred while creating async job on PCE. Exception: ' + exception);
        }

    },

    /**
     * Get status of async job running on PCE
     * @return {Boolean} whether status was successful or not.
     */
    getAsyncJobStatus: function() {

        try {
            var jobStatus = 'failed';
            var resultUrl = '';
            var isResultsAvailable = false;
            var response = this.pceHttpClient.get(this.pceEndpoint, '');

            if (response.hasError) {
                this.logger._error('Exception occurred while getting async job status from PCE, Response Code: ' + response.status);
                this.handleException('Exception occurred while getting async job status from PCE, Please check MID server logs for more details.');
                return false;
            }
            jobStatus = response.data.status.toLowerCase();
            this.logger._debug('IllumioManageAsyncJobs - Job status: ' + jobStatus);

            // If job status is done, get result's href
            if (jobStatus == 'done') {

                resultUrl = response.data.result.href;

                if (!resultUrl) {
                    this.logger._error('IllumioManageAsyncJobs - Job completed but datafiles url is not present in response. Setting job status to failed.');
                    jobStatus = 'failed';
                } else {
                    isResultsAvailable = this.getAsyncJobResults(resultUrl);
                }
            }

            // Results are available and stored in mapping tables
            // Set status to 'ready_to_map' to indicate getting CMDB servers and map with PCE data
            if (isResultsAvailable) {
                jobStatus = 'ready_to_map';
            }

            var payload = {
                job_status: jobStatus,
                job_result_location: resultUrl,
                retry_count: parseInt(probe.getParameter('glide.jms.retry_count')) + 1
            };

            var endpoint = TABLE_API + ASYNC_JOB_TABLE + "/" + this.currentJobSysID;
            response = this.snHttpClient.put(endpoint, '', null, payload);

            if (response.hasError) {
                this.logger._error('Exception occurred while updating async job status in SNOW, Response Code: ' + response.status);
                this.handleException('Exception occurred while updating async job status on SNOW, Please check MID server logs for more details.');
                return false;
            }

        } catch (exception) {

            this.logger._except('IllumioManageAsyncJobs - Exception occurred while getting async job status from PCE. Exception: ' + exception);

            this.handleException('Exception occurred while getting async job status from PCE. Exception: ' + exception);
        }
    },

    /**
     * Get results of async jobs from result location
     * @param {String} resultsLocation location of the result.
     * @return {Boolean} whether request was successful or not.
     */
    getAsyncJobResults: function(resultsLocation) {

        try {
            this.logger._info('IllumioManageAsyncJobs - Getting async job results');

            var response = this.pceHttpClient.get('/api/v2' + resultsLocation, '');

            if (response.hasError) {
                this.logger._error('No results received from PCE for current async job, Response status: ' + response.status);
                this.handleException('No results received from PCE for current async job, Please check MID server logs for more details.');
                return false;
            }

            // Required keys
            var resultTable = probe.getParameter('glide.jms.result_table_name');
            var job_identifier = probe.getParameter('glide.jms.job_identifier');
            var keysToMap = JSON.parse(probe.getParameter('glide.jms.keys_to_map'));
            var scheduled_job_id = probe.getParameter('glide.jms.illumio_scheduled_job_id');
            var primaryKey = probe.getParameter('glide.jms.primary_key');

            if (!resultTable || !keysToMap || !primaryKey) {
                this.logger._error('IllumioManageAsyncJobs - Missing result table or columns of result table or primary key. Setting job status to failed.');
                this.handleException('Missing result table or columns of result table or primary key. Setting job status to failed');
                return false;
            }

            if (!Array.isArray(response.data)) {
                this.logger._error('IllumioManageAsyncJobs - Invalid data.');
                this.handleException('Invalid data format received. Setting job status to failed');
                return false;
            }
            // Data will be array of objects

            var resultData = [];
            response.data = JSON.parse(JSON.stringify(response.data));
            response.data.map(function(resultObj) {

                if (resultObj[primaryKey]) {
                    var requredDataObj = {};
                    keysToMap.map(function(key) {
                        if (key == 'agent') {
                            var agent = resultObj[key];
                            if (agent['href'])
                                requredDataObj[key] = true;
                            else
                                requredDataObj[key] = false;
                        } else if (key == "interfaces") {
                            var interfaceRequiredFields = [];
                            var interfaceLength = resultObj[key].length;
                            for (var indexForInterface = 0; indexForInterface < interfaceLength; indexForInterface++) {
                                var IPObject = {};
                                IPObject["name"] = resultObj[key][indexForInterface].name;
                                IPObject["address"] = resultObj[key][indexForInterface].address;
                                interfaceRequiredFields.push(IPObject);
                            }
                            requredDataObj[key] = JSON.stringify(interfaceRequiredFields);

                        } else {
                            requredDataObj[key] = typeof resultObj[key] == 'object' ? JSON.stringify(resultObj[key]) : resultObj[key] + "";
                        }
                    });
                    resultData.push(requredDataObj);
                }
            });

            this.logger._debug('IllumioManageAsyncJobs - Total records : ' + resultData.length);

            var jobContent = {
                logs: 'Total ' + job_identifier + ' fetched : ' + resultData.length
            };
            this._updateJobRecord(scheduled_job_id, jobContent);

            var mappingGR = new GlideRecord(resultTable);
            mappingGR.initialize();
            mappingGR.setValue("json_data", JSON.stringify(resultData));
            if (!mappingGR.insert()) {
                this.logger._error("Cannot insert the data in staging table");
                this.handleException('Exception occurred while posting results to SNOW, Please check MID server logs for more details.');
                return false;
            }

            this.logger._info('IllumioManageAsyncJobs - Posted all records to SNOW');
            return true;

        } catch (exception) {

            this.logger._except('IllumioManageAsyncJobs - Exception occurred while getting async job results. Exception: ' + exception);

            this.handleException('Exception occurred while getting async job results. Exception: ' + exception);
            return false;
        }
    },

    /**
     * Handles exception by logging and setting job status as failed
     * @param {String} exception thrown by methods.
     */
    handleException: function(exception) {

        payload = {
            job_status: 'failed'
        };
        this.snHttpClient.put(TABLE_API + ASYNC_JOB_TABLE + "/" + this.jobId, '', null, payload);

        var illumio_job_id = probe.getParameter('glide.jms.illumio_scheduled_job_id');
        if (illumio_job_id) {
            var payload = {
                job_status: 'failed',
                logs: exception,
                job_completed: this.snowDateFormat.format(new Date()) + ""
            };
            this._updateJobRecord(illumio_job_id, payload);
        }
    },

    /**
     * Updates scheduled job record with given parameters
     * 
     * @param {String} jobId sys_id of the job record
     * @param {String} content of job
     * 
     */
    _updateJobRecord: function(jobSysId, jobContent) {

        var jobGr = new GlideRecord('x_illu2_illumio_illumio_scheduled_jobs');
        if (jobGr.get(jobSysId)) {
            // Update only if job is not invalidated
            if (jobGr.job_status != 'failed') {
                for (var key in jobContent) {
                    if (jobContent.hasOwnProperty(key)) {
                        if (key != "logs") {
                            jobGr[key] = jobContent[key];
                        } else {
                            jobGr[key] += '\n' + "[" + this.illumioDateFormat.format(new Date()) + "] " + jobContent[key];
                        }
                    }
                }
                jobGr.update();
            } else {
                this.logger._info('[_updateJobRecord] Given job is invalidated. Aborting further actions.');
            }
        } else {
            this.logger._error('[_updateJobRecord] Data sync job record for given sys_id (' + jobSysId + ') does not exist.');
        }
    },



    type: "IllumioUpdateKnownWorkloads"
};