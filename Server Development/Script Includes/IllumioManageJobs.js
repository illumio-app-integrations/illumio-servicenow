var IllumioManageJobs = Class.create();
IllumioManageJobs.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {

    /* 
     * Check jobs status and create new scheduled job for data syncing
     * @return {String} sysId of scheduled job.
     */
    createScheduledJob: function () {
        var userName = gs.getUser().getID();
        var count = 0, logs = '', job_type = '';
        var scheduledJobGr = new GlideRecord('x_illu2_illumio_illumio_scheduled_jobs');
        scheduledJobGr.initialize();

        /* Check if any data collection is already in running state */
        var runningJobsCount = new GlideAggregate("x_illu2_illumio_illumio_scheduled_jobs");
        var queryString = 'job_type=data collection^job_status=running';
        runningJobsCount.addEncodedQuery(queryString);
        runningJobsCount.addAggregate('COUNT');
        runningJobsCount.query();
        if (runningJobsCount.next()) {
            scheduledJobGr.job_owner = userName;
            scheduledJobGr.job_type = this.getParameter('sysparm_job_type');
            scheduledJobGr.job_started = new GlideDateTime();
            if (runningJobsCount.getAggregate('COUNT') > 0) {
                return null;
            } else {
                /* Create scheduled job */
                scheduledJobGr.job_status = this.getParameter('sysparm_job_status');
                scheduledJobGr.current_operation = this.getParameter('sysparm_current_operation');
                job_type = this.getParameter('sysparm_type_flag');
                if(job_type == 'true'){
                    count = this.getParameter('sysparm_count');
                    logs += '[' + new Date(new GlideDateTime().getNumericValue()).toISOString() + '] Total critical label groups fetched : ' + parseInt(count);
                }
                logs += '\n[' + new Date(new GlideDateTime().getNumericValue()).toISOString() + '] ' + this.getParameter('sysparm_logs');
                scheduledJobGr.logs = logs;
                var jobSysId = scheduledJobGr.insert();
                return jobSysId;
            }
        }
    },

    type: 'IllumioManageJobs'

});