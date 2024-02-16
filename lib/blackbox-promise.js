const {SerialPort} = require('serialport');
const events = require('events');

//Promise store
//There is probably a better way to do this.
//Either way, this idealy needs to be multi-command capable so we are able to use promise based commands inside existing promises if needed.
//Although a lot of the returns are handled by events where they need to be used during primoses as the host application will need to respond mid-promise.
var promises = {
  currentState: 'idle',
  currentResolve: null,
  curretReject: null,
}

var port = null;
var testObject = {};
var currentTestID = '-1';
var inspectObject = {};

//Internal functions
var _bb = {
  //Send a command and data to instrument
  //Prepend BB; and append \r, separate commands with ;
  send: function (data) {
    //If data is array of commands/data then join them as apporoiate
    if (Array.isArray(data)) {
      data = data.join('; ');
    }
    data = "BB; " + data + "\r";
    blackbox.events.emit("tx", data);
    port.write(data);
  },

  //Process a message from the instrument
  processMessage: function(msg){
    msg = msg.split(";").map((m) => m.trim());

    if (msg[0] != "BB"){
      blackbox.events.emit("debug", "Malformed message recieved: " + msg);
      return;
    }
    var cmd = msg[1].split(" ")[0];
    switch(cmd){
      //This message with relevant error code and description will be returned from the instrument if command cannot be executed. 
      case "ERROR":
        promises.curretReject({origin: "Blackbox", message: msg[1]});
        break;
      //With this command return the instrument signals that it has finished processing the last command.  
      case "DONE":
        if(promises.currentState == 'enable' || promises.currentState == 'disable' || promises.currentState == 'reset' || promises.currentState == 'wakeup'){
          promises.currentState = 'idle';
          promises.currentResolve();
        }
        break;
      //With this command return instrument displays the status of the Black Box properties. 
      case "STATUS":
        var status = msg[2].split(" = ")[1];
        if (promises.currentState == 'connect' || promises.currentState == 'status'){
          promises.currentState = 'idle';
          blackbox.connected = true;
          blackbox.enabled = (status == '1');
          promises.currentState = 'idle';
          promises.currentResolve({enabled: status == '1'});
        }
        break;
      //With this command the instrument tells the user that there is a message on the screen waiting for user input.  
      case "MSG":
        var message = {};
        //TODO - Convert to chunk function in case they change the order of the fields
        message.windowId = msg[2].split("=")[1].trim();
        message.type = msg[3].split(" ")[0].trim().toLowerCase();
        if (message.type == "notification" || message.type == "ask") message.msgId = msg[3].split(" ")[1].trim();
        if (message.type == "keyboard") message.keyboardType = msg[3].split(" ")[1].trim();
        message.text = msg[4].split("=")[1].trim();
        message.text = message.text.replace(/%0D/g, "\r").replace(/%0A/g, "\n").replace(/%3B/g, ";").replace(/%25/g, "%");
        blackbox.events.emit("msg", message);
        break;
      //Instrument reports data about the active inspection
      case "IS":
        var subCmd = msg[2].split(" ")[0];
        switch(subCmd){
          case "START":
            inspectObject = {check_boxes: []};
            break;
          case "END_DEFINITION":
            blackbox.events.emit('inspection', inspectObject);
            break;
          case "NAME":
            //TODO - Convert to chunk function in case they change the order of the fields
            inspectObject.name = msg[2].split("=")[1].trim();
            inspectObject.values = msg[3].split("=")[1].trim().split(",");
            break;
          case "CHECK_BOX":
            var this_cb = {};
            //TODO - Convert to chunk function in case they change the order of the fields
            this_cb.caption = msg[3].split("=")[1].trim();
            this_cb.values = msg[4].split("=")[1].trim().split(",");
            this_cb.id = msg[5].split("=")[1].trim();
            this_cb.parent_id = msg[6].split("=")[1].trim();
            inspectObject.check_boxes.push(this_cb);
            break;
          case "END":
            blackbox.events.emit('inspectionEnd');
            break;
          default:
            blackbox.events.emit("debug", "Unknown IS command: " + subCmd);
            break;
        }
        break;
      
      //Instrument reports data about the active single test. During Auto Sequence® execution ST (Single test) will only appear if SEND_ST INFO command is previously set.  
      case "ST":
      //Instrument reports data about the active Auto Sequence® (AT). 
      case "AT":
        var status = msg[2].split(" ")[0];
        switch(status){
          //Instrument reports that the test or sequence has started.
          case "START":
            if(!(promises.currentState == 'autotest' && cmd == "ST")){ //Don't reset the stored test data if it's a single test that's part of an autotest
              testObject = {}; 
            }
            currentTestID = msg[2].split(" ")[1] || 0;
            break;
          //Instrument reports that the test or sequence has ended.
          case "END":
            if(promises.currentState == 'autotest' && cmd == 'ST'){//Clear the test ID if it's a single test that's part of an autotest
              currentTestID = '-1';
            } else { //Otherwise return the promise with the test data as either it's a single test or the whole autotest has finished
              promises.currentState = 'idle';
              promises.currentResolve(testObject);
              blackbox.testInProgress = false;
            }
            break;
          //Safety touch pre-test notifications.
          case "TOUCH_TEST":
            if(msg[2].includes("REQUIRED"))
              blackbox.events.emit('userInteraction', "Touch Test");
            if(msg[2].includes("PASSED"))
              blackbox.events.emit('userInteractionEnd', "Touch Test");
            if(msg[2].includes("FAILED"))
              //TODO - Should this reject the promise?, or does it just get the user to retry?
              blackbox.events.emit('userInteraction', "Touch Test Failed");
            break;
          //Lists currently available user actions. 
          case "ACTION":
            var actions = msg[2].split("=")[1].split(",");
            actions = actions.map((a) => a.trim());
            blackbox.events.emit('action', actions);
          //Instrument reports that the Auto Sequence® has stopped in the “Operation after end of single test” screen.  
          case "STEP_END_DECISION":
            blackbox.events.emit('stepEndDecision');
            //TODO - Should this use 'HELP' to get the available actions?
            break;
          //Instrument reports appliance info from the flow command Appliance Info.
          case "APPLIANCE_INFO":
            //TODO
            break;
          //Instrument reports that the Auto Sequence® has stopped in an PAUSE flow command. 
          case "PAUSE" :
            //TODO - Implement retrieving details of the pause screen
            //PAUSE; TYPE = {type}; DURATION = {duration}; TEXT = {text}; IMAGE = {image}
            blackbox.events.emit('pause');
            //TODO - Should this use 'HELP' to get the available actions?
            break;
          //Stream of the single test.
          case "STREAM":
            //TODO
            break;
          //Otherwise it should just be info and it can be added to the test parameters/results object ... so just process the chunk
          //Proboably better to implement this explicitly then catch anythign else that falls through that may not be documented
          default:
            for(var i = 2; i < msg.length; i++){
              _bb.processChunk(msg[i]);
            }
            break;
        }
      break;
    }
  },
  //Processes a chunk of data from a command response (i.e. between ;s)
  //Currenty this just dumps to the global testObject object, but it should be refactored to be more generic
  processChunk: function(chunk){
    container = testObject;
    if(currentTestID != '-1'){
      if (!(currentTestID in testObject)) testObject[currentTestID] = {};
      container = container[currentTestID];
    }
    
    chunk = chunk.trim();
    var segments = chunk.split(" ");
    switch(segments.length){
      case 1: //Just a response i.e. END
        //Anything that needed to be acted on here should have been caught by it's own case above hopefully. There might be some boolean responses that needed to be handled here though.
        //TODO - Testing required to see if there are any responses that need to be handled here
        blackbox.events.emit("debug", "Unhandled response to 1 in chunker: " + segments[0])
        break;
      case 2: //Response with data i.e. START 1
        //TODO - Testing required to see if there are any responses that need to be handled here
        blackbox.events.emit("debug", "Unhandled response to 2 in chunker: " + segments[0] + "::" + segments[1])
        break;
      case 3: //Parameter with Value i.e. STATUS = 1
        var pname = segments[0].toLowerCase();
        if (!(pname in container)) container[pname] = {};
        container[pname] = segments[2];
        break;
      case 4: //Parameter with Lookup and Value
      case 5: //Parameter with Lookup, Value and Unit
        var pname = segments[0].toLowerCase()+"s";
        if (pname == "statuss") pname = "statuses";
        if (!(pname in container)) container[pname] = {};
        container[pname][segments[1].toLowerCase()] = segments[3];
        if (segments.length == 5) container[pname][segments[1].toLowerCase()] += " " + segments[4];
        break;
      default:
        blackbox.events.emit("debug", "Chunker not programmed to process a chunk of this size - " + chunk);
        break;
    }
  }
}

