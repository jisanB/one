define(function(require) {
  
  var TemplateHTML = require('hbs!./accounting/html');
  var Locale = require('utils/locale');
  var OpenNebulaVM = require('opennebula/vm');
  var Notifier = require('utils/notifier');
  var ResourceSelect = require('utils/resource-select');

  require('flot');
  require('flot.stack');
  require('flot.resize');
  require('flot.tooltip');
  require('flot.time');

  function _html(){
    var html = TemplateHTML({});

    return html;
  };

  // context is a jQuery selector
  // The following options can be set:
  //   fixed_user     fix an owner user ID
  //   fixed_group    fix an owner group ID
  //   init_group_by  "user", "group", "vm". init the group-by selector
  //   fixed_group_by "user", "group", "vm". set a fixed group-by selector
  function _setup(context, opt) {
    if (opt == undefined){
      opt = {};
    }

    //--------------------------------------------------------------------------
    // Set column width
    //--------------------------------------------------------------------------

    var n_columns = 3; // start, end time, button

    if (opt.fixed_user == undefined && opt.fixed_group == undefined){
      n_columns += 1;     //acct_owner_container
    }

    if(opt.fixed_group_by == undefined){
      n_columns += 1;     //acct_group_by_container
    }

    if (n_columns > 4){
      // In this case the first row will have 4 inputs, and the
      // get accounting button will overflow to the second row
      n_columns = 4;
    }

    var width = parseInt(12 / n_columns);

    $("#acct_start_time_container", context).addClass("large-"+width);
    $("#acct_end_time_container",   context).addClass("large-"+width);
    $("#acct_group_by_container",   context).addClass("large-"+width);
    $("#acct_owner_container",      context).addClass("large-"+width);
    $("#acct_button_container",     context).addClass("large-"+width);

    //--------------------------------------------------------------------------
    // Init start time to 1st of last month
    //--------------------------------------------------------------------------
    var d = new Date();

    d.setDate(1);
    d.setMonth(d.getMonth() - 1);

    $("#acct_start_time", context).val(
      d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2));

    //--------------------------------------------------------------------------
    // Init end time to today
    //--------------------------------------------------------------------------

    d = new Date();

    $("#acct_end_time", context).val(
      d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2));

    //--------------------------------------------------------------------------
    // VM owner: all, group, user
    //--------------------------------------------------------------------------

    if (opt.fixed_user != undefined || opt.fixed_group != undefined){
      $("#acct_owner_container", context).hide();
    } else {
      $("select#acct_owner", context).change(function(){
        var value = $(this).val();

        switch (value){
        case "acct_owner_all":
          $("#acct_owner_select", context).hide();
          break;

        case "acct_owner_group":
          $("#acct_owner_select", context).show();
          ResourceSelect.insert("#acct_owner_select", context, "Group");
          break;

        case "acct_owner_user":
          $("#acct_owner_select", context).show();
          ResourceSelect.insert("#acct_owner_select", context, "User", -1, false,
              '<option value="-1">'+Locale.tr("<< me >>")+'</option>');
          break;
        }
      });
    }

    //--------------------------------------------------------------------------
    // Init group by select
    //--------------------------------------------------------------------------

    if(opt.init_group_by != undefined){
      $("#acct_group_by", context).val(opt.init_group_by);
    }else if(opt.fixed_group_by != undefined){
      $("#acct_group_by", context).val(opt.fixed_group_by);
      $("#acct_group_by_container", context).hide();
    }

    //--------------------------------------------------------------------------
    // Submit request
    //--------------------------------------------------------------------------
    function dateFromString(str) {
      var a = $.map(str.split(/[^0-9]/), function(s) { return parseInt(s, 10) });
      return Date.UTC(a[0], a[1]-1 || 0, a[2] || 1, a[3] || 0, a[4] || 0, a[5] || 0, a[6] || 0);
    }

    $("#acct_submit", context).on("click", function(){
      var start_time = -1;
      var end_time = -1;

      var v = $("#acct_start_time", context).val();
      if (v == ""){
        Notifier.notifyError(Locale.tr("Time range start is mandatory"));
        return false;
      }else{
        start_time = dateFromString(v)
        //start_time = Date.parse(v+' UTC');

        if (isNaN(start_time)){
          Notifier.notifyError(Locale.tr("Time range start is not a valid date. It must be YYYY/MM/DD"));
          return false;
        }

        // ms to s
        start_time = start_time / 1000;
      }

      var v = $("#acct_end_time", context).val();
      if (v != ""){
        end_time = new Date(v+' UTC');

        if (isNaN(end_time)){
          Notifier.notifyError(Locale.tr("Time range end is not a valid date. It must be YYYY/MM/DD"));
          return false;
        }

        // Add 1 to end_date, because the date is initialized at 00:00.
        // The difference for this range  01/01, 31/01  is:
        //   without adjustment: [01, 31)
        //             adjusted: [01, 31]
        end_time.setDate(end_time.getDate() + 1);

        // ms to s
        end_time = end_time.getTime() / 1000;
      }

      var options = {
        "start_time": start_time,
        "end_time": end_time
      };

      if (opt.fixed_user != undefined){
        options.userfilter = opt.fixed_user;
      } else if (opt.fixed_group != undefined){
        options.group = opt.fixed_group;
      } else {
        var select_val = $("#acct_owner_select .resource_list_select", context).val();

        switch ($("select#acct_owner", context).val()){
        case "acct_owner_all":
          break;

        case "acct_owner_group":
          if(select_val != ""){
            options.group = select_val;
          }
          break;

        case "acct_owner_user":
          if(select_val != ""){
            options.userfilter = select_val;
          }
          break;
        }
      }

      OpenNebulaVM.accounting({
        //timeout: true,
        success: function(req, response){
          _fillAccounting(context, req, response, false);
        },
        error: Notifier.onError,
        data: options
      });

      return false;
    });
  };

  function _fillAccounting(context, req, response, no_table) {
    var options = req.request.data[0];

    //--------------------------------------------------------------------------
    // Time slots
    //--------------------------------------------------------------------------

    // start_time is mandatory
    var start = new Date(options.start_time * 1000);
    start.setUTCHours(0,0,0,0);

    var end;
    var now = new Date();

    if (options.end_time != undefined && options.end_time != -1) {
      end = new Date(options.end_time * 1000)
      if (end > now) {
        end = now;
      }
    } else {
      end = now;
    }

    // granularity of 1 day
    var times = [];

    var tmp_time = start;

    while (tmp_time < end) {
      times.push(tmp_time.getTime());

      // day += 1
      tmp_time.setUTCDate( tmp_time.getUTCDate() + 1 );
    }

    // End time is the start of the last time slot. For the last slot,
    // we don't add one day if the date is the current day, we add "up to now".
    if (tmp_time > now) {
      tmp_time = now;
    }

    times.push(tmp_time.getTime());

    //--------------------------------------------------------------------------
    // Flot options
    //--------------------------------------------------------------------------

    var options = {
      colors: ["#0098C3","#0A00C2","#AB00C2","#C20037","#C26B00","#78C200","#00C22A","#00B8C2"],

      xaxis : {
        mode: "time",
        timeformat: "%y/%m/%d",
        color: "#efefef",
        font: {
          color: "#999",
          size: 10
        },
        ticks: 4,
        minTickSize: [1, "day"]
      },
      yaxis : { min: 0,
        color: "#efefef",
        font: {
          color: "#999",
          size: 10
        }
      },
      series: {
        bars: {
          show: true,
          lineWidth: 0,
          fill: true,
          barWidth: 24*60*60*1000 * 0.8,
          align: "center"
        },
        stack: true
      },
      legend : {
        show : false
      },
      grid: {
        borderWidth: 1,
        borderColor: "#efefef",
        hoverable: true
      },
      tooltip: true,
      tooltipOpts: {
        content: "%x | %s | %y"
      }
    };

    //--------------------------------------------------------------------------
    // Group by
    //--------------------------------------------------------------------------

    // TODO: Allow to change group by dynamically, instead of calling oned again
    var group_by_fn;
    var group_by_name;
    var group_by_prefix;
    switch ($("#acct_group_by", context).val()){
    case "user":
      group_by_fn = function(history){
        return history.VM.UID;
      }

      group_by_name = function(history){
        return history.VM.UNAME;
      }

      group_by_prefix = Locale.tr("User");

      break;

    case "group":
      group_by_fn = function(history){
        return history.VM.GID;
      }

      group_by_name = function(history){
        return history.VM.GNAME;
      }

      group_by_prefix = Locale.tr("Group");

      break;

    case "vm":
      group_by_fn = function(history){
        return history.OID;
      }

      group_by_name = function(history){
        return history.VM.NAME;
      }

      group_by_prefix = Locale.tr("VM");

      break;
    }

    //--------------------------------------------------------------------------
    // Filter history entries
    //--------------------------------------------------------------------------

    // TODO filter
    // True to proccess, false to discard
    var filter_by_fn = function(history){
      // return history.OID == 3605 || history.OID == 2673;
      return true;
    }

    //--------------------------------------------------------------------------
    // Process data series for flot
    //--------------------------------------------------------------------------

    var series = {};

    $("#acct_no_data", context).hide();

    if(response.HISTORY_RECORDS == undefined){
      $("#acct_placeholder", context).show();
      $("#acct_content", context).hide();

      $("#acct_no_data", context).show();
      return false;
    }

    $.each(response.HISTORY_RECORDS.HISTORY, function(index, history){

      /*
      if(!filter_by_fn(history)){
        return true; //continue
      }
      */
      var group_by = group_by_fn(history);

      if (series[group_by] == undefined){
        series[group_by] = {};
        series[group_by].data_points = {};

        series[group_by].data_points[times[0]] = {};
        series[group_by].data_points[times[times.length-2]] = {};

        series[group_by].data_points[times[0]].CPU_HOURS = 0;
        series[group_by].data_points[times[times.length-2]].CPU_HOURS = 0;

        series[group_by].data_points[times[0]].MEM_HOURS = 0;
        series[group_by].data_points[times[times.length-2]].MEM_HOURS = 0;

        var name = group_by_name(history);
        series[group_by].name = name;
        series[group_by].label = group_by_prefix+" "+group_by+" "+name;
      }

      var serie = series[group_by].data_points;

      for (var i = 0; i<times.length-1; i++){

        var t = times[i];
        var t_next = times[i+1];

        // To stack values properly, flot needs an entry for all
        // the time slots
        if(serie[t] == undefined){
          serie[t] = {};
          serie[t].CPU_HOURS = 0;
          serie[t].MEM_HOURS = 0;
        }

        if( (history.ETIME*1000 > t || history.ETIME == 0) &&
            (history.STIME != 0 && history.STIME*1000 <= t_next) ) {

          var stime = t;
          if(history.STIME != 0){
            stime = Math.max(t, history.STIME*1000);
          }

          var etime = t_next;
          if(history.ETIME != 0){
            etime = Math.min(t_next, history.ETIME*1000);
          }

          var n_hours = (etime - stime) / 1000 / 60 / 60;

          // --- cpu ---

          var val = parseFloat(history.VM.TEMPLATE.CPU) * n_hours;

          if (!isNaN(val)){
            serie[t].CPU_HOURS += val;
          }

          // --- mem ---

          var val = parseInt(history.VM.TEMPLATE.MEMORY)/1024 * n_hours;

          if (!isNaN(val)){
            serie[t].MEM_HOURS += val;
          }
        }
      }
    });

    //--------------------------------------------------------------------------
    // Create series, draw plots
    //--------------------------------------------------------------------------

    var cpu_plot_series = [];
    var mem_plot_series = [];

    $.each(series, function(key, val){
      var cpu_data = [];
      var mem_data = [];

      $.each(val.data_points, function(time,num){
        cpu_data.push([parseInt(time),num.CPU_HOURS]);
        mem_data.push([parseInt(time),num.MEM_HOURS]);
      });

      cpu_plot_series.push(
      {
        label: val.label,
        name: val.name,
        id: key,
        data: cpu_data
      });

      mem_plot_series.push(
      {
        label: val.label,
        name: val.name,
        id: key,
        data: mem_data
      });
    });

    var cpu_plot = $.plot($("#acct_cpu_graph", context), cpu_plot_series, options);
    var mem_plot = $.plot($("#acct_mem_graph", context), mem_plot_series, options);

    //--------------------------------------------------------------------------
    // Init dataTables
    //--------------------------------------------------------------------------

    if (no_table) {
      $(".acct_table",context).hide();
    } else {
      $("#acct_cpu_datatable",context).dataTable().fnClearTable();
      $("#acct_cpu_datatable",context).dataTable().fnDestroy();

      $("#acct_cpu_datatable thead",context).remove();
      $("#acct_cpu_datatable",context).width("100%");


      $("#acct_mem_datatable",context).dataTable().fnClearTable();
      $("#acct_mem_datatable",context).dataTable().fnDestroy();

      $("#acct_mem_datatable thead",context).remove();
      $("#acct_mem_datatable",context).width("100%");


      cpu_plot_data = cpu_plot.getData();
      mem_plot_data = mem_plot.getData();

      var thead =
        '<thead>\
          <tr>\
            <th>'+Locale.tr("Date UTC")+'</th>\
            <th>'+Locale.tr("Total")+'</th>';

      $.each(cpu_plot_data, function(i, serie){
        thead += '<th style="border-bottom: '+serie.color+' 4px solid !important;'+
              ' border-left: 10px solid white; border-right: 5px solid white;'+
              ' white-space: nowrap">'+
              group_by_prefix+' '+serie.id+'<br/>'+serie.name+'</th>';
      });

      thead += '</tr></thead>';

      $("#acct_cpu_datatable",context).append(thead);

      thead =
        '<thead>\
          <tr>\
            <th>'+Locale.tr("Date UTC")+'</th>\
            <th>'+Locale.tr("Total")+'</th>';

      $.each(mem_plot_data, function(i, serie){
        thead += '<th style="border-bottom: '+serie.color+' 4px solid !important;'+
              ' border-left: 10px solid white; border-right: 5px solid white;'+
              ' white-space: nowrap">'+
              group_by_prefix+' '+serie.id+'<br/>'+serie.name+'</th>';
      });

      thead += '</tr></thead>';

      $("#acct_mem_datatable",context).append(thead);


      var cpu_dataTable_data = [];
      var mem_dataTable_data = [];

      for (var i = 0; i<times.length-1; i++){
        var t = times[i];

        var cpu_row = [];
        var mem_row = [];

        var time_st = time_UTC(t);

        cpu_row.push(time_st);
        mem_row.push(time_st);

        cpu_row.push(0);
        mem_row.push(0);

        var cpu_total = 0;
        var mem_total = 0;

        $.each(series, function(key, val){
          var v = val.data_points[t];

          if(v != undefined){
            var cpu_v = (v.CPU_HOURS * 100).toFixed() / 100;
            var mem_v = (v.MEM_HOURS * 100).toFixed() / 100;

            cpu_total += cpu_v;
            mem_total += mem_v;

            cpu_row.push(cpu_v);
            mem_row.push(mem_v);
          } else {
            cpu_row.push(0);
            mem_row.push(0);
          }
        });

        cpu_row[1] = (cpu_total * 100).toFixed() / 100;
        mem_row[1] = (mem_total * 100).toFixed() / 100;

        cpu_dataTable_data.push(cpu_row);
        mem_dataTable_data.push(mem_row);
      }

      var acct_cpu_dataTable = $("#acct_cpu_datatable",context).dataTable({
        "bSortClasses" : false,
        "bDeferRender": true,
        "aoColumnDefs": [
        { "bSortable": false, "aTargets": ['_all'] },
        ]
      });

      var acct_mem_dataTable = $("#acct_mem_datatable",context).dataTable({
        "bSortClasses" : false,
        "bDeferRender": true,
        "aoColumnDefs": [
        { "bSortable": false, "aTargets": ['_all'] },
        ]
      });

      if (cpu_dataTable_data.length > 0) {
        acct_cpu_dataTable.fnAddData(cpu_dataTable_data);
      }

      if (mem_dataTable_data.length > 0) {
        acct_mem_dataTable.fnAddData(mem_dataTable_data);
      }
    }

    $("#acct_placeholder", context).hide();
    $("#acct_content", context).show();
  }

  /**
   * Format time in UTC, YYYY/MM/DD
   * time is in ms
   */
  function time_UTC(time){
    var d = new Date(time);

    return d.getUTCFullYear() + '/' + (d.getUTCMonth()+1) + '/' + d.getUTCDate();
  }

  return {
    'html': _html,
    'setup': _setup,
    'fillAccounting': _fillAccounting
  };
});