//Event handlers for underlying serial port
var comms = {
  error: function(err){
    blackbox.events.emit("debug", 'serialPort Error: ' + err.message);
    blackbox.connected = false;
    err.origin = "SerialPort";
    promises.curretReject(err);
  },
  open: function(){
    blackbox.connected = true;
    blackbox.getStatus();
  },
  close: function(){
    blackbox.events.emit("debug", 'serialPort Closed');
    blackbox.connected = false;
    promises.curretReject({origin: "SerialPort", message: "SerialPort Closed"});
  },
  data: function(data){
    var lines = data.toString().split("\r");
    for(var i = 0; i < lines.length; i++){
      if (lines[i].trim() == "") continue;
      blackbox.events.emit("rx", lines[i]);
      _bb.processMessage(lines[i].trim());
    }
  }
}

//Public Functions
var blackbox = {
    connected: false,
    testInProgress: false,
    events: new events.EventEmitter(),
    //---- Communication Functions ----
    connect: function(conStr) {
      return new Promise(function(resolve, reject) {
        promises.currentResolve = resolve;
        promises.curretReject = reject;
        promises.currentState = 'connect';
          
        port = new SerialPort({path: conStr, baudRate: 115200});
        port.on('open',  comms.open);
        port.on('error', comms.error);
        port.on('close', comms.close);
        port.on('data',  comms.data);
      });
    },
    disconnect: function() {
        return new Promise(async function(resolve, reject) {
            await blackbox.reset();
            await blackbox.disable();
            port.close();
            resolve();
        });
    },

    //---- Metrel Commands ----
    //https://www.metrel.si/support/confluence/mpd/en/applications-and-tips/black-box-protocol?preview=/15401254/59703304/Black_Box_protocol_ANG_Ver_1.7.4.pdf

    //Verify the instrument about the Black Box status.
    //Returns a promise that resolves with the status
    getStatus: function () {
      return new Promise(function(resolve, reject) {
        if (promises.currentState == 'idle'){ //Don't overwrite an existing promise //TODO - store multuple promises if we are cascaded
          promises.currentResolve = resolve;
          promises.curretReject = reject;
          promises.currentState = 'status';
        }
        _bb.send('STATUS');
      });
    },

    //Puts the instrument into Black Box mode 
    //Options - DEBUG_TEXTS, MEASURING_STATUSES, ICONS, ACTIONS
    enable: function (password = "", options = []) {
      return new Promise(function(resolve, reject) {
        if(promises.currentState == 'idle'){ //TODO - store multuple promises if we are cascaded
          promises.currentResolve = resolve;
          promises.curretReject = reject;
          promises.currentState = 'enable';
        }

        var data = ['ENABLE = 1'];
        if(password != '') data.push("PASSWORD = " + password);
        if(options.length > 0) data.push(...options);
        _bb.send(data);
      });
    },
    // Exits Black Box mode
    // Waits for the instrument to be reply before resolving
    disable: function(){
      return new Promise(function(resolve, reject) {
        if(promises.currentState == 'idle'){
          promises.currentResolve = resolve;
          promises.curretReject = reject;
          promises.currentState = 'disable';
        }
        _bb.send('ENABLE = 0');
        this.blackbox = false;
      });
    },

    // Sets the instrument into default Black Box idle state
    // Waits for the instrument to be reply before resolving
    reset: function(){
      return new Promise(function(resolve, reject) {
        if(promises.currentState == 'idle'){
          promises.currentResolve = resolve;
          promises.curretReject = reject;
          promises.currentState = 'reset';
        }
        _bb.send('RESET');
      });
    },

    //When the instrument gets into the sleep mode (full charging screen) it can be awakened by this command
    wakeUp: function(){
      return new Promise(function(resolve, reject) {
        if(promises.currentState == 'idle'){
          promises.currentResolve = resolve;
          promises.curretReject = reject;
          promises.currentState = 'wakeup';
        }
        _bb.send('WAKEUP');
      });
    },

    //Starts a Singletest with ID #id. Optional parameters should be in the order as shown
    //Settings - HV_PASSWORD: XXXX, SEND_INFO: 0/1, TOUCH_TEST: ENABLE/DISABLE
    //TODO - Convert the params, limits, extParams, and settings to an 'options' object
    singleTest: function(id, params = {}, limits = {}, extParams = {}, settings = {}){
      return new Promise(function(resolve, reject) {
        if(promises.currentState != 'idle'){
          reject({origin: "Blackbox", message: "Blackbox logic is not in idle state"});
        }

        promises.currentResolve = resolve;
        promises.curretReject = reject;
        promises.currentState = 'singletest';

        var data = ['START_SINGLETEST ' + id];
        for(var p in params){
          data.push(`P ${p} = ${params[p]}`);
        }
        for(var l in limits){
          data.push(`L ${l} = ${limits[l]}`)
        }
        for(var x in extParams){
          data.push(`X ${x} = ${extParams[x]}`);
        }
        for(var s in settings){
          data.push(`${s.toUpperCase()} = ${settings[s]}`);
        }
        _bb.send(data);
        blackbox.testInProgress = true;
      });
    },

  //starts an Auto Sequence® 
  //Settings - SEND_ST_INFO: [INTERMEDIATE_RESULTS, AT_STEP_INFO], SAVE_RESULT, HV_PASSWORD = XXXX //Warning - This is array so password needs to be as a string with =
  autoTest: function(name, settings = ['SEND_ST_INFO']){
    return new Promise(function(resolve, reject) {
      if(promises.currentState != 'idle'){
        reject({origin: "Blackbox", message: "Blackbox logic is not in idle state"});
      }

      promises.currentResolve = resolve;
      promises.curretReject = reject;
      promises.currentState = 'autotest';

      var data = ['START_AUTOTEST; NAME = ' + name];
      data.push(...settings);
      _bb.send(data);
    });
  },

  //Within the execution of Inspection, the user can set the Inspection status and Check box statuses
  inspectionStatus: function(status){ //Overall status
    var data = ['IS', 'STATUS = ' + status];
    _bb.send(data);
  },  
  inspectionCheckBox: function(id, status){ //Individual status check box
    var data = ['IS', 'CHECKBOX_ID =  ' + id, "STATUS = " + status];
    _bb.send(data);
  },

  //This command executes an action on the instrument. Currently supported actions are Control Panel buttons. 
  action: function(action){
    _bb.send('ACTION = ' + action);
  },

  //With this command the user answers to MSG command sent by the instrument. 
  msg: function(id, response){
    _bb.send(["MSG "+id, response]);
  },

  //This command executes the equivalent of a keyboard button press. It operates in Single Test and Auto Sequence® menus.  
  key: function(key){
    _bb.send('KEY = ' + key);
  },

  //Prints help for certain commands. Currently supported commands: ACTION, KEY
  help: function(command){
    _bb.send(['HELP', command]);
  }
}

module.exports = blackbox;